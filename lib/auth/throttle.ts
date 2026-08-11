/**
 * 登入節流。
 *
 * 以**代號**為單位計數，不記 IP（CLAUDE.md 鐵則二：零 PII）。
 * 這也對應真實威脅：攻擊者針對某個已知代號猜 6 位數 PIN。
 *
 * 【參數的取捨】
 * 10 分鐘內失敗 10 次 → 鎖 5 分鐘。
 *   攻擊者：每小時約 40 次，一百萬種組合要兩年多。
 *   一般學生：連錯 10 次才會遇到，而且五分鐘後自己解開。
 *   惡意鎖人：也只鎖得住五分鐘。
 *
 * 教室現場最怕的其實不是暴力破解，是有人惡意把全班鎖住——所以刻意不用
 * 「鎖到管理員手動解除」那種設計。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** 觸發鎖定的失敗次數。 */
export const MAX_FAILURES = 10;
/** 計數視窗：這麼久沒有新的失敗就從頭算。 */
export const WINDOW_MS = 10 * 60 * 1000;
/** 鎖定時長。 */
export const LOCK_MS = 5 * 60 * 1000;

/** 代號正規化。與登入查詢用同一套，否則大小寫不同就繞過節流了。 */
export function normalizeCode(raw: string): string {
  // 截長：這張表也會記下攻擊者亂打的字串，不能讓他塞進超長的鍵。
  return raw.trim().toUpperCase().slice(0, 32);
}

type ThrottleRow = {
  code: string;
  failed_count: number;
  first_failed_at: string;
  locked_until: string | null;
};

export type ThrottleState = {
  locked: boolean;
  /** 還要等幾秒。locked 為 false 時是 0。 */
  retryAfterSeconds: number;
};

/**
 * 檢查這個代號現在能不能嘗試登入。
 *
 * 查詢失敗時**放行**：節流是防護措施，不該因為它自己壞掉就把全班擋在門外。
 * 資料完整性的鐵則管的是研究資料，不是這張表。
 */
export async function checkThrottle(code: string, now: Date): Promise<ThrottleState> {
  const { data, error } = await supabaseAdmin()
    .from("auth_throttle")
    .select("code, failed_count, first_failed_at, locked_until")
    .eq("code", normalizeCode(code))
    .maybeSingle<ThrottleRow>();

  if (error) {
    console.error("[auth/throttle] 查詢失敗，放行", { message: error.message });
    return { locked: false, retryAfterSeconds: 0 };
  }
  if (!data?.locked_until) return { locked: false, retryAfterSeconds: 0 };

  const until = new Date(data.locked_until).getTime();
  const remaining = until - now.getTime();
  if (remaining <= 0) return { locked: false, retryAfterSeconds: 0 };

  return { locked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
}

/** 記一次失敗，必要時上鎖。回傳這次之後的狀態。 */
export async function recordFailure(code: string, now: Date): Promise<ThrottleState> {
  const key = normalizeCode(code);
  const db = supabaseAdmin();

  const { data, error } = await db
    .from("auth_throttle")
    .select("code, failed_count, first_failed_at, locked_until")
    .eq("code", key)
    .maybeSingle<ThrottleRow>();
  if (error) {
    console.error("[auth/throttle] 讀取失敗，略過記錄", { message: error.message });
    return { locked: false, retryAfterSeconds: 0 };
  }

  // 視窗過期就從頭算：學生上週打錯三次，不該累積到今天。
  const windowExpired =
    !data || now.getTime() - new Date(data.first_failed_at).getTime() > WINDOW_MS;

  const failedCount = windowExpired ? 1 : data.failed_count + 1;
  const firstFailedAt = windowExpired ? now : new Date(data.first_failed_at);
  const shouldLock = failedCount >= MAX_FAILURES;
  const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_MS) : null;

  const { error: upsertError } = await db.from("auth_throttle").upsert(
    {
      code: key,
      failed_count: failedCount,
      first_failed_at: firstFailedAt.toISOString(),
      locked_until: lockedUntil?.toISOString() ?? null,
    },
    { onConflict: "code" },
  );
  if (upsertError) {
    console.error("[auth/throttle] 寫入失敗", { message: upsertError.message });
  }

  return shouldLock
    ? { locked: true, retryAfterSeconds: Math.ceil(LOCK_MS / 1000) }
    : { locked: false, retryAfterSeconds: 0 };
}

/** 登入成功：清掉這個代號的失敗紀錄。 */
export async function clearFailures(code: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("auth_throttle")
    .delete()
    .eq("code", normalizeCode(code));
  if (error) {
    console.error("[auth/throttle] 清除失敗", { message: error.message });
  }
}
