/**
 * 事件佇列（用戶端）。
 *
 * 鐵則：**事件寫入失敗不得丟資料。** 事件先落 IndexedDB 才算數，送出成功才刪除。
 * 關掉分頁、當機、斷網、切到背景——待送事件都還在，下次開同一個場次會補送。
 *
 * client_seq 由用戶端擁有並持久化於 IndexedDB。它是離線續傳的冪等鍵：
 * 重送必然與 DB 的 (session_id, client_seq) UNIQUE 衝突而被靜默略過，
 * 所以「寧可重送，也不可漏送」。若改由伺服器產生序號，補送就會與既有事件相撞。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { EventType, OutgoingEvent } from "./types";

const DB_NAME = "mirrorflow";
const DB_VERSION = 1;
const STORE_EVENTS = "pending_events";
const STORE_META = "meta";

/** BUILD_PLAN §6 STEP 5：每 5 秒批次 POST。 */
export const FLUSH_INTERVAL_MS = 5000;
/** 單次 POST 的上限，與 /api/events 的 MAX_BATCH 一致。 */
const MAX_BATCH = 500;

type PendingEvent = OutgoingEvent & { session_id: string };

let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          db.createObjectStore(STORE_EVENTS, {
            keyPath: ["session_id", "client_seq"],
          });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      },
    });
  }
  return dbPromise;
}

function rangeFor(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound(
    [sessionId, 0],
    [sessionId, Number.MAX_SAFE_INTEGER],
  );
}

/** 序號自增。讀取與寫回在同一個 transaction 內完成，避免併發配到同一號。 */
async function nextSeq(sessionId: string): Promise<number> {
  const db = await database();
  const tx = db.transaction(STORE_META, "readwrite");
  const key = `seq:${sessionId}`;
  const current = (await tx.store.get(key)) as number | undefined;
  const next = typeof current === "number" && Number.isFinite(current) ? current + 1 : 1;
  await tx.store.put(next, key);
  await tx.done;
  return next;
}

/**
 * 記錄一個事件。只負責落地，不負責送出——送出由 flusher 每 5 秒批次處理。
 * 永遠不丟例外：事件記錄失敗不該讓學生的寫作動作卡住。
 *
 * 回傳這筆事件拿到的 client_seq（失敗回 null）。STEP 6 的 aiOrigin mark 需要它
 * 來指向那筆 copy 事件——(session_id, client_seq) 是事件的唯一鍵，而 DB 的
 * bigint id 用戶端拿不到（批次送出的回應不帶 id，離線時更是還沒有 id）。
 */
export async function emitEvent(
  sessionId: string,
  type: EventType,
  payload: Record<string, unknown> = {},
): Promise<number | null> {
  if (typeof window === "undefined") return null;
  try {
    const event: PendingEvent = {
      session_id: sessionId,
      client_seq: await nextSeq(sessionId),
      type,
      payload,
      ts: new Date().toISOString(),
    };
    const db = await database();
    await db.put(STORE_EVENTS, event);
    return event.client_seq;
  } catch (err) {
    // IndexedDB 不可用（無痕模式、儲存空間滿）。記進 console 供除錯，
    // 但不影響學生繼續寫作。
    console.error("[events] 無法寫入本機佇列", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function pendingCount(sessionId: string): Promise<number> {
  if (typeof window === "undefined") return 0;
  const db = await database();
  return db.count(STORE_EVENTS, rangeFor(sessionId));
}

/**
 * 與伺服器對齊序號：把本機計數器推到不低於伺服器已知的最大值。
 *
 * 學生清除瀏覽器資料或換裝置後，IndexedDB 的計數器會從 1 重來。若不先對齊，
 * 新事件的序號會與既有事件相撞，然後被 /api/events 的 ignoreDuplicates
 * 靜默吃掉——事件就這樣無聲無息地不見了。這一步是「事件零遺漏」的前提。
 */
export async function syncSeq(sessionId: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch(
      `/api/events?session_id=${encodeURIComponent(sessionId)}`,
    );
    if (!res.ok) return;
    const body: unknown = await res.json();
    const serverMax =
      typeof body === "object" && body !== null && "max_client_seq" in body
        ? Number((body as { max_client_seq: unknown }).max_client_seq)
        : 0;
    if (!Number.isFinite(serverMax) || serverMax <= 0) return;

    const db = await database();
    const tx = db.transaction(STORE_META, "readwrite");
    const key = `seq:${sessionId}`;
    const local = (await tx.store.get(key)) as number | undefined;
    if (typeof local !== "number" || local < serverMax) {
      await tx.store.put(serverMax, key);
    }
    await tx.done;
  } catch {
    // 離線啟動。序號維持本機值；若真的相撞，下次上線的 syncSeq 會修正，
    // 期間的事件仍在 IndexedDB 裡不會消失。
  }
}

const inFlight = new Set<string>();

/**
 * 把待送事件批次送出。成功才刪除本機副本。
 * 回傳 true 表示這一輪把當時所有待送事件都送掉了。
 */
export async function flush(sessionId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (inFlight.has(sessionId)) return false;
  inFlight.add(sessionId);

  try {
    const db = await database();
    const all = (await db.getAll(STORE_EVENTS, rangeFor(sessionId))) as PendingEvent[];
    if (all.length === 0) return true;

    // 依序號送出，讓伺服器端的事件順序與學生的實際操作順序一致。
    all.sort((a, b) => a.client_seq - b.client_seq);
    const batch = all.slice(0, MAX_BATCH);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        events: batch.map(({ client_seq, type, payload, ts }) => ({
          client_seq,
          type,
          payload,
          ts,
        })),
      }),
    });
    if (!res.ok) return false;

    // 只刪除這一輪真的送出去的那些；期間新進的事件留給下一輪。
    const tx = db.transaction(STORE_EVENTS, "readwrite");
    for (const e of batch) {
      await tx.store.delete([e.session_id, e.client_seq]);
    }
    await tx.done;

    return batch.length === all.length;
  } catch {
    // 離線或伺服器不可達。事件原封不動留在 IndexedDB，下一輪再試。
    return false;
  } finally {
    inFlight.delete(sessionId);
  }
}

/**
 * 啟動背景送出。回傳停止函式。
 *
 * 除了每 5 秒一次，另外在三個時機立刻補送：
 *   - 瀏覽器回報上線（斷線期間累積的事件要盡快追上）
 *   - 分頁被切到背景（學生可能就此不再回來）
 *   - 頁面即將卸載
 */
export function startEventQueue(sessionId: string): () => void {
  if (typeof window === "undefined") return () => undefined;

  const timer = window.setInterval(() => void flush(sessionId), FLUSH_INTERVAL_MS);
  const onOnline = (): void => void flush(sessionId);
  const onHidden = (): void => {
    if (document.visibilityState === "hidden") void flush(sessionId);
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onOnline);

  // 先對齊序號再開始送，避免換裝置／清資料後的事件撞號被吃掉。
  void syncSeq(sessionId).then(() => flush(sessionId));

  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onOnline);
    void flush(sessionId);
  };
}
