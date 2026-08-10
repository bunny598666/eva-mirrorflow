# MirrorFlow（歷程之鏡）

碩士論文研究工具。研究問題：歷程視覺化回饋對國中生 AI 協作模式與反思之影響。

- 專案憲法：[CLAUDE.md](CLAUDE.md)（鐵則、技術棧、領域邏輯、禁止事項）
- 施工圖：[BUILD_PLAN.md](BUILD_PLAN.md)（完整 SQL schema §4、各 STEP 提示詞與驗收 §6）

## 本機開發

```bash
npm install
cp .env.example .env.local   # 填入實值
npm run dev
```

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 正式建置（每個 STEP 的驗收條件之一） |
| `npm run typecheck` | TypeScript strict 檢查 |
| `npm run lint` | ESLint（含禁用 `any`） |
| `npm run verify:rls` | STEP 1 驗收：RLS 與 append-only 鐵則驗證（單一 transaction，結尾一律 ROLLBACK，零殘留） |
| `npm run verify:step2` | STEP 2 驗收：認證、路由守衛、反思題目版本凍結（需另開終端機跑 `npm run dev`） |
| `npm run verify:step4` | STEP 4 驗收：SSE 串流、半截回覆不入庫、鷹架關聯（需以 `AI_PROVIDER=mock npm run dev` 啟動） |
| `npm run verify:step5 -- --session <id>` | 事件流完整性：序號連續、無重複、型別合法、時間單調 |
| `npm run verify:step6` | STEP 6 驗收：Provenance Marks。不需 DB／瀏覽器／AI，直接跑得動 |
| `npm run verify:step7` | STEP 7 驗收：回放引擎（重演終態、5000 事件跳轉、關鍵節點）。同樣不需 DB |
| `npm run verify:step8` | STEP 8 驗收：DNA 三色歸因（四份構造樣本、θ 邊界、缺損處理）。同樣不需 DB |
| `npm run verify:step9` | STEP 9 驗收：鏡子迴圈（看過的判準、伺服器端順序防線、recap）。需 `npm run dev` |
| `npm run gen:secret` | 產生 `AUTH_JWT_SECRET` |
| `npm run create:participant -- --code R-01 --role researcher` | 建立帳號。PIN 只印一次，資料庫只存雜湊 |

### STEP 5 斷線續傳的手動驗收程序

自動化腳本驗不了離線行為（需要真實瀏覽器與 IndexedDB），程序如下：

1. `AI_PROVIDER=mock npm run dev`
2. 學生登入 → 開始寫作，記下網址列的場次 id
3. DevTools → Network → 切 **Offline**
4. 持續打字 30 秒以上，中間停頓幾次
5. 切回 **Online**，等 5 秒
6. `npm run verify:step5 -- --session <場次 id>` → 應顯示序號連續、無重複

> `verify-step4.ts` 的冪等測試會刻意寫入 `client_seq=99`，那些測試場次
> （S4-A / S4-B）會被報成序號缺口。那是測試殘留而非真的遺漏——
> events 是 append-only 刪不掉。看真實場次即可。

### STEP 6 的瀏覽器實測程序

`npm run verify:step6` 已經驗掉全部判定邏輯（用真的 ProseMirror schema）。
剩下「剪貼簿 → 事件 → mark」這條線需要真瀏覽器：

1. `AI_PROVIDER=mock npm run dev`
2. 學生登入 → 開始寫作 → 在對話欄問一個問題
3. 用滑鼠選取 AI 回覆的一段，Ctrl+C
4. 到文章欄 Ctrl+V，接著**繼續往下打字**
5. F12 → Elements，檢查貼上那段被包在
   `<span data-mf-origin="ai" data-mf-message-id="…" data-mf-src-start="…">` 裡，
   而**後面自己打的字不在那個 span 裡**（這一點錯了，DNA 條碼就全錯）
6. 重整頁面再貼一次同一段，仍應判成 `data-mf-origin="ai"`

### STEP 7 的瀏覽器實測程序

`npm run verify:step7` 驗掉回放引擎本身。剩下快照排程需要真瀏覽器：

1. `AI_PROVIDER=mock SNAPSHOT_INTERVAL_MS=12000 SNAPSHOT_EVENT_COUNT=4 npm run dev`
   （正式環境是 60 秒／200 個事件，測試時調短才不用等）
2. 學生登入 → 寫幾段字，中間刪掉一大段
3. 等半分鐘，確認 `snapshots` 表長出好幾列，`seq_event_id` 遞增
4. 教師登入 → `/session/<場次 id>`：拖時間軸，文稿應隨之變化，
   拖到最右邊要等於學生的終稿
5. **災難演練**：DevTools → Application → Local Storage 刪掉 `mf-draft-<場次 id>`，
   重整寫作頁。文稿應該從**伺服器快照**回來，而不是變成空白

### STEP 8 的人工驗收程序（★這一項腳本做不到，必須找人）

驗收條件是「學生版由**非資訊背景成人**測試，10 秒內能說出三色意義」。
`npm run verify:step8` 驗的是歸因算得對不對，看不看得懂只能靠人。

程序：

1. 找一位沒看過這個系統、也不是資訊背景的成人（家人、同事都可以）
2. 打開任一份已交件場次的 `/mirror/<場次 id>`，**只給看畫面，不做任何說明**
3. 計時 10 秒後蓋掉畫面，請對方用自己的話說出藍、綠、橘各代表什麼
4. 三色全對＝通過。錯任何一色就記下對方**怎麼理解錯的**，那句話比「看不懂」有用得多
5. 至少測 3 個人。改文案之後要重測，不能拿舊結果充數

> 這一關卡的是研究效度，不是介面美感：學生看錯顏色的意思，寫出來的反思
> 就是在回答另一個問題，整個 SRL 迴圈的資料都會歪掉。

### STEP 9 的瀏覽器實測程序

`npm run verify:step9` 驗掉「看過」的幾何判準、字數規則、伺服器端的順序防線
與 recap 組裝。剩下兩件事需要真瀏覽器（自動化環境的分頁不合成畫面，
量不到視窗高度，gate 一定不會開）：

**（一）看鏡子的 gate**

1. `AI_PROVIDER=mock npm run dev`
2. 學生登入 → 交件 → 自動導到 `/mirror/<場次 id>`
3. 「開始寫想法」一開始應該是**灰的**，下面兩個項目都是 ○
4. **快速捲到底再捲回來**：兩個項目仍應是 ○（只是經過不算看過）
5. 停在文章 DNA 上約 2 秒 → 第一項變 ✓
6. 捲到「你這次的寫作過程」停約 2 秒 → 第二項變 ✓，按鈕變黑可按
7. 切到別的分頁再切回來，時間不該偷偷累積

**（二）反思斷網不遺失**

1. 按「開始寫想法」，三題各打超過 30 字
2. DevTools → Network 切 **Offline**
3. 按送出 → 應顯示「連不上，你打的字有留著，等一下再按一次」，
   **畫面上的字不能消失**
4. 重整頁面（仍離線）→ 重新按開始寫想法，應顯示
   「幫你留著上次打到一半的內容了」，三題內容都還在
5. 切回 **Online** 再送出 → 成功，導回首頁
6. DevTools → Application → IndexedDB → `mirrorflow-reflection`
   應該已經**清空**（送出成功才刪）

## 部署（Vercel）

GitHub `main` 推上去即自動部署。首次設定：

1. Vercel → Add New → Project → 匯入本 repo（Framework 會自動偵測為 Next.js，不用改）
2. Environment Variables 依下表填入，**Production 與 Preview 兩個環境都要填**

| 變數 | 需要嗎 | 說明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase 專案網址 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | 🔴 **絕不可加 `NEXT_PUBLIC_` 前綴**，加了會被打包進前端 JS，RLS 當場失效 |
| `AUTH_JWT_SECRET` | ✅ | 以 `npm run gen:secret` 產生，**與本機用不同的一組** |
| `DNA_THETA_HIGH` / `DNA_THETA_LOW` | ✅ | `0.9` / `0.5`。三期凍結，中途不得變動 |
| `SNAPSHOT_INTERVAL_MS` / `SNAPSHOT_EVENT_COUNT` | ✅ | `60000` / `200` |
| `WRITING_SESSION_MINUTES` | ✅ | `90` |
| `AI_PROVIDER` | ✅ | `anthropic` |
| `REFLECTION_PROMPT_VERSION` | ✅ | `v1`。三期凍結，中途不得變動 |
| `ANTHROPIC_API_KEY` | STEP 4 起 | 之前可留空 |
| `DATABASE_URL` | ❌ | **不要放上 Vercel**。只有本機的驗證與建帳號腳本用得到，應用程式完全不需要 |

3. 資料庫 migration 不會隨部署自動執行。換 Supabase 專案時，需在該專案的 SQL Editor
   依序執行 `supabase/migrations/` 的 `001` → `007`（`002`～`007` 可重複執行；
   `001` 若報「already exists」要停下來查，代表表已建過）。

### 部署前必讀

- **部署後網址是公開的**，登入頁擋在所有東西前面，但 PIN 只有 6 位數字且
  目前沒有嘗試次數限制。開發期間請在 Vercel 開啟 Deployment Protection；
  正式課堂前務必補上登入節流（見 `lib/auth/password.ts` 註解）。
- **開發與正式研究要用不同的 Supabase 專案。** `002` 的 trigger 讓
  events / chat_messages / reflections 永遠無法刪除，開發期的測試資料
  會永久留在該專案裡。
- Supabase 免費方案的專案閒置約一週會自動暫停，暫停期間網站會連不上資料庫。

## 安全

`.env.local` 與所有 `.env.*`（除 `.env.example`）已被 git 排除。
`SUPABASE_SERVICE_ROLE_KEY` 與 `ANTHROPIC_API_KEY` 絕不可入庫；
若不慎提交，刪檔不足以補救，必須輪替金鑰。
