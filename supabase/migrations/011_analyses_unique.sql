-- 011_analyses_unique.sql —— 一個場次的每種分析只有一列
--
-- analyses 是可重算的分析結果（與 events 不同，它不是現場行為紀錄）。
-- 加上唯一鍵之後，重算可以用單一 upsert 一次寫完整期，不必逐列
-- 「先查有沒有、再決定 insert 還是 update」。
--
-- 【為什麼要這樣做】象限座標的 z 分數以該期全班為基準，任何人交件都要
-- 整期重算。原本逐列寫入是每人 2 次查詢——45 人同時交件時就是
-- 45 × 45 × 2 ≈ 4000 次往返資料庫，實測 /api/submit 的 p50 是 15.7 秒。
-- 改成批次 upsert 之後每次重算只剩個位數往返。
--
-- 建立索引前先清掉可能存在的重複列（開發期逐列寫入可能留下的），
-- 只保留最新的一列。
--
-- 可重複執行。

delete from analyses a
using analyses b
where a.session_id = b.session_id
  and a.kind = b.kind
  and a.analyzed_at < b.analyzed_at;

create unique index if not exists analyses_session_kind_unique_idx
  on analyses (session_id, kind);
