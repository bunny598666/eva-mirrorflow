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
| `npm run gen:secret` | 產生 `AUTH_JWT_SECRET` |
| `npm run create:participant -- --code R-01 --role researcher` | 建立帳號。PIN 只印一次，資料庫只存雜湊 |

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
| `ANTHROPIC_API_KEY` | STEP 4 起 | 之前可留空 |
| `DATABASE_URL` | ❌ | **不要放上 Vercel**。只有本機的驗證與建帳號腳本用得到，應用程式完全不需要 |

3. 資料庫 migration 不會隨部署自動執行。換 Supabase 專案時，需在該專案的 SQL Editor
   依序執行 `supabase/migrations/` 的 `001` → `006`（`002`～`006` 可重複執行；
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
