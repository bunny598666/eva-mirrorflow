/**
 * 快照寫入與讀取。
 *
 * 快照是回放的起跳點，也是 marks 的唯一容身處——事件流只有純文字 patch，
 * 「哪一段是 AI 寫的」全靠 snapshots.doc。因此這個端點的可靠性等同研究資料本身。
 *
 * 僅 INSERT。同一個 (session_id, seq_event_id) 重送會被視為重複而略過，
 * 讓用戶端可以放心重試（斷網補送時會發生）。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, num, readJson, str } from "@/lib/api/guard";

/**
 * seq_event_id 存的是 **client_seq**，不是 events.id。
 *
 * 用戶端拿不到 DB 的 bigint id（事件批次非同步送出，離線時更是還沒進資料庫），
 * 而 (session_id, client_seq) 本來就是事件的唯一鍵。與 STEP 6 的 copyEventId
 * 同一套規則：用戶端能決定的鍵才是可離線的鍵。
 */
export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["student"], async (claims) => {
    const body = await readJson(request);
    const sessionId = str(body.session_id);
    const clientSeq = num(body.client_seq);
    const doc = body.doc;

    if (!sessionId) return badRequest("缺少 session_id");
    if (clientSeq === null || clientSeq < 0) return badRequest("client_seq 不正確");
    if (typeof doc !== "object" || doc === null) return badRequest("doc 需為物件");

    const db = supabaseAdmin();

    const { data: owned, error: sErr } = await db
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("participant_id", claims.participant_id)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!owned) return forbidden("這不是你的場次");

    // 同一個序號已經有快照就不重複寫。快照是冪等的檢查點，重送不該長出第二份。
    const { data: existing, error: eErr } = await db
      .from("snapshots")
      .select("id")
      .eq("session_id", sessionId)
      .eq("seq_event_id", Math.floor(clientSeq))
      .maybeSingle<{ id: string }>();
    if (eErr) throw new Error(eErr.message);
    if (existing) return NextResponse.json({ id: existing.id, duplicated: true });

    const { data, error } = await db
      .from("snapshots")
      .insert({
        session_id: sessionId,
        doc,
        seq_event_id: Math.floor(clientSeq),
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw new Error(error.message);

    return NextResponse.json({ id: data.id });
  });
}

// 刻意沒有 GET：快照一律由伺服器元件經 lib/replay/queries.ts 讀取，
// 那裡才有「學生只看自己／教師只看該班／研究者全部」的完整收斂。
// 多開一個唯讀端點就多一處要各自把授權寫對的地方，而它現在沒有任何呼叫者。
