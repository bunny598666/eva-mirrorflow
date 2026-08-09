/**
 * 正規化 Levenshtein 相似度（STEP 8）。純函式、可單元測試。
 *
 * 這個數字決定一段 AI 來源的文字算「藍」（照抄）還是「綠」（改寫過），
 * 也就是本研究最核心的測量。演算法必須簡單到可以在論文方法章寫清楚，
 * 而且三期之間完全一致——所以這裡不用任何近似或啟發式，就是教科書版的
 * 編輯距離，除以兩者較長的長度。
 *
 * 【以 UTF-16 code unit 計算，不是「字」】
 * 與 lib/editor/provenance.ts 的區段位移同一套單位。繁中在 BMP 內，一個字
 * 就是一個 code unit，兩者一致；emoji 之類的輔助平面字元會被算成兩個單位。
 * 學生寫的是作文，這個誤差可以忽略，但單位不一致會讓區段切錯，不能混用。
 */

/** 編輯距離。兩列滾動陣列，記憶體 O(min(m,n))。 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 讓 b 是比較短的那個，滾動陣列才小。
  let source = a;
  let target = b;
  if (target.length > source.length) {
    const swap = source;
    source = target;
    target = swap;
  }

  const width = target.length + 1;
  let previous = new Uint32Array(width);
  let current = new Uint32Array(width);
  for (let j = 0; j < width; j += 1) previous[j] = j;

  for (let i = 1; i <= source.length; i += 1) {
    current[0] = i;
    const sourceChar = source.charCodeAt(i - 1);
    for (let j = 1; j < width; j += 1) {
      const cost = sourceChar === target.charCodeAt(j - 1) ? 0 : 1;
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      const substitution = (previous[j - 1] ?? 0) + cost;
      current[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[target.length] ?? 0;
}

/**
 * 相似度 = 1 − 編輯距離 / 較長者長度。值域 [0, 1]。
 *
 * 兩邊都空字串視為完全相同（1）：那代表「這段 AI 文字被整段刪光」，
 * 呼叫端根本不會拿空區段來比。單邊空則是 0。
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;

  // 光看長度差就不可能達到 floor，直接省下 O(mn) 的 DP。
  // 交件時一份文稿可能有幾十個區段，每個都跑滿會讓學生等在那裡。
  return 1 - levenshtein(a, b) / longest;
}

/**
 * 只需要知道「有沒有達到門檻」時用這個：長度差已經注定達不到就早退。
 * 回傳實際相似度（早退時回傳一個保證低於 floor 的上界估計）。
 */
export function similarityAtLeast(a: string, b: string, floor: number): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;

  // 編輯距離至少是長度差，所以相似度上界 = 1 - |Δ|/longest。
  const upperBound = 1 - Math.abs(a.length - b.length) / longest;
  if (upperBound < floor) return upperBound;

  return similarity(a, b);
}
