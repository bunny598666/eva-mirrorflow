-- 009_export_audit.sql —— 匯出稽核紀錄
--
-- 每一次匯出留一筆：誰、什麼時候、匯出了幾列、用哪組研究參數。
--
-- 為什麼需要它：去識別化資料一旦離開系統就管不到了。IRB 與論文的資料管理
-- 章節要能回答「這份檔案是誰在什麼時候產生的」，而且答案不能靠記憶。
--
-- append-only：稽核紀錄可以被刪改就不叫稽核紀錄。比照 events 上鎖。
--
-- 可重複執行。

create table if not exists export_audit (
  id uuid primary key default gen_random_uuid(),
  researcher_code text not null,
  ts timestamptz not null default now(),
  manifest jsonb not null
);

create index if not exists export_audit_ts_idx on export_audit (ts desc);

alter table export_audit enable row level security;

-- 不給任何 RLS 政策 ＝ 只有 service_role（伺服器端）寫得進去、讀得到。
-- 學生與教師連這張表存在都碰不到。

drop trigger if exists export_audit_immutable on export_audit;
create trigger export_audit_immutable
  before update or delete on export_audit
  for each row execute function forbid_mutation();
