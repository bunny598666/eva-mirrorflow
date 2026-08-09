/**
 * verify-step8.ts —— DNA 三色歸因驗收
 *
 * BUILD_PLAN §6 STEP 8 驗收：
 *   1. 三份構造樣本歸因正確
 *   2. 學生版由非資訊背景成人測試 10 秒內能說出三色意義（← 這一項只能由人做，
 *      腳本驗不了。程序見 README「STEP 8 的人工驗收程序」）
 *
 * 這裡驗的是第 1 項，外加相似度函式本身與幾個邊界情況。
 * 不需要資料庫、瀏覽器或 AI。
 *
 *   npm run verify:step8
 */
import { attribute, type DnaThresholds } from "../lib/dna/attribute.ts";
import { levenshtein, similarity, similarityAtLeast } from "../lib/dna/similarity.ts";
import { DEFAULT_THETA } from "../lib/dna/config.ts";
import { AI_ORIGIN_MARK, EXTERNAL_ORIGIN_MARK } from "../lib/editor/provenance.ts";

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

function near(name: string, actual: number, expected: number, tolerance = 0.001): void {
  const ok = Math.abs(actual - expected) <= tolerance;
  check(name, ok, ok ? "" : `實際 ${actual}，預期 ${expected} ±${tolerance}`);
}

const THETA: DnaThresholds = DEFAULT_THETA;

// ── 建 doc 的小工具 ─────────────────────────────────────────────────────

type Piece =
  | { text: string }
  | { text: string; ai: { messageId: string; srcStart: number; srcEnd: number } }
  | { text: string; external: true };

function paragraph(pieces: Piece[]): Record<string, unknown> {
  return {
    type: "paragraph",
    content: pieces.map((piece) => {
      const marks =
        "ai" in piece
          ? [{ type: AI_ORIGIN_MARK, attrs: { copyEventId: 1, ...piece.ai } }]
          : "external" in piece
            ? [{ type: EXTERNAL_ORIGIN_MARK, attrs: { sha1: "x", length: piece.text.length } }]
            : undefined;
      return marks ? { type: "text", text: piece.text, marks } : { type: "text", text: piece.text };
    }),
  };
}

function doc(...paragraphs: Record<string, unknown>[]): Record<string, unknown> {
  return { type: "doc", content: paragraphs };
}

// ══ 1. 相似度函式 ═══════════════════════════════════════════════════════
console.log("\n【1】正規化 Levenshtein");

eq("完全相同 → 距離 0", levenshtein("秋天的操場", "秋天的操場"), 0);
eq("kitten → sitting 距離 3", levenshtein("kitten", "sitting"), 3);
eq("單邊為空 → 距離＝另一邊長度", levenshtein("", "四個字元"), 4);
eq("交換兩邊結果相同", levenshtein("abcdef", "abc"), levenshtein("abc", "abcdef"));

eq("完全相同 → 相似度 1", similarity("一模一樣的句子。", "一模一樣的句子。"), 1);
eq("兩邊皆空 → 1", similarity("", ""), 1);
eq("單邊為空 → 0", similarity("", "有字"), 0);
near("改一個字（10 字）→ 0.9", similarity("零一二三四五六七八九", "零一二三四五六七八X"), 0.9);
near("砍掉一半 → 0.5", similarity("零一二三四五六七八九", "零一二三四"), 0.5);

// 早退版必須與完整版在門檻附近給出一致的判定
{
  const source = "他站在走廊上看著窗外的雨，想著剛剛那句話。";
  const rewritten = "他坐在教室裡看著窗外的雨，想著剛剛那件事。";
  const full = similarity(source, rewritten);
  const fast = similarityAtLeast(source, rewritten, THETA.low);
  near("早退版與完整版一致（未早退時）", fast, full);

  // 長度差太大 → 早退，回傳的上界必須低於 floor（不然就白早退了）
  const short = "他站著。";
  const bound = similarityAtLeast(source, short, THETA.low);
  check(
    "長度差注定達不到門檻 → 回傳低於 floor 的上界",
    bound < THETA.low,
    `bound=${bound}`,
  );
}

// ══ 2. 三份構造樣本 ═════════════════════════════════════════════════════
console.log("\n【2】三份構造樣本");

const AI_MESSAGE_ID = "m-1";
const AI_FULL = "你可以先描述那天的天氣，再寫出你當下的心情，這樣讀者比較容易跟著你的視角走。";
const lookup = (id: string): string | null => (id === AI_MESSAGE_ID ? AI_FULL : null);

// ── 樣本 A：整段照抄 AI，沒改一個字 → 全藍
console.log(`${DIM}  樣本 A：整段照抄${OFF}`);
{
  const quoted = AI_FULL.slice(0, 18);
  const sample = doc(
    paragraph([
      { text: quoted, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 18 } },
    ]),
  );
  const result = attribute(sample, lookup, THETA);

  eq("一個區段", result.segments.length, 1);
  eq("顏色＝藍", result.segments[0]?.color, "blue");
  eq("來源＝ai", result.segments[0]?.origin, "ai");
  eq("相似度 1", result.segments[0]?.similarity, 1);
  eq("藍佔 100%", result.ratios, { blue: 1, green: 0, orange: 0 });
  eq("字數統計", result.counts, { blue: 18, green: 0, orange: 0 });
  eq("Before 對照存了 AI 原文", result.segments[0]?.sourceText, quoted);
}

// ── 樣本 B：AI 的句子改過幾個詞 → 綠；前後自己寫的 → 橘
console.log(`${DIM}  樣本 B：改寫 + 自己寫${OFF}`);
{
  const source = AI_FULL.slice(0, 18); // 「你可以先描述那天的天氣，再寫出你當」
  const edited = `${source.slice(0, 14)}然後說說你的心情`; // 後段改掉
  const mine = "我想從那天下午開始寫起。";
  const tail = "最後再收一個尾。";

  const sample = doc(
    paragraph([
      { text: mine },
      { text: edited, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 18 } },
      { text: tail },
    ]),
  );
  const result = attribute(sample, lookup, THETA);

  eq("三個區段", result.segments.length, 3);
  eq(
    "顏色依序 橘→綠→橘",
    result.segments.map((s) => s.color),
    ["orange", "green", "orange"],
  );
  eq(
    "來源依序 手打→AI→手打",
    result.segments.map((s) => s.origin),
    ["typed", "ai", "typed"],
  );
  eq("區段首尾相接、覆蓋全文", [
    result.segments[0]?.start,
    result.segments[0]?.end,
    result.segments[1]?.end,
    result.segments[2]?.end,
    result.textLength,
  ], [0, mine.length, mine.length + edited.length, mine.length + edited.length + tail.length,
      mine.length + edited.length + tail.length]);

  const sim = result.segments[1]?.similarity ?? 0;
  check(
    `綠色的相似度落在 [${THETA.low}, ${THETA.high}) —— 實際 ${sim.toFixed(3)}`,
    sim >= THETA.low && sim < THETA.high,
  );
  near("三色比例加總為 1", Object.values(result.ratios).reduce((a, b) => a + b, 0), 1);
}

// ── 樣本 C：貼了 AI 但幾乎整段重寫 → 橘（已經是自己的句子了）+ 外部貼上
console.log(`${DIM}  樣本 C：重寫到看不出原樣 + 外部貼上${OFF}`);
{
  const rewritten = "那天下午的操場空無一人，風把落葉捲成一圈又一圈。";
  const outside = "以下內容擷取自某個網站的段落。";

  const sample = doc(
    paragraph([
      { text: rewritten, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 18 } },
      { text: outside, external: true },
    ]),
  );
  const result = attribute(sample, lookup, THETA);

  eq("兩個區段", result.segments.length, 2);
  eq("改到面目全非 → 橘", result.segments[0]?.color, "orange");
  eq("但來源仍記為 ai（供研究者拆分）", result.segments[0]?.origin, "ai");
  check(
    "相似度低於 θ_low",
    (result.segments[0]?.similarity ?? 1) < THETA.low,
    `similarity=${result.segments[0]?.similarity}`,
  );
  eq("外部貼上 → 橘", result.segments[1]?.color, "orange");
  eq("外部貼上的來源標記", result.segments[1]?.origin, "external");
  eq("外部貼上不算相似度", result.segments[1]?.similarity, null);

  // 這是本步最重要的一個區分：學生看到的橘色是一種，
  // 研究者要看得出橘色裡混了「改寫過的 AI」與「外部來源」兩種完全不同的東西。
  eq("橘色佔全文", result.ratios.orange, 1);
  eq("來源拆分後三者不同", result.originCounts, {
    ai: rewritten.length,
    external: outside.length,
    typed: 0,
  });
}

// ── 樣本 D：從中間改掉一塊（實測時真的踩到的情況）
console.log(`${DIM}  樣本 D：AI 段落被從中間改掉一塊${OFF}`);
{
  // 學生貼了一段 AI 文字，然後把中間換成自己的話。
  // ProseMirror 會把原本連續的 mark 切成兩片，中間夾著沒有標記的手打文字。
  const source = AI_FULL.slice(0, 36);
  const head = source.slice(0, 14);
  const inserted = "我覺得我的問題是順序";
  const tail = source.slice(26, 36);

  const sample = doc(
    paragraph([
      { text: head, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 36 } },
      { text: inserted },
      { text: tail, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 36 } },
    ]),
  );
  const result = attribute(sample, lookup, THETA);

  eq("裂開的兩片合併成一個區段", result.segments.length, 1);
  eq("涵蓋整段（含中間插進去的字）", [result.segments[0]?.start, result.segments[0]?.end], [
    0,
    head.length + inserted.length + tail.length,
  ]);
  eq("記下學生插了幾個字", result.segments[0]?.insertedChars, inserted.length);
  eq("顏色＝綠（AI 寫的、你改過）", result.segments[0]?.color, "green");

  const sim = result.segments[0]?.similarity ?? 0;
  check(
    `合併後相似度落在 [${THETA.low}, ${THETA.high}) —— 實際 ${sim.toFixed(3)}`,
    sim >= THETA.low && sim < THETA.high,
  );

  // 沒有合併的話，兩片各自跟完整原文比會雙雙掉到 θ_low 以下變成橘色，
  // 「AI 寫的、你改過」這個類別就此消失。這一項就是在盯這件事。
  check("綠色沒有變成 0", result.counts.green > 0);

  // 來源拆分要誠實：插進去的字算手打，不算 AI。
  eq("來源拆分把插入的字歸手打", result.originCounts, {
    ai: head.length + tail.length,
    external: 0,
    typed: inserted.length,
  });
}

// 相隔太遠的同源貼上不該被合併（否則中間整段自己寫的會被吞進 AI 區段）
{
  const source = AI_FULL.slice(0, 12);
  const longOwnWriting = "這是我自己寫的很長一段內容".repeat(3); // 遠超過原文長度
  const sample = doc(
    paragraph([
      { text: source, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 12 } },
      { text: longOwnWriting },
      { text: source, ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 12 } },
    ]),
  );
  const result = attribute(sample, lookup, THETA);
  eq("隔太遠 → 不合併，維持三段", result.segments.length, 3);
  eq(
    "中間那段仍是學生自己的",
    [result.segments[1]?.color, result.segments[1]?.origin],
    ["orange", "typed"],
  );
}

// ══ 3. 門檻邊界 ═════════════════════════════════════════════════════════
console.log("\n【3】θ 邊界");

{
  // 相似度剛好等於 θ_high → 藍（>= 是藍）
  const source = "零一二三四五六七八九";
  const exactHigh = "零一二三四五六七八X"; // 改 1/10 → 0.9
  const sample = doc(
    paragraph([{ text: exactHigh, ai: { messageId: "m-x", srcStart: 0, srcEnd: 10 } }]),
  );
  const result = attribute(sample, () => source, THETA);
  eq("相似度恰好 θ_high → 藍", result.segments[0]?.color, "blue");
}

{
  // 相似度剛好等於 θ_low → 綠（>= 是綠）
  const source = "零一二三四五六七八九";
  const half = "零一二三四"; // 0.5
  const sample = doc(
    paragraph([{ text: half, ai: { messageId: "m-x", srcStart: 0, srcEnd: 10 } }]),
  );
  const result = attribute(sample, () => source, THETA);
  eq("相似度恰好 θ_low → 綠", result.segments[0]?.color, "green");
}

// ══ 4. 幾個不能出錯的情況 ═══════════════════════════════════════════════
console.log("\n【4】邊界與缺損");

{
  const result = attribute(doc(), lookup, THETA);
  eq("空文稿 → 沒有區段", result.segments.length, 0);
  eq("空文稿 → 比例全 0（不是 NaN）", result.ratios, { blue: 0, green: 0, orange: 0 });
  eq("空文稿 → 長度 0", result.textLength, 0);
}

{
  const sample = doc(paragraph([{ text: "整篇都是自己打的，沒有貼過任何東西。" }]));
  const result = attribute(sample, lookup, THETA);
  eq("完全手打 → 一段橘", result.segments.map((s) => s.color), ["orange"]);
  eq("完全手打 → 橘 100%", result.ratios.orange, 1);
}

{
  // mark 指向一則查不到的訊息（訊息 id 對不上）
  const sample = doc(
    paragraph([{ text: "一段來源不明的文字。", ai: { messageId: "不存在", srcStart: 0, srcEnd: 5 } }]),
  );
  const result = attribute(sample, lookup, THETA);
  eq("查不到原文 → 記為綠（保守）", result.segments[0]?.color, "green");
  eq("查不到原文 → similarity 留 null 而不是瞎猜", result.segments[0]?.similarity, null);
  eq("查不到原文 → 沒有 Before 對照", result.segments[0]?.sourceText, null);
}

{
  // 多段落：位移必須跨段落連續（分隔符也要算進總長）
  const sample = doc(
    paragraph([{ text: "第一段。", ai: { messageId: AI_MESSAGE_ID, srcStart: 0, srcEnd: 4 } }]),
    paragraph([{ text: "第二段。" }]),
  );
  const result = attribute(sample, lookup, THETA);
  eq("跨段落總長含分隔符", result.textLength, "第一段。\n\n第二段。".length);
  eq("第一段仍從 0 開始", result.segments[0]?.start, 0);
  check(
    "段落分隔符被算成橘色（沒有洞）",
    result.segments.reduce((sum, s) => sum + (s.end - s.start), 0) === result.textLength,
    JSON.stringify(result.segments.map((s) => [s.start, s.end])),
  );
}

{
  // Windows 剪貼簿：AI 原文含 \r\n，位移是對正規化後的字串取的
  const source = "第一行。\r\n第二行。";
  const sample = doc(
    paragraph([{ text: "第二行。", ai: { messageId: "m-crlf", srcStart: 5, srcEnd: 9 } }]),
  );
  const result = attribute(sample, () => source, THETA);
  eq("CRLF 原文先正規化再切 → 切得準", result.segments[0]?.sourceText, "第二行。");
  eq("因此判為藍", result.segments[0]?.color, "blue");
}

// ── 結果 ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(
  `${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`,
);
if (failed > 0) process.exit(1);
console.log(`${GREEN}STEP 8 自動化驗收通過。${OFF}`);
console.log(
  `${DIM}（另一項驗收「非資訊背景成人 10 秒說出三色意義」需人工進行，程序見 README）${OFF}`,
);
