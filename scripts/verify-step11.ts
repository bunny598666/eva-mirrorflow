/**
 * verify-step11.ts —— 人工編碼介面與 Cohen's κ 驗收
 *
 * BUILD_PLAN §6 STEP 11 驗收：
 *   1. κ 與手算一致
 *   2. 分歧清單正確
 *
 * 第 1 項用四組**在註解裡逐步手算**的例子對照。手算過程寫出來，日後有人
 * 懷疑數字時可以直接核對，不必反推程式碼。
 *
 * 另外驗編碼介面的資料流：coder_code 取自登入身分（不接受用戶端指定）、
 * 同一人重複送出是更新而非新增、編碼者看不到別人的判定。
 *
 * 需要 dev server（`npm run dev`）與 DATABASE_URL。
 *
 *   npm run verify:step11
 */
import { Client } from "pg";
import { buildReport, cohensKappa, interpret } from "../lib/coding/kappa.ts";
import {
  CURRENT_SCHEME_VERSION,
  getScheme,
  isComplete,
  sanitize,
} from "../lib/coding/scheme.ts";

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

function near(name: string, actual: number | null, expected: number, tol = 1e-9): void {
  const ok = actual !== null && Math.abs(actual - expected) <= tol;
  check(name, ok, ok ? "" : `實際 ${actual}，預期 ${expected} ±${tol}`);
}

/** 把兩串類目變成 cohensKappa 要的配對。 */
function pairs(a: readonly string[], b: readonly string[]) {
  return a.map((value, index) => ({
    unitId: `u${String(index).padStart(3, "0")}`,
    a: value,
    b: b[index] ?? "",
  }));
}

function repeat(value: string, times: number): string[] {
  return Array.from({ length: times }, () => value);
}

// ══ 1. κ 與手算一致 ═════════════════════════════════════════════════════
console.log("\n【1】Cohen's κ 與手算對照");

// ── 例 A：2×2 教科書例（n = 50）──
//        B:yes  B:no        手算：
//  A:yes   20     5    25   Po = (20+15)/50 = 0.70
//  A:no    10    15    25   Pe = (25/50)(30/50) + (25/50)(20/50)
//          30    20    50      = 0.5×0.6 + 0.5×0.4 = 0.30 + 0.20 = 0.50
//                           κ  = (0.70−0.50)/(1−0.50) = 0.20/0.50 = 0.40
{
  const a = [...repeat("yes", 25), ...repeat("no", 25)];
  const b = [
    ...repeat("yes", 20), ...repeat("no", 5),
    ...repeat("yes", 10), ...repeat("no", 15),
  ];
  const result = cohensKappa("d", pairs(a, b));

  eq("例 A：n = 50", result.n, 50);
  eq("例 A：一致 35 個", result.agreed, 35);
  near("例 A：Po = 0.70", result.po, 0.7);
  near("例 A：Pe = 0.50", result.pe, 0.5);
  near("例 A：κ = 0.40（手算）", result.kappa, 0.4);
  // Landis & Koch：.21–.40 = fair。0.40 正好落在「低」的上緣，
  // 而它在浮點下是 0.39999999999999997——interpret 先四捨五入到兩位小數，
  // 分帶才不會取決於浮點的最後一位。
  eq("例 A：解讀（Landis & Koch 的 fair）", interpret(result.kappa), "低");
  eq("0.41 進入中等", interpret(0.41), "中等");
  eq("0.405 四捨五入到 0.41 → 中等", interpret(0.405), "中等");
  eq("0.404 四捨五入到 0.40 → 低", interpret(0.404), "低");
}

// ── 例 B：三類目（n = 10）──
//  A: a a a b b b c c c c        agreed = 8 → Po = 0.80
//  B: a a b b b c c c c c        邊際 A: a=3 b=3 c=4／B: a=2 b=3 c=5
//                                Pe = .3×.2 + .3×.3 + .4×.5 = .06+.09+.20 = 0.35
//                                κ  = (0.80−0.35)/(1−0.35) = 0.45/0.65 = 0.692307…
{
  const a = ["a", "a", "a", "b", "b", "b", "c", "c", "c", "c"];
  const b = ["a", "a", "b", "b", "b", "c", "c", "c", "c", "c"];
  const result = cohensKappa("d", pairs(a, b));

  near("例 B：Po = 0.80", result.po, 0.8);
  near("例 B：Pe = 0.35", result.pe, 0.35);
  near("例 B：κ = 0.45/0.65（手算）", result.kappa, 0.45 / 0.65);
  eq("例 B：邊際分布 A", result.marginals.a, { a: 3, b: 3, c: 4 });
  eq("例 B：邊際分布 B", result.marginals.b, { a: 2, b: 3, c: 5 });
}

// ── 例 C：完全一致與完全相反 ──
{
  const same = cohensKappa("d", pairs(["a", "b", "a", "b"], ["a", "b", "a", "b"]));
  near("完全一致 → κ = 1", same.kappa, 1);
  eq("完全一致 → 沒有分歧", same.disagreements.length, 0);

  // A: a b／B: b a　Po = 0，邊際兩邊都是 .5/.5 → Pe = .25+.25 = .5
  // κ = (0−.5)/(1−.5) = −1
  const opposite = cohensKappa("d", pairs(["a", "b"], ["b", "a"]));
  near("完全相反 → κ = −1", opposite.kappa, -1);
  eq("完全相反 → 解讀", interpret(opposite.kappa), "低於機遇");
}

// ── 例 D：kappa paradox（Po 很高但 κ 近乎 0）──
//        B:a  B:b        Po = 90/100 = 0.90
//  A:a   90    5    95   Pe = .95×.95 + .05×.05 = .9025 + .0025 = 0.905
//  A:b    5    0     5   κ  = (0.90−0.905)/(1−0.905) = −0.005/0.095 = −0.05263…
//        95    5   100   ← 這就是為什麼要一併看 Po 與邊際分布
{
  const a = [...repeat("a", 95), ...repeat("b", 5)];
  const b = [...repeat("a", 90), ...repeat("b", 5), ...repeat("a", 5)];
  const result = cohensKappa("d", pairs(a, b));

  near("例 D：Po = 0.90（看起來很一致）", result.po, 0.9);
  near("例 D：Pe = 0.905", result.pe, 0.905);
  near("例 D：κ = −0.005/0.095（手算）", result.kappa, -0.005 / 0.095);
  check(
    "例 D：Po 高但 κ 近乎 0——所以報告一定要同時給 Po 與邊際",
    result.po > 0.85 && (result.kappa ?? 0) < 0.1,
  );
}

// ── 邊界 ──
{
  const empty = cohensKappa("d", []);
  eq("沒有共同案例 → κ 為 null（不是 0）", empty.kappa, null);
  eq("沒有共同案例 → 解讀", interpret(empty.kappa), "無法計算");

  // 兩人都只用同一個類目：完全沒有變異，κ 的分母為 0
  const noVariance = cohensKappa("d", pairs(repeat("a", 8), repeat("a", 8)));
  near("零變異 → Po = 1", noVariance.po, 1);
  eq("零變異 → κ 未定義，回 null 而不是 0 或 1", noVariance.kappa, null);
}

// ══ 2. 分歧清單 ═════════════════════════════════════════════════════════
console.log("\n【2】分歧清單");

{
  const scheme = getScheme();
  const dimensionIds = scheme.dimensions.map((d) => d.id);

  const recordsA: { unitId: string; codes: Record<string, string> }[] = [
    { unitId: "s1", codes: { ai_use: "dialogue", reflection_depth: "critical", intention: "specific" } },
    { unitId: "s2", codes: { ai_use: "delegation", reflection_depth: "descriptive", intention: "vague" } },
    { unitId: "s3", codes: { ai_use: "refinement", reflection_depth: "explanatory", intention: "none" } },
    // s4 只有 A 編過 → 不該進入計算
    { unitId: "s4", codes: { ai_use: "minimal", reflection_depth: "descriptive", intention: "none" } },
  ];
  const recordsB: { unitId: string; codes: Record<string, string> }[] = [
    { unitId: "s1", codes: { ai_use: "dialogue", reflection_depth: "critical", intention: "specific" } },
    { unitId: "s2", codes: { ai_use: "refinement", reflection_depth: "descriptive", intention: "vague" } },
    // s3 的 intention 留白 → 那一格不算不一致，只是還沒編完
    { unitId: "s3", codes: { ai_use: "refinement", reflection_depth: "critical" } },
  ];

  const report = buildReport("R-01", "R-02", dimensionIds, recordsA, recordsB);

  eq("兩人都編過的只有 3 個（s4 排除）", report.sharedUnits, 3);

  const aiUse = report.dimensions.find((d) => d.dimensionId === "ai_use");
  eq("AI 使用模式：n = 3", aiUse?.n, 3);
  eq("AI 使用模式：1 處分歧", aiUse?.disagreements.length, 1);
  eq("分歧內容", aiUse?.disagreements[0], {
    unitId: "s2",
    dimensionId: "ai_use",
    a: "delegation",
    b: "refinement",
  });

  const depth = report.dimensions.find((d) => d.dimensionId === "reflection_depth");
  eq("反思深度：1 處分歧（s3）", depth?.disagreements.length, 1);
  eq("分歧的是 s3", depth?.disagreements[0]?.unitId, "s3");

  const intention = report.dimensions.find((d) => d.dimensionId === "intention");
  eq("改變意圖：B 留白那格不算，n 降為 2", intention?.n, 2);
  eq("改變意圖：沒有分歧", intention?.disagreements.length, 0);

  check(
    "s4 完全沒出現在任何分歧裡",
    report.dimensions.every((d) => d.disagreements.every((x) => x.unitId !== "s4")),
  );
  check("平均 κ 算得出來", report.meanKappa !== null);
}

// ══ 3. 編碼架構 ═════════════════════════════════════════════════════════
console.log("\n【3】編碼架構");

{
  const scheme = getScheme();
  eq("現行版本", scheme.version, CURRENT_SCHEME_VERSION);
  check("有三個向度", scheme.dimensions.length === 3);
  check(
    "每個向度至少三個類目",
    scheme.dimensions.every((d) => d.categories.length >= 3),
  );
  check(
    "每個類目都有定義（沒有定義就編不一致）",
    scheme.dimensions.every((d) => d.categories.every((c) => c.definition.length > 10)),
  );
  check(
    "編碼對象含反思文本（本方向與方向一的差別）",
    scheme.dimensions.some((d) => d.material === "reflection"),
  );

  eq(
    "少填一個向度 → 不算編完",
    isComplete(scheme, { ai_use: "dialogue", reflection_depth: "critical" }),
    false,
  );
  eq(
    "填滿 → 算編完",
    isComplete(scheme, {
      ai_use: "dialogue",
      reflection_depth: "critical",
      intention: "specific",
    }),
    true,
  );
  eq(
    "不存在的類目 → 不算編完",
    isComplete(scheme, {
      ai_use: "不存在的類目",
      reflection_depth: "critical",
      intention: "specific",
    }),
    false,
  );

  eq(
    "sanitize 濾掉架構外的鍵值",
    sanitize(scheme, { ai_use: "dialogue", 亂塞: "x", reflection_depth: "不存在" }),
    { ai_use: "dialogue" },
  );
  eq("sanitize 收到非物件 → 空物件", sanitize(scheme, "字串"), {});
}

// ══ 4. 資料流（需要 dev server）══════════════════════════════════════════

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

async function postCoding(
  jar: Jar,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/coding`, {
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

async function main(): Promise<void> {
  console.log("\n【4】編碼寫入的資料流");

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  const db = new Client({ connectionString });
  await db.connect();

  try {
    const session = await db.query<{ id: string }>(
      "select id from sessions where status in ('submitted','reflected') limit 1",
    );
    const sessionId = session.rows[0]?.id;
    if (!sessionId) {
      console.log(`${DIM}    沒有已交件的場次，跳過資料流檢查。${OFF}`);
      return;
    }

    // 第二位編碼者。researcher 不隸屬班級，class_id 為 null。
    const donor = await db.query<{ pin_hash: string }>(
      "select pin_hash from participants where code = 'R-01'",
    );
    const pinHash = donor.rows[0]?.pin_hash;
    if (!pinHash) throw new Error("找不到 R-01。");

    await db.query(
      `insert into participants (code, pin_hash, class_id, role)
       values ('R-02', $1, null, 'researcher')
       on conflict (code) do nothing`,
      [pinHash],
    );

    const jarA = await login("R-01", "333333");
    const jarB = await login("R-02", "333333");

    const full = {
      ai_use: "dialogue",
      reflection_depth: "critical",
      intention: "specific",
    };

    // 少填一個向度要被擋
    const partial = await postCoding(jarA, {
      session_id: sessionId,
      codes: { ai_use: "dialogue" },
    });
    eq("少填向度 → 400", partial.status, 400);
    eq("擋下來的理由", partial.body.error, "每個向度都要選一個類目");

    // 用戶端自報 coder_code 不該生效
    const spoof = await postCoding(jarA, {
      session_id: sessionId,
      coder_code: "R-99",
      codes: full,
    });
    eq("正常寫入 → 200", spoof.status, 200);
    eq("coder_code 取自登入身分，不是用戶端送的", spoof.body.coder_code, "R-01");

    const spoofed = await db.query(
      "select 1 from coder_annotations where coder_code = 'R-99'",
    );
    eq("資料庫裡沒有 R-99 這位編碼者", spoofed.rowCount, 0);

    // 重複送出＝更新，不是新增
    await postCoding(jarA, {
      session_id: sessionId,
      codes: { ...full, ai_use: "refinement" },
    });
    const mine = await db.query<{ codes: Record<string, string> }>(
      `select codes from coder_annotations
        where session_id = $1 and coder_code = 'R-01' and scheme_version = $2`,
      [sessionId, CURRENT_SCHEME_VERSION],
    );
    eq("同一人同一場次只有一列", mine.rowCount, 1);
    eq("重送是更新，改判定會生效", mine.rows[0]?.codes.ai_use, "refinement");

    // 第二位編碼者獨立寫入
    const bWrote = await postCoding(jarB, {
      session_id: sessionId,
      codes: { ...full, ai_use: "delegation" },
    });
    eq("第二位編碼者寫入 → 200", bWrote.status, 200);
    eq("身分是 R-02", bWrote.body.coder_code, "R-02");

    const both = await db.query<{ coder_code: string }>(
      "select coder_code from coder_annotations where session_id = $1 and scheme_version = $2 order by coder_code",
      [sessionId, CURRENT_SCHEME_VERSION],
    );
    eq(
      "同一場次兩位編碼者各自一列",
      both.rows.map((r) => r.coder_code),
      ["R-01", "R-02"],
    );

    // 編碼者只讀得到自己的：頁面查詢一律以 coder_code 收斂
    const onlyMine = await db.query(
      "select 1 from coder_annotations where session_id = $1 and coder_code = 'R-01'",
      [sessionId],
    );
    eq("以 coder_code 查只拿到自己那列", onlyMine.rowCount, 1);

    // 未交件的場次不能編
    const active = await db.query<{ id: string }>(
      "select id from sessions where status = 'active' limit 1",
    );
    if (active.rows[0]) {
      const tooEarly = await postCoding(jarA, {
        session_id: active.rows[0].id,
        codes: full,
      });
      eq("未交件的場次 → 400", tooEarly.status, 400);
    }

    // 最後：真的從資料庫算一次 κ，確認端到端接得起來
    const rows = await db.query<{ session_id: string; coder_code: string; codes: Record<string, string> }>(
      "select session_id, coder_code, codes from coder_annotations where scheme_version = $1",
      [CURRENT_SCHEME_VERSION],
    );
    const scheme = getScheme();
    const report = buildReport(
      "R-01",
      "R-02",
      scheme.dimensions.map((d) => d.id),
      rows.rows.filter((r) => r.coder_code === "R-01").map((r) => ({ unitId: r.session_id, codes: r.codes })),
      rows.rows.filter((r) => r.coder_code === "R-02").map((r) => ({ unitId: r.session_id, codes: r.codes })),
    );
    check("從資料庫算得出 κ 報告", report.sharedUnits >= 1);
    // 只斷言**這一個場次**的分歧。資料庫裡會累積前幾輪驗收留下的編碼，
    // 斷言「總共只有 1 處分歧」會隨著跑過幾次而變動——那種測試遲早會紅，
    // 而且紅的時候跟程式碼無關。
    const aiUse = report.dimensions.find((d) => d.dimensionId === "ai_use");
    const thisSession = aiUse?.disagreements.find((x) => x.unitId === sessionId);
    check("剛才刻意編不一樣的向度被抓到分歧", thisSession !== undefined);
    eq("分歧內容正確", [thisSession?.a, thisSession?.b], ["refinement", "delegation"]);
  } finally {
    await db.end();
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`,
  );
  if (failed > 0) process.exit(1);
  console.log(`${GREEN}STEP 11 驗收通過。${OFF}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
