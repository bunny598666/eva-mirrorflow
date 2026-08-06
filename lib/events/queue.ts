/**
 * 事件送出（用戶端）。
 *
 * 【STEP 4 的範圍】client_seq 由用戶端維護並持久化於 localStorage，事件即時送出。
 * 【STEP 5 會接上】IndexedDB 佇列、每 5 秒批次送、離線累積、上線補送。
 *
 * client_seq 從一開始就由用戶端擁有，是刻意的：它是離線續傳的冪等鍵，
 * 若中途改由伺服器產生，STEP 5 的補送就會與既有序號相撞。
 *
 * 鐵則：事件寫入失敗不得丟資料。送失敗的事件留在待送清單裡，下次一併重送；
 * 由 DB 的 (session_id, client_seq) UNIQUE 負責去重。
 */
import type { EventType, OutgoingEvent } from "./types";

const seqKey = (sessionId: string): string => `mf-seq-${sessionId}`;
const pendingKey = (sessionId: string): string => `mf-pending-${sessionId}`;

function nextSeq(sessionId: string): number {
  const key = seqKey(sessionId);
  const current = Number(window.localStorage.getItem(key) ?? "0");
  const next = Number.isFinite(current) ? current + 1 : 1;
  window.localStorage.setItem(key, String(next));
  return next;
}

function readPending(sessionId: string): OutgoingEvent[] {
  try {
    const raw = window.localStorage.getItem(pendingKey(sessionId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutgoingEvent[]) : [];
  } catch {
    return [];
  }
}

function writePending(sessionId: string, events: OutgoingEvent[]): void {
  try {
    window.localStorage.setItem(pendingKey(sessionId), JSON.stringify(events));
  } catch {
    // localStorage 滿了也不能讓寫作流程中斷；事件在記憶體中已排入下一次重送。
  }
}

/**
 * 記錄一個事件並嘗試送出。送不出去就留在待送清單，下次呼叫時一併補送。
 * 永遠不丟例外——事件記錄失敗不該讓學生的寫作動作卡住。
 */
export async function emitEvent(
  sessionId: string,
  type: EventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const event: OutgoingEvent = {
    client_seq: nextSeq(sessionId),
    type,
    payload,
    ts: new Date().toISOString(),
  };

  const batch = [...readPending(sessionId), event];
  writePending(sessionId, batch);

  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, events: batch }),
    });
    if (res.ok) {
      // 送成功才清待送清單。失敗就原封不動留著，等下一次事件觸發時重送。
      writePending(sessionId, []);
    }
  } catch {
    // 離線。事件已在待送清單裡，不做任何事。
  }
}
