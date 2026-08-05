-- 005_researcher_role.sql —— 研究者角色
--
-- CLAUDE.md §1 列了三種角色，但 BUILD_PLAN §4 的 participants 只裝得下學生與教師。
-- /trajectory、/coding、/export 三個研究者頁上線後必須有人登入、也必須擋住別人，
-- 因此研究者比照師生存在 participants，登入流程只有一條程式碼路徑。
--
-- 研究者不屬於任何班級，故 class_id 放寬為可為空。
-- 資料存取仍走 service_role（BYPASSRLS），003 的班級型政策對其無意義。
-- 零 PII 不變：研究者一樣只有 code + pin_hash。

alter table participants
  drop constraint if exists participants_role_check;

alter table participants
  add constraint participants_role_check
  check (role in ('student','teacher','researcher'));

alter table participants
  alter column class_id drop not null;

-- 學生與教師必須隸屬班級；只有研究者可以沒有班級。
alter table participants
  drop constraint if exists participants_class_required;

alter table participants
  add constraint participants_class_required
  check (role = 'researcher' or class_id is not null);
