/**
 * 交件。
 *
 * 順序不可調換：
 *   1. 確認場次是本人的、而且還在 active
 *   2. 讀最後一份快照算 DNA（算不出來就整個中止，不改狀態）
 *   3. 寫 analyses(kind='dna')
 *   4. sessions.status → submitted
 *
 * 【為什麼 DNA 要在改狀態之前算完】
 * 狀態一旦變成 submitted 就回不去了（003 的 guard trigger 擋回退），
 * 學生也不能再寫。若先改狀態再算 DNA，中途失敗就會留下一個「已交件但
 * 沒有 DNA」的場次——鏡子頁打不開，而學生已經沒辦法重交。
 *
 * 用戶端必須在呼叫這裡之前把最後一份快照送上來，否則歸因會少掉最後那段。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, readJson, str } from "@/lib/api/guard";
import { computeDna, saveDna, NoSnapshotError } from "@/lib/dna/service";

type SessionRow = { id: string; participant_id: string; status: string };

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["student"], async (claims) => {
    const body = await readJson(request);
    const sessionId = str(body.session_id);
    if (!sessionId) return badRequest("缺少 session_id");

    const db = supabaseAdmin();

    const { data: session, error: sErr } = await db
      .from("sessions")
      .select("id, participant_id, status")
      .eq("id", sessionId)
      .maybeSingle<SessionRow>();
    if (sErr) throw new Error(sErr.message);
    if (!session || session.participant_id !== claims.participant_id) {
      return forbidden("這不是你的場次");
    }
    // 重送（連點兩下、網路重試）不該再跑一次，也不該報錯嚇到學生。
    if (session.status !== "active") {
      return NextResponse.json({ ok: true, alreadySubmitted: true });
    }

    let computation;
    try {
      computation = await computeDna(sessionId);
    } catch (err) {
      if (err instanceof NoSnapshotError) {
        console.error("[api/submit] 沒有快照，交件中止", { session_id: sessionId });
        return NextResponse.json(
          { error: "還沒存好你的文章，等一下再按一次" },
          { status: 409 },
        );
      }
      throw err;
    }

    await saveDna(sessionId, computation);

    const { error: uErr } = await db
      .from("sessions")
      .update({ status: "submitted", submitted_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "active");
    if (uErr) throw new Error(uErr.message);

    return NextResponse.json({ ok: true, ratios: computation.result.ratios });
  });
}
