// 事件批次寫入（STEP 5）。
// 鐵則：僅 INSERT；(session_id, client_seq) UNIQUE 衝突靜默略過並回 200，確保重送冪等。
import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "not_implemented" }, { status: 501 });
}
