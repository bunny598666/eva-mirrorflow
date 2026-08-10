/**
 * Cohen's κ（評分者間信度）。純函式。
 *
 *   κ = (Po − Pe) / (1 − Pe)
 *
 *   Po = 觀察一致率        ＝ 兩人編到同一類的比例
 *   Pe = 期望一致率（機遇）＝ Σ_k P(甲編 k) × P(乙編 k)
 *
 * 【為什麼要扣掉機遇】兩個人若都把九成案例編成同一類，光是亂猜也會有很高的
 * 一致率。κ 把那部分扣掉，只留下「超出機遇的一致」。這也是 κ 的著名限制：
 * 類目分布極度不均時，Po 很高但 κ 仍可能很低（kappa paradox）——所以下面
 * 一併回傳 Po 與各類目的邊際分布，讓研究者看得出是不是踩到這個情況。
 *
 * 【只算兩人都編過的案例】一個人編了、另一個沒編，那不是「不一致」，
 * 是還沒編完。把它算進去會低估信度。
 */

export type CoderRecord = {
  /** 分析單位的識別（本專案是 session id）。 */
  unitId: string;
  /** 向度 id → 類目 id。 */
  codes: Record<string, string>;
};

export type Disagreement = {
  unitId: string;
  dimensionId: string;
  a: string;
  b: string;
};

export type DimensionAgreement = {
  dimensionId: string;
  /** 兩人都編過的案例數。 */
  n: number;
  /** 一致的案例數。 */
  agreed: number;
  /** 觀察一致率。 */
  po: number;
  /** 機遇一致率。 */
  pe: number;
  /** Cohen's κ。n = 0 時為 null（算不出來，不是 0）。 */
  kappa: number | null;
  /** 各編碼者的類目分布，用來判讀 kappa paradox。 */
  marginals: { a: Record<string, number>; b: Record<string, number> };
  disagreements: Disagreement[];
};

export type KappaReport = {
  coderA: string;
  coderB: string;
  /** 兩人都編過的案例數。 */
  sharedUnits: number;
  dimensions: DimensionAgreement[];
  /** 所有向度的 κ 平均（可算的向度才納入）。 */
  meanKappa: number | null;
};

/**
 * κ 的慣用解讀（Landis & Koch, 1977）。
 *
 * 原始分帶是以兩位小數表述的：≤.20 slight、.21–.40 fair、.41–.60 moderate、
 * .61–.80 substantial、.81–1.00 almost perfect。
 *
 * 因此先四捨五入到兩位小數再分帶。不這麼做的話會被浮點誤差擺一道：
 * (0.7−0.5)/(1−0.5) 在 IEEE 754 下等於 0.39999999999999997，
 * 一個教科書上明明是 .40 的例子會掉進上一帶。標籤要寫進論文，
 * 不能取決於浮點的最後一位。
 *
 * 這只是標籤，不是通過與否的判準——論文要用哪個門檻請與指導教授確認。
 */
export function interpret(kappa: number | null): string {
  if (kappa === null) return "無法計算";
  const banded = Math.round(kappa * 100) / 100;
  if (banded < 0) return "低於機遇";
  if (banded <= 0.2) return "極低";
  if (banded <= 0.4) return "低";
  if (banded <= 0.6) return "中等";
  if (banded <= 0.8) return "高";
  return "幾乎完全一致";
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function cohensKappa(
  dimensionId: string,
  pairs: readonly { unitId: string; a: string; b: string }[],
): DimensionAgreement {
  const n = pairs.length;
  const aValues = pairs.map((p) => p.a);
  const bValues = pairs.map((p) => p.b);
  const marginals = { a: countBy(aValues), b: countBy(bValues) };

  const disagreements = pairs
    .filter((p) => p.a !== p.b)
    .map((p) => ({ unitId: p.unitId, dimensionId, a: p.a, b: p.b }));

  if (n === 0) {
    return {
      dimensionId,
      n: 0,
      agreed: 0,
      po: 0,
      pe: 0,
      kappa: null,
      marginals,
      disagreements,
    };
  }

  const agreed = n - disagreements.length;
  const po = agreed / n;

  const categories = new Set([...Object.keys(marginals.a), ...Object.keys(marginals.b)]);
  let pe = 0;
  for (const category of categories) {
    pe += ((marginals.a[category] ?? 0) / n) * ((marginals.b[category] ?? 0) / n);
  }

  // Pe = 1 表示兩人都把每一個案例編成同一類（完全沒有變異）。
  // 此時 κ 的分母為 0——數學上未定義，不能回 0（那會被誤讀成「毫無一致」），
  // 也不能回 1。誠實回 null，並讓 po 說明實情。
  const kappa = pe >= 1 ? null : (po - pe) / (1 - pe);

  return { dimensionId, n, agreed, po, pe, kappa, marginals, disagreements };
}

export function buildReport(
  coderA: string,
  coderB: string,
  dimensionIds: readonly string[],
  recordsA: readonly CoderRecord[],
  recordsB: readonly CoderRecord[],
): KappaReport {
  const byUnitA = new Map(recordsA.map((r) => [r.unitId, r.codes]));
  const byUnitB = new Map(recordsB.map((r) => [r.unitId, r.codes]));

  // 兩人都編過的案例才進入計算。順序固定（依 unitId 排序），
  // 同一份資料每次跑出來的分歧清單順序才一致。
  const shared = [...byUnitA.keys()].filter((id) => byUnitB.has(id)).sort();

  const dimensions = dimensionIds.map((dimensionId) => {
    const pairs: { unitId: string; a: string; b: string }[] = [];
    for (const unitId of shared) {
      const a = byUnitA.get(unitId)?.[dimensionId];
      const b = byUnitB.get(unitId)?.[dimensionId];
      // 某一方在這個向度留白＝這一格還沒編完，不當作不一致。
      if (!a || !b) continue;
      pairs.push({ unitId, a, b });
    }
    return cohensKappa(dimensionId, pairs);
  });

  const computable = dimensions
    .map((d) => d.kappa)
    .filter((k): k is number => k !== null);
  const meanKappa =
    computable.length === 0
      ? null
      : computable.reduce((sum, k) => sum + k, 0) / computable.length;

  return { coderA, coderB, sharedUnits: shared.length, dimensions, meanKappa };
}
