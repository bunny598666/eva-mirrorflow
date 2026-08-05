import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, readJson, str } from "@/lib/api/guard";
import { assignmentHasSessions } from "@/lib/admin/freeze";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const { id } = await params;

    // 作業說明是刺激材料的一部分；已有人作答就不能再動。
    if (await assignmentHasSessions(id)) {
      return forbidden(
        "此作業已有學生開始作答，內容不得再修改——作業說明屬於研究的刺激材料，中途變動會破壞三期可比性。",
      );
    }

    const body = await readJson(request);
    const patch: Record<string, unknown> = {};
    const title = str(body.title);
    const instructions = str(body.instructions);
    if (title) patch.title = title;
    if (instructions) patch.instructions = instructions;
    if (Array.isArray(body.scaffold_buttons)) {
      patch.scaffold_buttons = body.scaffold_buttons;
    }
    if (Object.keys(patch).length === 0) return badRequest("沒有要更新的欄位");

    const { data, error } = await supabaseAdmin()
      .from("assignments")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ assignment: data });
  });
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  return guarded(["researcher"], async () => {
    const { id } = await params;
    if (await assignmentHasSessions(id)) {
      return forbidden("此作業已有作答紀錄，不得刪除——研究資料不可湮滅。");
    }
    const { error } = await supabaseAdmin().from("assignments").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  });
}
