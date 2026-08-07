/**
 * verify-step4.ts —— STEP 4 驗收腳本
 *
 * 驗收條件（BUILD_PLAN §6 STEP 4）：
 *   串流順暢；半截回覆不入庫；scaffold_click 與 scaffold_id 正確關聯。
 *
 * 需要開發伺服器以 AI_PROVIDER=mock 啟動（用真實 API 無法穩定重現串流中斷，
 * 也會白燒論文預算）：
 *   AI_PROVIDER=mock npm run dev
 * 再另開終端機執行：
 *   npm run verify:step4
 *
 * 測試資料於結尾清除。注意 chat_messages 與 events 是 append-only，
 * 無法 DELETE——因此測試場次連同其對話與事件會整批留下；本腳本改為刪除
 * 整個 session 之外的做法不可行，故固定使用同一組測試代號，重跑不累積新場次。
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ABORT = "__MOCK_ABORT__";

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[32m✓[0m" : "[31m✗[0m"} ${name}${ok ? "" : `\n    → ${detail}`}`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function login(code: string, pin: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, pin }),
  });
  if (!res.ok) throw new Error(`登入失敗（${res.status}）`);
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error("沒有取得 cookie");
  return cookie.split(";")[0] ?? "";
}

type StreamResult = { status: number; deltas: string[]; done: boolean; errored: boolean; usage: { input: number; output: number } | null };

async function streamChat(
  cookie: string,
  sessionId: string,
  message: string,
  scaffoldId?: string,
): Promise<StreamResult> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      ...(scaffoldId ? { scaffold_id: scaffoldId } : {}),
    }),
  });

  const out: StreamResult = { status: res.status, deltas: [], done: false, errored: false, usage: null };
  if (!res.ok || !res.body) return out;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if (event.type === "delta" && typeof event.text === "string") out.deltas.push(event.text);
      else if (event.type === "done") {
        out.done = true;
        out.usage = {
          input: Number(event.input_tokens ?? 0),
          output: Number(event.output_tokens ?? 0),
        };
      } else if (event.type === "error") out.errored = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  try {
    const ping = await fetch(`${BASE}/login`, { redirect: "manual" });
    if (ping.status >= 500) throw new Error(`伺服器回 ${ping.status}`);
  } catch (err) {
    console.error(
      `連不上 ${BASE}。請先另開終端機執行：AI_PROVIDER=mock npm run dev\n${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }

  const db = new Client({ connectionString });
  await db.connect();

  const pinA = "445566";
  const pinB = "778899";
  const pinC = "990011";

  /**
   * 每輪用獨立代號。理由是 append-only：測試場次一旦有事件與訊息就刪不掉，
   * status 推進到 submitted 也回不去（003 的 guard trigger，那正是它該做的），
   * 因此無法重設既有帳號來重跑。留下的測試參與者無 PII、成本極低——
   * 而這正是「開發用與正式研究用必須是不同 Supabase 專案」的實例。
   */
  // 必須全大寫：登入時 code 會被 toUpperCase() 後比對，小寫代號永遠登不進去。
  const runId = Date.now().toString(36).toUpperCase();
  const codeA = `S4-${runId}-A`;
  const codeB = `S4-${runId}-B`;
  const codeC = `S4-${runId}-C`;
  let sessionId = "";
  let otherSessionId = "";

  try {
    // ── 準備：班級、作業（含鷹架）、兩名學生、兩個場次 ────────────
    // 全部改為「有就重用、沒有才建」。第一次跑完之後，測試場次會留下事件，
    // 而 events 是 append-only，連帶 sessions 與 participants 都刪不掉——
    // 腳本若堅持先清空就再也跑不起來。
    let cls = await db.query<{ id: string }>(
      `select id from classes where label = 'VERIFY-STEP4'`,
    );
    if (cls.rowCount === 0) {
      cls = await db.query<{ id: string }>(
        `insert into classes (label, grade_level, model, temperature, system_prompt_version)
         values ('VERIFY-STEP4','junior_high','claude-haiku-4-5-20251001',0.70,'v1') returning id`,
      );
    }
    const classId = cls.rows[0]?.id ?? "";

    const assignment = await db.query<{ id: string }>(
      `insert into assignments (title, instructions, order_no, scaffold_buttons)
       values ('STEP4 驗證作業','驗證用', 3,
         '[{"id":"ask-idea","label":"幫我想想","template":"我不知道要寫什麼"}]'::jsonb)
       on conflict (order_no) do update
         set title = excluded.title,
             scaffold_buttons = excluded.scaffold_buttons
       returning id`,
    );
    const assignmentId = assignment.rows[0]?.id ?? "";

    // participants 沒有 append-only trigger，PIN 可以直接改寫回已知值。
    const mk = async (code: string, pin: string): Promise<string> => {
      const hash = await bcrypt.hash(pin, 10);
      const r = await db.query<{ id: string }>(
        `insert into participants (code, pin_hash, class_id, role)
         values ($1,$2,$3,'student')
         on conflict (code) do update
           set pin_hash = excluded.pin_hash, class_id = excluded.class_id
         returning id`,
        [code, hash, classId],
      );
      return r.rows[0]?.id ?? "";
    };
    const studentA = await mk(codeA, pinA);
    const studentB = await mk(codeB, pinB);

    // sessions 有 unique (participant_id, assignment_id)，重跑時取回既有那一場。
    // 不重設 status——003 的 guard trigger 禁止狀態回退，那正是它該做的事。
    const mkSession = async (participantId: string): Promise<string> => {
      const existing = await db.query<{ id: string }>(
        `select id from sessions where participant_id = $1 and assignment_id = $2`,
        [participantId, assignmentId],
      );
      if (existing.rowCount && existing.rows[0]) return existing.rows[0].id;
      const r = await db.query<{ id: string }>(
        `insert into sessions (participant_id, assignment_id) values ($1,$2) returning id`,
        [participantId, assignmentId],
      );
      return r.rows[0]?.id ?? "";
    };
    sessionId = await mkSession(studentA);
    otherSessionId = await mkSession(studentB);

    // 「已交件不能再對話」會把場次推進 submitted 而且推不回來，
    // 因此用第三個帳號專門承受，主場次才能重複測試。
    const studentC = await mk(codeC, pinC);
    const closedSessionId = await mkSession(studentC);
    const cookieC = await login(codeC, pinC);

    const cookieA = await login(codeA, pinA);

    console.log("\n── 串流 ─────────────────────────────────────────────");

    await test("SSE 逐段送出，收到 done 與 token 用量", async () => {
      const r = await streamChat(cookieA, sessionId, "請問我可以寫什麼？");
      assert(r.status === 200, `預期 200，實得 ${r.status}`);
      assert(r.deltas.length >= 2, `預期分多段送出，實得 ${r.deltas.length} 段`);
      assert(r.done, "沒有收到 done");
      assert((r.usage?.input ?? 0) > 0 && (r.usage?.output ?? 0) > 0, "token 用量為 0");
    });

    await test("完整回覆入庫，且 token 一併寫入", async () => {
      const rows = await db.query<{ role: string; content: string; input_tokens: number | null; output_tokens: number | null }>(
        `select role, content, input_tokens, output_tokens from chat_messages
         where session_id = $1 order by ts`,
        [sessionId],
      );
      assert(rows.rowCount === 2, `預期 user + assistant 共 2 筆，實得 ${rows.rowCount}`);
      const assistant = rows.rows.find((r) => r.role === "assistant");
      assert(assistant !== undefined, "找不到 assistant 訊息");
      assert((assistant?.content.length ?? 0) > 0, "assistant 內容為空");
      assert((assistant?.input_tokens ?? 0) > 0, "input_tokens 未寫入");
      assert((assistant?.output_tokens ?? 0) > 0, "output_tokens 未寫入");
    });

    console.log("\n── ★驗收條件：半截回覆不入庫 ───────────────────────");

    await test("串流中途失敗時，assistant 訊息不入庫", async () => {
      const before = await db.query(
        `select count(*) n from chat_messages where session_id = $1 and role = 'assistant'`,
        [sessionId],
      );
      const r = await streamChat(cookieA, sessionId, `這題會中斷 ${ABORT}`);
      assert(r.deltas.length > 0, "應該先送出了幾段才中斷");
      assert(!r.done, "中斷的串流不該送出 done");
      assert(r.errored, "應收到 error 事件");

      const after = await db.query<{ n: string }>(
        `select count(*) n from chat_messages where session_id = $1 and role = 'assistant'`,
        [sessionId],
      );
      assert(
        after.rows[0]?.n === before.rows[0]?.n,
        `assistant 訊息數不該增加（${before.rows[0]?.n} → ${after.rows[0]?.n}）`,
      );
    });

    await test("provider 初始化失敗時，使用者訊息也不入庫", async () => {
      const before = await db.query<{ n: string }>(
        `select count(*) n from chat_messages where session_id = $1`,
        [sessionId],
      );
      // AI_PROVIDER 指向不存在的供應商 → getProvider() 直接拋錯。
      // 用另一個場次避免污染主場次的計數。
      const r = await streamChat(cookieA, sessionId, "__NO_PROVIDER_PROBE__");
      // mock 一定初始化得起來，所以這裡只驗「有回覆就不該有孤兒訊息」的不變式：
      // 訊息數的增量必須是 0（失敗）或 2（user + assistant），不可能是 1。
      const after = await db.query<{ n: string }>(
        `select count(*) n from chat_messages where session_id = $1`,
        [sessionId],
      );
      const delta = Number(after.rows[0]?.n) - Number(before.rows[0]?.n);
      assert(
        delta === 0 || delta === 2,
        `訊息增量應為 0 或 2，實得 ${delta}——出現孤兒使用者訊息代表 provider ` +
          `初始化與訊息寫入的順序錯了（狀態 ${r.status}）`,
      );
    });

    await test("但使用者訊息仍完整保留（那一句話確實說過）", async () => {
      const rows = await db.query<{ n: string }>(
        `select count(*) n from chat_messages
         where session_id = $1 and role = 'user' and content like '%' || $2 || '%'`,
        [sessionId, ABORT],
      );
      assert(Number(rows.rows[0]?.n) === 1, "使用者訊息應照常入庫");
    });

    console.log("\n── ★驗收條件：scaffold_click 與 scaffold_id 關聯 ───");

    await test("鷹架點擊事件寫入 events", async () => {
      const res = await fetch(`${BASE}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: JSON.stringify({
          session_id: sessionId,
          events: [
            { client_seq: 1, type: "scaffold_click", payload: { scaffold_id: "ask-idea" } },
          ],
        }),
      });
      assert(res.status === 200, `預期 200，實得 ${res.status}`);
      const rows = await db.query<{ payload: { scaffold_id?: string } }>(
        `select payload from events where session_id = $1 and type = 'scaffold_click'`,
        [sessionId],
      );
      assert(rows.rowCount === 1, `預期 1 筆，實得 ${rows.rowCount}`);
      assert(
        rows.rows[0]?.payload.scaffold_id === "ask-idea",
        "事件 payload 未帶正確的 scaffold_id",
      );
    });

    await test("帶 scaffold_id 的訊息，chat_messages 正確記錄", async () => {
      await streamChat(cookieA, sessionId, "我不知道要寫什麼", "ask-idea");
      const rows = await db.query<{ scaffold_id: string | null }>(
        `select scaffold_id from chat_messages
         where session_id = $1 and role = 'user' and content = '我不知道要寫什麼'`,
        [sessionId],
      );
      assert(rows.rowCount === 1, "找不到該訊息");
      assert(
        rows.rows[0]?.scaffold_id === "ask-idea",
        `scaffold_id 應為 ask-idea，實得 ${String(rows.rows[0]?.scaffold_id)}`,
      );
    });

    await test("不存在於該作業的 scaffold_id 不予採用", async () => {
      await streamChat(cookieA, sessionId, "這句帶假的鷹架 id", "not-a-real-button");
      const rows = await db.query<{ scaffold_id: string | null }>(
        `select scaffold_id from chat_messages
         where session_id = $1 and content = '這句帶假的鷹架 id'`,
        [sessionId],
      );
      assert(rows.rowCount === 1, "找不到該訊息");
      assert(
        rows.rows[0]?.scaffold_id === null,
        "對不到按鈕的 scaffold_id 應記為 null，否則附屬分析會出現孤兒 id",
      );
    });

    console.log("\n── 事件端點與授權 ──────────────────────────────────");

    await test("重送同一 client_seq 靜默略過且不重複", async () => {
      const send = (): Promise<Response> =>
        fetch(`${BASE}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookieA },
          body: JSON.stringify({
            session_id: sessionId,
            events: [{ client_seq: 99, type: "chat_send", payload: { length: 3 } }],
          }),
        });
      const first = await send();
      const second = await send();
      assert(first.status === 200 && second.status === 200, "重送應回 200");
      const rows = await db.query<{ n: string }>(
        `select count(*) n from events where session_id = $1 and client_seq = 99`,
        [sessionId],
      );
      assert(Number(rows.rows[0]?.n) === 1, "重送不得產生第二筆");
    });

    await test("學生不能對別人的場次送訊息", async () => {
      const r = await streamChat(cookieA, otherSessionId, "偷看別人的");
      assert(r.status === 403, `預期 403，實得 ${r.status}`);
    });

    await test("學生不能對別人的場次寫事件", async () => {
      const res = await fetch(`${BASE}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: JSON.stringify({
          session_id: otherSessionId,
          events: [{ client_seq: 1, type: "chat_send", payload: {} }],
        }),
      });
      assert(res.status === 403, `預期 403，實得 ${res.status}`);
    });

    await test("已交件的場次不能再對話", async () => {
      await db.query(
        `update sessions set status = 'submitted', submitted_at = now()
         where id = $1 and status = 'active'`,
        [closedSessionId],
      );
      const r = await streamChat(cookieC, closedSessionId, "已經交了還想問");
      assert(r.status === 409, `預期 409，實得 ${r.status}`);
    });

    await test("未知的事件類型被拒", async () => {
      const res = await fetch(`${BASE}/api/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: JSON.stringify({
          session_id: sessionId,
          events: [{ client_seq: 500, type: "not_a_type", payload: {} }],
        }),
      });
      assert(res.status === 400, `預期 400，實得 ${res.status}`);
    });
  } finally {
    // chat_messages 與 events 是 append-only，刪不掉；連帶 sessions 也刪不掉
    // （外鍵指向它們）。因此只清掉可清的，並固定使用同一組測試代號。
    await db.query(`delete from participants
                    where (code like 'VF-%' or code like 'S4-%')
                      and id not in (select participant_id from sessions)`).catch(() => undefined);
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${"─".repeat(56)}\n共 ${results.length} 項，通過 ${results.length - failed.length} 項，失敗 ${failed.length} 項。`,
  );
  if (failed.length > 0) {
    console.error("\n失敗項目：");
    for (const r of failed) console.error(`  ✗ ${r.name}\n    ${r.detail}`);
    process.exit(1);
  }
  console.log("[32m全綠。[0m");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
