# MirrorFlow（歷程之鏡）系統建構企劃書 v1.0

> 論文方向二：歷程視覺化回饋對國中生 AI 協作模式與反思之影響（單組時間序列,三期追蹤）
> 技術棧：Next.js 14 + TS strict + Tailwind + Supabase + Vercel ｜ 文件日期:2026-07-22
> 與 CLAUDE.md 搭配：CLAUDE.md 是「憲法」,本文件是「施工圖 + 每步的 Claude Code 提示詞」。

---

## 1. 目標與成功標準

**一句話**:同一套歷程記錄系統,把儀表板轉過來給學生自己看——交件後看見自己的 DNA 條碼與歷程,寫下反思,追蹤三次作業之間協作行為的變化。

**驗收即成功**:
1. 45 人班級 90 分鐘課堂全程使用,事件零遺漏（斷網 30 秒可續傳）。
2. 交件 → 看鏡子 → 反思的迴圈流暢完成,`viewed_dna_at` 證據齊全,反思答案零遺失。
3. 三期軌跡圖一鍵輸出出版級 SVG（論文 Figure 直接可用）。
4. 第 2、3 次作業開場的「上次的你」摘要卡正確呈現上期資料。

## 2. 系統架構

```
┌────────────────────── Vercel ──────────────────────┐
│ Next.js 14 (App Router, TS strict)                 │
│ [學生]                        [教師/研究者]         │
│  ├ 雙欄寫作頁(Chat+Tiptap)     ├ 班級總覽/完整回放   │
│  ├ ★鏡子頁(DNA+簡化回放       ├ ★三期軌跡圖        │
│  │   +反思表單)               ├ 編碼介面            │
│  └ ★「上次的你」摘要卡         └ 去識別化匯出        │
│ API: /chat /events /export                          │
└──────────────────┬─────────────────────────────────┘
┌────────────── Supabase ────────────────────────────┐
│ PostgreSQL(JSONB 事件流)+RLS+append-only trigger    │
│ reflections / reflection_prompts(版本凍結) ★        │
└────────────────────────────────────────────────────┘
★ = 本方向新增於共同核心之上的模組(介入迴圈與軌跡分析)
```

## 3. 研究設計對系統的四個硬需求

| 研究需求 | 系統落地 |
|---|---|
| 介入確實發生 | mirror 頁記錄 viewed_dna_at / viewed_replay_at;未瀏覽不得進反思表單 |
| 介入純度 | 學生僅見自己;無同儕、無全班統計(避免社會比較混淆) |
| 三期可比 | reflection_prompts、model、temperature、θ 全程版本凍結;assignments.order_no 定義期別 |
| 變化可視 | analyses(kind='quadrant') 每期落點;軌跡圖=同人三點連線帶箭頭 |

## 4. 資料庫 Schema(完整 SQL)

```sql
-- 001_core.sql(與 ScaffoldFlow 共同核心,classes 無 scaffold_enabled)
create table classes (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  grade_level text not null check (grade_level in ('junior_high','senior_high','university')),
  model text not null,
  temperature numeric(3,2) not null,
  system_prompt_version text not null
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  pin_hash text not null,
  class_id uuid not null references classes(id),
  consent_at timestamptz,
  guardian_consent_at timestamptz
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  instructions text not null,
  scaffold_buttons jsonb not null default '[]',
  order_no int not null unique check (order_no between 1 and 3)   -- 三期
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  assignment_id uuid not null references assignments(id),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status text not null default 'active'
    check (status in ('active','submitted','reflected')),          -- 多一態:已完成反思
  unique (participant_id, assignment_id)
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  role text not null check (role in ('user','assistant')),
  content text not null,
  scaffold_id text,
  input_tokens int, output_tokens int,
  ts timestamptz not null default now()
);

create table events (
  id bigint generated always as identity primary key,
  session_id uuid not null references sessions(id),
  ts timestamptz not null default now(),
  client_seq bigint not null,
  type text not null check (type in ('chat_send','chat_receive','copy','paste',
    'keystroke_batch','delete_block','focus_switch','scaffold_click','idle','submit',
    'mirror_view','recap_view')),                                  -- 多兩型:鏡子/摘要卡瀏覽
  payload jsonb not null,
  unique (session_id, client_seq)
);

create table snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  ts timestamptz not null default now(),
  doc jsonb not null,
  seq_event_id bigint not null
);

create table analyses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  kind text not null check (kind in ('dna','interaction','quadrant')),
  result jsonb not null,
  model text, rubric_version text,
  analyzed_at timestamptz not null default now()
);

-- ★ 本方向核心兩表
create table reflection_prompts (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  questions jsonb not null        -- [{id,text,min_chars}]
);

create table reflections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) unique,
  prompt_version text not null references reflection_prompts(version),
  answers jsonb not null,          -- [{question_id,text}]
  viewed_dna_at timestamptz not null,      -- 介入證據
  viewed_replay_at timestamptz,
  ts timestamptz not null default now()
);

create table coder_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  coder_code text not null,
  scheme_version text not null,
  codes jsonb not null,
  ts timestamptz not null default now()
);

-- 002_immutable.sql
create or replace function forbid_mutation() returns trigger
  language plpgsql as $$ begin raise exception '% is append-only', tg_table_name; end $$;
create trigger events_immutable      before update or delete on events          for each row execute function forbid_mutation();
create trigger chat_immutable       before update or delete on chat_messages   for each row execute function forbid_mutation();
create trigger reflections_immutable before update or delete on reflections    for each row execute function forbid_mutation();

-- 003_rls.sql 核心差異:學生可讀自己的分析結果(鏡子權限)
alter table analyses enable row level security;
create policy student_read_own_dna on analyses for select
  using (kind = 'dna' and session_id in
    (select id from sessions
      where participant_id = (current_setting('app.participant_id', true))::uuid));
-- 其餘同 ScaffoldFlow:student 限自身、teacher 限班級、researcher service role。
```

## 5. 用量與成本(沿用已查證之 2026-07 定價)

- 單班 45 人 × 3 作業 ≈ 135 場;每場約 20 萬輸入 / 1.25 萬輸出 tokens → Haiku 4.5 標準價約 USD 35,開 caching 約 USD 15。比方向一更省(單班設計)。**假設**:輪次需 pilot 校正;或掛指導教授計畫資源。

## 6. 開發階段(STEP 0–13,每步含 Claude Code 提示詞與驗收)

> STEP 0–8 與 ScaffoldFlow 高度同源(差異以【差異】標出);STEP 9–10 是本方向靈魂。

### STEP 0|初始化
**提示詞**:「建立 Next.js 14 App Router 專案,TypeScript strict,Tailwind。安裝 @supabase/supabase-js、@supabase/ssr、diff-match-patch、idb、@tiptap/react 與 starter-kit、recharts、@anthropic-ai/sdk。建立 .env.example(SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、AI_PROVIDER、ANTHROPIC_API_KEY、DNA_THETA_HIGH=0.9、DNA_THETA_LOW=0.5)。依 CLAUDE.md §5 建目錄骨架(含 mirror/recap/trajectory 路由)。GitHub repo mirrorflow 連 Vercel。」
**驗收**:`npm run build` 過;Vercel 部署成功。

### STEP 1|Schema + RLS + 防竄改
**提示詞**:「依 BUILD_PLAN.md §4 建立 migrations 001~003(含 reflection_prompts、reflections 與其 append-only trigger、學生讀自身 dna 的 RLS 政策)。寫 scripts/verify-rls.ts:驗證(a)學生可讀自己的 analyses kind='dna' 但讀不到他人、讀不到 kind='quadrant';(b)對 reflections 執行 UPDATE 被拒;(c)teacher 讀不到他班。」
**驗收**:verify-rls.ts 全綠。

### STEP 2|認證與後台
**提示詞**:「代號+PIN 登入(bcrypt+httpOnly JWT cookie,含 participant_id/role/class_id),middleware 守衛三種路由群。教師後台:班級 CRUD(模型參數欄)、作業 CRUD(order_no 1–3 唯一)、反思題目管理(reflection_prompts 版本化:只能新增版本,不能改既有版本——UI 直接不提供編輯)、批次產生學生代號+PIN 匯出 CSV(明碼不落庫)。」
**驗收**:嘗試修改已存在的 prompt 版本被 UI 與 API 雙層拒絕。

### STEP 3|雙欄介面外框
**提示詞**:「/write/[sessionId]:左 40% Chat、右 60% Tiptap,可拖曳分隔;頂部作業說明(可收合)、剩餘時間、儲存狀態指示。RWD 至 iPad 直向。全繁中,國中生語彙。」
**驗收**:iPad 可正常書寫;Lighthouse a11y ≥ 90。

### STEP 4|Chat SSE + 鷹架(常開)
**提示詞**:「lib/ai/provider.ts 抽象層(chat(messages,config)→AsyncIterable<string>,預設 Anthropic,config 取自 classes 列)。/api/chat SSE 串流,完成後訊息與 token 入庫。鷹架按鈕依 assignments.scaffold_buttons 渲染(本系統恆開啟),點擊插入模板+記 scaffold_click,訊息帶 scaffold_id。」【差異:無 feature flag,恆開】
**驗收**:串流順暢;半截回覆不入庫;scaffold_click 與 scaffold_id 正確關聯。

### STEP 5|事件記錄器
**提示詞**:「lib/events/capture.ts(keystroke 每 4 秒或停頓 1.5 秒打包 diff;另捕捉 focus_switch、idle>30s、delete_block>50 字、mirror_view、recap_view)+ queue.ts(IndexedDB 佇列、client_seq 自增、每 5 秒批次 POST、離線累積上線補送)。/api/events 批次 insert,UNIQUE 衝突靜默略過回 200。」【差異:多 mirror_view/recap_view 兩型】
**驗收**:斷網 30 秒打字→重連零遺漏零重複。

### STEP 6|Provenance Marks
**提示詞**:「lib/editor/marks.ts:aiOrigin{copyEventId,messageId,srcStart,srcEnd} 與 externalOrigin 兩個 Tiptap marks。Chat copy 攔截(記錄範圍+sha1);編輯器 paste 攔截(sha1 命中掛 aiOrigin、未命中掛 externalOrigin、同記 paste 事件);手打無 mark。」
**驗收**:貼上區段 mark attrs 正確;編輯拆分後 mark 隨區段分裂。

### STEP 7|快照與回放(雙版本)
**提示詞**:「快照:每 60 秒或 200 事件存 doc 含 marks。lib/replay/engine.ts 純函式 replay(snapshot,events[])→docState+單元測試。教師端完整回放(時間軸紅=提問/黃=複製/藍=輸入/灰=idle,可拖曳)。學生端簡化回放元件:僅列關鍵節點(貼上、大段刪除、>2 分鐘停頓)為可點卡片,點擊顯示該時刻文稿狀態——不做逐字播放。」【差異:多學生簡化版】
**驗收**:5000 事件模擬歷程任意跳轉 <1 秒;重演終態===實際終稿;簡化版節點數正確。

### STEP 8|DNA 歸因與條碼(雙版本)
**提示詞**:「lib/dna/:submit 時逐 mark 區段算正規化 Levenshtein,依環境變數 θ 歸藍/綠/橘,寫 analyses(kind='dna')。研究者版條碼:SVG 橫條+hover Before/After 對照。學生版條碼:同資料,但大色塊、圓環比例圖、白話圖例(藍=AI 寫的你沒改、綠=AI 寫的你改過、橘=你自己寫的),點色段捲動至文稿對應處並高亮。」【差異:多學生白話版】
**驗收**:三份構造樣本歸因正確;學生版由非資訊背景成人測試 10 秒內能說出三色意義。

### STEP 9|★鏡子迴圈(本方向靈魂之一)
**提示詞**:「(a) /mirror/[sessionId]:submit 後導向;依序呈現學生版 DNA 條碼→簡化回放;瀏覽即寫 viewed_dna_at/viewed_replay_at 與 mirror_view 事件;兩者皆瀏覽後『開始反思』按鈕才啟用。(b) 反思表單:載入 reflection_prompts 現行版,逐題最少 min_chars 字,輸入即暫存 IndexedDB,送出寫入 reflections 並將 session.status 更新為 reflected(此為 sessions 表合法更新,非 append-only 範圍)。(c) /recap/[assignmentId]:第 2、3 期寫作頁進入前強制顯示『上次的你』卡:上期三色圓環+上期反思第 3 題(『下次想做的改變』)原文+『開始這次寫作』按鈕;瀏覽記 recap_view。lib/mirror/recap.ts 組裝資料。」
**驗收**:未看完鏡子無法進反思;反思中斷網再送出零遺失;第 2 期開場正確顯示第 1 期資料;第 1 期無 recap(無上期)。

### STEP 10|★三期軌跡圖(本方向靈魂之二)
**提示詞**:「(a) 每次 submit 後計算象限座標(X=z(對話輪次)+z(平均 prompt 長度)+z(高階提問次數);Y=orange+0.5*green 比例;z 分數以該期全班為基準)寫入 analyses(kind='quadrant')。(b) /researcher/trajectory:四象限散佈圖,每位學生三期座標連帶箭頭折線,期別以點形狀區分(○△□);可篩選起始象限;hover 顯示 code 與三期數值;右上『匯出 SVG』輸出含字型嵌入的出版級檔案(座標軸標籤英文,供期刊投稿)。」
**驗收**:45 筆×3 期模擬資料渲染 <2 秒;SVG 匯出後以向量軟體開啟無破版;篩選正確。

### STEP 11|人工編碼介面
**提示詞**:「/researcher/coding:逐 session 呈現對話全文與反思全文(本方向編碼對象含反思文本),右側依 scheme_version 載入編碼架構,coder_code 各自作業寫入 coder_annotations。scripts/kappa.ts 計算兩位編碼者 Cohen's κ+分歧清單。」【差異:編碼對象多反思文本】
**驗收**:κ 與手算一致;分歧清單正確。

### STEP 12|去識別化匯出
**提示詞**:「/researcher/export:匯出 events.csv、chat.csv、dna.json、quadrant.csv、reflections.csv、metrics.csv,僅含 participant code;manifest.json 記匯出時間、θ、model、prompt_version、筆數;動作寫 audit log。」【差異:多 quadrant 與 reflections】
**驗收**:匯出檔查無 PII;manifest 與 DB count 一致。

### STEP 13|Pilot 與壓測
**提示詞**:「scripts/load-test.ts:45 併發×30 分鐘(打字+對話+貼上+完成鏡子迴圈),統計事件遺漏率、反思送出成功率、API p95。修正問題記錄於 PILOT_NOTES.md。」
**驗收**:遺漏率 0%;反思成功率 100%;/api/events p95 <800ms;真實課堂試辦一次,全班完成完整迴圈。

## 7. 風險與假設

| 項目 | 說明 | 處置 |
|---|---|---|
| 反思品質 | 題目設計不佳收到場面話 | 題目與指導教授共擬;min_chars 下限;pilot 後可發新版本(僅限正式研究開始前) |
| 介入強度不足 | 三期可能看不出行為改變 | 誠實寫入限制;以質性軌跡描述為主要成果;viewed_* 證據支撐「介入有發生」 |
| 學生看懂鏡子 | 13 歲能否理解 DNA 條碼 | 白話版+pilot 以放聲思考法驗證理解 |
| DNA 歸因誤差 | 同方向一 | θ 敏感度分析+人工標註對照 |
| 小樣本 | 單班 45 人 | 組內設計天然迴避組間比較弱點;統計以無母數重複量數處理 |
| 倫理程序 | 未成年+行為記錄+反思屬個人陳述 | 代號化+guardian_consent_at;反思文本匯出同樣僅掛 code |
