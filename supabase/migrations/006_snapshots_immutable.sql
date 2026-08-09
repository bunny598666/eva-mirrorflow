-- 006_snapshots_immutable.sql —— 快照也是 append-only
--
-- CLAUDE.md §0 的鐵則點名 events / chat_messages / reflections 三張表。
-- snapshots 沒被點名，但 STEP 7 之後它承擔了一件那三張表做不到的事：
--
--   事件流存的是純文字 patch，**marks（哪一段是 AI 寫的）只存在 snapshots.doc 裡**。
--   一次 UPDATE 就能無聲改掉「這段是誰寫的」，而那正是本研究的主要測量。
--
-- 因此比照辦理：寫入即不可變更，對 service_role 亦然。
-- 快照本來就只增不改（每一份是一個時間點的檢查點），加這道鎖不影響任何流程。
--
-- 可重複執行。

drop trigger if exists snapshots_immutable on snapshots;
create trigger snapshots_immutable
  before update or delete on snapshots
  for each row execute function forbid_mutation();
