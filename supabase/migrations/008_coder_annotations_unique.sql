-- 008_coder_annotations_unique.sql —— 一位編碼者對一個場次、一個架構版本只有一列
--
-- 編碼者會邊看邊改判定，所以這張表允許更新（與 events / reflections 不同，
-- 它不是現場行為紀錄，而是研究者的分析工作底稿）。
--
-- 但「同一個人對同一個場次」必須只有一列，否則：
--   - 連點兩次送出就會長出兩列，κ 計算時同一個案例被算兩次
--   - 兩列內容不同時，沒有任何規則說得出哪一列才算數
--
-- 換架構版本＝重新編碼，因此版本也是鍵的一部分：scheme-v1 與 scheme-v2
-- 的判定可以並存，各自算各自的信度。
--
-- 可重複執行。

create unique index if not exists coder_annotations_unique_idx
  on coder_annotations (session_id, coder_code, scheme_version);
