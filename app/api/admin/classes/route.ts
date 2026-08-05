import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, guarded, num, readJson, str } from "@/lib/api/guard";

const GRADE_LEVELS = ["junior_high", "senior_high", "university"];

export async function GET(): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async (session) => {
    const query = supabaseAdmin().from("classes").select("*").order("label");
    // 教師只看得到自己那班，與 003_rls.sql 的 classes_read_own 同語意。
    const { data, error } =
      session.app_role === "teacher" && session.class_id
        ? await query.eq("id", session.class_id)
        : await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ classes: data ?? [] });
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const body = await readJson(request);
    const label = str(body.label);
    const gradeLevel = str(body.grade_level);
    const model = str(body.model);
    const temperature = num(body.temperature);
    const promptVersion = str(body.system_prompt_version);

    if (!label) return badRequest("請填班級名稱");
    if (!gradeLevel || !GRADE_LEVELS.includes(gradeLevel)) {
      return badRequest("學制不正確");
    }
    if (!model) return badRequest("請填模型名稱");
    if (temperature === null || temperature < 0 || temperature > 2) {
      return badRequest("temperature 需介於 0 與 2 之間");
    }
    if (!promptVersion) return badRequest("請填 system prompt 版本");

    const { data, error } = await supabaseAdmin()
      .from("classes")
      .insert({
        label,
        grade_level: gradeLevel,
        model,
        temperature,
        system_prompt_version: promptVersion,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ class: data }, { status: 201 });
  });
}
