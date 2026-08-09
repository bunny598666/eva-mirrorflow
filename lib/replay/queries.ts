/**
 * 回放頁的伺服器端讀取。
 *
 * 走 service_role（繞過 RLS），所以授權範圍必須在這裡自己收斂乾淨：
 *   student    只能看自己的場次
 *   teacher    只能看自己那班的場次
 *   researcher 全部
 * 這與 003_rls.sql 的 app.owns_session / app.teaches_session 同語意——
 * 兩層各自成立，任一層失守另一層仍擋得住。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { docPlainText } from "@/lib/editor/provenance";
import type { SessionClaims } from "@/lib/auth/types";
import type { ReplayAnchor, ReplayEvent } from "./engine";

export type ReplaySession = {
  id: string;
  participant_id: string;
  assignment_id: string;
  started_at: string;
  submitted_at: string | null;
  status: "active" | "submitted" | "reflected";
};

export type SnapshotRow = { id: string; ts: string; doc: unknown; seq_event_id: number };

export type ReplayData = {
  session: ReplaySession;
  /** 零 PII：只有代號。 */
  participantCode: string;
  assignmentTitle: string;
  assignmentOrderNo: number;
  events: ReplayEvent[];
  /**
   * 快照轉成的錨點（只留純文字）。
   * 刻意不把整份 doc 送到瀏覽器：一節課的快照加起來可能好幾 MB，
   * 而回放只需要文字。marks 留在伺服器，STEP 8 算 DNA 時才用得到。
   */
  anchors: ReplayAnchor[];
  /** 最後一份快照的完整 doc（含 marks）。沒有快照則 null。 */
  latestDoc: unknown;
};

/** 讀場次並判斷這位使用者看不看得到。看不到一律回 null，呼叫端 notFound()。 */
async function loadViewableSession(
  sessionId: string,
  claims: SessionClaims,
): Promise<{ session: ReplaySession; participantCode: string } | null> {
  const db = supabaseAdmin();

  const { data: session, error } = await db
    .from("sessions")
    .select("id, participant_id, assignment_id, started_at, submitted_at, status")
    .eq("id", sessionId)
    .maybeSingle<ReplaySession>();
  if (error) throw new Error(error.message);
  if (!session) return null;

  const { data: participant, error: pErr } = await db
    .from("participants")
    .select("code, class_id")
    .eq("id", session.participant_id)
    .maybeSingle<{ code: string; class_id: string | null }>();
  if (pErr) throw new Error(pErr.message);
  if (!participant) return null;

  if (claims.app_role === "student" && session.participant_id !== claims.participant_id) {
    return null;
  }
  if (claims.app_role === "teacher") {
    if (!claims.class_id || participant.class_id !== claims.class_id) return null;
  }

  return { session, participantCode: participant.code };
}

export async function loadReplayData(
  sessionId: string,
  claims: SessionClaims,
): Promise<ReplayData | null> {
  const viewable = await loadViewableSession(sessionId, claims);
  if (!viewable) return null;

  const db = supabaseAdmin();
  const { session, participantCode } = viewable;

  const { data: assignment, error: aErr } = await db
    .from("assignments")
    .select("title, order_no")
    .eq("id", session.assignment_id)
    .maybeSingle<{ title: string; order_no: number }>();
  if (aErr) throw new Error(aErr.message);

  // 依 client_seq 排序而非 ts：ts 是用戶端時鐘，可能被調過；
  // client_seq 是單調的，才是真正的操作順序。
  const { data: events, error: eErr } = await db
    .from("events")
    .select("client_seq, type, payload, ts")
    .eq("session_id", sessionId)
    .order("client_seq", { ascending: true });
  if (eErr) throw new Error(eErr.message);

  const { data: snapshots, error: sErr } = await db
    .from("snapshots")
    .select("id, ts, doc, seq_event_id")
    .eq("session_id", sessionId)
    .order("seq_event_id", { ascending: true });
  if (sErr) throw new Error(sErr.message);

  const rows = (snapshots ?? []) as SnapshotRow[];

  return {
    session,
    participantCode,
    assignmentTitle: assignment?.title ?? "（作業已移除）",
    assignmentOrderNo: assignment?.order_no ?? 0,
    events: (events ?? []) as ReplayEvent[],
    anchors: rows.map((row) => ({
      clientSeq: Number(row.seq_event_id),
      text: docPlainText(row.doc),
    })),
    latestDoc: rows.length > 0 ? (rows[rows.length - 1]?.doc ?? null) : null,
  };
}
