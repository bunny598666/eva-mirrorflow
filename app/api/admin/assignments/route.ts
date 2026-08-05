import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, guarded, num, readJson, str } from "@/lib/api/guard";

export async function GET(): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const { data, error } = await supabaseAdmin()
      .from("assignments")
      .select("*")
      .order("order_no");
    if (error) throw new Error(error.message);
    return NextResponse.json({ assignments: data ?? [] });
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const body = await readJson(request);
    const title = str(body.title);
    const instructions = str(body.instructions);
    const orderNo = num(body.order_no);

    if (!title) return badRequest("請填作業標題");
    if (!instructions) return badRequest("請填作業說明");
    if (orderNo === null || ![1, 2, 3].includes(orderNo)) {
      return badRequest("期別只能是 1、2 或 3");
    }

    const scaffold = Array.isArray(body.scaffold_buttons) ? body.scaffold_buttons : [];

    const { data, error } = await supabaseAdmin()
      .from("assignments")
      .insert({
        title,
        instructions,
        order_no: orderNo,
        scaffold_buttons: scaffold,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return badRequest(`第 ${orderNo} 期作業已經存在`);
      throw new Error(error.message);
    }
    return NextResponse.json({ assignment: data }, { status: 201 });
  });
}
