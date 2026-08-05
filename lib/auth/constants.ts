/**
 * proxy.ts（Edge runtime）與伺服器端共用的常數。
 * 獨立成檔是因為 lib/auth/session.ts 會 import next/headers，Edge 不可載入。
 */
export const SESSION_COOKIE = "mf_session";
