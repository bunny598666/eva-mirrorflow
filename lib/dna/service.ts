/**
 * 交件時計算 DNA 並寫入 analyses(kind='dna')。
 *
 * 【文稿來源是最後一份快照，不是用戶端當下送來的東西】
 * 快照裡有 marks（哪一段是 AI 寫的），而那是整個歸因的依據。用戶端在交件
 * 之前會先強制存一份快照，這裡只讀資料庫——同一份 doc 既是回放的終點，
 * 也是歸因的輸入，兩邊永遠一致。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { attribute, type DnaResult } from "./attribute";
import { dnaThresholds } from "./config";
import { docPlainText } from "@/lib/editor/provenance";

export type DnaComputation = {
  result: DnaResult;
  /** 歸因所依據的最終文稿（純文字），條碼要拿它顯示內容。 */
  text: string;
  /** 依據的那份快照。 */
  snapshotId: string;
};

export class NoSnapshotError extends Error {
  constructor() {
    super("這個場次還沒有任何快照，算不出文章 DNA");
    this.name = "NoSnapshotError";
  }
}

export async function computeDna(sessionId: string): Promise<DnaComputation> {
  const db = supabaseAdmin();

  const { data: snapshot, error: sErr } = await db
    .from("snapshots")
    .select("id, doc, seq_event_id")
    .eq("session_id", sessionId)
    .order("seq_event_id", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; doc: unknown; seq_event_id: number }>();
  if (sErr) throw new Error(sErr.message);
  if (!snapshot) throw new NoSnapshotError();

  // 一次把整個場次的 AI 回覆撈進來建索引。逐段查會變成 N+1，
  // 而 45 人同時交件時那是會塞爆連線池的。
  const { data: messages, error: mErr } = await db
    .from("chat_messages")
    .select("id, content")
    .eq("session_id", sessionId)
    .eq("role", "assistant");
  if (mErr) throw new Error(mErr.message);

  const byId = new Map<string, string>();
  for (const row of (messages ?? []) as { id: string; content: string }[]) {
    byId.set(row.id, row.content);
  }

  const result = attribute(snapshot.doc, (id) => byId.get(id) ?? null, dnaThresholds());

  return { result, text: docPlainText(snapshot.doc), snapshotId: snapshot.id };
}

/** 寫入 analyses。同一個場次重算會取代舊的那筆（analyses 不是 append-only）。 */
export async function saveDna(
  sessionId: string,
  computation: DnaComputation,
): Promise<void> {
  const db = supabaseAdmin();

  // 靠 011 的 (session_id, kind) 唯一鍵直接 upsert，省掉「先查再決定」那一趟。
  const row = {
    session_id: sessionId,
    kind: "dna" as const,
    result: { ...computation.result, snapshot_id: computation.snapshotId },
    // 歸因不經過 AI，所以 model 留 null；rubric_version 記下演算法版本，
    // 日後若調整歸因方式，匯出時分得出哪批資料是哪一版算的。
    rubric_version: DNA_ALGORITHM_VERSION,
  };

  const { error } = await db
    .from("analyses")
    .upsert(row, { onConflict: "session_id,kind" });
  if (error) throw new Error(error.message);
}

/**
 * 歸因演算法版本。改動 lib/dna/ 的計算方式時務必跟著加。
 * 三期之間不得變動——變了就等於三期用了不同的尺。
 */
export const DNA_ALGORITHM_VERSION = "dna-v1";
