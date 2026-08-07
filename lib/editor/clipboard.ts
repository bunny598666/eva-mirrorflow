/**
 * 「從 Chat 複製走的內容」登記簿。
 *
 * 學生在對話欄選取 AI 的回覆按 Ctrl+C 時，這裡記下那段文字的指紋與它在原訊息
 * 中的位置；稍後在編輯器貼上時，用同一個指紋查回來，決定要掛 aiOrigin 還是
 * externalOrigin。
 *
 * 【為什麼要記憶體 + IndexedDB 兩層】
 * 貼上攔截是同步的，查表必須同步 → 記憶體 Map 是唯一可行的即時來源。
 * 但學生重整頁面（或平板把分頁殺掉再回來）記憶體就空了，之後貼上會被誤判成
 * 「外部來源」——AI 寫的東西被算成學生自己寫的，DNA 直接錯。所以每一筆同時
 * 寫進 IndexedDB，頁面載入時再灌回記憶體。
 *
 * 【最後一道保險在伺服器】copy 與 paste 兩種事件的 payload 都帶同一個 sha1，
 * 就算用戶端這層完全失效（無痕模式、儲存空間滿），STEP 8 仍能只用 events
 * 把兩邊接回來。用戶端的判斷是為了讓 mark 當下就正確，不是唯一依據。
 */
import { openDB, type IDBPDatabase } from "idb";
import { sha1Hex } from "./sha1.ts";
import type { AiOriginAttrs } from "./provenance.ts";

const DB_NAME = "mirrorflow-clipboard";
const DB_VERSION = 1;
const STORE = "copy_sources";

export type CopySource = AiOriginAttrs & {
  sha1: string;
  length: number;
};

type StoredCopySource = CopySource & { session_id: string };

const memory = new Map<string, CopySource>();
let dbPromise: Promise<IDBPDatabase> | null = null;

function database(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: ["session_id", "sha1"] });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 統一換行後再算指紋。
 *
 * 剪貼簿在 Windows 會把 \n 換成 \r\n，複製端（DOM selection）與貼上端
 * （clipboardData）拿到的字串因此不一定逐字相同。不先正規化的話，
 * 多行的 AI 回覆貼進來永遠對不上——而多行正是 AI 回覆最常見的樣子。
 */
export function normalizeClipboardText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function fingerprint(text: string): string {
  return sha1Hex(normalizeClipboardText(text));
}

/** 同步查表，給 handlePaste 用。 */
export function lookupCopySource(sha1: string): CopySource | null {
  return memory.get(sha1) ?? null;
}

export function rememberCopySource(sessionId: string, source: CopySource): void {
  memory.set(source.sha1, source);
  void persist(sessionId, source);
}

async function persist(sessionId: string, source: CopySource): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await database();
    await db.put(STORE, { ...source, session_id: sessionId } satisfies StoredCopySource);
  } catch {
    // IndexedDB 不可用。記憶體那份仍在，這一節課內的貼上照樣判得出來。
  }
}

/** 頁面載入時把這個場次先前的複製紀錄灌回記憶體。 */
export async function hydrateCopySources(sessionId: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await database();
    const rows = (await db.getAll(
      STORE,
      IDBKeyRange.bound([sessionId, ""], [sessionId, "￿"]),
    )) as StoredCopySource[];
    for (const row of rows) {
      if (memory.has(row.sha1)) continue;
      memory.set(row.sha1, {
        sha1: row.sha1,
        length: row.length,
        copyEventId: row.copyEventId,
        messageId: row.messageId,
        srcStart: row.srcStart,
        srcEnd: row.srcEnd,
      });
    }
  } catch {
    // 讀不回來就算了，之後的複製仍會即時登記。
  }
}

/** 測試用：清掉記憶體那層。 */
export function resetCopySources(): void {
  memory.clear();
}
