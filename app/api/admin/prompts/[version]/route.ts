/**
 * 針對「某一個既有版本」的修改嘗試，一律 403。
 * 與 ../route.ts 的 PATCH/PUT/DELETE 成對，確保不論打到哪個路徑形式都擋得住。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { forbidden, guarded } from "@/lib/api/guard";

const FREEZE_REASON =
  "反思題目版本凍結：既有版本不可修改或刪除，只能新增版本。三次作業必須使用同一版題目，否則「反思品質的變化」與「題目換了」將無法區辨。";

type Params = { params: Promise<{ version: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const { version } = await params;
    const { data, error } = await supabaseAdmin()
      .from("reflection_prompts")
      .select("*")
      .eq("version", version)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "查無此版本" }, { status: 404 });
    return NextResponse.json({ prompt: data });
  });
}

export async function PATCH(): Promise<NextResponse> {
  return forbidden(FREEZE_REASON);
}

export async function PUT(): Promise<NextResponse> {
  return forbidden(FREEZE_REASON);
}

export async function DELETE(): Promise<NextResponse> {
  return forbidden(FREEZE_REASON);
}
