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

## 安全

`.env.local` 與所有 `.env.*`（除 `.env.example`）已被 git 排除。
`SUPABASE_SERVICE_ROLE_KEY` 與 `ANTHROPIC_API_KEY` 絕不可入庫；
若不慎提交，刪檔不足以補救，必須輪替金鑰。
