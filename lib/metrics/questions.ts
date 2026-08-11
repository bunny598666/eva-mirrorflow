/**
 * 「高階提問」的操作型定義（象限座標 X 的第三個成分）。
 *
 * ⚠ 這是一個**研究測量**，不是一段普通的字串處理。它會直接改變論文最重要的
 *   那張圖上每個點的位置，所以：
 *
 *   1. 規則是**確定性**的，不經 AI。用 LLM 分類會讓這張圖的數值隨模型版本
 *      漂移，別人重跑你的資料得不到同一張圖——那在方法學上站不住。
 *   2. 規則有版本號。改動＝換版本，且三期之間不得變動（CLAUDE.md §0 鐵則三）。
 *   3. ⚠ **這一版尚未經指導教授確認。** 正式施測前務必請指導者過目下方的
 *      分類準則，必要時調整用語清單，確認後才凍結。
 *
 * 【分類準則】
 * 依 Chi 的 ICAP 與 Bloom 修訂版的精神，區分的是「學生要 AI 做什麼」：
 *
 *   低階（不計入）：要 AI 直接產出成品。「幫我寫一段」「給我一個開頭」
 *   高階（計入）  ：要 AI 解釋、比較、評價、或針對學生自己的內容給回饋。
 *                   這類提問要求學生先有想法，才問得出來。
 *
 * 一則訊息只要出現任一高階線索就計 1（同一則不重複計）。純粹的代寫要求
 * 即使很長也不計——長度本身是 X 的另一個獨立成分，不該重複計算。
 */

/** 改動下列任何清單都必須跟著加版號。 */
export const QUESTION_RULE_VERSION = "q-v1";

/** 要求解釋原因、機制。 */
export const WHY = ["為什麼", "為何", "怎麼會", "原因是", "理由是", "憑什麼"];

/** 要求比較、區辨。 */
export const COMPARE = ["差別", "差在哪", "比較好", "哪一個比較", "不一樣的地方", "有什麼不同", "哪裡不同"];

/** 要求針對「學生自己寫的東西」給評價或回饋。 */
export const CRITIQUE = [
  "幫我看",
  "你覺得我",
  "我寫的",
  "我這樣寫",
  "哪裡不好",
  "哪裡怪",
  "可以改進",
  "需要改",
  "有沒有問題",
  "通順嗎",
  "合理嗎",
  "會不會太",
  "夠不夠",
  "算不算",
];

/** 要求方法、策略，而不是成品。 */
export const HOW = ["怎麼做", "怎麼寫比較", "怎麼樣才能", "如何才能", "有什麼方法", "該從哪", "要注意什麼"];

/** 追問、深化前一輪。 */
export const PROBE = ["那如果", "可是", "還有別的", "還有其他", "再多說", "更具體", "舉個例", "舉例說明"];

/** 純代寫要求。只出現這些而沒有上面任何線索時，不計為高階。 */
export const GENERATION_ONLY = [
  "幫我寫",
  "直接寫",
  "寫一段",
  "寫一篇",
  "給我一段",
  "給我一篇",
  "給我一個開頭",
  "幫我生成",
  "幫我完成",
  "寫好給我",
];

const HIGH_ORDER: readonly string[] = [...WHY, ...COMPARE, ...CRITIQUE, ...HOW, ...PROBE];

function hits(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

/** 這一則學生訊息算不算高階提問。 */
export function isHighOrderQuestion(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (!hits(text, HIGH_ORDER)) return false;
  // 有高階線索就算——即使同一則裡也夾了代寫要求，那仍然是一次高階互動。
  return true;
}

/** 只用來做敘述統計／人工檢核：這則是不是純代寫。 */
export function isGenerationRequest(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return hits(text, GENERATION_ONLY) && !hits(text, HIGH_ORDER);
}

export function countHighOrder(messages: readonly string[]): number {
  return messages.reduce((sum, message) => sum + (isHighOrderQuestion(message) ? 1 : 0), 0);
}
