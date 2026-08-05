/**
 * service_role 的 Supabase client。**僅限伺服器端**。
 *
 * service_role 具 BYPASSRLS，003_rls.sql 的政策對它完全無效——因此凡是用本
 * client 的地方，授權都必須由應用層自己把關（見 lib/auth/session.ts 的
 * requireRole，以及各 Route Handler 內以 class_id / participant_id 過濾的查詢）。
 *
 * 002 與 004 的 append-only trigger 不受影響：那是資料庫層的鐵則，
 * service_role 一樣撞得頭破血流。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。請檢查 .env.local。",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
