/**
 * 反思草稿的本機暫存。
 *
 * CLAUDE.md §6：「反思送出失敗時，答案暫存 IndexedDB——學生打的 90 字反思
 * 弄丟一次，信任就沒了。」
 *
 * 所以這裡不是「送失敗才存」，而是**邊打邊存**。等到送出失敗才想到要存，
 * 分頁當掉、平板沒電、瀏覽器被關掉這幾種情況一樣救不回來。
 * 送出成功之後才刪。
 */
import { openDB, type IDBPDatabase } from "idb";
import type { ReflectionAnswer } from "./types";

const DB_NAME = "mirrorflow-reflection";
const DB_VERSION = 1;
const STORE = "drafts";

export type ReflectionDraft = {
  session_id: string;
  prompt_version: string;
  answers: ReflectionAnswer[];
  updated_at: string;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "session_id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveDraft(draft: ReflectionDraft): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await database();
    await db.put(STORE, draft);
  } catch (err) {
    // IndexedDB 不可用（無痕模式、空間滿）。不能讓學生的打字卡住，
    // 但這是唯一一道保險失效了，值得留下痕跡。
    console.error("[reflection] 無法暫存草稿", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadDraft(sessionId: string): Promise<ReflectionDraft | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = await database();
    const row = (await db.get(STORE, sessionId)) as ReflectionDraft | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

/** 只在伺服器確認寫入之後才呼叫。 */
export async function clearDraft(sessionId: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await database();
    await db.delete(STORE, sessionId);
  } catch {
    // 刪不掉無妨：下次載入時伺服器已有反思，表單本來就不會再出現。
  }
}
