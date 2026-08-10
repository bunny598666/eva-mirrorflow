/**
 * 軌跡圖的伺服器端讀取。僅 researcher（proxy.ts 已擋在路由層，這裡再收一次）。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildTrajectories, type QuadrantPoint, type Trajectory } from "./quadrant";

type Row = {
  session_id: string;
  result: {
    x?: number;
    y?: number;
    quadrant?: string;
    z?: { turns: number; promptChars: number; highOrder: number };
    raw?: QuadrantPoint["raw"];
    cohort_n?: number;
    order_no?: number;
  };
};

/**
 * 讀出所有已計算的象限座標並整理成軌跡。
 *
 * 這裡不重算——重算發生在 submit（見 lib/metrics/service.ts）。研究者看到的
 * 一律是資料庫裡那一份，跟匯出的 CSV 會是同一組數字。
 */
export async function loadTrajectories(): Promise<Trajectory[]> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("analyses")
    .select("session_id, result")
    .eq("kind", "quadrant");
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const { data: sessions, error: sErr } = await db
    .from("sessions")
    .select("id, participant_id")
    .in("id", rows.map((row) => row.session_id));
  if (sErr) throw new Error(sErr.message);

  const bySession = new Map(
    ((sessions ?? []) as { id: string; participant_id: string }[]).map((s) => [
      s.id,
      s.participant_id,
    ]),
  );

  const { data: participants, error: pErr } = await db
    .from("participants")
    .select("id, code")
    .in("id", [...new Set([...bySession.values()])]);
  if (pErr) throw new Error(pErr.message);

  const codeOf = new Map(
    ((participants ?? []) as { id: string; code: string }[]).map((p) => [p.id, p.code]),
  );

  const points: QuadrantPoint[] = [];
  for (const row of rows) {
    const participantId = bySession.get(row.session_id);
    const code = participantId ? codeOf.get(participantId) : null;
    // 座標不完整的列直接略過，不要在圖上畫出一個位置錯誤的點。
    if (!code || typeof row.result?.x !== "number" || typeof row.result?.y !== "number") {
      continue;
    }
    points.push({
      sessionId: row.session_id,
      participantCode: code,
      orderNo: row.result.order_no ?? 0,
      x: row.result.x,
      y: row.result.y,
      quadrant: (row.result.quadrant ?? "free_rider") as QuadrantPoint["quadrant"],
      raw: row.result.raw ?? {
        turns: 0,
        promptChars: 0,
        highOrder: 0,
        orangeRatio: 0,
        greenRatio: 0,
      },
      z: row.result.z ?? { turns: 0, promptChars: 0, highOrder: 0 },
      cohortN: row.result.cohort_n ?? 0,
    });
  }

  return buildTrajectories(points);
}
