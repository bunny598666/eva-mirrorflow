/**
 * 課堂時間長度。CLAUDE.md §7 禁止把這類參數寫死在程式碼裡，走環境變數。
 * 一節課 90 分鐘是預設值；時間到只是換提醒文字，不會強制交件。
 */
export function writingMinutes(): number {
  const raw = process.env.WRITING_SESSION_MINUTES;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
}
