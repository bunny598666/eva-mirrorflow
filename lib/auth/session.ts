/**
 * 伺服器端的登入狀態讀取。Server Component 與 Route Handler 共用。
 * proxy.ts 不使用本檔（它直接從 NextRequest 讀 cookie）。
 */
import { cookies } from "next/headers";
import { verifyToken } from "./jwt";
import { SESSION_COOKIE } from "./constants";
import type { Role, SessionClaims } from "./types";

export { SESSION_COOKIE };

export function authSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_JWT_SECRET 未設定或長度不足 32 字元。請執行 npm run gen:secret 產生一組。",
    );
  }
  return secret;
}

export async function getSession(): Promise<SessionClaims | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token, authSecret());
}

/**
 * 取得登入身分並檢查角色。不符合就丟例外——呼叫端（Route Handler）應轉成
 * 403，頁面則由 proxy.ts 先擋掉，正常情況不會走到這裡。
 */
export async function requireRole(
  ...allowed: readonly Role[]
): Promise<SessionClaims> {
  const session = await getSession();
  if (!session) throw new AuthError("尚未登入", 401);
  if (!allowed.includes(session.app_role)) {
    throw new AuthError("權限不足", 403);
  }
  return session;
}

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
