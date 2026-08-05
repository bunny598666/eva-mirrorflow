/**
 * 後台頁面的伺服器端讀取。走 service_role，因此每個函式都必須自己把授權範圍
 * 收斂好——RLS 對 service_role 無效，這裡就是唯一一道。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AssignmentRow,
  ClassRow,
  ParticipantRow,
  PromptRow,
} from "./types";
import type { SessionClaims } from "@/lib/auth/types";

export async function listClasses(session: SessionClaims): Promise<ClassRow[]> {
  const query = supabaseAdmin().from("classes").select("*").order("label");
  // 教師只看自己那班（與 003_rls.sql 的 classes_read_own 同語意）。
  const { data, error } =
    session.app_role === "teacher" && session.class_id
      ? await query.eq("id", session.class_id)
      : await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ClassRow[];
}

export async function listAssignments(): Promise<AssignmentRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("assignments")
    .select("*")
    .order("order_no");
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentRow[];
}

export async function listPrompts(): Promise<PromptRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("reflection_prompts")
    .select("*")
    .order("version");
  if (error) throw new Error(error.message);
  return (data ?? []) as PromptRow[];
}

export async function listParticipants(
  session: SessionClaims,
): Promise<ParticipantRow[]> {
  // 不選 pin_hash——它不該離開資料庫。
  let query = supabaseAdmin()
    .from("participants")
    .select("id, code, role, class_id, consent_at, guardian_consent_at")
    .order("code");
  if (session.app_role === "teacher" && session.class_id) {
    query = query.eq("class_id", session.class_id);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ParticipantRow[];
}
