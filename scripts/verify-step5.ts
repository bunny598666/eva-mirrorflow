/**
 * verify-step5.ts —— 事件流完整性檢查
 *
 * STEP 5 的驗收（斷網 30 秒打字→重連零遺漏零重複）必須在真實瀏覽器裡做，
 * 因為要模擬離線與 IndexedDB 行為。本腳本負責驗收的另一半：**檢查落庫的
 * 事件流是否完整**——序號連續、無重複、型別合法、時間單調。
 *
 * 手動驗收程序（README 有完整版）：
 *   1. AI_PROVIDER=mock npm run dev
 *   2. 學生登入 → 開始寫作
 *   3. DevTools Network 切 Offline，打字 30 秒以上
 *   4. 切回 Online，等 5 秒
 *   5. npm run verify:step5 -- --session <場次 id>
 *
 * 不帶 --session 則檢查全部場次。
 *
 * ⚠ verify-step4.ts 的冪等測試會刻意寫入 client_seq=99，因此那些測試場次
 *   （S4-A / S4-B）會被本腳本報成序號缺口。那是測試殘留，不是真的遺漏——
 *   events 是 append-only 刪不掉。看真實場次的結果即可。
 */
import { Client } from "pg";

// 與 lib/events/types.ts 同步。刻意複製而非 import：跨出 scripts/ 目錄
// 會讓 Node 的型別剝離走 CommonJS 判定而噴警告。
const EVENT_TYPES = [
  "chat_send",
  "chat_receive",
  "copy",
  "paste",
  "keystroke_batch",
  "delete_block",
  "focus_switch",
  "scaffold_click",
  "idle",
  "submit",
  "mirror_view",
  "recap_view",
] as const;

type Row = { session_id: string; client_seq: string; type: string; ts: string };

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("缺少 DATABASE_URL（.env.local）。");
    process.exit(1);
  }

  const only = arg("session");
  const client = new Client({ connectionString });
  await client.connect();

  let problems = 0;

  try {
    const res = only
      ? await client.query<Row>(
          `select session_id, client_seq, type, ts from events where session_id = $1 order by client_seq`,
          [only],
        )
      : await client.query<Row>(
          `select session_id, client_seq, type, ts from events order by session_id, client_seq`,
        );

    const bySession = new Map<string, Row[]>();
    for (const row of res.rows) {
      const list = bySession.get(row.session_id) ?? [];
      list.push(row);
      bySession.set(row.session_id, list);
    }

    if (bySession.size === 0) {
      console.log("查無事件。先在瀏覽器裡寫幾個字再回來。");
      return;
    }

    for (const [sessionId, rows] of bySession) {
      const seqs = rows.map((r) => Number(r.client_seq));
      const max = Math.max(...seqs);
      const seen = new Set<number>();
      const duplicates: number[] = [];
      for (const s of seqs) {
        if (seen.has(s)) duplicates.push(s);
        seen.add(s);
      }
      const gaps: number[] = [];
      for (let i = 1; i <= max; i += 1) if (!seen.has(i)) gaps.push(i);

      const badTypes = rows
        .map((r) => r.type)
        .filter((t) => !(EVENT_TYPES as readonly string[]).includes(t));

      // 序號遞增時時間也該遞增。倒退代表用戶端時鐘被調過，
      // 會讓 STEP 7 的回放時間軸錯亂。
      const backwards: number[] = [];
      for (let i = 1; i < rows.length; i += 1) {
        const prev = rows[i - 1];
        const cur = rows[i];
        if (prev && cur && new Date(cur.ts).getTime() < new Date(prev.ts).getTime()) {
          backwards.push(Number(cur.client_seq));
        }
      }

      const ok =
        duplicates.length === 0 &&
        gaps.length === 0 &&
        badTypes.length === 0 &&
        backwards.length === 0;
      if (!ok) problems += 1;

      const mark = ok ? "[32m✓[0m" : "[31m✗[0m";
      console.log(`${mark} ${sessionId}  ${rows.length} 筆，序號 1–${max}`);
      if (duplicates.length) console.log(`    重複序號：${duplicates.join(", ")}`);
      if (gaps.length) console.log(`    序號缺口：${gaps.join(", ")}  ← 事件遺漏`);
      if (badTypes.length) console.log(`    非法型別：${[...new Set(badTypes)].join(", ")}`);
      if (backwards.length) console.log(`    時間倒退於序號：${backwards.join(", ")}`);
    }

    console.log(
      `\n${"─".repeat(56)}\n檢查 ${bySession.size} 個場次，${problems} 個有問題。`,
    );
  } finally {
    await client.end();
  }

  if (problems > 0) process.exit(1);
  console.log("[32m事件流完整。[0m");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
