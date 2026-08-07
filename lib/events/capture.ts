/**
 * 事件擷取（用戶端）。
 *
 * 把編輯器與視窗的原始動作轉成 events 表的事件型別。所有節奏參數集中在
 * CAPTURE，因為它們是資料採集的規格——三期之間不得變動，否則各期的事件
 * 密度不可比。改動請視同改研究方法，一併更新論文的方法章。
 */
import { diff_match_patch } from "diff-match-patch";
import { emitEvent } from "./queue";

export const CAPTURE = {
  /** 一批 keystroke 最長累積多久就送出（BUILD_PLAN §6 STEP 5）。 */
  KEYSTROKE_MAX_MS: 4000,
  /** 停止打字多久就把這批送出。 */
  KEYSTROKE_PAUSE_MS: 1500,
  /** 超過這個時間沒有任何動作，視為一次停頓。 */
  IDLE_MS: 30_000,
  /** 單次變更刪掉超過這麼多字，另記一筆 delete_block。 */
  DELETE_BLOCK_CHARS: 50,
} as const;

export type CaptureHandle = {
  /** 編輯器內容變動時呼叫。 */
  onDocChange: () => void;
  /** 非編輯類的操作（送出訊息、點鷹架）呼叫，用來重算停頓。 */
  noteActivity: () => void;
  /** 立刻把累積中的 keystroke 批次送出（交件前呼叫）。 */
  flushPending: () => void;
  stop: () => void;
};

const dmp = new diff_match_patch();

/** 以 patch 文字保存變更，而非整份文稿——事件流會小非常多。 */
function patchText(before: string, after: string): string {
  return dmp.patch_toText(dmp.patch_make(before, after));
}

export function startCapture(
  sessionId: string,
  getText: () => string,
): CaptureHandle {
  if (typeof window === "undefined") {
    return {
      onDocChange: () => undefined,
      noteActivity: () => undefined,
      flushPending: () => undefined,
      stop: () => undefined,
    };
  }

  // batchBaseline：這一批 keystroke 開始時的文稿。送出後重設為當下內容。
  let batchBaseline = getText();
  let lastSeenText = batchBaseline;
  let pauseTimer: number | null = null;
  let maxTimer: number | null = null;
  let lastActivityAt = Date.now();
  let stopped = false;

  const clearTimers = (): void => {
    if (pauseTimer !== null) window.clearTimeout(pauseTimer);
    if (maxTimer !== null) window.clearTimeout(maxTimer);
    pauseTimer = null;
    maxTimer = null;
  };

  const flushBatch = (): void => {
    clearTimers();
    const current = getText();
    if (current === batchBaseline) return;
    void emitEvent(sessionId, "keystroke_batch", {
      patch: patchText(batchBaseline, current),
      before_len: batchBaseline.length,
      after_len: current.length,
    });
    batchBaseline = current;
  };

  /** 動作發生。若距離上次動作超過門檻，補記一筆停頓（帶真實時長）。 */
  const markActivity = (): void => {
    const now = Date.now();
    const gap = now - lastActivityAt;
    if (gap > CAPTURE.IDLE_MS) {
      void emitEvent(sessionId, "idle", {
        ms: gap,
        ended_at: new Date(now).toISOString(),
      });
    }
    lastActivityAt = now;
  };

  const onDocChange = (): void => {
    if (stopped) return;
    markActivity();

    const current = getText();
    const removed = lastSeenText.length - current.length;

    // 大段刪除自成一筆：先把累積中的批次結清，再單獨記錄，
    // 否則刪除會被混進 keystroke_batch 的 patch 裡而看不出來。
    if (removed > CAPTURE.DELETE_BLOCK_CHARS) {
      flushBatch();
      void emitEvent(sessionId, "delete_block", {
        removed_chars: removed,
        patch: patchText(lastSeenText, current),
        after_len: current.length,
      });
      batchBaseline = current;
      lastSeenText = current;
      return;
    }

    lastSeenText = current;

    // 停頓 1.5 秒送出；但一批最多累積 4 秒，避免連續打字永遠不送。
    if (pauseTimer !== null) window.clearTimeout(pauseTimer);
    pauseTimer = window.setTimeout(flushBatch, CAPTURE.KEYSTROKE_PAUSE_MS);
    if (maxTimer === null) {
      maxTimer = window.setTimeout(flushBatch, CAPTURE.KEYSTROKE_MAX_MS);
    }
  };

  const noteActivity = (): void => {
    if (stopped) return;
    markActivity();
  };

  const onBlur = (): void => {
    if (stopped) return;
    // 切走前先結清，否則離開這段時間的輸入會被下一批的 baseline 蓋掉。
    flushBatch();
    void emitEvent(sessionId, "focus_switch", { to: "away" });
    lastActivityAt = Date.now();
  };

  const onFocus = (): void => {
    if (stopped) return;
    markActivity();
    void emitEvent(sessionId, "focus_switch", { to: "back" });
  };

  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  return {
    onDocChange,
    noteActivity,
    flushPending: flushBatch,
    stop: () => {
      if (stopped) return;
      stopped = true;
      flushBatch();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    },
  };
}
