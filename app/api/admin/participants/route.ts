import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, num, readJson, str } from "@/lib/api/guard";
import { buildCodes, withHashes } from "@/lib/admin/credentials";

const MAX_BATCH = 60; // 單班 45 人，留些餘裕

export async function GET(request: Request): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async (session) => {
    const url = new URL(request.url);
    const classId =
      session.app_role === "teacher" ? session.class_id : url.searchParams.get("class_id");

    // 不選 pin_hash——它不該離開資料庫。
    let query = supabaseAdmin()
      .from("participants")
      .select("id, code, role, class_id, consent_at, guardian_consent_at")
      .order("code");
    if (classId) query = query.eq("class_id", classId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ participants: data ?? [] });
  });
}

/**
 * 批次產生學生代號 + PIN。
 * 回應含 PIN 明碼，且這是它唯一一次出現——資料庫只存 bcrypt 雜湊。
 */
export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["teacher", "researcher"], async (session) => {
    const body = await readJson(request);
    const requestedClass = str(body.class_id);
    const classId =
      session.app_role === "teacher" ? session.class_id : requestedClass;
    const count = num(body.count);
    const prefix = (str(body.prefix) ?? "S").toUpperCase();

    if (!classId) return badRequest("請指定班級");
    if (session.app_role === "teacher" && requestedClass && requestedClass !== classId) {
      return forbidden("只能為自己任教的班級產生代號");
    }
    if (count === null || count < 1 || count > MAX_BATCH) {
      return badRequest(`人數需介於 1 與 ${MAX_BATCH} 之間`);
    }
    if (!/^[A-Z]{1,4}$/.test(prefix)) {
      return badRequest("代號前綴只能是 1～4 個英文字母");
    }

    const db = supabaseAdmin();
    const { data: existing, error: exErr } = await db.from("participants").select("code");
    if (exErr) throw new Error(exErr.message);
    const taken = new Set((existing ?? []).map((r) => (r as { code: string }).code));

    const codes = buildCodes(prefix, Math.floor(count), taken);
    if (codes.length < count) return badRequest("可用代號不足，換一個前綴試試");

    const { credentials, rows } = await withHashes(codes);

    const { error } = await db.from("participants").insert(
      rows.map((r) => ({
        code: r.code,
        pin_hash: r.pin_hash,
        class_id: classId,
        role: "student",
      })),
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ credentials }, { status: 201 });
  });
}
