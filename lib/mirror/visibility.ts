/**
 * 「看過」的操作型定義（CLAUDE.md §4.4 的介入證據）。
 *
 * viewed_dna_at / viewed_replay_at 是論文方法章用來主張「介入確實發生」的
 * 證據。定義鬆掉，那個主張就站不住；定義寫死在元件裡，就沒人驗得到。
 * 所以幾何規則抽成純函式放這裡，元件只負責量 rect 與計時。
 *
 * 【為什麼不用 IntersectionObserver 的 threshold】
 * 那個比例是相對**元素本身**的。DNA 區塊含條碼與全文，往往比整個螢幕還高
 * （實測 2038px vs 720px 視窗），可見比例永遠到不了 40%，threshold 就永遠
 * 不會觸發——文章愈長的學生愈打不開反思表單，而那正是最需要反思的那群人。
 *
 * 改成比對「元素與視窗較小的那一個」：短區塊要露出自己的四成，
 * 長區塊只要占滿視窗四成。兩種情況對應同一件事實——這個東西確實佔據了螢幕。
 */

/** 露出的比例門檻。改動等同修改研究方法。 */
export const VIEW_RATIO = 0.4;
/** 要連續停留多久才算看過。只是捲過去不算。 */
export const VIEW_DWELL_MS = 1500;
/** 檢查頻率。 */
export const VIEW_POLL_MS = 250;

export type Rect = { top: number; bottom: number; height: number };

/** 這個矩形此刻露出多少像素在視窗裡。 */
export function visibleHeight(rect: Rect, viewportHeight: number): number {
  if (viewportHeight <= 0) return 0;
  return Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
}

export function countsAsVisible(rect: Rect, viewportHeight: number): boolean {
  if (viewportHeight <= 0 || rect.height <= 0) return false;
  const reference = Math.min(rect.height, viewportHeight);
  return visibleHeight(rect, viewportHeight) >= reference * VIEW_RATIO;
}
