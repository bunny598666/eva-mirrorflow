/**
 * DNA 三色歸因（STEP 8）：submit 時逐 mark 區段計算相似度，依 θ 分色，
 * 結果寫入 analyses(kind='dna')。
 * θ 一律讀環境變數 DNA_THETA_HIGH / DNA_THETA_LOW，禁止寫死。
 */

/**
 * 藍 = AI 寫的、你沒改；綠 = AI 寫的、你改過；橘 = 你自己寫的。
 * （學生端文案用語，教師／研究者端可另加學術標籤。）
 */
export type DnaColor = "blue" | "green" | "orange";

export type DnaSegment = {
  start: number;
  end: number;
  color: DnaColor;
  similarity: number | null;
};
