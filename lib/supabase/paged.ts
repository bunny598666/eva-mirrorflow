/**
 * 分頁讀取。
 *
 * 【為什麼一定要有這支】PostgREST（Supabase 的 API 層）**預設每次最多回
 * 1000 列**，而且不會報錯——它就是安靜地少給你。
 *
 * 壓測之後資料庫裡有 6734 筆事件，匯出的 events.csv 只有 1000 列。
 * manifest 記的筆數與檔案一致（兩邊都是 1000），所以「manifest 與檔案相符」
 * 的檢查完全看不出問題；是拿去跟資料庫的 count 對照才抓到的。
 *
 * 少掉 85% 的歷程資料而毫無徵兆，是這個專案能出的最嚴重的錯。
 * 凡是可能超過 1000 列的查詢，一律走這支。
 *
 * 【呼叫端必須給定排序】沒有 ORDER BY 的分頁在 PostgreSQL 裡沒有穩定順序，
 * 換頁時可能重複或漏掉列。每個 page() 都要帶 .order()。
 */
import "server-only";

/** 與 Supabase 的預設上限一致。調大沒有用，伺服器端會截掉。 */
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const all: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    all.push(...rows);

    // 拿回來的比一頁少 ＝ 已經到底。剛好整除時會多跑一次空的查詢，
    // 那一次的成本遠低於「少拿了一頁卻不知道」的代價。
    if (rows.length < PAGE_SIZE) break;
  }

  return all;
}
