/**
 * verify-step7.ts —— 快照與回放引擎驗收
 *
 * BUILD_PLAN §6 STEP 7 驗收：
 *   1. 5000 事件模擬歷程任意跳轉 < 1 秒
 *   2. 重演終態 === 實際終稿
 *   3. 簡化版節點數正確
 *
 * 不需要資料庫、瀏覽器或 AI。事件流由本腳本模擬 startCapture 的行為產生——
 * 包含它真正的打包規則（批次終點是 lastSeenText、delete_block 自成一筆），
 * 所以驗的是「真實事件流能不能重演回去」，不是「我自己編的 patch 對不對」。
 *
 *   npm run verify:step7
 */
import { diff_match_patch } from "diff-match-patch";

import {
  applyPatch,
  buildReplayIndex,
  buildTimeline,
  keyMoments,
  replay,
  textAt,
  finalText,
  KEY_MOMENT_IDLE_MS,
  type ReplayAnchor,
  type ReplayEvent,
} from "../lib/replay/engine.ts";
import { docPlainText } from "../lib/editor/provenance.ts";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`${GREEN}✓${OFF} ${name}`);
  } else {
    failed += 1;
    console.log(`${RED}✗${OFF} ${name}${detail ? `\n    ${DIM}${detail}${OFF}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  check(name, a === b, a === b ? "" : `實際 ${a}\n    預期 ${b}`);
}

// ── 模擬 startCapture ───────────────────────────────────────────────────
//
// 刻意複製 capture.ts 的打包規則而不是 import：capture.ts 綁在 window 與
// IndexedDB 上，在 Node 裡跑不起來。複製的是「規則」，而規則正是要驗的東西——
// 若哪天 capture.ts 的規則改了而這裡沒跟著改，第 2 項（重演終態）就會紅。

const dmp = new diff_match_patch();
const DELETE_BLOCK_CHARS = 50;

function patchText(before: string, after: string): string {
  return dmp.patch_toText(dmp.patch_make(before, after));
}

type Capture = {
  events: ReplayEvent[];
  text: string;
};

function makeCapture(startAt: number): {
  capture: Capture;
  edit: (next: string) => void;
  flush: () => void;
  note: (type: ReplayEvent["type"], payload?: Record<string, unknown>) => void;
} {
  const events: ReplayEvent[] = [];
  let seq = 0;
  let clock = startAt;
  let baseline = "";
  let lastSeen = "";

  const push = (
    type: ReplayEvent["type"],
    payload: Record<string, unknown>,
  ): void => {
    seq += 1;
    clock += 700;
    events.push({ client_seq: seq, type, payload, ts: new Date(clock).toISOString() });
  };

  // 與 capture.ts 的 flushBatch 同語意：終點是 lastSeen，不是「當下的文字」。
  const flush = (): void => {
    if (lastSeen === baseline) return;
    push("keystroke_batch", {
      patch: patchText(baseline, lastSeen),
      before_len: baseline.length,
      after_len: lastSeen.length,
    });
    baseline = lastSeen;
  };

  const edit = (next: string): void => {
    const removed = lastSeen.length - next.length;
    if (removed > DELETE_BLOCK_CHARS) {
      flush(); // 先結清刪除之前打的字
      push("delete_block", {
        removed_chars: removed,
        patch: patchText(lastSeen, next),
        after_len: next.length,
      });
      baseline = next;
      lastSeen = next;
      return;
    }
    lastSeen = next;
  };

  const capture = {
    events,
    get text(): string {
      return lastSeen;
    },
  } as Capture;

  return {
    capture,
    edit,
    flush,
    note: (type, payload = {}) => push(type, payload),
  };
}

// ══ 1. patch 套用的基本性質 ═════════════════════════════════════════════
console.log("\n【1】patch 套用");

{
  const before = "秋天的操場";
  const after = "秋天的操場上，落葉像下雨";
  const patch = patchText(before, after);
  eq("正確基準 → 套得回去", applyPatch(before, patch), after);
  eq("空 patch → 原樣", applyPatch(before, ""), before);
  check("亂七八糟的 patch → null 而不是硬套", applyPatch(before, "not a patch") === null);

  // 這一項是整個引擎最重要的防線：基準不對時必須誠實地失敗。
  // diff-match-patch 預設會模糊比對，硬套出一份看似合理其實錯誤的文稿。
  const wrongBase = "完全不相干的一段文字，長度也差很多，比對不到任何東西。";
  check(
    "基準文字對不上 → null（不做模糊硬套）",
    applyPatch(wrongBase, patch) === null,
    `得到：${JSON.stringify(applyPatch(wrongBase, patch))}`,
  );
}

// ══ 2. 重演終態 === 實際終稿 ════════════════════════════════════════════
console.log("\n【2】重演終態 === 實際終稿");

{
  const { capture, edit, flush, note } = makeCapture(Date.parse("2026-08-09T09:00:00Z"));

  edit("秋天的");
  edit("秋天的操場");
  flush();
  note("chat_send", { length: 12 });
  note("chat_receive", { length: 180 });
  edit("秋天的操場上，落葉像一場慢慢下的雨。");
  flush();
  note("copy", { sha1: "abc", length: 20 });
  note("paste", { origin: "ai", length: 20, sha1: "abc" });
  edit("秋天的操場上，落葉像一場慢慢下的雨。我走過去，踩到一片，發出很脆的聲音。");
  flush();
  // 大段刪除（超過 50 字）
  edit("秋天的操場上。");
  note("idle", { ms: 150_000 });
  edit("秋天的操場上，我一個人走著。");
  flush();

  const result = replay(capture.events);
  eq("重演終態逐字相同", result.text, capture.text);
  eq("沒有任何 patch 套失敗", result.issues, []);

  const index = buildReplayIndex(capture.events);
  eq("索引版終態也相同", finalText(index), capture.text);
  eq("textAt(0) 是空白", textAt(index, 0), "");
}

// 這一項專門盯住 STEP 5 那個 bug：delete_block 前的批次若以「刪除後的文字」
// 為終點，兩份 patch 會把同一段刪兩次，重演就對不上。
{
  const { capture, edit, flush } = makeCapture(Date.parse("2026-08-09T10:00:00Z"));
  const long = "這是一段刻意寫得很長的文字，長到刪掉的時候會被判定成大段刪除。".repeat(3);
  edit("開頭。");
  edit(`開頭。${long}`); // 沒 flush，批次還累積著
  edit("開頭。"); // 直接刪掉一大段
  flush();

  const kinds = capture.events.map((e) => e.type);
  eq("事件順序：先結清批次，再記刪除", kinds, ["keystroke_batch", "delete_block"]);
  const result = replay(capture.events);
  eq("刪除前後銜接得起來", result.text, capture.text);
  eq("沒有失敗", result.issues.length, 0);
}

// 帶快照錨點：正常情況下錨點與重演結果相同，不該產生任何「校正」。
{
  const { capture, edit, flush } = makeCapture(Date.parse("2026-08-09T11:00:00Z"));
  edit("第一段。");
  flush();
  const midpoint = capture.text;
  const midSeq = capture.events[capture.events.length - 1]?.client_seq ?? 0;
  edit("第一段。第二段。");
  flush();

  const anchors: ReplayAnchor[] = [{ clientSeq: midSeq, text: midpoint }];
  const withAnchor = replay(capture.events, anchors);
  eq("有錨點也得到同一份終稿", withAnchor.text, capture.text);
  eq("事件流沒斷 → 不需要校正", withAnchor.repairs, 0);
  eq("沒有問題", withAnchor.issues.length, 0);
}

// ══ 2b. 事件流斷掉（換裝置／清瀏覽器資料） ══════════════════════════════
console.log("\n【2b】事件流斷掉時要察覺，並用快照校正");

{
  // 前半段：學生寫了一段。
  const first = makeCapture(Date.parse("2026-08-09T12:00:00Z"));
  first.edit("這是我在教室電腦上寫的第一段，長度足夠讓後面的比對有意義。");
  first.flush();
  const writtenSoFar = first.capture.text;
  const seqSoFar = first.capture.events[first.capture.events.length - 1]?.client_seq ?? 0;

  // 後半段：換了一台裝置，本機暫存稿是空的，於是從空白重新打起，
  // 但事件序號接著往下長。這正是實測時真的踩到的情況。
  const second = makeCapture(Date.parse("2026-08-09T12:30:00Z"));
  second.edit("換一台電腦之後重新打的內容。");
  second.flush();
  const broken = [
    ...first.capture.events,
    ...second.capture.events.map((e) => ({
      ...e,
      client_seq: e.client_seq + seqSoFar,
    })),
  ];

  const naked = replay(broken);
  check(
    "沒有快照時：察覺到斷點（不是默默套出一份假文稿）",
    naked.issues.some((i) => i.kind === "discontinuity"),
    JSON.stringify(naked.issues),
  );

  // 有快照就能校正回來。
  const anchors: ReplayAnchor[] = [
    { clientSeq: seqSoFar, text: writtenSoFar },
    {
      clientSeq: seqSoFar + (second.capture.events[0]?.client_seq ?? 1),
      text: second.capture.text,
    },
  ];
  const repaired = replay(broken, anchors);
  eq("有快照時：終稿校正回正確版本", repaired.text, second.capture.text);
  check("有記下校正次數", repaired.repairs > 0, `repairs=${repaired.repairs}`);
  check(
    "斷點仍然被誠實記下來（不因為修好了就當沒發生）",
    repaired.issues.some((i) => i.kind === "discontinuity"),
  );
}

// 快照的 doc → 純文字，必須與事件重演的結果一致（STEP 6 的 docPlainText）
{
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "第一段。" }] },
      { type: "paragraph", content: [{ type: "text", text: "第二段。" }] },
    ],
  };
  eq("快照 doc 轉純文字", docPlainText(doc), "第一段。\n\n第二段。");
}

// ══ 3. 5000 事件任意跳轉 < 1 秒 ═════════════════════════════════════════
console.log("\n【3】5000 事件的跳轉效能");

{
  const { capture, edit, flush, note } = makeCapture(Date.parse("2026-08-09T13:00:00Z"));
  let text = "";
  const sentence = "他站在走廊上看著窗外的雨，想著剛剛那句話。";

  // 模擬一節課：打字為主，穿插對話、複製貼上、停頓、偶爾刪掉一大段。
  for (let i = 0; i < 4600; i += 1) {
    text += sentence.slice(0, 5 + (i % 16));
    edit(text);
    flush();
    if (i % 25 === 0) note("chat_send", { length: 20 });
    if (i % 37 === 0) note("paste", { origin: i % 74 === 0 ? "ai" : "external", length: 40 });
    if (i % 53 === 0) note("idle", { ms: 130_000 });
    if (i % 211 === 0 && text.length > 400) {
      text = text.slice(0, text.length - 300);
      edit(text);
      flush();
    }
  }

  const total = capture.events.length;
  check(`事件數 ≥ 5000（實際 ${total}）`, total >= 5000);

  const t0 = performance.now();
  const index = buildReplayIndex(capture.events);
  const buildMs = performance.now() - t0;

  eq("終態仍逐字相同", finalText(index), capture.text);
  eq("整段重演零失敗", index.issues.length, 0);

  // 任意跳轉：隨機 200 個位置，量最慢的一次。
  const positions: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    positions.push(Math.floor(((i * 7919) % 1000) / 1000 * total));
  }

  let worst = 0;
  let sum = 0;
  for (const p of positions) {
    const s = performance.now();
    textAt(index, p);
    const d = performance.now() - s;
    if (d > worst) worst = d;
    sum += d;
  }

  console.log(
    `${DIM}    建索引 ${buildMs.toFixed(0)}ms／檢查點 ${index.checkpoints.length} 個／stride ${index.stride}${OFF}`,
  );
  console.log(
    `${DIM}    200 次跳轉：最慢 ${worst.toFixed(1)}ms，平均 ${(sum / positions.length).toFixed(1)}ms${OFF}`,
  );

  check(`最慢一次跳轉 < 1000ms（實際 ${worst.toFixed(1)}ms）`, worst < 1000);
  check(`建索引 < 5000ms（實際 ${buildMs.toFixed(0)}ms）`, buildMs < 5000);

  // 跳轉結果必須與從頭重演一致，不能為了快而算錯。
  const spotChecks = [1, 137, 1500, total - 1, total];
  const mismatches = spotChecks.filter((p) => {
    const viaIndex = textAt(index, p);
    const viaReplay = replay(capture.events.slice(0, p)).text;
    return viaIndex !== viaReplay;
  });
  eq("跳轉結果與從頭重演一致", mismatches, []);
}

// ══ 4. 時間軸分色 ═══════════════════════════════════════════════════════
console.log("\n【4】時間軸分色");

{
  const started = "2026-08-09T09:00:00.000Z";
  const events: ReplayEvent[] = [
    { client_seq: 1, type: "chat_send", payload: {}, ts: "2026-08-09T09:00:10.000Z" },
    { client_seq: 2, type: "copy", payload: {}, ts: "2026-08-09T09:00:20.000Z" },
    { client_seq: 3, type: "paste", payload: {}, ts: "2026-08-09T09:00:25.000Z" },
    { client_seq: 4, type: "keystroke_batch", payload: {}, ts: "2026-08-09T09:01:00.000Z" },
    { client_seq: 5, type: "delete_block", payload: {}, ts: "2026-08-09T09:02:00.000Z" },
    { client_seq: 6, type: "idle", payload: { ms: 40_000 }, ts: "2026-08-09T09:03:00.000Z" },
    { client_seq: 7, type: "focus_switch", payload: {}, ts: "2026-08-09T09:03:10.000Z" },
  ];
  const timeline = buildTimeline(events, started);

  eq(
    "紅=提問、黃=複製、藍=輸入、灰=停頓",
    timeline.map((t) => t.color),
    ["red", "yellow", "yellow", "blue", "blue", "gray", "neutral"],
  );
  eq("距開始的毫秒數", timeline[0]?.offsetMs, 10_000);
  eq("時間軸長度 === 事件數", timeline.length, events.length);
}

// ══ 5. 學生簡化版的節點數 ═══════════════════════════════════════════════
console.log("\n【5】簡化版關鍵節點");

{
  const events: ReplayEvent[] = [
    { client_seq: 1, type: "keystroke_batch", payload: {}, ts: "2026-08-09T09:00:00.000Z" },
    { client_seq: 2, type: "paste", payload: { origin: "ai", length: 48 }, ts: "2026-08-09T09:01:00.000Z" },
    { client_seq: 3, type: "chat_send", payload: {}, ts: "2026-08-09T09:02:00.000Z" },
    { client_seq: 4, type: "copy", payload: {}, ts: "2026-08-09T09:02:30.000Z" },
    { client_seq: 5, type: "delete_block", payload: { removed_chars: 120 }, ts: "2026-08-09T09:03:00.000Z" },
    // 剛好等於門檻 → 不算（門檻是「超過 2 分鐘」）
    { client_seq: 6, type: "idle", payload: { ms: KEY_MOMENT_IDLE_MS }, ts: "2026-08-09T09:04:00.000Z" },
    // 超過門檻 → 算
    { client_seq: 7, type: "idle", payload: { ms: KEY_MOMENT_IDLE_MS + 1000 }, ts: "2026-08-09T09:05:00.000Z" },
    // 短停頓 → 不算
    { client_seq: 8, type: "idle", payload: { ms: 35_000 }, ts: "2026-08-09T09:06:00.000Z" },
    { client_seq: 9, type: "paste", payload: { origin: "external", length: 12 }, ts: "2026-08-09T09:07:00.000Z" },
    // 在自己的文章裡搬動段落 → 不是「從外面拿東西進來」，不入列
    { client_seq: 10, type: "paste", payload: { origin: "internal", length: 30 }, ts: "2026-08-09T09:08:00.000Z" },
  ];

  const moments = keyMoments(events);
  eq("節點數＝貼上2＋大段刪除1＋長停頓1", moments.length, 4);
  check(
    "內部搬動的貼上不入列",
    moments.every((m) => m.clientSeq !== 10),
    JSON.stringify(moments.map((m) => m.clientSeq)),
  );
  eq(
    "節點種類",
    moments.map((m) => m.kind),
    ["paste", "delete_block", "long_idle", "paste"],
  );
  eq(
    "指到正確的事件",
    moments.map((m) => m.clientSeq),
    [2, 5, 7, 9],
  );
  eq("AI 來源的貼上文案不同於外部", moments[0]?.headline, "你把 AI 寫的一段貼進文章");
  eq("外部來源的貼上文案", moments[3]?.headline, "你從別的地方貼了一段進來");
  eq("停頓分鐘數四捨五入", moments[2]?.detail, "這裡停了大約 2 分鐘");

  // 對話與複製本身不是關鍵節點：學生看的是「文章發生了什麼事」，
  // 問了幾次 AI 是研究者的分析，不是給學生自我觀察的材料。
  check(
    "chat_send / copy 不入列",
    moments.every((m) => m.kind !== ("chat_send" as string) && m.kind !== ("copy" as string)),
  );

  // 節點的 index 必須能直接餵給 textAt，且拿到的是「那件事發生之後」的文稿
  const index = buildReplayIndex(events);
  const withinRange = moments.every((m) => m.index >= 1 && m.index <= index.events.length);
  check("節點的 index 落在可跳轉範圍內", withinRange);
}

// 空歷程
{
  eq("沒有事件 → 沒有節點", keyMoments([]).length, 0);
  const index = buildReplayIndex([]);
  eq("沒有事件 → 終稿為空", finalText(index), "");
}

// ── 結果 ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(
  `${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`,
);
if (failed > 0) process.exit(1);
console.log(`${GREEN}STEP 7 驗收通過。${OFF}`);
