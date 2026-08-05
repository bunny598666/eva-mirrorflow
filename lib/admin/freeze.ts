/**
 * 三期凍結的應用層守門（CLAUDE.md §0 鐵則三、§7）。
 *
 * 一旦某個班級／作業已經產生任何 session，代表研究已經開始收資料。此後變更
 * 模型、temperature、system_prompt_version 或作業說明，都會讓三期之間不可比——
 * 「行為的改變」與「條件被改動」再也分不開。因此直接擋在後台 API。
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function classHasSessions(classId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: participants, error: pErr } = await db
    .from("participants")
    .select("id")
    .eq("class_id", classId);
  if (pErr) throw new Error(pErr.message);
  if (!participants || participants.length === 0) return false;

  const ids = participants.map((p) => (p as { id: string }).id);
  const { count, error } = await db
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .in("participant_id", ids);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

export async function assignmentHasSessions(assignmentId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin()
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
