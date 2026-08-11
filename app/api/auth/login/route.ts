/**
 * 代號 + PIN 登入。
 * 成功後簽發 httpOnly JWT cookie（含 participant_id / app_role / class_id）。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyPin } from "@/lib/auth/password";
import { signToken, SESSION_TTL_SECONDS } from "@/lib/auth/jwt";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { authSecret } from "@/lib/auth/session";
import { isRole } from "@/lib/auth/types";
import { checkThrottle, clearFailures, recordFailure } from "@/lib/auth/throttle";

type ParticipantRow = {
  id: string;
  code: string;
  pin_hash: string;
  role: string;
  class_id: string | null;
};

// 學生端不看技術訊息：代號不存在與 PIN 錯誤回同一句話，
// 既是可用性也是安全性（不洩漏哪些代號存在）。
const GENERIC_FAILURE = "代號或密碼不對，再試一次";

/**
 * 被節流時的訊息。刻意不說「這個代號被鎖住了」——那會洩漏代號存在與否。
 * 只說要等多久，學生看得懂，攻擊者也問不出額外資訊。
 */
function throttledMessage(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return `試太多次了，等 ${minutes} 分鐘再試一次`;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
  }

  const { code, pin } = body as { code?: unknown; pin?: unknown };
  if (typeof code !== "string" || typeof pin !== "string" || !code || !pin) {
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
  }

  // 節流先擋。放在查資料庫之前，被鎖住時連 bcrypt 都不必跑——
  // 那正是暴力嘗試最想消耗的資源（每次驗證約 100ms）。
  const now = new Date();
  const throttle = await checkThrottle(code, now);
  if (throttle.locked) {
    return NextResponse.json(
      { error: throttledMessage(throttle.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSeconds) } },
    );
  }

  const { data, error } = await supabaseAdmin()
    .from("participants")
    .select("id, code, pin_hash, role, class_id")
    .eq("code", code.trim().toUpperCase())
    .maybeSingle<ParticipantRow>();

  if (error) {
    console.error("[auth/login] participants 查詢失敗", {
      message: error.message,
    });
    return NextResponse.json({ error: "系統忙碌中，稍後再試" }, { status: 500 });
  }

  // 找不到代號時仍跑一次雜湊比對，讓回應時間不因帳號存在與否而不同。
  const hash = data?.pin_hash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduu";
  const ok = await verifyPin(pin, hash);

  if (!data || !ok || !isRole(data.role)) {
    // 代號不存在也照記。否則「有沒有被節流」就成了帳號存在與否的旁通道。
    const after = await recordFailure(code, now);
    if (after.locked) {
      return NextResponse.json(
        { error: throttledMessage(after.retryAfterSeconds) },
        { status: 429, headers: { "Retry-After": String(after.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
  }

  await clearFailures(code);

  const token = await signToken(
    {
      participantId: data.id,
      code: data.code,
      role: data.role,
      classId: data.class_id,
    },
    authSecret(),
  );

  const response = NextResponse.json({ role: data.role, code: data.code });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}
