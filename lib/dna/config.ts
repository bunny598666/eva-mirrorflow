/**
 * DNA 門檻 θ。
 *
 * CLAUDE.md §7：禁止寫死。θ 是研究參數，三次作業期間凍結——中途動它，
 * 三期的三色比例就不再可比，而那正是本研究的主要依變項。
 *
 * 每次計算都會把當下的 θ 一起寫進 analyses.result.theta，所以就算日後
 * 有人改了環境變數，也看得出每一筆歸因當初是用哪組門檻算的。
 */
import type { DnaThresholds } from "./attribute.ts";

export const DEFAULT_THETA: DnaThresholds = { high: 0.9, low: 0.5 };

function ratioEnv(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function dnaThresholds(): DnaThresholds {
  const high = ratioEnv(process.env.DNA_THETA_HIGH, DEFAULT_THETA.high);
  const low = ratioEnv(process.env.DNA_THETA_LOW, DEFAULT_THETA.low);
  // low 高於 high 的話綠色會消失，等於偷偷改掉了研究設計。
  // 這種設定錯誤要在啟動時就吵，不要靜靜地產出一份沒有綠色的資料。
  if (low > high) {
    throw new Error(
      `DNA_THETA_LOW (${low}) 不可大於 DNA_THETA_HIGH (${high})——這會讓「改過」這一類永遠是空的。`,
    );
  }
  return { high, low };
}
