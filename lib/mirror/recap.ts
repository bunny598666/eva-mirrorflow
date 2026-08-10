/**
 * 「上次的你」摘要卡的資料組裝（CLAUDE.md §4.4 第 3 點）。
 *
 * 這張卡是整個 SRL 迴圈的閉合點：把上一期的「自我反應」（學生自己寫下的
 * 「下次想做的改變」）接回這一期的「自我觀察」。少了它，三次作業就只是
 * 三次獨立的測量，不構成一個迴圈——而迴圈正是這個研究方向的主張。
 *
 * 只看得到自己的上一期，沒有任何同儕比較。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { DnaColor, DnaResult } from "@/lib/dna/attribute";
import type { ReflectionAnswer } from "@/lib/reflection/types";
import type { SessionClaims } from "@/lib/auth/types";

export type RecapData = {
  /** 這一次要寫的作業。 */
  assignmentId: string;
  assignmentTitle: string;
  orderNo: number;
  /** 上一期的資料。第 1 期沒有上一期，整個 recap 就不該出現。 */
  previous: {
    assignmentTitle: string;
    orderNo: number;
    ratios: Record<DnaColor, number> | null;
    /** 上期反思最後一題（「下次想做的改變」）的原文。 */
    intention: string | null;
  };
  /** 這一期已經開始的話帶場次 id，按鈕直接接回去。 */
  existingSessionId: string | null;
};

type AssignmentRow = { id: string; title: string; order_no: number };

/**
 * 組裝 recap。回傳 null 代表「不該顯示 recap」——
 * 第 1 期（沒有上一期）或上一期根本沒交件，都屬於這種情況。
 * 呼叫端據此直接放行到寫作頁。
 */
export async function loadRecap(
  assignmentId: string,
  claims: SessionClaims,
): Promise<RecapData | null> {
  const db = supabaseAdmin();

  const { data: assignments, error: aErr } = await db
    .from("assignments")
    .select("id, title, order_no")
    .order("order_no");
  if (aErr) throw new Error(aErr.message);

  const list = (assignments ?? []) as AssignmentRow[];
  const current = list.find((row) => row.id === assignmentId);
  if (!current) return null;

  // 上一期＝order_no 比這次小的裡面最大的那個。不假設號碼連續，
  // 老師若刪掉中間一份作業，迴圈仍然接得起來。
  const previous = list
    .filter((row) => row.order_no < current.order_no)
    .sort((a, b) => b.order_no - a.order_no)[0];
  if (!previous) return null;

  const { data: sessions, error: sErr } = await db
    .from("sessions")
    .select("id, assignment_id, status")
    .eq("participant_id", claims.participant_id)
    .in("assignment_id", [previous.id, current.id]);
  if (sErr) throw new Error(sErr.message);

  const rows = (sessions ?? []) as { id: string; assignment_id: string; status: string }[];
  const previousSession = rows.find((row) => row.assignment_id === previous.id);
  const currentSession = rows.find((row) => row.assignment_id === current.id);

  // 上一期沒寫、或寫了沒交，就沒有東西可以回顧。
  if (!previousSession || previousSession.status === "active") return null;

  const [ratios, intention] = await Promise.all([
    loadPreviousRatios(previousSession.id),
    loadPreviousIntention(previousSession.id),
  ]);

  return {
    assignmentId: current.id,
    assignmentTitle: current.title,
    orderNo: current.order_no,
    previous: {
      assignmentTitle: previous.title,
      orderNo: previous.order_no,
      ratios,
      intention,
    },
    existingSessionId: currentSession?.id ?? null,
  };
}

async function loadPreviousRatios(
  sessionId: string,
): Promise<Record<DnaColor, number> | null> {
  const { data, error } = await supabaseAdmin()
    .from("analyses")
    .select("result")
    .eq("session_id", sessionId)
    .eq("kind", "dna")
    .maybeSingle<{ result: DnaResult }>();
  if (error) throw new Error(error.message);
  return data?.result?.ratios ?? null;
}

/**
 * 上期反思的「下次想做的改變」。
 *
 * 取**最後一題**而不是寫死 'q3'：題目版本可能換（只能在研究週期之間換），
 * 而「下次想做的改變」依設計一律是最後一題。寫死 id 會讓換版之後靜靜地
 * 抓不到東西，卡片變空白也不會有人發現。
 */
async function loadPreviousIntention(sessionId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("reflections")
    .select("answers")
    .eq("session_id", sessionId)
    .maybeSingle<{ answers: ReflectionAnswer[] }>();
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray(data.answers) || data.answers.length === 0) return null;

  const last = data.answers[data.answers.length - 1];
  const text = last?.text?.trim();
  return text ? text : null;
}
