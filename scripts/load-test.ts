/**
 * load-test.ts —— 45 併發模擬課堂（STEP 13）
 *
 *   npm run loadtest                          # 45 人 × 3 分鐘（快速煙霧測試）
 *   npm run loadtest -- --minutes 30          # BUILD_PLAN 指定的完整壓測
 *   npm run loadtest -- --students 45 --minutes 30 --base https://…
 *
 * 每個虛擬學生跑完整迴圈：
 *   登入 → 開場次 → 打字（事件批次）→ 問 AI → 複製貼上 → 快照 → 交件
 *   → 看鏡子（mirror_view）→ 送反思
 *
 * 統計 BUILD_PLAN §6 STEP 13 的三個驗收數字：
 *   事件遺漏率、反思送出成功率、/api/events p95
 *
 * 【測試帳號會留下痕跡】events / chat_messages / reflections 是 append-only，
 * 這支腳本產生的資料**永遠刪不掉**。務必只對開發用的 Supabase 專案跑，
 * 不要對正式研究的專案跑。腳本啟動時會再問一次。
 */
import { createInterface } from "node:readline/promises";
import { Client } from "pg";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const OFF = "[0m";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const BASE = arg("base") ?? process.env.VERIFY_BASE_URL ?? "http://localhost:3210";
const STUDENTS = Number(arg("students") ?? 45);
const MINUTES = Number(arg("minutes") ?? 3);
/**
 * 進場時間差（秒）。學生不會在同一毫秒登入——真實課堂是陸續開機、陸續登入。
 * 全部同時進場會製造出現實不存在的尖峰，把 p95 灌到失真。
 * 要看同步尖峰的最壞情況就下 --ramp 0。
 */
const RAMP_SECONDS = Number(arg("ramp") ?? 30);
const PIN = "111111";

/**
 * 每輪一組新代號。
 *
 * 沿用固定代號的話，第二輪會撈到上一輪**已交件**的場次（一位學生一份作業
 * 只有一個場次），於是所有對話都回 409「這次已經交出去了」——第一次跑
 * 就踩到，135 次失敗全是這個。壓測要重複跑，帳號就得跟著換。
 */
const RUN_ID = Date.now().toString(36).toUpperCase().slice(-5);

/** 一節課的節奏。真實學生不會每秒打字，這裡刻意貼近實際密度。 */
const TYPE_INTERVAL_MS = 4000; // 每 4 秒一批 keystroke（與 capture.ts 的上限一致）
const CHAT_EVERY = 8; // 每 8 批打字問一次 AI
const PASTE_EVERY = 15; // 每 15 批貼一次

type Timing = { path: string; ms: number; ok: boolean };

const timings: Timing[] = [];

async function timed(
  path: string,
  init: RequestInit,
): Promise<{ res: Response; ms: number }> {
  const start = performance.now();
  const res = await fetch(`${BASE}${path}`, init);
  const ms = performance.now() - start;
  timings.push({ path: path.split("?")[0] ?? path, ms, ok: res.ok });
  return { res, ms };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // 最近秩法（nearest-rank）：p95 就是「第 ceil(0.95n) 快的那一筆」，
  // 定義單純，不需要內插，報告裡也講得清楚。
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? 0;
}

type StudentResult = {
  code: string;
  eventsEmitted: number;
  submitted: boolean;
  reflected: boolean;
  errors: string[];
};

async function runStudent(
  code: string,
  endAt: number,
  startDelayMs: number,
): Promise<StudentResult> {
  const result: StudentResult = {
    code,
    eventsEmitted: 0,
    submitted: false,
    reflected: false,
    errors: [],
  };

  try {
    await sleep(startDelayMs);
    const login = await timed("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, pin: PIN }),
    });
    if (!login.res.ok) {
      result.errors.push(`登入失敗 ${login.res.status}`);
      return result;
    }
    const cookie = (login.res.headers.getSetCookie?.() ?? [])
      .map((line) => line.split(";")[0])
      .join("; ");
    const headers = { "Content-Type": "application/json", Cookie: cookie };

    const assignmentId = await firstAssignmentId();
    const created = await timed("/api/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({ assignment_id: assignmentId }),
    });
    if (!created.res.ok) {
      result.errors.push(`開場次失敗 ${created.res.status}`);
      return result;
    }
    const session = (await created.res.json()) as { session: { id: string } };
    const sessionId = session.session.id;

    let seq = 0;
    let batch = 0;
    let text = "";

    while (Date.now() < endAt) {
      batch += 1;
      const sentence = `第 ${batch} 段，${code} 在課堂上寫下的內容。`;
      const before = text;
      text += sentence;

      const events: { client_seq: number; type: string; payload: unknown; ts: string }[] = [];
      seq += 1;
      events.push({
        client_seq: seq,
        type: "keystroke_batch",
        payload: { patch: "", before_len: before.length, after_len: text.length },
        ts: new Date().toISOString(),
      });

      if (batch % PASTE_EVERY === 0) {
        seq += 1;
        events.push({
          client_seq: seq,
          type: "paste",
          payload: { origin: "external", length: 20, sha1: "x", matched: false },
          ts: new Date().toISOString(),
        });
      }

      const posted = await timed("/api/events", {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: sessionId, events }),
      });
      if (posted.res.ok) result.eventsEmitted += events.length;
      else result.errors.push(`事件寫入 ${posted.res.status}`);

      if (batch % CHAT_EVERY === 0) {
        const chat = await timed("/api/chat", {
          method: "POST",
          headers,
          body: JSON.stringify({
            session_id: sessionId,
            message: `${code} 想問：這一段可以怎麼寫得更具體？`,
          }),
        });
        // SSE 要讀完，否則連線一直掛著，45 人同時跑會把連線池吃光。
        if (chat.res.ok && chat.res.body) await chat.res.text();
        else if (!chat.res.ok) result.errors.push(`對話 ${chat.res.status}`);
      }

      await sleep(TYPE_INTERVAL_MS);
    }

    // 快照（交件前必須有，否則算不出 DNA）
    const snapshot = await timed("/api/snapshots", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        client_seq: seq,
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        },
      }),
    });
    if (!snapshot.res.ok) result.errors.push(`快照 ${snapshot.res.status}`);

    seq += 1;
    await timed("/api/events", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        events: [
          { client_seq: seq, type: "submit", payload: {}, ts: new Date().toISOString() },
        ],
      }),
    });
    result.eventsEmitted += 1;

    const submitted = await timed("/api/submit", {
      method: "POST",
      headers,
      body: JSON.stringify({ session_id: sessionId }),
    });
    result.submitted = submitted.res.ok;
    if (!submitted.res.ok) result.errors.push(`交件 ${submitted.res.status}`);

    // 看鏡子
    const viewedDnaAt = new Date().toISOString();
    seq += 1;
    await timed("/api/events", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        events: [
          {
            client_seq: seq,
            type: "mirror_view",
            payload: { part: "dna", at: viewedDnaAt },
            ts: viewedDnaAt,
          },
        ],
      }),
    });
    result.eventsEmitted += 1;

    const viewedReplayAt = new Date().toISOString();
    seq += 1;
    await timed("/api/events", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        events: [
          {
            client_seq: seq,
            type: "mirror_view",
            payload: { part: "replay", at: viewedReplayAt },
            ts: viewedReplayAt,
          },
        ],
      }),
    });
    result.eventsEmitted += 1;

    const answers = (await promptQuestions()).map((q) => ({
      question_id: q.id,
      text: `${code} 的回答：這一題我想了一下，我覺得當時會那樣做是因為時間不夠，下次會先自己寫完再問。`,
    }));

    const reflected = await timed("/api/reflections", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_id: sessionId,
        answers,
        viewed_dna_at: viewedDnaAt,
        viewed_replay_at: viewedReplayAt,
      }),
    });
    result.reflected = reflected.res.ok;
    if (!reflected.res.ok) {
      const body = await reflected.res.text();
      result.errors.push(`反思 ${reflected.res.status} ${body.slice(0, 60)}`);
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let cachedAssignment: string | null = null;
async function firstAssignmentId(): Promise<string> {
  if (cachedAssignment) return cachedAssignment;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const r = await db.query<{ id: string }>(
      "select id from assignments order by order_no limit 1",
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error("資料庫裡沒有作業，先在 /admin 建立。");
    cachedAssignment = id;
    return id;
  } finally {
    await db.end();
  }
}

let cachedQuestions: { id: string }[] | null = null;
async function promptQuestions(): Promise<{ id: string }[]> {
  if (cachedQuestions) return cachedQuestions;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const version = process.env.REFLECTION_PROMPT_VERSION ?? "v1";
    const r = await db.query<{ questions: { id: string }[] }>(
      "select questions from reflection_prompts where version = $1",
      [version],
    );
    cachedQuestions = r.rows[0]?.questions ?? [];
    return cachedQuestions;
  } finally {
    await db.end();
  }
}

/** 建立（或沿用）壓測帳號。代號固定，重跑不會一直長出新帳號。 */
async function ensureStudents(count: number): Promise<string[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const donor = await db.query<{ pin_hash: string; class_id: string }>(
      "select pin_hash, class_id from participants where code = 'S-01'",
    );
    const row = donor.rows[0];
    if (!row) throw new Error("找不到 S-01（用它的 PIN 雜湊與班級）。");

    const codes: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      const code = `LT${RUN_ID}-${String(i).padStart(2, "0")}`;
      codes.push(code);
      await db.query(
        `insert into participants (code, pin_hash, class_id, role)
         values ($1, $2, $3, 'student') on conflict (code) do nothing`,
        [code, row.pin_hash, row.class_id],
      );
    }
    return codes;
  } finally {
    await db.end();
  }
}

/** 對照資料庫實際落地的事件數，算遺漏率。 */
async function countStoredEvents(codes: readonly string[]): Promise<number> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const r = await db.query<{ n: string }>(
      `select count(*) as n from events e
         join sessions s on s.id = e.session_id
         join participants p on p.id = s.participant_id
        where p.code = any($1)`,
      [[...codes]],
    );
    return Number(r.rows[0]?.n ?? 0);
  } finally {
    await db.end();
  }
}

async function confirmTarget(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  const host = url ? new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname : "（未設定）";
  console.log(`${BOLD}壓測目標${OFF}`);
  console.log(`  應用程式：${BASE}`);
  console.log(`  資料庫　：${host}`);
  console.log(
    `${RED}${BOLD}⚠ 這支腳本會寫入永遠刪不掉的資料（events / reflections 是 append-only）。${OFF}`,
  );
  console.log(`${RED}  只對開發用的 Supabase 專案跑，不要對正式研究的專案跑。${OFF}`);

  if (process.argv.includes("--yes")) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("確定要繼續嗎？輸入 yes：");
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("已取消。");
    process.exit(0);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  await confirmTarget();

  console.log(`\n${BOLD}準備 ${STUDENTS} 個壓測帳號…${OFF}`);
  const codes = await ensureStudents(STUDENTS);
  const eventsBefore = await countStoredEvents(codes);

  const endAt = Date.now() + MINUTES * 60 * 1000;
  console.log(
    `${BOLD}開跑：${STUDENTS} 人併發 × ${MINUTES} 分鐘${OFF}` +
      `${DIM}（每 ${TYPE_INTERVAL_MS / 1000} 秒一批事件，進場時間差 ${RAMP_SECONDS} 秒）${OFF}`,
  );

  const started = performance.now();
  const results = await Promise.all(
    codes.map((code, index) =>
      runStudent(code, endAt, (index / Math.max(1, codes.length)) * RAMP_SECONDS * 1000),
    ),
  );
  const wallMs = performance.now() - started;

  const eventsAfter = await countStoredEvents(codes);
  const stored = eventsAfter - eventsBefore;
  const emitted = results.reduce((sum, r) => sum + r.eventsEmitted, 0);
  const lossRate = emitted === 0 ? 0 : (emitted - stored) / emitted;

  const submitted = results.filter((r) => r.submitted).length;
  const reflected = results.filter((r) => r.reflected).length;
  const reflectionRate = STUDENTS === 0 ? 0 : reflected / STUDENTS;

  const eventTimings = timings.filter((t) => t.path === "/api/events").map((t) => t.ms);
  const p95 = percentile(eventTimings, 95);
  const p50 = percentile(eventTimings, 50);
  const p99 = percentile(eventTimings, 99);

  console.log(`\n${"─".repeat(64)}`);
  console.log(`${BOLD}壓測結果${OFF}　${(wallMs / 1000 / 60).toFixed(1)} 分鐘`);
  console.log("─".repeat(64));

  const pass = (ok: boolean): string => (ok ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`);

  console.log(
    `${pass(lossRate === 0)} 事件遺漏率　${(lossRate * 100).toFixed(3)}%` +
      `${DIM}（送出 ${emitted}，落庫 ${stored}）　驗收：0%${OFF}`,
  );
  console.log(
    `${pass(reflectionRate === 1)} 反思成功率　${(reflectionRate * 100).toFixed(1)}%` +
      `${DIM}（${reflected}/${STUDENTS}）　驗收：100%${OFF}`,
  );
  console.log(
    `${pass(p95 < 800)} /api/events p95　${p95.toFixed(0)}ms` +
      `${DIM}（p50 ${p50.toFixed(0)} / p99 ${p99.toFixed(0)}，共 ${eventTimings.length} 次）　驗收：<800ms${OFF}`,
  );
  console.log(`${DIM}　 交件成功 ${submitted}/${STUDENTS}${OFF}`);

  console.log(`\n${BOLD}各端點延遲${OFF}`);
  const byPath = new Map<string, number[]>();
  for (const t of timings) {
    const list = byPath.get(t.path) ?? [];
    list.push(t.ms);
    byPath.set(t.path, list);
  }
  for (const [path, values] of [...byPath].sort()) {
    console.log(
      `  ${path.padEnd(20)} n=${String(values.length).padStart(5)}　` +
        `p50 ${percentile(values, 50).toFixed(0).padStart(5)}ms　` +
        `p95 ${percentile(values, 95).toFixed(0).padStart(5)}ms　` +
        `p99 ${percentile(values, 99).toFixed(0).padStart(5)}ms`,
    );
  }

  const failures = timings.filter((t) => !t.ok).length;
  console.log(
    `\n${failures === 0 ? GREEN : RED}HTTP 失敗 ${failures} / ${timings.length} 次${OFF}`,
  );

  const withErrors = results.filter((r) => r.errors.length > 0);
  if (withErrors.length > 0) {
    console.log(`\n${BOLD}錯誤明細${OFF}`);
    for (const r of withErrors.slice(0, 10)) {
      console.log(`  ${r.code}：${[...new Set(r.errors)].join("；")}`);
    }
    if (withErrors.length > 10) console.log(`  …另有 ${withErrors.length - 10} 人`);
  }

  const allPass = lossRate === 0 && reflectionRate === 1 && p95 < 800;
  console.log(
    `\n${allPass ? `${GREEN}三項驗收全過。${OFF}` : `${RED}未達驗收標準，詳見上方。${OFF}`}`,
  );
  console.log(`${DIM}把結果與觀察記進 PILOT_NOTES.md。${OFF}`);

  if (!allPass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(`${RED}${err instanceof Error ? err.message : String(err)}${OFF}`);
  process.exit(1);
});
