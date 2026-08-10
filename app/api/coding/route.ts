/**
 * 寫入人工編碼。
 *
 * 【coder_code 一律取自登入身分，不接受用戶端指定】
 * 兩位編碼者各自用自己的 researcher 帳號登入（R-01 / R-02）。若讓用戶端
 * 自報 coder_code，任何人都能以另一位編碼者的名義寫入，信度就沒有意義了。
 *
 * 同一個人對同一個場次只會有一列（008 的唯一索引），重複送出是更新而非新增：
 * 編碼者本來就會邊看邊改判定。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, guarded, readJson, str } from "@/lib/api/guard";
import { CURRENT_SCHEME_VERSION, getScheme, isComplete, sanitize } from "@/lib/coding/scheme";

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["researcher"], async (claims) => {
    const body = await readJson(request);
    const sessionId = str(body.session_id);
    const schemeVersion = str(body.scheme_version) ?? CURRENT_SCHEME_VERSION;
    if (!sessionId) return badRequest("缺少 session_id");

    let scheme;
    try {
      scheme = getScheme(schemeVersion);
    } catch {
      return badRequest(`未知的編碼架構版本：${schemeVersion}`);
    }

    const codes = sanitize(scheme, body.codes);
    if (!isComplete(scheme, codes)) {
      return badRequest("每個向度都要選一個類目");
    }

    const db = supabaseAdmin();

    // 場次要存在且已交件——沒交件就沒有東西可編。
    const { data: session, error: sErr } = await db
      .from("sessions")
      .select("id, status")
      .eq("id", sessionId)
      .maybeSingle<{ id: string; status: string }>();
    if (sErr) throw new Error(sErr.message);
    if (!session || session.status === "active") {
      return badRequest("這個場次還不能編碼");
    }

    const { error } = await db.from("coder_annotations").upsert(
      {
        session_id: sessionId,
        coder_code: claims.code,
        scheme_version: schemeVersion,
        codes,
        ts: new Date().toISOString(),
      },
      { onConflict: "session_id,coder_code,scheme_version" },
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, coder_code: claims.code });
  });
}
