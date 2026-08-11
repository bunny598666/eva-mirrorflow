# CLAUDE.md — MirrorFlow（歷程之鏡）v1.0

> 碩士論文研究工具。研究問題：**歷程視覺化回饋對國中生 AI 協作模式與反思之影響**。
> 單組時間序列設計：一個班級連續 3 次作業,每次交件後學生檢視自己的「文章 DNA 條碼 + 歷程回放」並完成結構化反思,追蹤三期之間協作行為的變化軌跡。
> 理論框架：知識翻新理論（rise above）+ 自我調整學習（SRL：自我觀察 → 自我判斷 → 自我反應）。
> **核心翻轉：歷程視覺化不只是研究者的顯微鏡,更是學生的鏡子——本系統把「評量工具」做成「學習工具」。**

---

## 0. 三條不可違反的鐵則

1. **events 表 append-only。** 任何程式碼不得 UPDATE / DELETE events、chat_messages、reflections;資料庫 trigger 強制,應用層同樣不准寫出。研究資料完整性 = 論文可信度。
2. **零 PII。** 只有 `participants.code`（如 S-07）+ PIN。不存姓名、Email、學號、IP。
3. **模型、參數、θ 門檻、反思題目版本全部凍結。** 本方向比方向一多一項：`reflection_prompts` 也有版本欄——三次作業的反思題目必須同版,否則「反思品質的變化」與「題目變了」混淆。

## 1. 專案身份

- **這是研究工具,不是產品。** 不做多租戶、金流、email 註冊。優先順序：資料完整性 > 穩定 > 功能 > 美觀。
- 角色：`student`（讀寫自己 + **讀自己的歷程分析**）、`teacher`（讀該班）、`researcher`（全部 + 匯出）。
- **與方向一最大的差別**：學生端多了「我的歷程」頁——DNA 條碼、簡化回放、反思表單都是**給 13 歲學生看的**,視覺與文案必須做到國中生 10 秒內看懂,這是一級需求。
- 場域：國中教室、45 人同堂、離線韌性是一級功能。

## 2. 技術棧（不得擅自替換）

| 層 | 選型 | 備註 |
|---|---|---|
| 框架 | Next.js 16 App Router + TypeScript **strict** + React 19 | 單一 repo。**v1.0 原訂 Next 14,2026-07-31 經指導者裁示升至 16** |
| 樣式 | Tailwind CSS | 自建輕量元件 |
| 編輯器 | Tiptap（ProseMirror） | Provenance Marks 依賴,不可換 |
| 資料庫 | Supabase（PostgreSQL + RLS + pg_cron） | |
| 圖表 | Recharts | 散佈圖、軌跡圖、三期趨勢 |
| AI SDK | `lib/ai/provider.ts` 抽象層（預設 @anthropic-ai/sdk,可切 Gemini / Ollama） | 唯一出口 |
| 部署 | Vercel（GitHub main 自動部署） | |
| 差異比對 | diff-match-patch | |
| 本地佇列 | IndexedDB（idb） | |

### 2.1 Next 16 慣例（後續 STEP 必須遵守）

BUILD_PLAN.md 撰寫時以 Next 14 為準,升版後下列寫法已變更,以本節為準：

- **`params` / `searchParams` / `cookies()` / `headers()` 皆為 Promise**,必須 `await`。
- **路由守衛寫在 `proxy.ts`**（Next 16 對 `middleware.ts` 的新命名,兩者仍相容;新檔一律用 `proxy.ts`）——STEP 2 三種角色的路由群守衛適用。
- **ESLint 用 flat config `eslint.config.mjs`**;`next lint` 已移除,指令為 `npm run lint`（= `eslint .`）。

## 3. 資料庫（詳細 SQL 見 BUILD_PLAN.md §4）

```
participants(id, code, pin_hash, class_id, consent_at, guardian_consent_at)
classes(id, label, grade_level, model, temperature, system_prompt_version)
assignments(id, title, instructions, scaffold_buttons jsonb, order_no)   ← order_no 1/2/3 = 三期
sessions(id, participant_id, assignment_id, started_at, submitted_at, status)
chat_messages(id, session_id, role, content, scaffold_id, input_tokens, output_tokens, ts)
events(...)                                  ← 同方向一,append-only
snapshots(...)
analyses(id, session_id, kind, result jsonb, ...)     ← kind 含 'dna' | 'quadrant'
reflection_prompts(id, version, questions jsonb)      ← ★反思題目(版本凍結)
reflections(id, session_id, prompt_version, answers jsonb, viewed_dna_at, viewed_replay_at, ts)  ← ★
coder_annotations(id, session_id, coder_code, scheme_version, codes jsonb, ts)
```

- ★ 兩張表是本方向的靈魂。`reflections.viewed_dna_at / viewed_replay_at` 記錄學生**確實看過**視覺化才作答——這是「介入有發生」的操作型證據,論文方法章要用。
- 學生 RLS 例外:可 SELECT 自己 sessions 對應的 `analyses`（僅 kind='dna'）與 snapshots——這是「鏡子」的權限基礎,方向一沒有這條。

## 4. 核心領域邏輯

### 4.1–4.3 事件記錄、Provenance Marks、DNA 三色歸因
與 ScaffoldFlow 完全相同（keystroke 4 秒/停頓 1.5 秒打包;IndexedDB 佇列 + client_seq 冪等續傳;aiOrigin/externalOrigin marks;θ 讀環境變數,submit 時算 DNA 寫入 analyses）。細節見 BUILD_PLAN.md §4。

### 4.4 歷程回饋迴圈（本方向的介入,最重要的一節）
交件後的強制流程,順序不可調換：
1. **看鏡子**:呈現本次 DNA 條碼（學生版:大色塊 + 白話圖例「藍=AI 寫的你沒改、綠=AI 寫的你改過、橘=你自己寫的」）+ 三色比例圓環 + 簡化回放（僅關鍵節點:貼上、大段刪除、長時間停頓）。記錄 viewed_dna_at / viewed_replay_at。
2. **回答反思**:載入 reflection_prompts 當前版本的 3 題（範例:「找一段藍色,當時為什麼直接用了 AI 的句子?」「找一段綠色,你改了什麼?為什麼?」「下一次寫作,你想在哪裡做得不一樣?」）。每題最少 30 字才能送出。
3. **第 2、3 次作業開始前**:顯示「上次的你」摘要卡（上次三色比例 + 學生自己寫的「下次想做的改變」原文）——把 SRL 的「自我反應」接回下一輪的「自我觀察」,迴圈才完整。
- 學生**只能看自己**;看不到同儕資料、看不到全班分布（避免社會比較污染介入）。

### 4.5 軌跡分析（本方向的招牌產出）
- 每次 submit 後計算象限座標寫入 analyses(kind='quadrant'):X=互動深度、Y=原創性(算法同方向一 metrics)。
- 研究者儀表板「軌跡圖」:四象限散佈圖上,每位學生三期座標連成帶箭頭折線——誰從「搭便車者」走成「協作者」一眼可見。這是論文最重要的一張 Figure,渲染品質要求出版級（SVG 可匯出）。

### 4.6 鷹架按鈕
本方向鷹架**全程開啟**（不是實驗變項,是常備支持）,scaffold_click 照常記錄——這批資料留作論文附屬分析或未來研究。

### 4.7 回放引擎
同方向一:snapshot 每 60 秒/200 事件;replay 純函式可測。學生版回放是**簡化版**（僅事件節點跳轉,無逐字重演）,避免 13 歲使用者迷失。

## 5. 目錄結構

```
app/
  (student)/write/[sessionId]/       雙欄寫作頁
  (student)/mirror/[sessionId]/      ★我的歷程:DNA+簡化回放+反思表單
  (student)/recap/[assignmentId]/    ★「上次的你」摘要卡
  (teacher)/dashboard/               班級總覽
  (teacher)/session/[id]/            單人完整回放
  (researcher)/trajectory/           ★三期軌跡圖
  (researcher)/coding/  export/      編碼、匯出
  api/chat/ events/ export/
lib/
  ai/provider.ts
  events/{queue.ts,capture.ts}
  dna/{attribute.ts,similarity.ts}
  replay/engine.ts
  editor/marks.ts
  mirror/recap.ts                    ★摘要卡組裝邏輯
supabase/migrations/
```

## 6. 編碼規範

- TypeScript strict,禁 `any`。
- UI 全繁中。**學生端文案標準**:國中生 10 秒看懂;禁用「歸因」「權重」「參數」等詞——用「這段是誰寫的」「AI 幫了多少」。教師/研究者端可用學術詞彙。
- 資料層 snake_case、元件 PascalCase、函式 camelCase。
- 錯誤三原則:學生端不彈技術訊息;事件寫入失敗不丟資料;API 錯誤結構化 log。
- 反思送出失敗時,答案暫存 IndexedDB——**學生打的 90 字反思弄丟一次,信任就沒了**。
- 每 STEP 過驗收 + `npm run build` 無錯 + 更新 §8 進度表,才進下一步。

## 7. 禁止事項

- 禁止 UPDATE / DELETE events、chat_messages、reflections。
- 禁止儲存 PII;匯出僅 participant code。
- 禁止繞過 lib/ai/provider.ts。
- 禁止寫死 θ、snapshot 週期、反思題目（前者環境變數,後者 DB 版本化）。
- 禁止讓學生看到他人資料或全班統計（介入純度）。
- 禁止在三次作業期間變更 reflection_prompts 版本、模型參數、θ。
- 禁止引入 LangChain、Yjs 即時共編、清單外重型依賴。

## 8. STEP 進度表（Claude Code 每完成一步更新）

| STEP | 內容 | 狀態 |
|---|---|---|
| 0 | Repo + Supabase + Vercel 初始化 | ☑ 本機骨架完成（build 過）；GitHub / Vercel 待接 |
| 1 | Schema + RLS + append-only trigger（含 reflections） | ☑ migrations 001–004；verify-rls.ts 30/30 全綠（2026-08-05, dev 專案） |
| 2 | 代號+PIN 認證、班級/作業/反思題目後台 | ☑ migration 005；verify-step2.ts 21/21 全綠 + UI 層目視確認（2026-08-05） |
| 3 | 雙欄介面外框（平板可用） | ◐ 版面與 a11y 自動檢查全過（768×1024 與 1280×800 皆零問題）；**Lighthouse 分數待你在 Chrome DevTools 實跑、真實 iPad 待你實測** |
| 4 | Chat SSE + 鷹架按鈕（常開）+ token 入庫 | ◐ verify-step4.ts 12/12 全綠（AI_PROVIDER=mock）+ UI 實測；**真實 Anthropic API 路徑待金鑰實測** |
| 5 | 事件記錄器 + IndexedDB 佇列 + 斷線續傳 | ☑ 瀏覽器實測斷網 30 秒→重連零遺漏零重複；verify-step5.ts 事件流完整（2026-08-07） |
| 6 | 複製/貼上攔截 + Provenance Marks | ☑ verify-step6.ts 55/55 全綠（無需 DB／瀏覽器／AI）+ 瀏覽器實測複製→貼上→重整→再貼上（2026-08-07） |
| 7 | 快照 + 回放引擎（完整版+學生簡化版） | ☑ verify-step7.ts 39/39 全綠（5017 事件跳轉最慢 5.5ms）+ 瀏覽器實測教師時間軸與學生節點卡片（2026-08-09）。**migration 006 已套用** |
| 8 | DNA 歸因 + 條碼（研究者版+學生白話版） | ◐ verify-step8.ts 57/57 全綠 + 交件→歸因→雙版條碼瀏覽器實測（2026-08-09）；**「非資訊背景成人 10 秒看懂」待你找 3 個人實測，程序見 README** |
| 9 | ★鏡子迴圈:mirror 頁 + 反思表單 + recap 摘要卡 | ◐ verify-step9.ts 40/40 全綠 + recap／唯讀反思瀏覽器實測（2026-08-10）。**migration 007（反思題目 v1）已套用**；**看鏡子 gate 與斷網暫存待你在真瀏覽器實測，程序見 README** |
| 10 | ★軌跡圖（三期象限移動,SVG 可匯出） | ◐ verify-step10.ts 76/76 全綠（45×3 渲染 6.4ms）+ 圖表／篩選／匯出瀏覽器實測（2026-08-10）；**匯出檔待你用向量軟體開一次；高階提問規則待指導教授確認** |
| 11 | 人工編碼介面 + κ 計算 | ◐ verify-step11.ts 61/61 全綠（κ 與四組手算一致）+ 編碼介面／κ CLI 實測（2026-08-10）。**migration 008 已套用**；**編碼架構 scheme-v1 待指導教授確認** |
| 12 | 去識別化匯出（含 reflections） | ☑ verify-step12.ts 62/62 全綠（真的解壓、七檔逐一與 DB count 比對、零 PII）+ 匯出實測（2026-08-11）。**migration 009 已套用** |
| 13 | Pilot:45 併發壓測 + 真實課堂試辦 | ☐ |

> 各 STEP 完整提示詞與驗收見 `BUILD_PLAN.md` §6。
