/**
 * 象限座標（STEP 10）。純函式，可單元測試。
 *
 *   X = z(對話輪次) + z(平均提問長度) + z(高階提問次數)     互動深度
 *   Y = 橘比例 + 0.5 × 綠比例                                原創性
 *
 * 【z 分數以「該期全班」為基準——這件事有一個必須寫進論文的後果】
 * X 是相對的：全班在第 2 期一起變得更會問，每個人的 z 幾乎不動，圖上就看不出
 * 進步。它量的是「在這個班裡的相對位置」，不是絕對能力。
 * 因此每一筆都同時保留原始值（rawTurns / rawPromptChars / rawHighOrder），
 * 需要看絕對變化時直接用原始值重算，不必回頭挖事件。
 *
 * Y 則是絕對的（0–1 的比例），所以縱向移動可以跨期直接比較。
 * 兩軸的性質不同，這是規格所定義（BUILD_PLAN §6 STEP 10），不是實作選擇。
 *
 * 【象限分界】X 用 0（＝該期全班平均），Y 用 0.5。
 * Y 不用全班平均是刻意的：分界若每期跟著全班浮動，三期的點就不在同一個
 * 座標系裡，「軌跡」也就沒有意義了。0.5 的白話意思是「文章裡有一半以上
 * 是自己的」，跨期固定，看得懂也比得了。
 */

export const METRICS_VERSION = "quadrant-v1";

/** Y 軸的象限分界。跨期固定，不隨全班浮動。 */
export const Y_DIVIDER = 0.5;

export type RawMetrics = {
  /** 學生送出的訊息則數。 */
  turns: number;
  /** 每則訊息的平均字數（沒有訊息時為 0）。 */
  promptChars: number;
  /** 高階提問則數。 */
  highOrder: number;
  /** DNA 的三色比例。 */
  orangeRatio: number;
  greenRatio: number;
};

export type QuadrantName = "free_rider" | "outsourcer" | "solo" | "collaborator";

export type QuadrantPoint = {
  sessionId: string;
  participantCode: string;
  orderNo: number;
  x: number;
  y: number;
  quadrant: QuadrantName;
  raw: RawMetrics;
  /** 三個 z 分數，方便研究者看是哪一項在動。 */
  z: { turns: number; promptChars: number; highOrder: number };
  /** 這一期一起算 z 的人數。太少的話 z 沒有意義，要看得出來。 */
  cohortN: number;
};

export const QUADRANT_LABEL: Record<QuadrantName, string> = {
  free_rider: "搭便車者",
  outsourcer: "外包者",
  solo: "獨行者",
  collaborator: "協作者",
};

/** 期刊投稿用的英文標籤（匯出 SVG 時使用）。 */
export const QUADRANT_LABEL_EN: Record<QuadrantName, string> = {
  free_rider: "Free rider",
  outsourcer: "Outsourcer",
  solo: "Solo writer",
  collaborator: "Collaborator",
};

export function quadrantOf(x: number, y: number): QuadrantName {
  if (y >= Y_DIVIDER) return x >= 0 ? "collaborator" : "solo";
  return x >= 0 ? "outsourcer" : "free_rider";
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 母體標準差（分母 N）。這一期的全班就是母體本身，不是抽樣。 */
export function stdDev(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map((value) => (value - m) ** 2));
  return Math.sqrt(variance);
}

/**
 * z 分數。
 *
 * 標準差為 0（全班都一樣、或只有一個人交件）時回 0 而不是 NaN 或 Infinity：
 * 「大家都一樣」在語意上就是「誰都不特別」，z=0 是唯一說得通的答案。
 * 課堂現場第一個交件的學生一定會遇到這個情況。
 */
export function zScore(value: number, m: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - m) / sd;
}

export type CohortMember = {
  sessionId: string;
  participantCode: string;
  raw: RawMetrics;
};

/**
 * 一次算完整期全班的座標。
 *
 * 為什麼不是一次算一個人：z 分數要全班才算得出來。任何一個人交件，
 * 全班的平均與標準差都會變，所有人的 X 都跟著動——所以 submit 之後
 * 必須整期重算，不能只更新交件那一位。
 */
export function computeCohort(
  members: readonly CohortMember[],
  orderNo: number,
): QuadrantPoint[] {
  const turns = members.map((m) => m.raw.turns);
  const promptChars = members.map((m) => m.raw.promptChars);
  const highOrder = members.map((m) => m.raw.highOrder);

  const stats = {
    turns: { m: mean(turns), sd: stdDev(turns) },
    promptChars: { m: mean(promptChars), sd: stdDev(promptChars) },
    highOrder: { m: mean(highOrder), sd: stdDev(highOrder) },
  };

  return members.map((member) => {
    const z = {
      turns: zScore(member.raw.turns, stats.turns.m, stats.turns.sd),
      promptChars: zScore(member.raw.promptChars, stats.promptChars.m, stats.promptChars.sd),
      highOrder: zScore(member.raw.highOrder, stats.highOrder.m, stats.highOrder.sd),
    };
    const x = z.turns + z.promptChars + z.highOrder;
    const y = member.raw.orangeRatio + 0.5 * member.raw.greenRatio;

    return {
      sessionId: member.sessionId,
      participantCode: member.participantCode,
      orderNo,
      x,
      y,
      quadrant: quadrantOf(x, y),
      raw: member.raw,
      z,
      cohortN: members.length,
    };
  });
}

export type Trajectory = {
  participantCode: string;
  /** 依期別排序。可能只有一兩期（還沒寫完三次）。 */
  points: QuadrantPoint[];
};

/** 把逐點資料整理成每位學生一條軌跡。 */
export function buildTrajectories(points: readonly QuadrantPoint[]): Trajectory[] {
  const byCode = new Map<string, QuadrantPoint[]>();
  for (const point of points) {
    const list = byCode.get(point.participantCode) ?? [];
    list.push(point);
    byCode.set(point.participantCode, list);
  }
  return [...byCode.entries()]
    .map(([participantCode, list]) => ({
      participantCode,
      points: [...list].sort((a, b) => a.orderNo - b.orderNo),
    }))
    .sort((a, b) => a.participantCode.localeCompare(b.participantCode));
}

/** 起始象限＝第一期所在的象限。篩選器用。 */
export function startingQuadrant(trajectory: Trajectory): QuadrantName | null {
  return trajectory.points[0]?.quadrant ?? null;
}
