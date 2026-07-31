-- 001_core.sql —— MirrorFlow 核心資料表
-- 依 BUILD_PLAN.md §4。零 PII：全表不得出現姓名、Email、學號、IP。

-- ── 班級 ───────────────────────────────────────────────────────────────
-- model / temperature / system_prompt_version 三期凍結，是「三期可比」的資料基礎。
create table classes (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  grade_level text not null check (grade_level in ('junior_high','senior_high','university')),
  model text not null,
  temperature numeric(3,2) not null,
  system_prompt_version text not null
);

-- ── 參與者 ─────────────────────────────────────────────────────────────
-- code 如 'S-07'（學生）、'T-01'（教師）。除 code 與 PIN 雜湊外不存任何識別資料。
create table participants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  pin_hash text not null,
  class_id uuid not null references classes(id),
  -- 【偏離 BUILD_PLAN §4】§4 的 participants 無角色欄，但 STEP 2 規定 JWT 需帶
  -- participant_id / role / class_id，且 RLS 需區分 student 與 teacher。研究者
  -- 走 service role 不入此表。
  role text not null default 'student' check (role in ('student','teacher')),
  consent_at timestamptz,
  guardian_consent_at timestamptz
);
create index participants_class_idx on participants (class_id);

-- ── 作業（三期）────────────────────────────────────────────────────────
create table assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  instructions text not null,
  scaffold_buttons jsonb not null default '[]',
  order_no int not null unique check (order_no between 1 and 3)   -- 三期
);

-- ── 場次 ───────────────────────────────────────────────────────────────
-- status 'reflected' = 已完成鏡子迴圈。sessions 是唯一允許 UPDATE 的流程性資料表。
create table sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  assignment_id uuid not null references assignments(id),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status text not null default 'active'
    check (status in ('active','submitted','reflected')),
  unique (participant_id, assignment_id)
);
create index sessions_participant_idx on sessions (participant_id);
create index sessions_assignment_idx on sessions (assignment_id);

-- ── 對話訊息（append-only，見 002）─────────────────────────────────────
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  scaffold_id text,
  input_tokens int,
  output_tokens int,
  ts timestamptz not null default now()
);
create index chat_messages_session_idx on chat_messages (session_id, ts);

-- ── 事件流（append-only，見 002）───────────────────────────────────────
-- (session_id, client_seq) UNIQUE 是離線續傳的冪等基礎：重送必然衝突，靜默略過。
create table events (
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions(id),
  ts timestamptz not null default now(),
  client_seq bigint not null,
  type text not null check (type in ('chat_send','chat_receive','copy','paste',
    'keystroke_batch','delete_block','focus_switch','scaffold_click','idle','submit',
    'mirror_view','recap_view')),
  payload jsonb not null,
  unique (session_id, client_seq)
);
create index events_session_ts_idx on events (session_id, ts);

-- ── 快照 ───────────────────────────────────────────────────────────────
create table snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  ts timestamptz not null default now(),
  doc jsonb not null,
  seq_event_id bigint not null
);
create index snapshots_session_idx on snapshots (session_id, seq_event_id);

-- ── 分析結果 ───────────────────────────────────────────────────────────
-- kind='dna' 學生看得到（鏡子）；kind='quadrant' 僅研究者（避免社會比較）。
create table analyses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  kind text not null check (kind in ('dna','interaction','quadrant')),
  result jsonb not null,
  model text,
  rubric_version text,
  analyzed_at timestamptz not null default now()
);
create index analyses_session_kind_idx on analyses (session_id, kind);

-- ── ★反思題目（版本凍結）───────────────────────────────────────────────
-- 鐵則：只能新增版本，不得修改既有版本。UPDATE 由 003 的 RLS 與 STEP 2 的 UI/API 雙層擋下。
create table reflection_prompts (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  questions jsonb not null        -- [{id,text,min_chars}]
);

-- ── ★反思（append-only，見 002）───────────────────────────────────────
-- viewed_dna_at / viewed_replay_at = 「介入確實發生」的操作型證據，論文方法章使用。
create table reflections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) unique,
  prompt_version text not null references reflection_prompts(version),
  answers jsonb not null,          -- [{question_id,text}]
  viewed_dna_at timestamptz not null,
  viewed_replay_at timestamptz,
  ts timestamptz not null default now()
);

-- ── 人工編碼 ───────────────────────────────────────────────────────────
create table coder_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  coder_code text not null,
  scheme_version text not null,
  codes jsonb not null,
  ts timestamptz not null default now()
);
create index coder_annotations_session_idx on coder_annotations (session_id);
