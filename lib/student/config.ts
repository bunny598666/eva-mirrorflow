/**
 * 課堂時間長度。CLAUDE.md §7 禁止把這類參數寫死在程式碼裡，走環境變數。
 * 一節課 90 分鐘是預設值；時間到只是換提醒文字，不會強制交件。
 */
export function writingMinutes(): number {
  return positiveEnv(process.env.WRITING_SESSION_MINUTES, 90);
}

/**
 * 快照節奏（BUILD_PLAN §6 STEP 7：每 60 秒或 200 個事件）。
 *
 * 這兩個值是資料採集規格的一部分，三期之間不得變動——快照密度變了，
 * 回放的顆粒度就不可比。它們是伺服器端環境變數，由寫作頁以 props 傳給
 * 用戶端；刻意不加 NEXT_PUBLIC_ 前綴，免得被當成可以隨手改的前端設定。
 */
export function snapshotIntervalMs(): number {
  return positiveEnv(process.env.SNAPSHOT_INTERVAL_MS, 60_000);
}

export function snapshotEventCount(): number {
  return positiveEnv(process.env.SNAPSHOT_EVENT_COUNT, 200);
}

function positiveEnv(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
