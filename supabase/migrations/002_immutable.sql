-- 002_immutable.sql —— append-only 鐵則的資料庫層強制
-- 依 BUILD_PLAN.md §4。
--
-- events / chat_messages / reflections 三表一旦寫入即不可變更。
-- 此 trigger 對所有角色生效，service_role 亦不例外——研究資料完整性沒有後門。
-- 唯一允許 UPDATE 的流程性資料表是 sessions（status 轉移），不在本檔範圍。

create or replace function forbid_mutation() returns trigger
  language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end
$$;

create trigger events_immutable
  before update or delete on events
  for each row execute function forbid_mutation();

create trigger chat_immutable
  before update or delete on chat_messages
  for each row execute function forbid_mutation();

create trigger reflections_immutable
  before update or delete on reflections
  for each row execute function forbid_mutation();
