/**
 * verify-step10.ts —— 三期軌跡圖驗收
 *
 * BUILD_PLAN §6 STEP 10 驗收：
 *   1. 45 筆 × 3 期模擬資料渲染 < 2 秒
 *   2. SVG 匯出後以向量軟體開啟無破版
 *   3. 篩選正確
 *
 * 第 2 項腳本只驗得到「檔案本身是合法、自足的 SVG」——真的用 Illustrator／
 * Inkscape 開一次仍需人工，程序見 README。這裡把會造成破版的技術原因逐條擋掉：
 * XML 解析得動、沒有外部 CSS class、沒有外部字型或圖片、數值不是 NaN。
 *
 * 不需要資料庫、瀏覽器或 AI。
 *
 *   npm run verify:step10
 */
import {
  buildTrajectories,
  computeCohort,
  mean,
  quadrantOf,
  startingQuadrant,
  stdDev,
  zScore,
  Y_DIVIDER,
  type CohortMember,
  type QuadrantPoint,
} from "../lib/metrics/quadrant.ts";
import {
  countHighOrder,
  isGenerationRequest,
  isHighOrderQuestion,
} from "../lib/metrics/questions.ts";
import {
  arrowFor,
  colorFor,
  DEFAULT_CHART,
  renderTrajectorySvg,
  shapeFor,
} from "../lib/metrics/chart.ts";

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

function near(name: string, actual: number, expected: number, tol = 0.0001): void {
  const ok = Math.abs(actual - expected) <= tol;
  check(name, ok, ok ? "" : `實際 ${actual}，預期 ${expected} ±${tol}`);
}

/**
 * 極簡 XML 結構檢查（標籤是否成對、屬性是否加引號）。
 *
 * 刻意不引入 XML 解析套件：CLAUDE.md §7 禁止清單外的依賴，而這裡真正要確認的
 * 只有「向量軟體解析得動」——標籤不成對是最常見的破版原因。
 */
function xmlIsBalanced(markup: string): { ok: boolean; reason: string } {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  let consumed = 0;

  while ((match = tag.exec(markup)) !== null) {
    consumed = tag.lastIndex;
    const [, closing, name, attrs, selfClosing] = match;
    if (!name) continue;

    // 屬性值一律要有引號，否則不同解析器會有不同解讀。
    const unquoted = /=\s*[^"'\s>]/.test(attrs ?? "");
    if (unquoted) return { ok: false, reason: `<${name}> 有沒加引號的屬性` };

    if (closing) {
      const open = stack.pop();
      if (open !== name) return { ok: false, reason: `</${name}> 對不上 <${open ?? "（無）"}>` };
    } else if (!selfClosing) {
      stack.push(name);
    }
  }

  if (consumed !== markup.length) {
    return { ok: false, reason: `有無法解析的片段（停在第 ${consumed} 個字元）` };
  }
  if (stack.length > 0) return { ok: false, reason: `未關閉：${stack.join(", ")}` };
  return { ok: true, reason: "" };
}

/** 取根元素 <svg …> 的屬性。 */
function rootAttributes(markup: string): Record<string, string> {
  const match = /<svg((?:[^>"']|"[^"]*")*)>/.exec(markup);
  const attrs: Record<string, string> = {};
  if (!match?.[1]) return attrs;
  const pair = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let found: RegExpExecArray | null;
  while ((found = pair.exec(match[1])) !== null) {
    if (found[1]) attrs[found[1]] = found[2] ?? "";
  }
  return attrs;
}

// ══ 1. 統計基礎 ═════════════════════════════════════════════════════════
console.log("\n【1】z 分數與象限判定");

eq("平均", mean([1, 2, 3, 4]), 2.5);
near("母體標準差", stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2);
eq("空陣列不會 NaN", stdDev([]), 0);

// 課堂現場一定會遇到：第一個交件的學生，全班只有他一個。
eq("標準差為 0（全班一樣）→ z = 0，不是 NaN", zScore(5, 5, 0), 0);
near("一般情況", zScore(7, 5, 2), 1);

eq("X≥0 且 Y≥0.5 → 協作者", quadrantOf(0, 0.5), "collaborator");
eq("X<0 且 Y≥0.5 → 獨行者", quadrantOf(-0.01, 0.9), "solo");
eq("X≥0 且 Y<0.5 → 外包者", quadrantOf(2, 0.49), "outsourcer");
eq("X<0 且 Y<0.5 → 搭便車者", quadrantOf(-2, 0.1), "free_rider");
eq("Y 分界固定在 0.5", Y_DIVIDER, 0.5);

// ══ 2. 高階提問規則 ═════════════════════════════════════════════════════
console.log("\n【2】高階提問的操作型定義");

check("要求解釋原因 → 高階", isHighOrderQuestion("為什麼這樣寫比較好？"));
check("要求比較 → 高階", isHighOrderQuestion("這兩種寫法有什麼不同？"));
check("要求評價自己的內容 → 高階", isHighOrderQuestion("幫我看一下我這段通順嗎"));
check("要求方法而非成品 → 高階", isHighOrderQuestion("我該從哪裡開始想？"));
check("追問深化 → 高階", isHighOrderQuestion("那如果我想寫得更具體一點呢"));

check("純代寫要求 → 不算高階", !isHighOrderQuestion("幫我寫一段開頭"));
check("純代寫要求 → 被認出來", isGenerationRequest("幫我寫一段開頭"));
check(
  "代寫但同時問了原因 → 仍算高階",
  isHighOrderQuestion("幫我寫一段開頭，然後告訴我為什麼要那樣開場"),
);
check(
  "代寫但同時問了原因 → 就不算純代寫",
  !isGenerationRequest("幫我寫一段開頭，然後告訴我為什麼要那樣開場"),
);
check("空字串 → 不算", !isHighOrderQuestion("   "));
eq(
  "計數",
  countHighOrder(["為什麼？", "幫我寫一段", "哪裡不好", "嗯"]),
  2,
);

// ══ 3. 整期一起算 ═══════════════════════════════════════════════════════
console.log("\n【3】整期全班一起算 z");

{
  const members: CohortMember[] = [
    {
      sessionId: "s1",
      participantCode: "S-01",
      raw: { turns: 10, promptChars: 40, highOrder: 5, orangeRatio: 0.7, greenRatio: 0.2 },
    },
    {
      sessionId: "s2",
      participantCode: "S-02",
      raw: { turns: 2, promptChars: 8, highOrder: 0, orangeRatio: 0.1, greenRatio: 0.2 },
    },
  ];
  const points = computeCohort(members, 1);

  eq("兩個人都有座標", points.length, 2);
  near("Y = 橘 + 0.5×綠", points[0]?.y ?? 0, 0.7 + 0.1);
  near("Y（第二位）", points[1]?.y ?? 0, 0.1 + 0.1);
  check(
    "互動多的人 X 比較大",
    (points[0]?.x ?? 0) > (points[1]?.x ?? 0),
    `${points[0]?.x} vs ${points[1]?.x}`,
  );
  near("兩人 z 相加為 0（對稱）", (points[0]?.x ?? 0) + (points[1]?.x ?? 0), 0);
  eq("象限", [points[0]?.quadrant, points[1]?.quadrant], ["collaborator", "free_rider"]);
  eq("記下基準人數", points[0]?.cohortN, 2);
  eq("保留原始值供絕對比較", points[0]?.raw.turns, 10);
}

// 只有一個人交件：z 全為 0，X 落在原點，不該是 NaN
{
  const solo = computeCohort(
    [
      {
        sessionId: "s1",
        participantCode: "S-01",
        raw: { turns: 7, promptChars: 30, highOrder: 3, orangeRatio: 0.9, greenRatio: 0 },
      },
    ],
    1,
  );
  eq("全班只有一人 → X = 0", solo[0]?.x, 0);
  check("X 不是 NaN", Number.isFinite(solo[0]?.x ?? NaN));
  near("Y 仍算得出來", solo[0]?.y ?? 0, 0.9);
}

eq("沒有人交件 → 空陣列", computeCohort([], 1).length, 0);

// ══ 4. 軌跡整理與篩選 ═══════════════════════════════════════════════════
console.log("\n【4】軌跡與起始象限篩選");

function point(code: string, orderNo: number, x: number, y: number): QuadrantPoint {
  return {
    sessionId: `${code}-${orderNo}`,
    participantCode: code,
    orderNo,
    x,
    y,
    quadrant: quadrantOf(x, y),
    raw: { turns: 1, promptChars: 1, highOrder: 0, orangeRatio: y, greenRatio: 0 },
    z: { turns: 0, promptChars: 0, highOrder: 0 },
    cohortN: 3,
  };
}

{
  // 刻意打亂輸入順序，確認整理後是照期別排的
  const scattered = [
    point("S-02", 2, 1, 0.8),
    point("S-01", 3, 2, 0.9),
    point("S-01", 1, -2, 0.2),
    point("S-02", 1, 0.5, 0.7),
    point("S-01", 2, 0, 0.6),
  ];
  const trajectories = buildTrajectories(scattered);

  eq("兩位學生", trajectories.length, 2);
  eq("代號排序", trajectories.map((t) => t.participantCode), ["S-01", "S-02"]);
  eq(
    "S-01 的三期照順序",
    trajectories[0]?.points.map((p) => p.orderNo),
    [1, 2, 3],
  );
  eq("S-01 起始象限＝第 1 期所在", startingQuadrant(trajectories[0]!), "free_rider");
  eq("S-02 起始象限", startingQuadrant(trajectories[1]!), "collaborator");

  const onlyFreeRiders = trajectories.filter((t) => startingQuadrant(t) === "free_rider");
  eq("篩「搭便車者」只留 S-01", onlyFreeRiders.map((t) => t.participantCode), ["S-01"]);

  // 只寫了一期的學生也要能畫（沒有箭頭而已）
  const partial = buildTrajectories([point("S-09", 1, 0, 0.5)]);
  eq("只有一期也成立", partial[0]?.points.length, 1);
  eq("起始象限仍算得出來", startingQuadrant(partial[0]!), "collaborator");
}

// ══ 5. 幾何 ═════════════════════════════════════════════════════════════
console.log("\n【5】點形狀與箭頭");

eq("第 1 次 → 圓", shapeFor(1), "circle");
eq("第 2 次 → 三角", shapeFor(2), "triangle");
eq("第 3 次 → 方", shapeFor(3), "square");

{
  const arrow = arrowFor(0, 0, 100, 0, 9);
  check("箭頭兩端各縮短，不蓋住端點形狀", arrow !== null);
  eq("起點內縮", arrow?.x1, 9);
  eq("終點內縮", arrow?.x2, 91);
  eq("角度", arrow?.angle, 0);
  eq("兩點重合 → 不畫箭頭", arrowFor(50, 50, 50, 50, 9), null);
  eq("距離太短 → 不畫箭頭", arrowFor(0, 0, 10, 0, 9), null);
}

eq("同一個代號永遠同色", colorFor("S-07"), colorFor("S-07"));
check("不同代號通常不同色", colorFor("S-01") !== colorFor("S-02"));

// ══ 6. 45 人 × 3 期：效能與 SVG 完整性 ══════════════════════════════════
console.log("\n【6】45 人 × 3 期");

{
  // 確定性的假資料（不用亂數，才能重複驗）
  const trajectories = buildTrajectories(
    Array.from({ length: 45 }, (_, i) =>
      [1, 2, 3].map((orderNo) => {
        const code = `S-${String(i + 1).padStart(2, "0")}`;
        const x = ((i * 7 + orderNo * 13) % 100) / 100 * 8 - 4;
        const y = ((i * 11 + orderNo * 29) % 100) / 100;
        return point(code, orderNo, x, y);
      }),
    ).flat(),
  );

  eq("45 位學生", trajectories.length, 45);
  eq("共 135 個點", trajectories.reduce((n, t) => n + t.points.length, 0), 135);

  const t0 = performance.now();
  const svg = renderTrajectorySvg(trajectories, DEFAULT_CHART);
  const renderMs = performance.now() - t0;

  const t1 = performance.now();
  const exported = renderTrajectorySvg(trajectories, { ...DEFAULT_CHART, english: true });
  const exportMs = performance.now() - t1;

  console.log(
    `${DIM}    畫面版 ${renderMs.toFixed(1)}ms／匯出版 ${exportMs.toFixed(1)}ms／${(svg.length / 1024).toFixed(0)}KB${OFF}`,
  );
  check(`渲染 < 2000ms（實際 ${renderMs.toFixed(1)}ms）`, renderMs < 2000);
  check(`匯出 < 2000ms（實際 ${exportMs.toFixed(1)}ms）`, exportMs < 2000);

  // ── 匯出檔必須是自足、合法的 SVG（＝向量軟體開得起來且不破版）──
  console.log(`${DIM}    匯出檔健檢${OFF}`);

  const balanced = xmlIsBalanced(exported);
  check("標籤成對、屬性有引號（解析得動）", balanced.ok, balanced.reason);

  const root = rootAttributes(exported);
  check("根元素是 svg", exported.startsWith("<svg "));
  eq("有 xmlns（少了就不是獨立檔案）", root.xmlns, "http://www.w3.org/2000/svg");
  check("有 viewBox（縮放不破版）", typeof root.viewBox === "string" && root.viewBox.length > 0);
  eq("有明確寬高", [root.width, root.height], ["720", "640"]);

  check("沒有 class 屬性（不依賴外部 CSS）", !/\sclass=/.test(exported));
  check("沒有外部樣式表連結", !exported.includes("<link"));
  check("沒有 <style> 區塊", !exported.includes("<style"));
  check("沒有外部圖片或字型", !/<image|@font-face|url\(http/.test(exported));
  check(
    "沒有 NaN / undefined 混進座標",
    !/NaN|undefined|Infinity/.test(exported),
    exported.slice(0, 200),
  );
  check("字型走系統通用字（不必嵌字型檔）", exported.includes("Helvetica, Arial"));
  check("箭頭 marker 有定義", exported.includes('id="mf-arrow"') && exported.includes("marker-end"));

  // 匯出檔的標籤必須是英文（期刊投稿；中文沒嵌字型會變豆腐字）
  check("匯出版軸標籤是英文", exported.includes("Interaction depth"));
  check("匯出版象限標籤是英文", exported.includes("Free rider") && exported.includes("Collaborator"));
  check("匯出版期別是英文", exported.includes("Time 1"));
  check(
    "匯出版不含中文",
    !/[一-鿿]/.test(exported),
    (exported.match(/[一-鿿]+/g) ?? []).slice(0, 3).join("、"),
  );

  // 畫面版反過來：中文
  check("畫面版是中文", svg.includes("互動深度") && svg.includes("協作者"));

  // 135 個點都要畫出來（每個點一個 path）
  const pathCount = (exported.match(/<path /g) ?? []).length;
  check(
    `135 個資料點 + 圖例 3 個 + 箭頭 1 個都有畫（實際 ${pathCount} 個 path）`,
    pathCount >= 135 + 3,
  );

  // 篩選之後重畫，點數要跟著少
  const filtered = trajectories.filter((t) => startingQuadrant(t) === "free_rider");
  const filteredSvg = renderTrajectorySvg(filtered, DEFAULT_CHART);
  check(`篩選後人數變少（${filtered.length} / 45）`, filtered.length > 0 && filtered.length < 45);
  check(
    "篩選後的 SVG 比較小",
    filteredSvg.length < svg.length,
    `${filteredSvg.length} vs ${svg.length}`,
  );
}

// ── 結果 ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(
  `${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`,
);
if (failed > 0) process.exit(1);
console.log(`${GREEN}STEP 10 自動化驗收通過。${OFF}`);
console.log(
  `${DIM}（匯出檔仍請用 Illustrator／Inkscape 實際開一次，程序見 README）${OFF}`,
);
