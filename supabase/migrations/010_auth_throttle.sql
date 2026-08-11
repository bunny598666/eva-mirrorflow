-- 010_auth_throttle.sql —— 登入嘗試節流
--
-- PIN 是 6 位數字，熵約 20 bits。bcrypt 擋得住雜湊外洩後的離線破解，
-- 但擋不住線上暴力嘗試——沒有節流的話，公開網址加一支腳本就能把
-- 一百萬種組合跑完。
--
-- 【不記 IP】CLAUDE.md 鐵則二：零 PII，不存 IP。所以節流以**代號**為單位。
-- 這剛好也對應真實威脅：攻擊者是針對某個已知代號猜 PIN。
--
-- 【代號不存在也要記】否則「有沒有被節流」就成了帳號存在與否的旁通道。
-- 這張表因此會出現攻擊者亂打的字串，屬正常現象。
--
-- 【故意設計成短鎖】班級現場最怕的不是暴力破解，是有人惡意把全班鎖住。
-- 10 分鐘內失敗 10 次 → 鎖 5 分鐘，自己會解開。攻擊者的速率被壓到
-- 每小時約 40 次，跑完一百萬種組合要兩年多；被惡意鎖住的學生等五分鐘。
--
-- 可重複執行。

create table if not exists auth_throttle (
  code text primary key,
  failed_count int not null default 0,
  first_failed_at timestamptz not null default now(),
  locked_until timestamptz
);

create index if not exists auth_throttle_locked_idx on auth_throttle (locked_until);

alter table auth_throttle enable row level security;
-- 不給任何政策 ＝ 只有 service_role 碰得到。這張表不該被任何登入者讀寫。

-- 這張表是可變的：成功登入要歸零、視窗過期要重置。
-- 與 events / reflections 不同，它不是研究資料，是防護狀態。
