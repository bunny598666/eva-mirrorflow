/**
 * verify-step12.ts —— 去識別化匯出驗收
 *
 * BUILD_PLAN §6 STEP 12 驗收：
 *   1. 匯出檔查無 PII
 *   2. manifest 與 DB count 一致
 *
 * 做法：真的打 /api/export 拿回 zip，**用系統的解壓工具解開**（不是用自己
 * 寫的程式碼驗自己寫的程式碼），再逐檔檢查內容。
 *
 * 需要 dev server（`npm run dev`）與 DATABASE_URL。
 *
 *   npm run verify:step12
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";

import { toCsv, withBom } from "../lib/export/csv.ts";
import { createZip, crc32 } from "../lib/export/zip.ts";
import { mask, scanPii } from "../lib/export/pii.ts";

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

// ══ 1. CSV 跳脫 ═════════════════════════════════════════════════════════
console.log("\n【1】CSV 跳脫");

{
  // 學生寫的東西一定會有逗號、換行、引號。少跳脫一個，欄位就錯開。
  const csv = toCsv(
    ["a", "b"],
    [["含,逗號", '含"引號"'], ["含\n換行", null], [1, undefined]],
  );
  eq(
    "逗號、引號、換行都跳脫正確",
    csv,
    '"a","b"\r\n"含,逗號","含""引號"""\r\n"含\n換行",\r\n"1",\r\n',
  );
  // null 與空字串在統計軟體裡不同：未加引號的空欄位讀成 NA，"" 讀成空字串。
  // 「這件事沒發生」與「他真的留了白」不能混為一談。
  eq("null → 未加引號的空欄位（R/pandas 讀成 NA）", toCsv(["a"], [[null]]), '"a"\r\n\r\n');
  eq('空字串 → ""（讀成長度 0 的字串）', toCsv(["a"], [[""]]), '"a"\r\n""\r\n');
  check("BOM 加得上（Excel 才不會亂碼）", withBom("x").charCodeAt(0) === 0xfeff);
}

// ══ 2. PII 掃描 ═════════════════════════════════════════════════════════
console.log("\n【2】PII 掃描");

{
  const findings = scanPii([
    { name: "chat.csv", content: "我的信箱是 wang@example.com，電話 0912-345-678" },
    { name: "reflections.csv", content: "身分證 A123456789，學號 10912345" },
  ]);
  const ids = findings.map((f) => f.patternId).sort();
  eq("四種樣態都抓得到", ids, ["email", "long_digits", "tw_id", "tw_mobile"]);

  const email = findings.find((f) => f.patternId === "email");
  eq("記下出現在哪個檔案", email?.files, ["chat.csv"]);
  check(
    "樣本有遮蔽（manifest 會被存下來，不該留原文）",
    email?.samples.every((s) => s.includes("*")) === true,
    JSON.stringify(email?.samples),
  );
  eq("遮蔽保留頭尾", mask("A123456789"), "A1******89");
  eq("太短的整串遮掉", mask("abc"), "***");

  eq("乾淨的內容沒有命中", scanPii([{ name: "chat.csv", content: "今天天氣很好。" }]), []);

  // 小數不是學號。實測時 metrics.csv 的三色比例被誤報 27 次。
  eq(
    "小數點裡的長數字不算學號",
    scanPii([{ name: "chat.csv", content: "比例是 0.3719008264462810" }]),
    [],
  );
  check(
    "但真正的裸學號仍抓得到",
    scanPii([{ name: "chat.csv", content: "我的學號 10912345" }]).length === 1,
  );

  // 誤報會讓研究者直接略過整份報告，所以寧可保守
  eq(
    "一般的數字不誤報",
    scanPii([{ name: "chat.csv", content: "我寫了 300 字，花了 45 分鐘。" }]),
    [],
  );
}

// ══ 3. ZIP 格式 ═════════════════════════════════════════════════════════
console.log("\n【3】ZIP 格式");

{
  // CRC-32 標準測試向量
  eq("CRC-32('123456789') = 0xCBF43926", crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  eq("CRC-32(空) = 0", crc32(new Uint8Array()), 0);
}

// ══ 4. 端到端：真的匯出、真的解壓 ═══════════════════════════════════════

type Jar = { cookie: string };

async function login(code: string, pin: string): Promise<Jar> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, pin }),
  });
  if (!res.ok) throw new Error(`登入失敗 ${code}：${res.status}`);
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("登入沒有回 cookie");
  return { cookie };
}

/**
 * 用系統的解壓工具解開。
 *
 * 刻意不用自己寫的程式碼來讀自己寫的 zip——那只會證明「我跟我自己一致」。
 * Windows 用 PowerShell 的 Expand-Archive，其餘平台用 unzip。
 */
function extract(zipPath: string, outDir: string): void {
  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
      ],
      { stdio: "pipe" },
    );
  } else {
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", outDir], { stdio: "pipe" });
  }
}

function parseCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      // 由下一個 \n 收尾
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function main(): Promise<void> {
  console.log("\n【4】端到端：匯出、解壓、逐檔檢查");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  // 學生與教師都不該碰得到匯出
  const student = await login("S-01", "111111");
  const blocked = await fetch(`${BASE}/api/export`, { headers: { Cookie: student.cookie } });
  check(`學生存取匯出被擋（${blocked.status}）`, blocked.status === 401 || blocked.status === 403);

  const jar = await login("R-01", "333333");
  const before = new Date();
  const res = await fetch(`${BASE}/api/export`, { headers: { Cookie: jar.cookie } });
  eq("研究者匯出 → 200", res.status, 200);
  eq("Content-Type 是 zip", res.headers.get("content-type"), "application/zip");
  check(
    "帶 Content-Disposition 檔名",
    (res.headers.get("content-disposition") ?? "").includes("mirrorflow-export-"),
  );
  eq("不快取", res.headers.get("cache-control"), "no-store");

  const zipBytes = new Uint8Array(await res.arrayBuffer());
  check(`zip 有內容（${(zipBytes.length / 1024).toFixed(0)}KB）`, zipBytes.length > 100);
  eq(
    "檔頭是 PK\\x03\\x04",
    [zipBytes[0], zipBytes[1], zipBytes[2], zipBytes[3]],
    [0x50, 0x4b, 0x03, 0x04],
  );

  const dir = mkdtempSync(join(tmpdir(), "mf-export-"));
  try {
    const zipPath = join(dir, "export.zip");
    writeFileSync(zipPath, zipBytes);
    const outDir = join(dir, "out");

    let extracted = true;
    try {
      extract(zipPath, outDir);
    } catch (err) {
      extracted = false;
      check("系統解壓工具開得起來", false, err instanceof Error ? err.message : String(err));
    }
    if (!extracted) return;

    check("系統解壓工具開得起來", true);

    const names = readdirSync(outDir).sort();
    eq("七個檔案齊全", names, [
      "chat.csv",
      "dna.json",
      "events.csv",
      "manifest.json",
      "metrics.csv",
      "quadrant.csv",
      "reflections.csv",
    ]);

    const read = (name: string): string => readFileSync(join(outDir, name), "utf8");
    const manifest = JSON.parse(read("manifest.json")) as {
      exported_at: string;
      exported_by: string;
      parameters: Record<string, unknown>;
      counts: Record<string, number>;
      db_counts: Record<string, number>;
      pii_scan: { note: string; findings: unknown[] };
    };

    // ── manifest ──
    eq("manifest 記下匯出者", manifest.exported_by, "R-01");
    check(
      "manifest 的時間戳合理",
      new Date(manifest.exported_at).getTime() >= before.getTime() - 5000,
    );
    check("記下 θ", typeof manifest.parameters.dna_theta === "object");
    check("記下演算法版本", typeof manifest.parameters.dna_algorithm_version === "string");
    check("記下高階提問規則版本", typeof manifest.parameters.question_rule_version === "string");
    check("記下編碼架構版本", typeof manifest.parameters.coding_scheme_version === "string");
    check("記下模型參數", Array.isArray(manifest.parameters.models));
    check("記下反思題目版本", Array.isArray(manifest.parameters.reflection_prompt_versions));
    check("PII 掃描有附上警語", manifest.pii_scan.note.includes("人工"));

    // ── manifest 的筆數與檔案實際列數一致 ──
    const db = new Client({ connectionString });
    await db.connect();
    try {
      const csvRows = (name: string): number => {
        const rows = parseCsv(read(name)).filter((r) => r.some((c) => c !== ""));
        return rows.length - 1; // 扣掉表頭
      };

      for (const name of ["events.csv", "chat.csv", "quadrant.csv", "reflections.csv", "metrics.csv"]) {
        eq(`${name}：manifest 筆數 === 檔案列數`, csvRows(name), manifest.counts[name]);
      }
      const dnaRecords = JSON.parse(read("dna.json")) as unknown[];
      eq("dna.json：manifest 筆數 === 陣列長度", dnaRecords.length, manifest.counts["dna.json"]);

      // ── 與資料庫直接 count 對照 ──
      const dbCount = async (sql: string): Promise<number> => {
        const r = await db.query<{ n: string }>(sql);
        return Number(r.rows[0]?.n ?? 0);
      };

      eq(
        "events.csv 列數 === DB events 筆數",
        manifest.counts["events.csv"],
        await dbCount("select count(*) as n from events"),
      );
      eq(
        "chat.csv 列數 === DB chat_messages 筆數",
        manifest.counts["chat.csv"],
        await dbCount("select count(*) as n from chat_messages"),
      );
      eq(
        "metrics.csv 列數 === DB sessions 筆數",
        manifest.counts["metrics.csv"],
        await dbCount("select count(*) as n from sessions"),
      );
      eq(
        "dna.json 筆數 === DB analyses(kind='dna')",
        manifest.counts["dna.json"],
        await dbCount("select count(*) as n from analyses where kind = 'dna'"),
      );
      eq(
        "quadrant.csv 列數 === DB analyses(kind='quadrant')",
        manifest.counts["quadrant.csv"],
        await dbCount("select count(*) as n from analyses where kind = 'quadrant'"),
      );
      eq(
        "reflections.csv 列數 === DB 反思的答案總數",
        manifest.counts["reflections.csv"],
        await dbCount(
          "select coalesce(sum(jsonb_array_length(answers)), 0) as n from reflections",
        ),
      );
      eq(
        "manifest 的 db_counts 與實際一致",
        manifest.db_counts.events,
        await dbCount("select count(*) as n from events"),
      );

      // ── 零 PII ──
      console.log(`${DIM}    去識別化檢查${OFF}`);
      const allContent = names.map((name) => ({ name, content: read(name) }));

      // 1. 內部主鍵不該出現
      const participantIds = await db.query<{ id: string }>("select id from participants");
      const leakedIds = participantIds.rows.filter((row) =>
        allContent.some((file) => file.content.includes(row.id)),
      );
      eq("匯出檔不含 participants.id（內部主鍵）", leakedIds.length, 0);

      // 2. pin_hash 一個字元都不該出現
      const hashes = await db.query<{ pin_hash: string }>("select pin_hash from participants");
      const leakedHashes = hashes.rows.filter((row) =>
        allContent.some((file) => file.content.includes(row.pin_hash)),
      );
      eq("匯出檔不含 pin_hash", leakedHashes.length, 0);
      check(
        "也沒有 bcrypt 雜湊的特徵字串",
        !allContent.some((file) => /\$2[aby]\$\d{2}\$/.test(file.content)),
      );

      // 3. 欄位名稱層級：不該有 pin / password 之類的欄位
      const headers = ["events.csv", "chat.csv", "quadrant.csv", "reflections.csv", "metrics.csv"]
        .flatMap((name) => parseCsv(read(name))[0] ?? []);
      check(
        "欄位名稱沒有 pin／password／participant_id",
        !headers.some((h) => /pin|password|participant_id/i.test(h)),
        headers.filter((h) => /pin|password|participant_id/i.test(h)).join(", "),
      );

      // 4. participant code 有出現（那是設計好要有的假名）
      const codes = await db.query<{ code: string }>(
        "select code from participants where role = 'student' limit 5",
      );
      check(
        "participant code 有出現（研究用假名，本來就該在）",
        codes.rows.some((row) => read("metrics.csv").includes(row.code)),
      );

      // ── 稽核紀錄 ──
      const audit = await db.query<{ researcher_code: string; manifest: { counts: unknown } }>(
        "select researcher_code, manifest from export_audit order by ts desc limit 1",
      );
      eq("寫了一筆稽核紀錄", audit.rowCount, 1);
      eq("稽核記下匯出者", audit.rows[0]?.researcher_code, "R-01");
      check("稽核存了完整 manifest", audit.rows[0]?.manifest?.counts !== undefined);

      // 稽核紀錄不可刪改
      let auditLocked = false;
      try {
        await db.query("begin");
        await db.query("update export_audit set researcher_code = 'X'");
        await db.query("rollback");
      } catch {
        auditLocked = true;
        await db.query("rollback");
      }
      check("稽核紀錄不可修改（DB trigger）", auditLocked);

      // ── 檔案內容抽查 ──
      const metrics = parseCsv(read("metrics.csv"));
      const header = metrics[0] ?? [];
      check("metrics.csv 有三色比例欄", header.includes("dna_blue_ratio"));
      check("metrics.csv 有象限座標欄", header.includes("x_interaction_depth"));
      check("metrics.csv 有事件計數欄", header.includes("n_paste"));
      eq("四個 join 鍵擺在最前面", header.slice(0, 4), [
        "session_id",
        "participant_code",
        "order_no",
        "assignment_title",
      ]);

      const reflectionsCsv = parseCsv(read("reflections.csv"));
      check(
        "reflections.csv 走長格式（一題一列）",
        (reflectionsCsv[0] ?? []).includes("question_index"),
      );
      check(
        "reflections.csv 帶介入證據（viewed_dna_at）",
        (reflectionsCsv[0] ?? []).includes("viewed_dna_at"),
      );
    } finally {
      await db.end();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`,
  );
  if (failed > 0) process.exit(1);
  console.log(`${GREEN}STEP 12 驗收通過。${OFF}`);
  console.log(
    `${DIM}（chat.csv 與 reflections.csv 是學生自由書寫，釋出前仍須人工通讀）${OFF}`,
  );
}

// createZip 在端到端流程裡由伺服器呼叫；這裡確認本地也產得出合法檔頭。
{
  const sample = createZip([{ name: "a.txt", content: "hello" }], new Date(2026, 0, 1));
  check(
    "createZip 產出 PK 檔頭",
    sample[0] === 0x50 && sample[1] === 0x4b,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
