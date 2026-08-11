/**
 * 場次歸屬查詢（帶快取）。
 *
 * 每一次寫事件都要確認「這個場次是不是你的」——service_role 繞過 RLS，
 * 應用層是唯一一道。但那是一次資料庫往返，而事件端點是全系統呼叫最頻繁的：
 * 45 人同堂、每 4 秒一批，一節課約兩萬次。
 *
 * 【為什麼可以快取】場次的擁有者**永遠不會變**：
 *   - sessions.participant_id 沒有任何程式路徑會改它
 *   - 003 的 guard_session_update trigger 在資料庫層再擋一次
 *   - id 是 uuid，不會被回收再利用
 * 所以「這個場次屬於誰」是一個寫入後就固定的事實，快取不會過期。
 *
 * 快取只記 sessionId → participantId，不記任何其他狀態（status 會變，
 * 需要 status 的呼叫端請自己查）。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** 一個班三期最多 135 個場次；設 2000 是為了多班共用同一個部署時仍夠用。 */
const MAX_ENTRIES = 2000;

const cache = new Map<string, string>();

/** 回傳這個場次的擁有者；場次不存在回 null。 */
export async function sessionOwner(sessionId: string): Promise<string | null> {
  const cached = cache.get(sessionId);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin()
    .from("sessions")
    .select("participant_id")
    .eq("id", sessionId)
    .maybeSingle<{ participant_id: string }>();
  if (error) throw new Error(error.message);
  if (!data) return null;

  // 滿了就整個清掉。LRU 在這裡不值得——快取失效只是多一次查詢，
  // 而且實際條目數遠低於上限，這條路幾乎不會走到。
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(sessionId, data.participant_id);
  return data.participant_id;
}

export async function ownsSession(
  sessionId: string,
  participantId: string,
): Promise<boolean> {
  return (await sessionOwner(sessionId)) === participantId;
}

/** 測試用。 */
export function clearSessionOwnerCache(): void {
  cache.clear();
}
