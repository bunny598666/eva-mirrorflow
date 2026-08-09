/**
 * 快照排程（用戶端）。
 *
 * 每 SNAPSHOT_INTERVAL_MS 或每 SNAPSHOT_EVENT_COUNT 個事件存一份 doc。
 *
 * 【為什麼快照跟事件一樣要落 IndexedDB】
 * 事件流只有純文字 patch，**marks 只存在快照的 doc 裡**——「這段是 AI 寫的」
 * 這件事，除了快照沒有第二個地方記得。一份快照送失敗就丟掉的話，
 * 丟的不是「一個效能最佳化的檢查點」，而是那段時間的來源歸屬。
 * 所以比照事件：先落地，送成功才刪。
 *
 * 【順序不可調換】存快照前一定要先把累積中的 keystroke 批次結清，
 * 否則 doc 已經含了那些字、事件流卻還沒有，seq_event_id 會標到一個
 * 對不上這份 doc 的位置，回放從這個檢查點起跳就會多出一段。
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "mirrorflow-snapshots";
const DB_VERSION = 1;
const STORE = "pending_snapshots";

type PendingSnapshot = {
  session_id: string;
  client_seq: number;
  doc: unknown;
  ts: string;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: ["session_id", "client_seq"] });
        }
      },
    });
  }
  return dbPromise;
}

function rangeFor(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]);
}

async function enqueue(snapshot: PendingSnapshot): Promise<void> {
  try {
    const db = await database();
    await db.put(STORE, snapshot);
  } catch (err) {
    console.error("[snapshot] 無法寫入本機佇列", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** 送出待送快照。成功才刪本機副本。 */
export async function flushSnapshots(sessionId: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const db = await database();
    const all = (await db.getAll(STORE, rangeFor(sessionId))) as PendingSnapshot[];
    if (all.length === 0) return true;

    all.sort((a, b) => a.client_seq - b.client_seq);

    for (const snapshot of all) {
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      // 4xx 代表這份快照本身有問題（例如場次已交件），重送幾次都一樣，
      // 留著只會擋住後面的。5xx／離線才留下重試。
      if (!res.ok && res.status >= 500) return false;
      await db.delete(STORE, [snapshot.session_id, snapshot.client_seq]);
    }
    return true;
  } catch {
    return false;
  }
}

export type SnapshotOptions = {
  sessionId: string;
  /** 取當下的 Tiptap JSON（含 marks）。 */
  getDoc: () => unknown;
  /** 結清累積中的 keystroke 批次，回傳該批的 client_seq。 */
  flushPending: () => Promise<number | null>;
  /** 目前已用掉的最大 client_seq。 */
  peekSeq: () => Promise<number>;
  intervalMs: number;
  eventCount: number;
};

/**
 * 存一份快照（先結清批次，再取 doc 與序號）。
 * 回傳這份快照標記的 client_seq；沒東西可存回 null。
 */
export async function captureSnapshot(
  options: SnapshotOptions,
): Promise<number | null> {
  if (typeof window === "undefined") return null;

  await options.flushPending();
  const clientSeq = await options.peekSeq();
  const doc = options.getDoc();
  if (typeof doc !== "object" || doc === null) return null;

  await enqueue({
    session_id: options.sessionId,
    client_seq: clientSeq,
    doc,
    ts: new Date().toISOString(),
  });
  void flushSnapshots(options.sessionId);
  return clientSeq;
}

/**
 * 啟動快照排程。回傳停止函式（停止時會補存最後一份）。
 *
 * 兩個觸發條件是「或」：時間到、或事件累積夠多。連續打字 90 分鐘的學生
 * 靠事件數觸發，只跟 AI 聊天不打字的學生靠時間觸發——兩種歷程都要有檢查點。
 */
export function startSnapshots(options: SnapshotOptions): () => void {
  if (typeof window === "undefined") return () => undefined;

  let lastSeq = 0;
  let running = false;
  let stopped = false;

  const take = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      const taken = await captureSnapshot(options);
      if (taken !== null) lastSeq = taken;
    } finally {
      running = false;
    }
  };

  // 時間到就存。
  const timer = window.setInterval(() => void take(), options.intervalMs);

  // 事件數到了也存。用比快照間隔短的節奏檢查，連續打字的學生才不必等滿一分鐘。
  const watchMs = Math.max(5_000, Math.floor(options.intervalMs / 6));
  const watcher = window.setInterval(() => {
    void (async () => {
      if (running || stopped) return;
      const seq = await options.peekSeq();
      if (seq - lastSeq >= options.eventCount) await take();
    })();
  }, watchMs);

  const onOnline = (): void => void flushSnapshots(options.sessionId);
  const onHidden = (): void => {
    // 分頁被切到背景：學生可能就此不再回來，先把當下狀態存起來。
    if (document.visibilityState === "hidden") void take();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onOnline);

  void flushSnapshots(options.sessionId);

  return () => {
    if (stopped) return;
    window.clearInterval(timer);
    window.clearInterval(watcher);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onOnline);
    // 離開前補存一份，然後才封鎖後續排程。
    void take().then(() => {
      stopped = true;
    });
  };
}
