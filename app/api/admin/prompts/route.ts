/**
 * 反思題目版本管理。
 *
 * 【鐵則三】三次作業的反思題目必須同版。既有版本永遠不可修改，只能新增版本。
 * 本檔是「API 層」的拒絕（BUILD_PLAN STEP 2 驗收要求 UI 與 API 雙層）：
 * PATCH / PUT / DELETE 都明確存在且一律回 403，附上理由——不是靠「沒寫 handler
 * 所以回 405」這種偶然的擋法。第三層在資料庫：004_prompt_version_freeze.sql。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, readJson, str } from "@/lib/api/guard";

const FREEZE_REASON =
  "反思題目版本凍結：既有版本不可修改或刪除，只能新增版本。三次作業必須使用同一版題目，否則「反思品質的變化」與「題目換了」將無法區辨。";

type Question = { id: string; text: string; min_chars: number };

export async function GET(): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const { data, error } = await supabaseAdmin()
      .from("reflection_prompts")
      .select("*")
      .order("version");
    if (error) throw new Error(error.message);
    return NextResponse.json({ prompts: data ?? [] });
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async () => {
    const body = await readJson(request);
    const version = str(body.version);
    if (!version) return badRequest("請填版本名稱");

    const parsed = parseQuestions(body.questions);
    if (typeof parsed === "string") return badRequest(parsed);

    const { data, error } = await supabaseAdmin()
      .from("reflection_prompts")
      .insert({ version, questions: parsed })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return forbidden(`版本「${version}」已存在。${FREEZE_REASON}`);
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ prompt: data }, { status: 201 });
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

function parseQuestions(value: unknown): Question[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "至少要有一題";
  }
  const out: Question[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return "題目格式不正確";
    const q = raw as Record<string, unknown>;
    const id = str(q.id);
    const text = str(q.text);
    const minChars = typeof q.min_chars === "number" ? q.min_chars : Number(q.min_chars);

    if (!id) return "每一題都需要 id";
    if (seen.has(id)) return `題目 id 重複：${id}`;
    seen.add(id);
    if (!text) return `題目 ${id} 缺少題幹`;
    if (!Number.isFinite(minChars) || minChars < 1) {
      return `題目 ${id} 的最少字數不正確`;
    }
    out.push({ id, text, min_chars: Math.floor(minChars) });
  }
  return out;
}
