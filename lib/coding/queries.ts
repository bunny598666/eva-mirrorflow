/**
 * 編碼介面的伺服器端讀取。僅 researcher。
 *
 * 【編碼者只看得到自己的判定】這不是權限問題，是效度問題：
 * 乙看得到甲編了什麼，兩人的判定就不再獨立，算出來的 κ 沒有意義。
 * 因此這裡所有查詢都以 coder_code 收斂，介面上沒有任何地方看得到別人的編碼。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getScheme, sanitize, type CodeAssignment } from "./scheme";
import type { ReflectionAnswer } from "@/lib/reflection/types";

export type CodingUnit = {
  sessionId: string;
  participantCode: string;
  orderNo: number;
  assignmentTitle: string;
  /** 這位編碼者編完了沒。 */
  coded: boolean;
};

export type CodingMaterial = {
  sessionId: string;
  participantCode: string;
  orderNo: number;
  assignmentTitle: string;
  /** 對話全文。 */
  chat: { role: "user" | "assistant"; content: string; ts: string }[];
  /** 反思全文（本方向的編碼對象含反思）。 */
  reflection: { question: string; answer: string }[] | null;
  /** 這位編碼者先前的判定。 */
  myCodes: CodeAssignment;
};

/**
 * 可編碼的場次清單。只有交件之後才有東西可編。
 * 依代號與期別排序，兩位編碼者看到的順序一致，比較好對照進度。
 */
export async function listCodingUnits(
  coderCode: string,
  schemeVersion: string,
): Promise<CodingUnit[]> {
  const db = supabaseAdmin();

  const { data: sessions, error } = await db
    .from("sessions")
    .select("id, participant_id, assignment_id")
    .in("status", ["submitted", "reflected"]);
  if (error) throw new Error(error.message);

  const rows = (sessions ?? []) as {
    id: string;
    participant_id: string;
    assignment_id: string;
  }[];
  if (rows.length === 0) return [];

  const [codes, assignments, mine] = await Promise.all([
    loadCodes(rows.map((r) => r.participant_id)),
    loadAssignments(rows.map((r) => r.assignment_id)),
    loadMyAnnotatedSessions(coderCode, schemeVersion),
  ]);

  return rows
    .map((row) => {
      const assignment = assignments.get(row.assignment_id);
      return {
        sessionId: row.id,
        participantCode: codes.get(row.participant_id) ?? "?",
        orderNo: assignment?.order_no ?? 0,
        assignmentTitle: assignment?.title ?? "（作業已移除）",
        coded: mine.has(row.id),
      };
    })
    .sort(
      (a, b) =>
        a.participantCode.localeCompare(b.participantCode) || a.orderNo - b.orderNo,
    );
}

export async function loadCodingMaterial(
  sessionId: string,
  coderCode: string,
  schemeVersion: string,
): Promise<CodingMaterial | null> {
  const db = supabaseAdmin();

  const { data: session, error } = await db
    .from("sessions")
    .select("id, participant_id, assignment_id, status")
    .eq("id", sessionId)
    .maybeSingle<{
      id: string;
      participant_id: string;
      assignment_id: string;
      status: string;
    }>();
  if (error) throw new Error(error.message);
  if (!session || session.status === "active") return null;

  const [codes, assignments] = await Promise.all([
    loadCodes([session.participant_id]),
    loadAssignments([session.assignment_id]),
  ]);

  const { data: chat, error: cErr } = await db
    .from("chat_messages")
    .select("role, content, ts")
    .eq("session_id", sessionId)
    .order("ts", { ascending: true });
  if (cErr) throw new Error(cErr.message);

  const { data: annotation, error: aErr } = await db
    .from("coder_annotations")
    .select("codes")
    .eq("session_id", sessionId)
    .eq("coder_code", coderCode)
    .eq("scheme_version", schemeVersion)
    .maybeSingle<{ codes: unknown }>();
  if (aErr) throw new Error(aErr.message);

  const assignment = assignments.get(session.assignment_id);

  return {
    sessionId,
    participantCode: codes.get(session.participant_id) ?? "?",
    orderNo: assignment?.order_no ?? 0,
    assignmentTitle: assignment?.title ?? "（作業已移除）",
    chat: (chat ?? []) as CodingMaterial["chat"],
    reflection: await loadReflectionText(sessionId),
    myCodes: sanitize(getScheme(schemeVersion), annotation?.codes),
  };
}

/** 反思全文，題目與答案配好對——編碼者需要看到題幹才判斷得出深度。 */
async function loadReflectionText(
  sessionId: string,
): Promise<{ question: string; answer: string }[] | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("reflections")
    .select("prompt_version, answers")
    .eq("session_id", sessionId)
    .maybeSingle<{ prompt_version: string; answers: ReflectionAnswer[] }>();
  if (error) throw new Error(error.message);
  if (!data) return null;

  // 用這筆反思**當初作答的那一版**題目，不是現行版。
  // 拿現行版去配舊答案，題文會對不上內容，編碼者就會依錯的題幹判斷。
  const { data: prompt, error: pErr } = await db
    .from("reflection_prompts")
    .select("questions")
    .eq("version", data.prompt_version)
    .maybeSingle<{ questions: { id: string; text: string }[] }>();
  if (pErr) throw new Error(pErr.message);

  const questionText = new Map(
    (prompt?.questions ?? []).map((q) => [q.id, q.text]),
  );

  return (data.answers ?? []).map((answer) => ({
    question: questionText.get(answer.question_id) ?? answer.question_id,
    answer: answer.text,
  }));
}

async function loadCodes(participantIds: readonly string[]): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin()
    .from("participants")
    .select("id, code")
    .in("id", [...new Set(participantIds)]);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]));
}

async function loadAssignments(
  assignmentIds: readonly string[],
): Promise<Map<string, { title: string; order_no: number }>> {
  const { data, error } = await supabaseAdmin()
    .from("assignments")
    .select("id, title, order_no")
    .in("id", [...new Set(assignmentIds)]);
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as { id: string; title: string; order_no: number }[]).map((r) => [
      r.id,
      { title: r.title, order_no: r.order_no },
    ]),
  );
}

async function loadMyAnnotatedSessions(
  coderCode: string,
  schemeVersion: string,
): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin()
    .from("coder_annotations")
    .select("session_id")
    .eq("coder_code", coderCode)
    .eq("scheme_version", schemeVersion);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as { session_id: string }[]).map((r) => r.session_id));
}
