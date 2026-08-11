/**
 * 去識別化匯出（STEP 12）。僅輸出 participant code，不得含任何 PII。
 *
 * 七個檔案打包成一個 zip 下載，並寫一筆 export_audit。
 *
 * 【稽核先寫，再回傳檔案】順序反過來的話，下載成功但稽核寫失敗，
 * 就會出現一份「沒人知道誰匯出的」資料檔。反過來（稽核寫了但下載失敗）
 * 只是多一筆紀錄，無害。
 */
import { AuthError, requireRole } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildExport } from "@/lib/export/bundle";
import { createZip } from "@/lib/export/zip";

// zip 用 node:zlib，必須跑在 Node runtime（Edge 沒有這個模組）。
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  let claims;
  try {
    claims = await requireRole("researcher");
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const now = new Date();

  try {
    const { files, manifest } = await buildExport(claims.code, now);

    const { error } = await supabaseAdmin()
      .from("export_audit")
      .insert({ researcher_code: claims.code, ts: now.toISOString(), manifest });
    if (error) throw new Error(error.message);

    const zip = createZip(files, now);
    const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

    return new Response(zip as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="mirrorflow-export-${stamp}.zip"`,
        "Content-Length": String(zip.length),
        // 匯出的是研究資料，不該被任何一層快取住。
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[api/export] 匯出失敗", {
      researcher: claims.code,
      message: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: "匯出失敗，請看伺服器日誌" }, { status: 500 });
  }
}
