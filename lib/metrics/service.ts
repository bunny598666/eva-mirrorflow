/**
 * 象限座標的計算與寫入。
 *
 * 【每次 submit 都整期重算，不是只算交件那一位】
 * X 的三個成分都是 z 分數，以該期全班為基準。任何一個人交件都會改變全班的
 * 平均與標準差，所有人的 X 都跟著移動。只更新交件那一位的話，同一期的
 * 座標會來自不同批次的統計基準，那張圖就沒有意義了。
 *
 * 45 人一班，重算一次是 45 列的 upsert，成本可以忽略。
 *
 * 【期中的座標是暫時的】全班交完之前，z 分數還在動。result 裡記了 cohort_n
 * 與 computed_at，研究者看得出這一筆是幾個人的基準算出來的。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { countHighOrder, QUESTION_RULE_VERSION } from "./questions";
import {
  computeCohort,
  METRICS_VERSION,
  type CohortMember,
  type QuadrantPoint,
  type RawMetrics,
} from "./quadrant";
import type { DnaResult } from "@/lib/dna/attribute";

type SessionRow = { id: string; participant_id: string };

/**
 * 重算某一份作業（＝某一期）全班的象限座標並寫回 analyses。
 * 回傳這一期算出來的所有點，方便呼叫端記 log 或回應。
 */
export async function recomputeQuadrantsForAssignment(
  assignmentId: string,
): Promise<QuadrantPoint[]> {
  const db = supabaseAdmin();

  const { data: assignment, error: aErr } = await db
    .from("assignments")
    .select("order_no")
    .eq("id", assignmentId)
    .maybeSingle<{ order_no: number }>();
  if (aErr) throw new Error(aErr.message);
  if (!assignment) return [];

  // 只納入已交件的場次。還在寫的人沒有 DNA，也還不該出現在圖上。
  const { data: sessions, error: sErr } = await db
    .from("sessions")
    .select("id, participant_id")
    .eq("assignment_id", assignmentId)
    .in("status", ["submitted", "reflected"]);
  if (sErr) throw new Error(sErr.message);

  const rows = (sessions ?? []) as SessionRow[];
  if (rows.length === 0) return [];

  const sessionIds = rows.map((row) => row.id);

  const [codes, messages, analyses] = await Promise.all([
    loadCodes(rows.map((row) => row.participant_id)),
    loadUserMessages(sessionIds),
    loadDna(sessionIds),
  ]);

  const members: CohortMember[] = [];
  for (const row of rows) {
    const dna = analyses.get(row.id);
    // 沒有 DNA 就算不出 Y。這種場次先不畫，也不該把它當成 0 去拉低全班平均。
    if (!dna) continue;
    const prompts = messages.get(row.id) ?? [];
    members.push({
      sessionId: row.id,
      participantCode: codes.get(row.participant_id) ?? "?",
      raw: rawMetricsOf(prompts, dna),
    });
  }
  if (members.length === 0) return [];

  const points = computeCohort(members, assignment.order_no);
  await Promise.all(points.map((point) => saveQuadrant(point)));
  return points;
}

export function rawMetricsOf(prompts: readonly string[], dna: DnaResult): RawMetrics {
  const totalChars = prompts.reduce((sum, text) => sum + Array.from(text.trim()).length, 0);
  return {
    turns: prompts.length,
    promptChars: prompts.length === 0 ? 0 : totalChars / prompts.length,
    highOrder: countHighOrder(prompts),
    orangeRatio: dna.ratios?.orange ?? 0,
    greenRatio: dna.ratios?.green ?? 0,
  };
}

async function loadCodes(participantIds: readonly string[]): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin()
    .from("participants")
    .select("id, code")
    .in("id", [...new Set(participantIds)]);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { id: string; code: string }[]).map((r) => [r.id, r.code]));
}

async function loadUserMessages(
  sessionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const { data, error } = await supabaseAdmin()
    .from("chat_messages")
    .select("session_id, content")
    .in("session_id", [...sessionIds])
    .eq("role", "user")
    .order("ts", { ascending: true });
  if (error) throw new Error(error.message);

  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as { session_id: string; content: string }[]) {
    const list = map.get(row.session_id) ?? [];
    list.push(row.content);
    map.set(row.session_id, list);
  }
  return map;
}

async function loadDna(sessionIds: readonly string[]): Promise<Map<string, DnaResult>> {
  const { data, error } = await supabaseAdmin()
    .from("analyses")
    .select("session_id, result")
    .in("session_id", [...sessionIds])
    .eq("kind", "dna");
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as { session_id: string; result: DnaResult }[]).map((r) => [
      r.session_id,
      r.result,
    ]),
  );
}

async function saveQuadrant(point: QuadrantPoint): Promise<void> {
  const db = supabaseAdmin();
  const { data: existing, error: qErr } = await db
    .from("analyses")
    .select("id")
    .eq("session_id", point.sessionId)
    .eq("kind", "quadrant")
    .maybeSingle<{ id: string }>();
  if (qErr) throw new Error(qErr.message);

  const row = {
    session_id: point.sessionId,
    kind: "quadrant" as const,
    result: {
      x: point.x,
      y: point.y,
      quadrant: point.quadrant,
      z: point.z,
      raw: point.raw,
      cohort_n: point.cohortN,
      order_no: point.orderNo,
      question_rule_version: QUESTION_RULE_VERSION,
    },
    rubric_version: METRICS_VERSION,
  };

  const { error } = existing
    ? await db.from("analyses").update(row).eq("id", existing.id)
    : await db.from("analyses").insert(row);
  if (error) throw new Error(error.message);
}
