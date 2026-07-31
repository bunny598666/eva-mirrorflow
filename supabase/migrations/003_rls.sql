-- 003_rls.sql —— Row Level Security
-- 依 BUILD_PLAN.md §4 與 CLAUDE.md §3。
--
-- 三個角色：
--   student  —— 讀寫自己；額外可讀自己的 analyses(kind='dna') 與 snapshots（＝鏡子權限）
--   teacher  —— 唯讀該班
--   researcher —— 走 Supabase service_role（BYPASSRLS），不在本檔的政策範圍
--
-- 【介入純度】學生政策一律以 participant_id = app.participant_id() 收斂到自己一列，
-- 沒有任何政策讓學生看到同儕列或聚合結果。analyses 更進一步限制 kind='dna'，
-- 讓 kind='quadrant'（象限座標，需以全班為基準算 z 分數）永遠不會到學生手上。

-- ─────────────────────────────────────────────────────────────────────
-- 身分來源
-- ─────────────────────────────────────────────────────────────────────
-- BUILD_PLAN §4 寫的是 current_setting('app.participant_id')，那是連線層 GUC；
-- 但 PostgREST 每個請求都是獨立 transaction，前端無法先設定再查詢。
-- 因此改由 helper 收斂：先讀 GUC（伺服器端 set_config 與 verify-rls.ts 走這條），
-- 沒有才回退讀 PostgREST 帶進來的 JWT claims（學生端直連 Supabase 走這條）。
-- 兩條路徑語意相同，政策本身不必分歧。

create schema if not exists app;

create or replace function app.jwt_claims() returns jsonb
  language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

create or replace function app.participant_id() returns uuid
  language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('app.participant_id', true), ''),
    app.jwt_claims() ->> 'participant_id'
  ), '')::uuid
$$;

-- 注意兩件事：
--   1. claim 名稱用 app_role，不可用 role——role 是 PostgREST 用來決定資料庫角色的
--      保留 claim，必須維持 'authenticated'。
--   2. 函式名稱不可叫 current_role——那是 SQL 保留字。
create or replace function app.app_role() returns text
  language sql stable as $$
  select coalesce(
    nullif(current_setting('app.role', true), ''),
    app.jwt_claims() ->> 'app_role',
    'anonymous'
  )
$$;

create or replace function app.class_id() returns uuid
  language sql stable as $$
  select nullif(coalesce(
    nullif(current_setting('app.class_id', true), ''),
    app.jwt_claims() ->> 'class_id'
  ), '')::uuid
$$;

-- 「這個 session 是我的嗎」——學生政策反覆用到，收成一個函式避免各表寫法漂移。
create or replace function app.owns_session(p_session_id uuid) returns boolean
  language sql stable as $$
  select exists (
    select 1 from public.sessions s
    where s.id = p_session_id
      and s.participant_id = app.participant_id()
  )
$$;

-- 「這個 session 屬於我這班嗎」——教師政策用。
create or replace function app.teaches_session(p_session_id uuid) returns boolean
  language sql stable as $$
  select app.app_role() = 'teacher' and exists (
    select 1
    from public.sessions s
    join public.participants p on p.id = s.participant_id
    where s.id = p_session_id
      and p.class_id = app.class_id()
  )
$$;

grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 全表啟用 RLS（預設拒絕；未列政策者＝僅 service_role 可存取）
-- ─────────────────────────────────────────────────────────────────────
alter table classes            enable row level security;
alter table participants       enable row level security;
alter table assignments        enable row level security;
alter table sessions           enable row level security;
alter table chat_messages      enable row level security;
alter table events             enable row level security;
alter table snapshots          enable row level security;
alter table analyses           enable row level security;
alter table reflection_prompts enable row level security;
alter table reflections        enable row level security;
alter table coder_annotations  enable row level security;

-- 未登入者一律無權；所有政策都掛在 authenticated 上。
revoke all on all tables in schema public from anon;

-- PIN 雜湊不需要被任何前端讀到（PIN 驗證在伺服器端以 service_role 進行），以欄位權限擋掉。
-- 注意：PostgreSQL 不允許從「表層級 SELECT」中挖掉單一欄位——表層級權限會蓋過欄位層級。
-- 必須先收回整表的 SELECT，再逐欄授予 pin_hash 以外的欄位。
revoke select on participants from authenticated;
grant select (id, code, class_id, role, consent_at, guardian_consent_at)
  on participants to authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- classes：只看得到自己那班
-- ─────────────────────────────────────────────────────────────────────
create policy classes_read_own on classes for select to authenticated
  using (id = app.class_id());

-- ─────────────────────────────────────────────────────────────────────
-- participants：學生只看自己；教師看該班（pin_hash 已於上方以欄位權限排除）
-- ─────────────────────────────────────────────────────────────────────
create policy participants_read_self on participants for select to authenticated
  using (id = app.participant_id());

create policy participants_read_class on participants for select to authenticated
  using (app.app_role() = 'teacher' and class_id = app.class_id());

-- ─────────────────────────────────────────────────────────────────────
-- assignments：三期作業全域唯一（order_no unique），登入者皆可讀
-- ─────────────────────────────────────────────────────────────────────
create policy assignments_read on assignments for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────
-- reflection_prompts：登入者可讀當前版本；沒有任何 write 政策
-- ＝ 版本凍結的第一層。新增版本只能經伺服器端 service_role（STEP 2 教師後台），
--    UI 不提供編輯是第二層。
-- ─────────────────────────────────────────────────────────────────────
create policy reflection_prompts_read on reflection_prompts for select to authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────────────
-- sessions：唯一允許 UPDATE 的流程性資料表
-- ─────────────────────────────────────────────────────────────────────
create policy sessions_read_own on sessions for select to authenticated
  using (participant_id = app.participant_id());

create policy sessions_read_class on sessions for select to authenticated
  using (
    app.app_role() = 'teacher'
    and participant_id in (
      select id from participants where class_id = app.class_id()
    )
  );

create policy sessions_insert_own on sessions for insert to authenticated
  with check (participant_id = app.participant_id());

create policy sessions_update_own on sessions for update to authenticated
  using (participant_id = app.participant_id())
  with check (participant_id = app.participant_id());

-- sessions 可 UPDATE，但只准動流程欄位。身分綁定與開始時間屬研究資料，
-- 不得事後改寫；狀態亦只能單向前進 active → submitted → reflected。
create or replace function guard_session_update() returns trigger
  language plpgsql as $$
declare
  rank_old int;
  rank_new int;
begin
  if new.id <> old.id
     or new.participant_id <> old.participant_id
     or new.assignment_id <> old.assignment_id
     or new.started_at <> old.started_at then
    raise exception 'sessions: 身分與起始時間不可變更';
  end if;

  rank_old := array_position(array['active','submitted','reflected'], old.status);
  rank_new := array_position(array['active','submitted','reflected'], new.status);
  if rank_new < rank_old then
    raise exception 'sessions: status 不可回退（% → %）', old.status, new.status;
  end if;

  return new;
end
$$;

create trigger sessions_guard_update
  before update on sessions
  for each row execute function guard_session_update();

-- ─────────────────────────────────────────────────────────────────────
-- chat_messages / events / snapshots：學生寫自己的、讀自己的；教師唯讀該班
-- （UPDATE / DELETE 由 002 的 trigger 擋，這裡也不給政策）
-- ─────────────────────────────────────────────────────────────────────
create policy chat_read_own on chat_messages for select to authenticated
  using (app.owns_session(session_id));
create policy chat_read_class on chat_messages for select to authenticated
  using (app.teaches_session(session_id));
create policy chat_insert_own on chat_messages for insert to authenticated
  with check (app.owns_session(session_id));

create policy events_read_own on events for select to authenticated
  using (app.owns_session(session_id));
create policy events_read_class on events for select to authenticated
  using (app.teaches_session(session_id));
create policy events_insert_own on events for insert to authenticated
  with check (app.owns_session(session_id));

create policy snapshots_read_own on snapshots for select to authenticated
  using (app.owns_session(session_id));
create policy snapshots_read_class on snapshots for select to authenticated
  using (app.teaches_session(session_id));
create policy snapshots_insert_own on snapshots for insert to authenticated
  with check (app.owns_session(session_id));

-- ─────────────────────────────────────────────────────────────────────
-- ★analyses：鏡子權限。學生只能讀自己的、且只能讀 kind='dna'
-- kind='quadrant' 以全班為基準計算 z 分數，讓學生看到等同揭露全班分布，
-- 會污染介入——因此連自己的 quadrant 都不給看。
-- 沒有 insert 政策：DNA 與象限座標一律由伺服器端 service_role 於 submit 時寫入。
-- ─────────────────────────────────────────────────────────────────────
create policy student_read_own_dna on analyses for select to authenticated
  using (kind = 'dna' and app.owns_session(session_id));

create policy analyses_read_class on analyses for select to authenticated
  using (app.teaches_session(session_id));

-- ─────────────────────────────────────────────────────────────────────
-- ★reflections：學生寫自己的、讀自己的；教師唯讀該班
-- 無 update / delete 政策，002 的 trigger 再擋一層。
-- ─────────────────────────────────────────────────────────────────────
create policy reflections_read_own on reflections for select to authenticated
  using (app.owns_session(session_id));
create policy reflections_read_class on reflections for select to authenticated
  using (app.teaches_session(session_id));
create policy reflections_insert_own on reflections for insert to authenticated
  with check (app.owns_session(session_id));

-- ─────────────────────────────────────────────────────────────────────
-- coder_annotations：不設任何政策 ＝ 僅 researcher（service_role）可存取
-- ─────────────────────────────────────────────────────────────────────
