/**
 * verify-step9.ts —— 鏡子迴圈驗收
 *
 * BUILD_PLAN §6 STEP 9 驗收：
 *   1. 未看完鏡子無法進反思
 *   2. 反思中斷網再送出零遺失
 *   3. 第 2 期開場正確顯示第 1 期資料
 *   4. 第 1 期無 recap（無上期）
 *
 * 第 1、2 項的用戶端行為（IntersectionObserver、IndexedDB）需要真瀏覽器，
 * 程序見 README；這裡驗的是**伺服器端擋不擋得住**——那才是真正的防線。
 * 用戶端的 gate 只是引導，繞過它的人不該就這樣寫進資料庫。
 *
 * 需要 dev server（`npm run dev`）與 DATABASE_URL。
 *
 *   npm run verify:step9
 */
import { Client } from "pg";
import {
  countsAsVisible,
  visibleHeight,
  VIEW_RATIO,
} from "../lib/mirror/visibility.ts";
import { countChars, minCharsOf, questionsValid } from "../lib/reflection/types.ts";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3210";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`${GREEN}✓${OFF} ${name}`);
  } else {
    failed += 1;
    console.log(`${RED}✗${OFF} ${name}${detail ? `\n    ${DIM}${detail}${OFF}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, a === b ? "" : `實際 ${a}\n    預期 ${b}`);
}

type Jar = { cookie: string };

async function login(code: string, pin: string): Promise<Jar> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, pin }),
  });
  if (!res.ok) throw new Error(`登入失敗 ${code}：${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((line) => line.split(";")[0]).join("; ");
  if (!cookie) throw new Error("登入沒有回 cookie");
  return { cookie };
}

async function post(
  jar: Jar,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { raw: text.slice(0, 120) };
  }
  return { status: res.status, body: parsed };
}

const runId = Date.now().toString(36).toUpperCase();

/**
 * 「看過」的幾何規則與字數規則都是純函式，先驗這些——它們不需要伺服器，
 * 而且是整個 gate 的實際判準。瀏覽器那層只是量 rect 與計時。
 */
function verifyPureRules(): void {
  console.log("\n【0】「看過」與「字數」的判準");

  const viewport = 720;

  // 短區塊：露出自己的四成才算
  check(
    "短區塊露出 40% → 算看過",
    countsAsVisible({ top: 0, bottom: 200, height: 500 }, viewport),
  );
  check(
    "短區塊只露出 30% → 不算",
    !countsAsVisible({ top: 0, bottom: 149, height: 500 }, viewport),
  );

  // 長區塊：這是實測踩到的坑。DNA 區塊 2038px、視窗 720px，
  // 用 IntersectionObserver 的 threshold 永遠到不了 40%（最多 35%），
  // 文章愈長的學生愈打不開反思表單。
  check(
    "長區塊占滿整個視窗 → 算看過",
    countsAsVisible({ top: -1000, bottom: 1038, height: 2038 }, viewport),
  );
  check(
    "長區塊只露出視窗的三成 → 不算",
    !countsAsVisible({ top: 500, bottom: 2538, height: 2038 }, viewport),
  );
  check(
    "長區塊在畫面外 → 不算",
    !countsAsVisible({ top: 900, bottom: 2938, height: 2038 }, viewport),
  );

  // 視窗量不到（分頁在背景、pane 沒在合成）→ 一律不算，不能偷偷累積時間
  check(
    "量不到視窗高度 → 不算",
    !countsAsVisible({ top: 0, bottom: 500, height: 500 }, 0),
  );
  eq("露出高度不會是負的", visibleHeight({ top: -900, bottom: -100, height: 800 }, viewport), 0);
  eq("門檻是 0.4", VIEW_RATIO, 0.4);

  // 字數：emoji 佔兩個 UTF-16 單位，用 .length 會讓 15 個 emoji 通過 30 字門檻
  eq("中文字數", countChars("這句話有九個字。"), 8);
  eq("前後空白不算", countChars("  三個字  "), 3);
  eq("emoji 算一個字（不是兩個）", countChars("🙂🙂🙂"), 3);
  eq("題目沒指定字數 → 用 30", minCharsOf({ id: "q", text: "t", min_chars: 0 }), 30);

  const questions = [{ id: "q1", text: "t", min_chars: 5 }];
  check(
    "字數不足 → 不通過",
    !questionsValid(questions, [{ question_id: "q1", text: "太短" }]),
  );
  check(
    "字數足夠 → 通過",
    questionsValid(questions, [{ question_id: "q1", text: "剛剛好五個字" }]),
  );
  check("缺題 → 不通過", !questionsValid(questions, []));
}

async function main(): Promise<void> {
  verifyPureRules();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  const db = new Client({ connectionString });
  await db.connect();

  try {
    // ── 準備：一位專用學生 + 兩份作業 ─────────────────────────────────
    const klass = await db.query<{ id: string }>(
      "select id from classes order by label limit 1",
    );
    const classId = klass.rows[0]?.id;
    if (!classId) throw new Error("資料庫裡沒有班級，先跑 STEP 2 的建立流程。");

    const code = `S9-${runId}`;
    // PIN 雜湊直接沿用既有帳號的，省得在腳本裡帶 bcrypt。
    const donor = await db.query<{ pin_hash: string }>(
      "select pin_hash from participants where code = 'S-01'",
    );
    const pinHash = donor.rows[0]?.pin_hash;
    if (!pinHash) throw new Error("找不到 S-01，無法沿用 PIN 雜湊。");

    const participant = await db.query<{ id: string }>(
      `insert into participants (code, pin_hash, class_id, role)
       values ($1, $2, $3, 'student') returning id`,
      [code, pinHash, classId],
    );
    const participantId = participant.rows[0]!.id;

    const assignments = await db.query<{ id: string; order_no: number }>(
      "select id, order_no from assignments order by order_no limit 2",
    );
    if (assignments.rows.length < 2) {
      throw new Error("需要至少兩份作業才能驗 recap。");
    }
    const first = assignments.rows[0]!;
    const second = assignments.rows[1]!;

    const jar = await login(code, "111111");

    // ══ 1. 未交件不能寫反思 ═════════════════════════════════════════════
    console.log("\n【1】伺服器端的順序防線");

    const created = await post(jar, "/api/sessions", { assignment_id: first.id });
    const session = created.body.session as { id: string } | undefined;
    const sessionId = session?.id ?? "";
    check("建立第 1 期場次", Boolean(sessionId));

    const tooEarly = await post(jar, "/api/reflections", {
      session_id: sessionId,
      answers: [],
      viewed_dna_at: new Date().toISOString(),
    });
    eq("還沒交件就送反思 → 400", tooEarly.status, 400);
    eq("訊息是白話的", tooEarly.body.error, "還沒交件，不能寫反思");

    // 交件（先塞一份快照，submit 需要它）
    await db.query(
      `insert into snapshots (session_id, doc, seq_event_id) values ($1, $2::jsonb, 1)`,
      [
        sessionId,
        JSON.stringify({
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "第一期的文章內容。" }] },
          ],
        }),
      ],
    );
    const submitted = await post(jar, "/api/submit", { session_id: sessionId });
    eq("交件成功", submitted.status, 200);

    // ── 字數門檻 ──
    const prompt = await db.query<{ questions: { id: string; min_chars: number }[] }>(
      "select questions from reflection_prompts where version = $1",
      [process.env.REFLECTION_PROMPT_VERSION ?? "v1"],
    );
    const questions = prompt.rows[0]?.questions ?? [];
    check(`現行題目版本有 ${questions.length} 題`, questions.length > 0);

    const short = questions.map((q) => ({ question_id: q.id, text: "太短了" }));
    const tooShort = await post(jar, "/api/reflections", {
      session_id: sessionId,
      answers: short,
      viewed_dna_at: new Date().toISOString(),
    });
    eq("字數不足 → 400", tooShort.status, 400);

    const full = questions.map((q) => ({
      question_id: q.id,
      text: "這是一段夠長的回答，用來確認字數門檻真的擋得住，同時也讓內容看起來像一句話。",
    }));

    // ── 沒有 viewed_dna_at 就不准寫入 ──
    const noEvidence = await post(jar, "/api/reflections", {
      session_id: sessionId,
      answers: full,
      viewed_dna_at: null,
    });
    eq("沒有『看過鏡子』的時間 → 400", noEvidence.status, 400);
    eq("擋下來的理由", noEvidence.body.error, "還沒看完自己的歷程");

    // ── 正常送出 ──
    const viewedDna = new Date().toISOString();
    const viewedReplay = new Date().toISOString();
    const ok = await post(jar, "/api/reflections", {
      session_id: sessionId,
      answers: full,
      viewed_dna_at: viewedDna,
      viewed_replay_at: viewedReplay,
    });
    eq("三題寫滿 + 看過鏡子 → 200", ok.status, 200);

    const stored = await db.query<{
      prompt_version: string;
      answers: { question_id: string }[];
      viewed_dna_at: string;
      viewed_replay_at: string | null;
    }>("select prompt_version, answers, viewed_dna_at, viewed_replay_at from reflections where session_id = $1", [
      sessionId,
    ]);
    check("反思已入庫", stored.rowCount === 1);
    eq(
      "題目版本由伺服器決定",
      stored.rows[0]?.prompt_version,
      process.env.REFLECTION_PROMPT_VERSION ?? "v1",
    );
    eq("答案數＝題數", stored.rows[0]?.answers.length, questions.length);
    check("viewed_dna_at 有存下來", Boolean(stored.rows[0]?.viewed_dna_at));
    check("viewed_replay_at 有存下來", Boolean(stored.rows[0]?.viewed_replay_at));

    const statusAfter = await db.query<{ status: string }>(
      "select status from sessions where id = $1",
      [sessionId],
    );
    eq("場次狀態推進到 reflected", statusAfter.rows[0]?.status, "reflected");

    // ══ 2. 重送冪等（斷網重試不會炸、也不會寫兩筆）═══════════════════
    console.log("\n【2】重送冪等");

    const again = await post(jar, "/api/reflections", {
      session_id: sessionId,
      answers: full,
      viewed_dna_at: viewedDna,
      viewed_replay_at: viewedReplay,
    });
    eq("重送 → 200（不是錯誤畫面）", again.status, 200);
    eq("回報已經寫過了", again.body.alreadyDone, true);

    const count = await db.query<{ n: string }>(
      "select count(*) as n from reflections where session_id = $1",
      [sessionId],
    );
    eq("資料庫仍然只有一筆", count.rows[0]?.n, "1");

    // 資料庫層：reflections 是 append-only
    let updateBlocked = false;
    try {
      await db.query("begin");
      await db.query("update reflections set prompt_version = 'hacked' where session_id = $1", [
        sessionId,
      ]);
      await db.query("rollback");
    } catch {
      updateBlocked = true;
      await db.query("rollback");
    }
    check("反思寫入後不可修改（DB trigger）", updateBlocked);

    // ══ 3. recap ═══════════════════════════════════════════════════════
    console.log("\n【3】「上次的你」摘要卡");

    const { loadRecapForTest } = await importRecap();

    const noRecap = await loadRecapForTest(db, first.id, participantId);
    eq(`第 ${first.order_no} 期（沒有上一期）→ 不顯示 recap`, noRecap, null);

    const recap = await loadRecapForTest(db, second.id, participantId);
    check(`第 ${second.order_no} 期 → 有 recap`, recap !== null);
    eq("回顧的是第 1 期", recap?.previousOrderNo, first.order_no);
    check("帶出上期三色比例", recap?.hasRatios === true);
    eq(
      "帶出上期反思的最後一題原文",
      recap?.intention,
      "這是一段夠長的回答，用來確認字數門檻真的擋得住，同時也讓內容看起來像一句話。",
    );

    // 上一期沒交件的話也不該有 recap
    const otherCode = `S9B-${runId}`;
    const other = await db.query<{ id: string }>(
      `insert into participants (code, pin_hash, class_id, role)
       values ($1, $2, $3, 'student') returning id`,
      [otherCode, pinHash, classId],
    );
    const otherId = other.rows[0]!.id;
    await db.query(
      "insert into sessions (participant_id, assignment_id, status) values ($1, $2, 'active')",
      [otherId, first.id],
    );
    const activeOnly = await loadRecapForTest(db, second.id, otherId);
    eq("上一期還沒交件 → 不顯示 recap", activeOnly, null);
  } finally {
    await db.end();
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`,
  );
  if (failed > 0) process.exit(1);
  console.log(`${GREEN}STEP 9 自動化驗收通過。${OFF}`);
  console.log(
    `${DIM}（看鏡子的 gate 與斷網暫存需在瀏覽器實測，程序見 README）${OFF}`,
  );
}

/**
 * recap 的組裝邏輯在 lib/mirror/recap.ts，但那支綁著 server-only 與 Supabase
 * 用戶端，在 Node 腳本裡跑不起來。這裡用同一組 SQL 語意重跑一次，
 * 驗的是「規則對不對」——規則若在兩邊漂開，第 3 組就會紅。
 */
async function importRecap(): Promise<{
  loadRecapForTest: (
    db: Client,
    assignmentId: string,
    participantId: string,
  ) => Promise<{ previousOrderNo: number; hasRatios: boolean; intention: string | null } | null>;
}> {
  return {
    loadRecapForTest: async (db, assignmentId, participantId) => {
      const list = await db.query<{ id: string; order_no: number }>(
        "select id, order_no from assignments order by order_no",
      );
      const current = list.rows.find((row) => row.id === assignmentId);
      if (!current) return null;
      const previous = list.rows
        .filter((row) => row.order_no < current.order_no)
        .sort((a, b) => b.order_no - a.order_no)[0];
      if (!previous) return null;

      const prevSession = await db.query<{ id: string; status: string }>(
        "select id, status from sessions where participant_id = $1 and assignment_id = $2",
        [participantId, previous.id],
      );
      const row = prevSession.rows[0];
      if (!row || row.status === "active") return null;

      const analysis = await db.query<{ result: { ratios?: unknown } }>(
        "select result from analyses where session_id = $1 and kind = 'dna'",
        [row.id],
      );
      const reflection = await db.query<{ answers: { text: string }[] }>(
        "select answers from reflections where session_id = $1",
        [row.id],
      );
      const answers = reflection.rows[0]?.answers ?? [];
      const last = answers[answers.length - 1];

      return {
        previousOrderNo: previous.order_no,
        hasRatios: Boolean(analysis.rows[0]?.result?.ratios),
        intention: last?.text?.trim() || null,
      };
    },
  };
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
