/**
 * verify-rls.ts —— STEP 1 驗收腳本
 *
 * 驗證 migrations 001~003 的三件事（BUILD_PLAN.md §6 STEP 1）：
 *   (a) 學生可讀自己的 analyses kind='dna'，但讀不到他人、讀不到 kind='quadrant'
 *   (b) 對 reflections 執行 UPDATE 被拒
 *   (c) teacher 讀不到他班
 * 另補驗 append-only、欄位權限、sessions 狀態不可回退等鐵則。
 *
 * 【零殘留保證】整份腳本跑在單一 transaction 內，結尾無條件 ROLLBACK。
 * 這是必要的：002 的 trigger 讓 reflections 永遠無法 DELETE，測試資料一旦
 * 真的落庫就再也清不掉，會永久污染研究資料庫。
 *
 * 執行：npm run verify:rls
 * 需要 .env.local 內的 DATABASE_URL（Supabase → Project Settings → Database →
 * Connection string，直連 5432 而非 pooler：pooler 不保證同一連線，transaction 會斷）。
 */
import { Client } from "pg";

type Identity = {
  participant_id: string;
  app_role: "student" | "teacher";
  class_id: string;
};

type Fixtures = {
  classA: string;
  classB: string;
  studentA1: string;
  studentA2: string;
  teacherA: string;
  teacherB: string;
  studentB1: string;
  sessionA1: string;
  sessionA2: string;
  sessionB1: string;
};

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  const mark = ok ? "[32m✓[0m" : "[31m✗[0m";
  console.log(`${mark} ${name}${ok ? "" : `\n    → ${detail}`}`);
}

/** 每個測項獨立 savepoint：預期失敗的操作會讓 transaction 進入 aborted 狀態，必須回捲才能續跑。 */
async function test(
  client: Client,
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  await client.query("savepoint tc");
  try {
    await fn();
    record(name, true, "");
  } catch (err) {
    record(name, false, err instanceof Error ? err.message : String(err));
  } finally {
    await client.query("rollback to savepoint tc");
  }
}

/** 切換為指定身分。role 設 authenticated，身分細節走 request.jwt.claims（與 PostgREST 同路徑）。 */
async function as(client: Client, identity: Identity): Promise<void> {
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "authenticated", ...identity }),
  ]);
}

async function asAnon(client: Client): Promise<void> {
  await client.query("set local role anon");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ role: "anon" }),
  ]);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** 斷言某個操作必須被資料庫拒絕。成功執行＝測試失敗。 */
async function assertRejected(
  client: Client,
  sql: string,
  params: unknown[],
  message: string,
): Promise<void> {
  await client.query("savepoint expect_fail");
  let rejected = false;
  let detail = "";
  try {
    await client.query(sql, params);
  } catch (err) {
    rejected = true;
    detail = err instanceof Error ? err.message : String(err);
  }
  await client.query("rollback to savepoint expect_fail");
  assert(rejected, `${message}（該操作竟然成功了）`);
  if (process.env.VERBOSE === "1") console.log(`      拒絕理由：${detail}`);
}

async function countAs(
  client: Client,
  identity: Identity,
  sql: string,
): Promise<number> {
  await as(client, identity);
  const res = await client.query<{ n: string }>(sql);
  return Number(res.rows[0]?.n ?? "0");
}

async function seed(client: Client): Promise<Fixtures> {
  const one = async (sql: string, params: unknown[] = []): Promise<string> => {
    const res = await client.query<{ id: string }>(sql, params);
    const id = res.rows[0]?.id;
    if (!id) throw new Error(`seed 失敗，沒有回傳 id：${sql}`);
    return id;
  };

  const mkClass = (label: string): Promise<string> =>
    one(
      `insert into classes (label, grade_level, model, temperature, system_prompt_version)
       values ($1, 'junior_high', 'claude-haiku-4-5-20251001', 0.70, 'v1') returning id`,
      [label],
    );

  const mkParticipant = (
    code: string,
    classId: string,
    role: "student" | "teacher",
  ): Promise<string> =>
    one(
      `insert into participants (code, pin_hash, class_id, role)
       values ($1, 'bcrypt$dummy', $2, $3) returning id`,
      [code, classId, role],
    );

  const classA = await mkClass("VERIFY-A");
  const classB = await mkClass("VERIFY-B");

  const studentA1 = await mkParticipant("VERIFY-S-A1", classA, "student");
  const studentA2 = await mkParticipant("VERIFY-S-A2", classA, "student");
  const teacherA = await mkParticipant("VERIFY-T-A", classA, "teacher");
  const studentB1 = await mkParticipant("VERIFY-S-B1", classB, "student");
  const teacherB = await mkParticipant("VERIFY-T-B", classB, "teacher");

  const assignment = await one(
    `insert into assignments (title, instructions, order_no)
     values ('驗證用作業', '驗證用說明', 1) returning id`,
  );

  const mkSession = (participantId: string): Promise<string> =>
    one(
      `insert into sessions (participant_id, assignment_id, status, submitted_at)
       values ($1, $2, 'submitted', now()) returning id`,
      [participantId, assignment],
    );

  const sessionA1 = await mkSession(studentA1);
  const sessionA2 = await mkSession(studentA2);
  const sessionB1 = await mkSession(studentB1);

  // analyses：每個 session 各一筆 dna 與一筆 quadrant
  for (const s of [sessionA1, sessionA2, sessionB1]) {
    await client.query(
      `insert into analyses (session_id, kind, result) values ($1, 'dna', '{"segments":[]}')`,
      [s],
    );
    await client.query(
      `insert into analyses (session_id, kind, result) values ($1, 'quadrant', '{"x":0.5,"y":0.5}')`,
      [s],
    );
  }

  await client.query(
    `insert into reflection_prompts (version, questions)
     values ('verify-v1', '[{"id":"q1","text":"為什麼直接用了 AI 的句子？","min_chars":30}]')`,
  );

  for (const s of [sessionA1, sessionA2]) {
    await client.query(
      `insert into reflections (session_id, prompt_version, answers, viewed_dna_at, viewed_replay_at)
       values ($1, 'verify-v1', '[{"question_id":"q1","text":"驗證用答案"}]', now(), now())`,
      [s],
    );
    await client.query(
      `insert into chat_messages (session_id, role, content) values ($1, 'user', '驗證用訊息')`,
      [s],
    );
    await client.query(
      `insert into events (session_id, client_seq, type, payload)
       values ($1, 1, 'submit', '{}')`,
      [s],
    );
  }

  return {
    classA,
    classB,
    studentA1,
    studentA2,
    teacherA,
    teacherB,
    studentB1,
    sessionA1,
    sessionA2,
    sessionB1,
  };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "缺少 DATABASE_URL。請在 .env.local 填入 Supabase 的直連字串（port 5432，非 pooler）。",
    );
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const rolesRes = await client.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('authenticated','anon')`,
    );
    const roles = rolesRes.rows.map((r) => r.rolname);
    for (const required of ["authenticated", "anon"]) {
      if (!roles.includes(required)) {
        throw new Error(
          `資料庫缺少角色 ${required}。本腳本假設對象是 Supabase 專案（雲端或 supabase start）。`,
        );
      }
    }

    await client.query("begin");
    const f = await seed(client);

    const studentA1: Identity = {
      participant_id: f.studentA1,
      app_role: "student",
      class_id: f.classA,
    };
    const teacherA: Identity = {
      participant_id: f.teacherA,
      app_role: "teacher",
      class_id: f.classA,
    };
    const teacherB: Identity = {
      participant_id: f.teacherB,
      app_role: "teacher",
      class_id: f.classB,
    };

    console.log("\n── (a) 鏡子權限：學生只讀得到自己的 DNA ──────────────");

    await test(client, "學生讀得到自己的 analyses kind='dna'", async () => {
      const n = await countAs(
        client,
        studentA1,
        `select count(*) n from analyses where kind = 'dna' and session_id = '${f.sessionA1}'`,
      );
      assert(n === 1, `預期 1 筆，實得 ${n}`);
    });

    await test(client, "學生讀不到自己的 analyses kind='quadrant'", async () => {
      const n = await countAs(
        client,
        studentA1,
        `select count(*) n from analyses where kind = 'quadrant'`,
      );
      assert(n === 0, `預期 0 筆，實得 ${n}——象限座標以全班為基準，外洩即污染介入`);
    });

    await test(client, "學生讀不到同儕的 analyses", async () => {
      const n = await countAs(client, studentA1, `select count(*) n from analyses`);
      assert(n === 1, `學生視野內應僅有自己那 1 筆 dna，實得 ${n}`);
    });

    await test(client, "學生讀不到同儕的 sessions", async () => {
      const n = await countAs(client, studentA1, `select count(*) n from sessions`);
      assert(n === 1, `預期僅自己 1 筆，實得 ${n}`);
    });

    await test(client, "學生讀不到同儕的 reflections", async () => {
      const n = await countAs(client, studentA1, `select count(*) n from reflections`);
      assert(n === 1, `預期僅自己 1 筆，實得 ${n}`);
    });

    await test(client, "學生讀不到同儕的 chat_messages", async () => {
      const n = await countAs(client, studentA1, `select count(*) n from chat_messages`);
      assert(n === 1, `預期僅自己 1 筆，實得 ${n}`);
    });

    await test(client, "學生讀得到自己的 snapshots（回放權限）", async () => {
      await as(client, studentA1);
      await client.query(
        `insert into snapshots (session_id, doc, seq_event_id) values ($1, '{}', 1)`,
        [f.sessionA1],
      );
      const res = await client.query<{ n: string }>(
        `select count(*) n from snapshots`,
      );
      assert(Number(res.rows[0]?.n) === 1, "學生應讀得到自己的快照");
    });

    console.log("\n── (b) append-only：三表不可 UPDATE / DELETE ─────────");

    await test(client, "學生對 reflections 執行 UPDATE 被拒", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `update reflections set answers = '[{"question_id":"q1","text":"竄改"}]' where session_id = $1`,
        [f.sessionA1],
        "reflections 必須不可 UPDATE",
      );
    });

    await test(client, "學生對 reflections 執行 DELETE 被拒", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `delete from reflections where session_id = $1`,
        [f.sessionA1],
        "reflections 必須不可 DELETE",
      );
    });

    await test(client, "連 superuser 也不能 UPDATE reflections", async () => {
      await assertRejected(
        client,
        `update reflections set answers = '[]'`,
        [],
        "append-only 不得有後門，service_role 亦然",
      );
    });

    await test(client, "連 superuser 也不能 DELETE events", async () => {
      await assertRejected(
        client,
        `delete from events`,
        [],
        "events 必須不可 DELETE",
      );
    });

    await test(client, "連 superuser 也不能 UPDATE chat_messages", async () => {
      await assertRejected(
        client,
        `update chat_messages set content = '竄改'`,
        [],
        "chat_messages 必須不可 UPDATE",
      );
    });

    console.log("\n── (c) 教師只看得到自己那班 ─────────────────────────");

    await test(client, "教師 A 讀得到 A 班全部 sessions", async () => {
      const n = await countAs(client, teacherA, `select count(*) n from sessions`);
      assert(n === 2, `A 班有 2 名學生各 1 場，預期 2 筆，實得 ${n}`);
    });

    await test(client, "教師 B 讀不到 A 班的 sessions", async () => {
      await as(client, teacherB);
      const res = await client.query<{ n: string }>(
        `select count(*) n from sessions where id = '${f.sessionA1}'`,
      );
      assert(Number(res.rows[0]?.n) === 0, "教師不得跨班讀取");
    });

    await test(client, "教師 B 讀不到 A 班的 reflections", async () => {
      await as(client, teacherB);
      const res = await client.query<{ n: string }>(
        `select count(*) n from reflections where session_id = '${f.sessionA1}'`,
      );
      assert(Number(res.rows[0]?.n) === 0, "教師不得跨班讀取反思");
    });

    await test(client, "教師 B 讀不到 A 班的 classes 列", async () => {
      await as(client, teacherB);
      const res = await client.query<{ n: string }>(
        `select count(*) n from classes where id = '${f.classA}'`,
      );
      assert(Number(res.rows[0]?.n) === 0, "教師不得讀他班班級設定");
    });

    console.log("\n── 其餘鐵則 ─────────────────────────────────────────");

    await test(client, "學生不可寫入他人 session 的事件", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `insert into events (session_id, client_seq, type, payload) values ($1, 99, 'paste', '{}')`,
        [f.sessionA2],
        "學生僅能寫入自己 session 的事件",
      );
    });

    await test(client, "學生可寫入自己 session 的事件", async () => {
      await as(client, studentA1);
      await client.query(
        `insert into events (session_id, client_seq, type, payload) values ($1, 99, 'paste', '{}')`,
        [f.sessionA1],
      );
    });

    await test(client, "重送同一 client_seq 觸發 UNIQUE 衝突（冪等基礎）", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `insert into events (session_id, client_seq, type, payload) values ($1, 1, 'submit', '{}')`,
        [f.sessionA1],
        "(session_id, client_seq) 必須唯一，否則離線續傳會產生重複事件",
      );
    });

    await test(client, "學生不可新增 reflection_prompts 版本", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `insert into reflection_prompts (version, questions) values ('hacked', '[]')`,
        [],
        "反思題目版本僅能由伺服器端新增",
      );
    });

    await test(client, "學生不可修改既有 reflection_prompts 版本", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `update reflection_prompts set questions = '[]' where version = 'verify-v1'`,
        [],
        "版本凍結：既有版本不可修改",
      );
    });

    await test(client, "學生讀不到任何 pin_hash（欄位權限）", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `select pin_hash from participants where id = $1`,
        [f.studentA1],
        "pin_hash 不得對前端開放",
      );
    });

    await test(client, "學生在 participants 只看得到自己", async () => {
      const n = await countAs(
        client,
        studentA1,
        `select count(*) n from participants`,
      );
      assert(n === 1, `預期 1 筆，實得 ${n}`);
    });

    await test(client, "sessions 的 status 不可回退", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `update sessions set status = 'active' where id = $1`,
        [f.sessionA1],
        "status 只能 active → submitted → reflected 單向前進",
      );
    });

    await test(client, "sessions 的 participant_id 不可竄改", async () => {
      await as(client, studentA1);
      await assertRejected(
        client,
        `update sessions set participant_id = $2 where id = $1`,
        [f.sessionA1, f.studentA2],
        "場次的身分綁定屬研究資料，不得事後改寫",
      );
    });

    await test(client, "sessions 可正常推進為 reflected", async () => {
      await as(client, studentA1);
      await client.query(`update sessions set status = 'reflected' where id = $1`, [
        f.sessionA1,
      ]);
    });

    await test(client, "未登入者讀不到任何資料", async () => {
      await asAnon(client);
      for (const table of ["sessions", "reflections", "analyses", "events"]) {
        await assertRejected(
          client,
          `select count(*) from ${table}`,
          [],
          `anon 不得讀取 ${table}`,
        );
      }
    });
  } finally {
    // 無條件回捲：研究資料庫不留任何測試痕跡。
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${"─".repeat(56)}\n共 ${results.length} 項，通過 ${results.length - failed.length} 項，失敗 ${failed.length} 項。`,
  );
  console.log("已 ROLLBACK，資料庫零殘留。");
  if (failed.length > 0) {
    console.error("\n失敗項目：");
    for (const r of failed) console.error(`  ✗ ${r.name}\n    ${r.detail}`);
    process.exit(1);
  }
  console.log("[32m全綠。[0m");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
