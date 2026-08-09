/**
 * 學生端的伺服器讀取。走 service_role，因此每一個函式都必須自己把
 * participant_id 綁死——學生只能看到自己的東西（CLAUDE.md §4.4）。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { parseScaffoldButtons, type ScaffoldButton } from "@/lib/scaffold/types";
import type { SessionClaims } from "@/lib/auth/types";

export type AssignmentSummary = {
  id: string;
  title: string;
  instructions: string;
  order_no: number;
};

export type ChatHistoryItem = {
  /** chat_messages.id。aiOrigin mark 靠它指回被複製的那則 AI 回覆（STEP 6）。 */
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type WritingSession = {
  id: string;
  participant_id: string;
  assignment_id: string;
  started_at: string;
  submitted_at: string | null;
  status: "active" | "submitted" | "reflected";
};

export type WritingContext = {
  session: WritingSession;
  assignment: AssignmentSummary;
  scaffolds: ScaffoldButton[];
  history: ChatHistoryItem[];
  /**
   * 最後一份快照（含 marks）與它反映到的事件序號。
   *
   * 用途是災難復原：本機暫存稿存在 localStorage，學生換裝置、換瀏覽器、
   * 或家長幫忙清了「網頁資料」就沒了。沒有這條路的話，編輯器會從空白重來，
   * 而事件流卻接著先前的序號往下長——重演到那裡就會斷掉，那段歷程再也拼不回來。
   */
  latestSnapshot: { doc: unknown; clientSeq: number } | null;
};

export async function listAssignmentsWithProgress(
  session: SessionClaims,
): Promise<{ assignment: AssignmentSummary; session: WritingSession | null }[]> {
  const db = supabaseAdmin();

  const { data: assignments, error: aErr } = await db
    .from("assignments")
    .select("id, title, instructions, order_no")
    .order("order_no");
  if (aErr) throw new Error(aErr.message);

  const { data: sessions, error: sErr } = await db
    .from("sessions")
    .select("id, participant_id, assignment_id, started_at, submitted_at, status")
    .eq("participant_id", session.participant_id);
  if (sErr) throw new Error(sErr.message);

  const byAssignment = new Map<string, WritingSession>();
  for (const row of (sessions ?? []) as WritingSession[]) {
    byAssignment.set(row.assignment_id, row);
  }

  return ((assignments ?? []) as AssignmentSummary[]).map((assignment) => ({
    assignment,
    session: byAssignment.get(assignment.id) ?? null,
  }));
}

/**
 * 取得寫作頁所需的場次與作業。找不到、或這個場次不是本人的，一律回 null——
 * 呼叫端據此 notFound()，不透露「這個 id 存在但不是你的」。
 */
export async function loadWritingContext(
  sessionId: string,
  claims: SessionClaims,
): Promise<WritingContext | null> {
  const db = supabaseAdmin();

  const { data: row, error } = await db
    .from("sessions")
    .select("id, participant_id, assignment_id, started_at, submitted_at, status")
    .eq("id", sessionId)
    .maybeSingle<WritingSession>();
  if (error) throw new Error(error.message);
  if (!row || row.participant_id !== claims.participant_id) return null;

  const { data: assignment, error: aErr } = await db
    .from("assignments")
    .select("id, title, instructions, order_no, scaffold_buttons")
    .eq("id", row.assignment_id)
    .maybeSingle<AssignmentSummary & { scaffold_buttons: unknown }>();
  if (aErr) throw new Error(aErr.message);
  if (!assignment) return null;

  const { data: history, error: hErr } = await db
    .from("chat_messages")
    .select("id, role, content")
    .eq("session_id", sessionId)
    .order("ts", { ascending: true });
  if (hErr) throw new Error(hErr.message);

  const { data: snapshot, error: snErr } = await db
    .from("snapshots")
    .select("doc, seq_event_id")
    .eq("session_id", sessionId)
    .order("seq_event_id", { ascending: false })
    .limit(1)
    .maybeSingle<{ doc: unknown; seq_event_id: number }>();
  if (snErr) throw new Error(snErr.message);

  return {
    session: row,
    latestSnapshot: snapshot
      ? { doc: snapshot.doc, clientSeq: Number(snapshot.seq_event_id) }
      : null,
    assignment: {
      id: assignment.id,
      title: assignment.title,
      instructions: assignment.instructions,
      order_no: assignment.order_no,
    },
    // 鷹架全程開啟（CLAUDE.md §4.6），沒有開關可判斷。
    scaffolds: parseScaffoldButtons(assignment.scaffold_buttons),
    history: (history ?? []) as ChatHistoryItem[],
  };
}
