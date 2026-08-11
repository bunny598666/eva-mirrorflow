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
import { fetchAllRows } from "@/lib/supabase/paged";
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
  await saveQuadrants(points);
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
  const data = await fetchAllRows<{ session_id: string; content: string }>((from, to) =>
    supabaseAdmin()
      .from("chat_messages")
      .select("session_id, content")
      .in("session_id", [...sessionIds])
      .eq("role", "user")
      .order("session_id", { ascending: true })
      .order("ts", { ascending: true })
      .range(from, to),
  );

  const map = new Map<string, string[]>();
  for (const row of data) {
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

/**
 * 一次寫完整期。
 *
 * 原本是每個人「先查有沒有、再 insert 或 update」＝每人 2 次往返。45 人同時
 * 交件時每次重算都要 90 次往返，累積約 4000 次——實測 /api/submit 的 p50
 * 是 15.7 秒，而學生就卡在那顆「交出去」按鈕上。
 *
 * 靠 011 的 (session_id, kind) 唯一鍵，整期一次 upsert 解決。
 */
async function saveQuadrants(points: readonly QuadrantPoint[]): Promise<void> {
  if (points.length === 0) return;

  const rows = points.map((point) => ({
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
    analyzed_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin()
    .from("analyses")
    .upsert(rows, { onConflict: "session_id,kind" });
  if (error) throw new Error(error.message);
}
