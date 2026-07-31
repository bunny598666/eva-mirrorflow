// SSE 串流對話（STEP 4）。模型參數一律取自 classes 列，且只能經 lib/ai/provider.ts 出去。
import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "not_implemented" }, { status: 501 });
}
