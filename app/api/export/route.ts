// 去識別化匯出（STEP 12）。僅輸出 participant code，不得含任何 PII。
import { NextResponse } from "next/server";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "not_implemented" }, { status: 501 });
}
