/**
 * db-setup.ts —— 對一個乾淨的 Supabase 專案套用全部 migration
 *
 *   npm run db:setup                 # 依序執行 supabase/migrations/*.sql
 *   npm run db:setup -- --check      # 只檢查現況，不寫入
 *
 * 【為什麼需要這支】正式研究必須用一個**全新的 Supabase 專案**：
 * events / chat_messages / reflections / snapshots / export_audit 都是
 * append-only，開發期的測試資料永遠刪不掉，會一直混在正式資料裡。
 *
 * 手動貼十個 SQL 檔容易貼錯順序、漏掉一個，而漏掉的那個往往是 trigger——
 * 那種錯不會報錯，只會讓鐵則悄悄失效。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const OFF = "[0m";

const MIGRATIONS_DIR = "supabase/migrations";

/** 這些表建立之後就該存在。少一張就是 001 沒跑或跑錯專案。 */
const EXPECTED_TABLES = [
  "participants",
  "classes",
  "assignments",
  "sessions",
  "chat_messages",
  "events",
  "snapshots",
  "analyses",
  "reflection_prompts",
  "reflections",
  "coder_annotations",
  "export_audit",
  "auth_throttle",
];

/** append-only 的鐵則靠這些 trigger。少一個，鐵則就是空話。 */
const EXPECTED_TRIGGERS: { table: string; trigger: string }[] = [
  { table: "events", trigger: "events_immutable" },
  { table: "chat_messages", trigger: "chat_immutable" },
  { table: "reflections", trigger: "reflections_immutable" },
  { table: "reflection_prompts", trigger: "reflection_prompts_frozen" },
  { table: "snapshots", trigger: "snapshots_immutable" },
  { table: "export_audit", trigger: "export_audit_immutable" },
  { table: "sessions", trigger: "sessions_guard_update" },
];

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort(); // 檔名以編號開頭，字典序即執行順序
}

async function tableExists(db: Client, name: string): Promise<boolean> {
  const r = await db.query<{ n: string }>(
    "select count(*) as n from information_schema.tables where table_schema = 'public' and table_name = $1",
    [name],
  );
  return Number(r.rows[0]?.n ?? 0) > 0;
}

async function triggerExists(db: Client, table: string, trigger: string): Promise<boolean> {
  const r = await db.query<{ n: string }>(
    `select count(*) as n from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where c.relname = $1 and t.tgname = $2 and not t.tgisinternal`,
    [table, trigger],
  );
  return Number(r.rows[0]?.n ?? 0) > 0;
}

async function report(db: Client): Promise<boolean> {
  let ok = true;

  console.log(`\n${BOLD}資料表${OFF}`);
  for (const table of EXPECTED_TABLES) {
    const exists = await tableExists(db, table);
    if (!exists) ok = false;
    console.log(`  ${exists ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`} ${table}`);
  }

  console.log(`\n${BOLD}append-only 與守衛 trigger${OFF}`);
  for (const { table, trigger } of EXPECTED_TRIGGERS) {
    const exists = await triggerExists(db, table, trigger);
    if (!exists) ok = false;
    console.log(`  ${exists ? `${GREEN}✓${OFF}` : `${RED}✗${OFF}`} ${table}.${trigger}`);
  }

  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  const unprotected = rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  console.log(`\n${BOLD}Row Level Security${OFF}`);
  if (unprotected.length === 0) {
    console.log(`  ${GREEN}✓${OFF} 全部資料表都已啟用`);
  } else {
    ok = false;
    console.log(`  ${RED}✗${OFF} 未啟用：${unprotected.join(", ")}`);
  }

  return ok;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    console.error("Supabase → Project Settings → Database → Connection string（port 5432 直連）");
    process.exit(1);
  }

  const checkOnly = process.argv.includes("--check");
  const db = new Client({ connectionString });
  await db.connect();

  try {
    const host = new URL(connectionString.replace(/^postgres(ql)?:/, "http:")).hostname;
    console.log(`${DIM}目標資料庫：${host}${OFF}`);

    if (checkOnly) {
      const ok = await report(db);
      console.log(`\n${ok ? `${GREEN}結構完整。${OFF}` : `${RED}結構不完整——執行 npm run db:setup 補齊。${OFF}`}`);
      process.exit(ok ? 0 : 1);
    }

    const files = migrationFiles();
    console.log(`\n${BOLD}套用 ${files.length} 個 migration${OFF}`);

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      try {
        await db.query(sql);
        console.log(`  ${GREEN}✓${OFF} ${file}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 001 建表；已經建過就會撞 "already exists"。那不是錯誤，是這個專案
        // 已經套用過——但要講清楚，免得誤以為全新專案跑成功了。
        if (/already exists/i.test(message)) {
          console.log(`  ${DIM}－ ${file}（已存在，略過）${OFF}`);
          continue;
        }
        console.log(`  ${RED}✗${OFF} ${file}\n    ${message}`);
        throw err;
      }
    }

    const ok = await report(db);
    if (!ok) {
      console.log(`\n${RED}結構仍不完整，請看上方標記。${OFF}`);
      process.exit(1);
    }

    console.log(`\n${GREEN}資料庫結構就緒。${OFF}`);
    console.log(`${DIM}接下來：
  1. npm run create:participant -- --code T-01 --role teacher   建立教師帳號
  2. 以教師身分登入 /admin 建立班級與三份作業
  3. npm run create:participant 逐一建立學生帳號（PIN 只印一次）
  4. Vercel 環境變數確認 REFLECTION_PROMPT_VERSION 與 θ 與本機一致${OFF}`);
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(`${RED}${err instanceof Error ? err.message : String(err)}${OFF}`);
  process.exit(1);
});
