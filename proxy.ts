/**
 * 路由守衛（Next 16 的 proxy.ts，即舊稱 middleware.ts）。
 *
 * 三個路由群對應三種角色。這是第一道門，不是唯一一道——每個 Route Handler
 * 仍各自 requireRole()，因為 proxy 只看得到路徑，看不到「這筆資料是不是你的」。
 *
 * 注意：本檔跑在 Edge runtime，不可 import next/headers、node:crypto 或任何
 * 伺服器端 Supabase client。JWT 驗證因此走 Web Crypto（見 lib/auth/jwt.ts）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth/jwt";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import type { Role, SessionClaims } from "@/lib/auth/types";

const GUARDED: readonly { prefix: string; roles: readonly Role[] }[] = [
  // 學生：寫作、鏡子、上次的你
  { prefix: "/write", roles: ["student"] },
  { prefix: "/mirror", roles: ["student"] },
  { prefix: "/recap", roles: ["student"] },
  // 教師：班級總覽、單人回放、後台
  { prefix: "/dashboard", roles: ["teacher", "researcher"] },
  { prefix: "/session", roles: ["teacher", "researcher"] },
  { prefix: "/admin", roles: ["teacher", "researcher"] },
  { prefix: "/api/admin", roles: ["teacher", "researcher"] },
  // 研究者：軌跡圖、編碼、匯出
  { prefix: "/trajectory", roles: ["researcher"] },
  { prefix: "/coding", roles: ["researcher"] },
  { prefix: "/export", roles: ["researcher"] },
  { prefix: "/api/export", roles: ["researcher"] },
];

/** 登入後各角色的落地頁。 */
export const HOME_BY_ROLE: Readonly<Record<Role, string>> = {
  student: "/",
  teacher: "/dashboard",
  researcher: "/trajectory",
};

function guardFor(pathname: string): readonly Role[] | null {
  const match = GUARDED.find(
    (g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`),
  );
  return match ? match.roles : null;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const required = guardFor(pathname);
  if (!required) return NextResponse.next();

  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) {
    // 設定缺失時一律關門，不要因為環境變數沒填就把研究資料敞開。
    return deny(request, pathname, null);
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifyToken(token, secret) : null;

  if (!session || !required.includes(session.app_role)) {
    return deny(request, pathname, session);
  }

  return NextResponse.next();
}

function deny(
  request: NextRequest,
  pathname: string,
  session: SessionClaims | null,
): NextResponse {
  // API 回 JSON，頁面導向登入或自己的首頁。
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: session ? "forbidden" : "unauthorized" },
      { status: session ? 403 : 401 },
    );
  }

  if (session) {
    // 已登入但走錯區：送回自己的地盤，不要讓學生看到「權限不足」這種技術訊息。
    return NextResponse.redirect(
      new URL(HOME_BY_ROLE[session.app_role], request.url),
    );
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/write/:path*",
    "/mirror/:path*",
    "/recap/:path*",
    "/dashboard/:path*",
    "/session/:path*",
    "/admin/:path*",
    "/trajectory/:path*",
    "/coding/:path*",
    "/export/:path*",
    "/api/admin/:path*",
    "/api/export/:path*",
  ],
};
