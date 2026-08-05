/**
 * verify-step2.ts —— STEP 2 驗收腳本
 *
 * 驗收條件（BUILD_PLAN §6 STEP 2）：
 *   嘗試修改已存在的 prompt 版本，被 UI 與 API 雙層拒絕。
 * UI 層無法用腳本斷言（那一層是「畫面上根本沒有編輯按鈕」），因此本腳本
 * 驗 API 層與資料庫層，並額外涵蓋認證與三種角色的路由守衛。
 *
 * 需要開發伺服器已啟動：npm run dev（預設 http://localhost:3000）
 * 可用 BASE_URL 覆寫。
 *
 * 測試帳號與班級於結尾刪除；唯一無法清除的是 reflection_prompts 的
 * 'verify-freeze' 版本——那正是被驗證的鐵則本身（004 禁止 DELETE）。
 * 版本名稱固定，重跑不會累積。
 */
import { Client } from "pg";
import bcrypt from "bcryptjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const FROZEN_VERSION = "verify-freeze";

const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "[32m✓[0m" : "[31m✗[0m"} ${name}${ok ? "" : `\n    → ${detail}`}`);
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

type Fetched = { status: number; body: unknown; cookie: string | null; location: string | null };

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string | null } = {},
): Promise<Fetched> {
  const headers: Record<string, string> = {};
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.cookie) headers["Cookie"] = init.cookie;

  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });

  let body: unknown = null;
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) body = await res.json().catch(() => null);

  const setCookie = res.headers.get("set-cookie");
  return {
    status: res.status,
    body,
    cookie: setCookie ? (setCookie.split(";")[0] ?? null) : null,
    location: res.headers.get("location"),
  };
}

function errorOf(body: unknown): string {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : "";
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
      `連不上 ${BASE}。請先另開一個終端機執行 npm run dev。\n${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }

  const db = new Client({ connectionString });
  await db.connect();

  const researcherPin = "135790";
  const studentPin = "246801";
  let classId = "";

  try {
    // ── 準備測試身分 ────────────────────────────────────────────────
    await db.query(`delete from participants where code in ('R-VERIFY','S-VERIFY')`);
    await db.query(`delete from classes where label = 'VERIFY-STEP2'`);

    const cls = await db.query<{ id: string }>(
      `insert into classes (label, grade_level, model, temperature, system_prompt_version)
       values ('VERIFY-STEP2','junior_high','claude-haiku-4-5-20251001',0.70,'v1') returning id`,
    );
    classId = cls.rows[0]?.id ?? "";

    await db.query(
      `insert into participants (code, pin_hash, class_id, role)
       values ('R-VERIFY', $1, null, 'researcher')`,
      [await bcrypt.hash(researcherPin, 10)],
    );
    await db.query(
      `insert into participants (code, pin_hash, class_id, role)
       values ('S-VERIFY', $1, $2, 'student')`,
      [await bcrypt.hash(studentPin, 10), classId],
    );

    console.log("\n── 認證 ─────────────────────────────────────────────");

    let researcherCookie = "";
    let studentCookie = "";

    await test("錯誤的 PIN 被拒，且不透露代號是否存在", async () => {
      const wrong = await call("/api/auth/login", {
        method: "POST",
        body: { code: "R-VERIFY", pin: "000000" },
      });
      const ghost = await call("/api/auth/login", {
        method: "POST",
        body: { code: "NO-SUCH-CODE", pin: "000000" },
      });
      assert(wrong.status === 401, `PIN 錯誤應回 401，實得 ${wrong.status}`);
      assert(ghost.status === 401, `代號不存在應回 401，實得 ${ghost.status}`);
      assert(
        errorOf(wrong.body) === errorOf(ghost.body),
        "兩種失敗的訊息必須一致，否則可枚舉出哪些代號存在",
      );
    });

    await test("研究者以代號 + PIN 登入成功並取得 httpOnly cookie", async () => {
      const res = await call("/api/auth/login", {
        method: "POST",
        body: { code: "R-VERIFY", pin: researcherPin },
      });
      assert(res.status === 200, `預期 200，實得 ${res.status}`);
      assert(res.cookie !== null, "沒有收到 session cookie");
      researcherCookie = res.cookie ?? "";
    });

    await test("學生登入成功", async () => {
      const res = await call("/api/auth/login", {
        method: "POST",
        body: { code: "S-VERIFY", pin: studentPin },
      });
      assert(res.status === 200, `預期 200，實得 ${res.status}`);
      studentCookie = res.cookie ?? "";
    });

    console.log("\n── 路由守衛（proxy.ts）─────────────────────────────");

    await test("未登入存取後台頁面 → 導向登入頁", async () => {
      const res = await call("/admin/prompts");
      assert(res.status === 307 || res.status === 302, `預期轉址，實得 ${res.status}`);
      assert(
        (res.location ?? "").includes("/login"),
        `應導向 /login，實得 ${res.location}`,
      );
    });

    await test("未登入呼叫後台 API → 401", async () => {
      const res = await call("/api/admin/prompts");
      assert(res.status === 401, `預期 401，實得 ${res.status}`);
    });

    await test("學生呼叫後台 API → 403", async () => {
      const res = await call("/api/admin/prompts", { cookie: studentCookie });
      assert(res.status === 403, `預期 403，實得 ${res.status}`);
    });

    await test("學生存取研究者頁面 → 被導離", async () => {
      const res = await call("/trajectory", { cookie: studentCookie });
      assert(res.status === 307 || res.status === 302, `預期轉址，實得 ${res.status}`);
      assert(
        !(res.location ?? "").includes("/trajectory"),
        "學生不得停留在研究者頁面",
      );
    });

    await test("研究者可讀後台 API", async () => {
      const res = await call("/api/admin/prompts", { cookie: researcherCookie });
      assert(res.status === 200, `預期 200，實得 ${res.status}`);
    });

    console.log("\n── ★驗收條件：反思題目版本凍結 ─────────────────────");

    await test("可新增反思題目版本", async () => {
      const res = await call("/api/admin/prompts", {
        method: "POST",
        cookie: researcherCookie,
        body: {
          version: FROZEN_VERSION,
          questions: [
            { id: "q1", text: "找一段藍色，當時為什麼直接用了 AI 的句子？", min_chars: 30 },
          ],
        },
      });
      assert(
        res.status === 201 || res.status === 403,
        `預期 201（首次）或 403（版本已存在），實得 ${res.status}`,
      );
    });

    await test("重複建立同一版本被拒（API 層）", async () => {
      const res = await call("/api/admin/prompts", {
        method: "POST",
        cookie: researcherCookie,
        body: { version: FROZEN_VERSION, questions: [{ id: "q1", text: "改過的題目", min_chars: 1 }] },
      });
      assert(res.status === 403, `預期 403，實得 ${res.status}`);
      assert(errorOf(res.body).includes("凍結"), "拒絕訊息應說明版本凍結");
    });

    for (const method of ["PATCH", "PUT", "DELETE"]) {
      await test(`${method} /api/admin/prompts 被拒（API 層）`, async () => {
        const res = await call("/api/admin/prompts", {
          method,
          cookie: researcherCookie,
          body: { version: FROZEN_VERSION, questions: [] },
        });
        assert(res.status === 403, `預期 403，實得 ${res.status}`);
        assert(errorOf(res.body).includes("凍結"), "拒絕訊息應說明版本凍結");
      });

      await test(`${method} /api/admin/prompts/${FROZEN_VERSION} 被拒（API 層）`, async () => {
        const res = await call(`/api/admin/prompts/${FROZEN_VERSION}`, {
          method,
          cookie: researcherCookie,
          body: { questions: [] },
        });
        assert(res.status === 403, `預期 403，實得 ${res.status}`);
      });
    }

    await test("繞過 API 直接改資料庫，仍被 004 的 trigger 擋下", async () => {
      await db.query("savepoint sp");
      let blocked = false;
      try {
        const res = await db.query(
          `update reflection_prompts set questions = '[]' where version = $1`,
          [FROZEN_VERSION],
        );
        blocked = res.rowCount === 0;
      } catch {
        blocked = true;
      }
      await db.query("rollback to savepoint sp");
      assert(blocked, "資料庫層必須擋下既有版本的修改");
    });

    console.log("\n── 三期凍結（模型參數與作業內容）────────────────────");

    await test("班級尚無作答紀錄時可調整模型參數", async () => {
      const res = await call(`/api/admin/classes/${classId}`, {
        method: "PATCH",
        cookie: researcherCookie,
        body: { temperature: 0.5 },
      });
      assert(res.status === 200, `預期 200，實得 ${res.status}：${errorOf(res.body)}`);
    });

    await test("班級一有作答紀錄，模型參數即凍結", async () => {
      const assignment = await db.query<{ id: string }>(
        `insert into assignments (title, instructions, order_no)
         values ('VERIFY-STEP2 作業', '驗證用', 3)
         on conflict (order_no) do update set title = excluded.title
         returning id`,
      );
      const student = await db.query<{ id: string }>(
        `select id from participants where code = 'S-VERIFY'`,
      );
      await db.query(
        `insert into sessions (participant_id, assignment_id) values ($1, $2)
         on conflict (participant_id, assignment_id) do nothing`,
        [student.rows[0]?.id, assignment.rows[0]?.id],
      );

      const res = await call(`/api/admin/classes/${classId}`, {
        method: "PATCH",
        cookie: researcherCookie,
        body: { temperature: 1.2 },
      });
      assert(res.status === 403, `預期 403，實得 ${res.status}`);
      assert(errorOf(res.body).includes("三期"), "拒絕理由應說明三期可比性");
    });

    console.log("\n── 參與者代號與 PIN ────────────────────────────────");

    await test("批次產生代號，PIN 明碼只在回應出現、不落資料庫", async () => {
      const res = await call("/api/admin/participants", {
        method: "POST",
        cookie: researcherCookie,
        body: { class_id: classId, count: 3, prefix: "VF" },
      });
      assert(res.status === 201, `預期 201，實得 ${res.status}：${errorOf(res.body)}`);

      const creds = (res.body as { credentials?: { code: string; pin: string }[] })
        .credentials;
      assert(Array.isArray(creds) && creds.length === 3, "應回傳 3 組帳號");

      const pins = (creds ?? []).map((c) => c.pin);
      assert(
        pins.every((p) => /^\d{6}$/.test(p)),
        "PIN 應為 6 位數字",
      );

      const stored = await db.query<{ pin_hash: string }>(
        `select pin_hash from participants where code like 'VF-%'`,
      );
      assert(stored.rowCount === 3, "資料庫應有 3 筆");
      for (const row of stored.rows) {
        assert(row.pin_hash.startsWith("$2"), "資料庫存的必須是 bcrypt 雜湊");
        assert(!pins.includes(row.pin_hash), "資料庫不得存 PIN 明碼");
      }

      // 產生的帳號真的能登入
      const first = creds?.[0];
      if (!first) throw new Error("沒有取得第一組帳號");
      const login = await call("/api/auth/login", {
        method: "POST",
        body: { code: first.code, pin: first.pin },
      });
      assert(login.status === 200, "新產生的帳號應可登入");
    });

    await test("登出後 cookie 失效", async () => {
      const out = await call("/api/auth/logout", {
        method: "POST",
        cookie: researcherCookie,
      });
      assert(out.status === 200, `預期 200，實得 ${out.status}`);
      assert(out.cookie === "mf_session=", "應清空 session cookie");
    });
  } finally {
    // 清理：participants / classes / sessions / assignments 皆可刪。
    // reflection_prompts 的 'verify-freeze' 依鐵則永遠留著，版本名稱固定不累積。
    await db.query(`delete from sessions where participant_id in
      (select id from participants where code like 'VF-%' or code in ('R-VERIFY','S-VERIFY'))`)
      .catch(() => undefined);
    await db.query(`delete from participants where code like 'VF-%' or code in ('R-VERIFY','S-VERIFY')`)
      .catch(() => undefined);
    await db.query(`delete from assignments where title = 'VERIFY-STEP2 作業'`)
      .catch(() => undefined);
    await db.query(`delete from classes where label = 'VERIFY-STEP2'`)
      .catch(() => undefined);
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${"─".repeat(56)}\n共 ${results.length} 項，通過 ${results.length - failed.length} 項，失敗 ${failed.length} 項。`,
  );
  console.log(`測試帳號與班級已清除；reflection_prompts 保留 '${FROZEN_VERSION}'（依鐵則不可刪）。`);
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
