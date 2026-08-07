/**
 * 事件批次寫入。
 *
 * 鐵則：僅 INSERT；(session_id, client_seq) UNIQUE 衝突靜默略過並回 200，
 * 確保離線重送冪等——寧可重送也不可丟事件。
 *
 * STEP 4 只由對話與鷹架按鈕呼叫；STEP 5 會補上 IndexedDB 佇列、批次送出、
 * 斷線累積與 keystroke／idle／focus 的擷取。端點本身的語意兩步一致。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, readJson, str } from "@/lib/api/guard";
import { EVENT_TYPES, type EventType } from "@/lib/events/types";

/**
 * 回報該場次目前最大的 client_seq，供用戶端啟動時對齊序號。
 *
 * 沒有這一步會漏資料：client_seq 存在 IndexedDB，學生若清除瀏覽器資料或換裝置，
 * 計數器會從 1 重來，而重複的序號會被下方的 ignoreDuplicates 靜默吃掉——
 * 那個機制本來是為了冪等重送，在這個情境下卻會讓新事件永遠消失。
 */
export async function GET(request: Request): Promise<NextResponse> {
  return guarded(["student"], async (claims) => {
    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId) return badRequest("缺少 session_id");

    const db = supabaseAdmin();
    const { data: owned, error: sErr } = await db
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("participant_id", claims.participant_id)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!owned) return forbidden("這不是你的場次");

    const { data, error } = await db
      .from("events")
      .select("client_seq")
      .eq("session_id", sessionId)
      .order("client_seq", { ascending: false })
      .limit(1)
      .maybeSingle<{ client_seq: number }>();
    if (error) throw new Error(error.message);

    return NextResponse.json({ max_client_seq: data?.client_seq ?? 0 });
  });
}

type IncomingEvent = {
  client_seq: number;
  type: EventType;
  payload: Record<string, unknown>;
  ts?: string;
};

const MAX_BATCH = 500;

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["student"], async (claims) => {
    const body = await readJson(request);
    const sessionId = str(body.session_id);
    if (!sessionId) return badRequest("缺少 session_id");
    if (!Array.isArray(body.events)) return badRequest("events 需為陣列");
    if (body.events.length === 0) return NextResponse.json({ inserted: 0 });
    if (body.events.length > MAX_BATCH) {
      return badRequest(`一次最多 ${MAX_BATCH} 筆事件`);
    }

    const db = supabaseAdmin();

    // 只能寫自己的場次——service_role 繞過 RLS，這裡是唯一一道。
    const { data: owned, error: sErr } = await db
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("participant_id", claims.participant_id)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!owned) return forbidden("這不是你的場次");

    const rows: {
      session_id: string;
      client_seq: number;
      type: EventType;
      payload: Record<string, unknown>;
      ts?: string;
    }[] = [];

    for (const raw of body.events as unknown[]) {
      if (typeof raw !== "object" || raw === null) {
        return badRequest("事件格式不正確");
      }
      const e = raw as Partial<IncomingEvent>;
      const seq = typeof e.client_seq === "number" ? e.client_seq : Number.NaN;
      if (!Number.isFinite(seq) || seq < 0) return badRequest("client_seq 不正確");
      if (typeof e.type !== "string" || !EVENT_TYPES.includes(e.type as EventType)) {
        return badRequest(`未知的事件類型：${String(e.type)}`);
      }
      rows.push({
        session_id: sessionId,
        client_seq: Math.floor(seq),
        type: e.type as EventType,
        payload:
          typeof e.payload === "object" && e.payload !== null ? e.payload : {},
        ...(typeof e.ts === "string" ? { ts: e.ts } : {}),
      });
    }

    // ignoreDuplicates：UNIQUE 衝突不報錯、不覆寫（events 是 append-only，
    // 覆寫在資料庫層本來就會被 trigger 擋下）。
    const { error } = await db
      .from("events")
      .upsert(rows, { onConflict: "session_id,client_seq", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    return NextResponse.json({ received: rows.length });
  });
}
