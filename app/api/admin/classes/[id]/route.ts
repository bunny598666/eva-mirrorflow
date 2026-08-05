import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, num, readJson, str } from "@/lib/api/guard";
import { classHasSessions } from "@/lib/admin/freeze";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async (session) => {
    const { id } = await params;
    if (session.app_role === "teacher" && session.class_id !== id) {
      return forbidden("只能修改自己任教的班級");
    }

    const body = await readJson(request);
    const label = str(body.label);
    const model = str(body.model);
    const temperature = num(body.temperature);
    const promptVersion = str(body.system_prompt_version);

    // 【鐵則三】模型參數一旦開始收資料就凍結。
    const touchesFrozenFields =
      model !== null || temperature !== null || promptVersion !== null;
    if (touchesFrozenFields && (await classHasSessions(id))) {
      return forbidden(
        "此班級已有作答紀錄，模型、temperature 與 prompt 版本不得再變更——三期之間必須維持同一條件，否則行為的改變與條件的改變無法區辨。",
      );
    }

    const patch: Record<string, unknown> = {};
    if (label) patch.label = label;
    if (model) patch.model = model;
    if (temperature !== null) {
      if (temperature < 0 || temperature > 2) {
        return badRequest("temperature 需介於 0 與 2 之間");
      }
      patch.temperature = temperature;
    }
    if (promptVersion) patch.system_prompt_version = promptVersion;
    if (Object.keys(patch).length === 0) return badRequest("沒有要更新的欄位");

    const { data, error } = await supabaseAdmin()
      .from("classes")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ class: data });
  });
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  return guarded(["researcher"], async () => {
    const { id } = await params;
    if (await classHasSessions(id)) {
      return forbidden("此班級已有作答紀錄，不得刪除——研究資料不可湮滅。");
    }
    const { error } = await supabaseAdmin().from("classes").delete().eq("id", id);
    if (error) {
      return forbidden("刪不掉：此班級底下還有參與者，請先移除參與者。");
    }
    return NextResponse.json({ ok: true });
  });
}
