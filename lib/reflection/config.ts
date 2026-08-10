/**
 * 現行反思題目版本。
 *
 * 【為什麼要一個環境變數】
 * reflection_prompts 是版本表，可以同時存在好幾版（開發測試留下的、未來要用的）。
 * 「現在該出哪一版」必須是一個明確、看得見、且部署時就凍結的決定——
 * 不能靠「取最新一列」之類的規則，那會讓開發期隨手插進去的測試版本
 * 在課堂上被端到學生面前。
 *
 * 這與 θ、快照週期同一個模式：研究參數走環境變數，凍結在部署設定裡。
 * CLAUDE.md §7：三次作業期間不得變更。
 */

export const DEFAULT_PROMPT_VERSION = "v1";

export function reflectionPromptVersion(): string {
  const raw = process.env.REFLECTION_PROMPT_VERSION;
  return raw && raw.trim() ? raw.trim() : DEFAULT_PROMPT_VERSION;
}
