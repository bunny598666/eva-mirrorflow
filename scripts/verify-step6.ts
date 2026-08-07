/**
 * verify-step6.ts —— Provenance Marks 驗收
 *
 * BUILD_PLAN §6 STEP 6 驗收：「貼上區段 mark attrs 正確；編輯拆分後 mark 隨區段分裂。」
 *
 * 這支腳本不需要資料庫、不需要瀏覽器、不需要 AI：它用真正的 ProseMirror schema
 * （由 StarterKit + 我們的兩個 mark 建出來）跑 lib/editor/paste.ts 的決策函式，
 * 再對產出的文件狀態下斷言。跑的是正式程式碼本身，不是複製品。
 *
 *   npm run verify:step6
 *
 * 為什麼要驗到這種程度：來源歸屬錯一次，那份文稿的 DNA 就永久錯了——
 * events 是 append-only，事後補不回來，而三期資料是不可重來的課堂現場。
 */
import { createHash } from "node:crypto";
import { getSchema, getText, getTextSerializersFromSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

import { sha1Hex } from "../lib/editor/sha1.ts";
import { PROVENANCE_EXTENSIONS } from "../lib/editor/marks.ts";
import { decidePaste } from "../lib/editor/paste.ts";
import {
  fingerprint,
  normalizeClipboardText,
  rememberCopySource,
  resetCopySources,
} from "../lib/editor/clipboard.ts";
import {
  AI_ORIGIN_MARK,
  BLOCK_SEPARATOR,
  docPlainText,
  extractProvenanceRuns,
  type ProvenanceRun,
} from "../lib/editor/provenance.ts";

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

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

// ── 環境 ────────────────────────────────────────────────────────────────
const schema = getSchema([StarterKit, ...PROVENANCE_EXTENSIONS]);
const serializers = getTextSerializersFromSchema(schema);

function tiptapText(doc: PMNode): string {
  return getText(doc, { blockSeparator: BLOCK_SEPARATOR, textSerializers: serializers });
}

function stateWith(...paragraphs: string[]): EditorState {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      ...(p ? { content: [{ type: "text", text: p }] } : {}),
    })),
  });
  return EditorState.create({ schema, doc });
}

function caretAt(state: EditorState, pos: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

type PasteResult = { state: EditorState; payload: Record<string, unknown>; handled: boolean };

function paste(state: EditorState, plain: string, html = ""): PasteResult {
  const outcome = decidePaste(state, plain, html);
  if (!outcome) throw new Error("decidePaste 回了 null（不該發生）");
  return {
    state: outcome.handled && outcome.tr ? state.apply(outcome.tr) : state,
    payload: outcome.payload,
    handled: outcome.handled,
  };
}

function runs(state: EditorState): ProvenanceRun[] {
  return extractProvenanceRuns(state.doc.toJSON());
}

/** 在游標位置打字，模擬學生手打（不帶任何 stored mark 以外的東西）。 */
function type(state: EditorState, pos: number, text: string): EditorState {
  const placed = caretAt(state, pos);
  return placed.apply(placed.tr.insertText(text));
}

const SESSION = "verify-step6";

// ══ 1. sha1 ═════════════════════════════════════════════════════════════
console.log("\n【1】sha1 指紋");

eq("空字串", sha1Hex(""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
eq("abc", sha1Hex("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
eq(
  "The quick brown fox…",
  sha1Hex("The quick brown fox jumps over the lazy dog"),
  "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
);

// 中文與長字串交叉比對 node:crypto。學生寫的是繁中，UTF-8 多位元組路徑必須對。
const chinese = "秋天的操場上，落葉像一場慢慢下的雨。";
eq(
  "繁中（對照 node:crypto）",
  sha1Hex(chinese),
  createHash("sha1").update(chinese, "utf8").digest("hex"),
);
const long = chinese.repeat(200);
eq(
  "長字串跨 block 邊界（對照 node:crypto）",
  sha1Hex(long),
  createHash("sha1").update(long, "utf8").digest("hex"),
);

// ══ 2. 換行正規化 ═══════════════════════════════════════════════════════
console.log("\n【2】換行正規化（Windows 剪貼簿）");

eq("CRLF → LF", normalizeClipboardText("一\r\n二\r三"), "一\n二\n三");
check(
  "CRLF 與 LF 的指紋相同",
  fingerprint("一\r\n二") === fingerprint("一\n二"),
  "不同的話，多行 AI 回覆貼進來永遠對不上來源",
);

// ══ 3. 貼上：未命中 → externalOrigin ════════════════════════════════════
console.log("\n【3】貼上未命中 → externalOrigin");

resetCopySources();
{
  const outside = "這段是從網路上抄來的句子。";
  const result = paste(stateWith(""), outside);
  const list = runs(result.state);

  check("產生一個區段", list.length === 1);
  eq("kind", list[0]?.kind, "external");
  eq("sha1 attr", list[0]?.attrs, {
    sha1: fingerprint(outside),
    length: outside.length,
  });
  eq("涵蓋範圍", [list[0]?.start, list[0]?.end], [0, outside.length]);
  eq("事件 origin", result.payload.origin, "external");
  eq("事件 matched", result.payload.matched, false);
}

// ══ 4. 貼上：命中 → aiOrigin，attrs 完整 ════════════════════════════════
console.log("\n【4】貼上命中 Chat 複製紀錄 → aiOrigin");

const AI_TEXT = "你可以先描述那天的天氣，再寫出你當下的心情。";
const AI_SOURCE = {
  sha1: fingerprint(AI_TEXT),
  length: AI_TEXT.length,
  copyEventId: 42,
  messageId: "8f0a5d1e-0000-4000-8000-000000000001",
  srcStart: 17,
  srcEnd: 17 + AI_TEXT.length,
};

resetCopySources();
rememberCopySource(SESSION, AI_SOURCE);

{
  const result = paste(stateWith(""), AI_TEXT);
  const list = runs(result.state);

  check("產生一個區段", list.length === 1);
  eq("kind", list[0]?.kind, "ai");
  eq("mark attrs（四欄全對）", list[0]?.attrs, {
    copyEventId: 42,
    messageId: "8f0a5d1e-0000-4000-8000-000000000001",
    srcStart: 17,
    srcEnd: 17 + AI_TEXT.length,
  });
  eq("事件 origin", result.payload.origin, "ai");
  eq("事件 copy_event_id", result.payload.copy_event_id, 42);
  eq("事件 message_id", result.payload.message_id, AI_SOURCE.messageId);
  eq(
    "事件 src 範圍",
    [result.payload.src_start, result.payload.src_end],
    [17, 17 + AI_TEXT.length],
  );
}

// 剪貼簿換成 CRLF 也要命中（Windows 平板的真實情況）。
{
  const multi = "第一句。\n第二句。";
  resetCopySources();
  rememberCopySource(SESSION, {
    sha1: fingerprint(multi),
    length: multi.length,
    copyEventId: 7,
    messageId: "m-2",
    srcStart: 0,
    srcEnd: multi.length,
  });
  const result = paste(stateWith(""), "第一句。\r\n第二句。");
  eq("CRLF 貼上仍命中", result.payload.origin, "ai");
}

// ══ 5. 內部搬動不誤標 ═══════════════════════════════════════════════════
console.log("\n【5】從編輯器內部複製再貼回（學生搬自己的段落）");

{
  const result = paste(
    stateWith("我自己寫的第一段。"),
    "我自己寫的第一段。",
    '<div data-pm-slice="1 1 []"><p>我自己寫的第一段。</p></div>',
  );
  check("交回 ProseMirror 預設處理", result.handled === false);
  eq("事件 origin", result.payload.origin, "internal");
  eq("沒有被掛上任何來源標記", runs(result.state).length, 0);
}

// ══ 6. inclusive:false —— 邊界外的手打不繼承 ════════════════════════════
console.log("\n【6】貼上前後接著手打（最容易毀掉 DNA 的一關）");

resetCopySources();
rememberCopySource(SESSION, AI_SOURCE);

{
  const pasted = paste(stateWith(""), AI_TEXT).state;
  const mine = "然後我自己接著往下寫了好長一段。";

  // 尾端接著打
  const after = type(pasted, pasted.doc.content.size - 1, mine);
  const afterRuns = runs(after);
  check("尾端續打：仍只有一個區段", afterRuns.length === 1);
  eq("尾端續打：AI 區段沒有被撐大", afterRuns[0]?.end, AI_TEXT.length);
  eq("尾端續打：全文長度", docPlainText(after.doc.toJSON()).length, AI_TEXT.length + mine.length);

  // 開頭前面打
  const before = type(pasted, 1, mine);
  const beforeRuns = runs(before);
  check("開頭前插入：仍只有一個區段", beforeRuns.length === 1);
  eq("開頭前插入：AI 區段整段後移", [beforeRuns[0]?.start, beforeRuns[0]?.end], [
    mine.length,
    mine.length + AI_TEXT.length,
  ]);
}

// ══ 7. 區段中間被改動 ═══════════════════════════════════════════════════
console.log("\n【7】改動 AI 區段內部");

{
  const pasted = paste(stateWith(""), AI_TEXT).state;

  // 中間插字：仍算 AI 來源區段（之後由 STEP 8 的相似度判成「綠：改過」）
  const edited = type(pasted, 6, "秋天");
  const editedRuns = runs(edited);
  check("中間插字：區段不斷開", editedRuns.length === 1);
  eq("中間插字：區段跟著變長", editedRuns[0]?.end, AI_TEXT.length + 2);

  // 中間刪一段：兩側殘留仍帶著同一組 attrs
  const cut = pasted.apply(pasted.tr.delete(6, 12));
  const cutRuns = runs(cut);
  check("中間刪除：區段仍在", cutRuns.length === 1);
  eq("中間刪除：長度扣掉刪除量", cutRuns[0]?.end, AI_TEXT.length - 6);
  eq("中間刪除：attrs 不變", cutRuns[0]?.attrs, {
    copyEventId: 42,
    messageId: AI_SOURCE.messageId,
    srcStart: 17,
    srcEnd: 17 + AI_TEXT.length,
  });
}

// ══ 8. 拆分：mark 隨區段分裂 ════════════════════════════════════════════
console.log("\n【8】按 Enter 把貼上的段落切成兩段（驗收條件後半）");

{
  const pasted = paste(stateWith(""), AI_TEXT).state;
  const splitAt = 1 + 10; // 段落內第 10 個字之後
  const split = pasted.apply(pasted.tr.split(splitAt));
  const splitRuns = runs(split);

  eq("切成兩段", split.doc.childCount, 2);
  check("兩段各自帶著來源標記", splitRuns.length === 2);
  eq(
    "兩段的 attrs 完全相同",
    splitRuns.map((r) => r.attrs),
    [
      {
        copyEventId: 42,
        messageId: AI_SOURCE.messageId,
        srcStart: 17,
        srcEnd: 17 + AI_TEXT.length,
      },
      {
        copyEventId: 42,
        messageId: AI_SOURCE.messageId,
        srcStart: 17,
        srcEnd: 17 + AI_TEXT.length,
      },
    ],
  );
  eq("第一段涵蓋前 10 字", [splitRuns[0]?.start, splitRuns[0]?.end], [0, 10]);
  eq(
    "第二段從分隔符之後接續",
    [splitRuns[1]?.start, splitRuns[1]?.end],
    [10 + BLOCK_SEPARATOR.length, 10 + BLOCK_SEPARATOR.length + (AI_TEXT.length - 10)],
  );
}

// ══ 9. 多次貼上與互斥 ═══════════════════════════════════════════════════
console.log("\n【9】多次貼上、兩種來源互斥");

{
  resetCopySources();
  rememberCopySource(SESSION, AI_SOURCE);
  const other = "另一段從瀏覽器抄來的文字。";

  let state = stateWith("");
  state = paste(state, AI_TEXT).state;
  state = caretAt(state, state.doc.content.size - 1);
  state = state.apply(state.tr.insertText("我自己寫的中間段。"));
  state = caretAt(state, state.doc.content.size - 1);
  state = paste(state, other).state;

  const list = runs(state);
  eq("三段文字產生兩個來源區段", list.length, 2);
  eq("第一個是 AI", list[0]?.kind, "ai");
  eq("第二個是外部", list[1]?.kind, "external");
  check(
    "中間手打那段沒有被任何區段涵蓋",
    (list[0]?.end ?? 0) < (list[1]?.start ?? 0),
    `區段：${JSON.stringify(list.map((r) => [r.start, r.end]))}`,
  );

  // 互斥：把外部內容貼在既有 AI 區段上，不該兩個 mark 同時存在
  const overlaid = paste(caretAt(state, 3), other).state;
  const textNodes: string[][] = [];
  overlaid.doc.descendants((node) => {
    if (node.isText) textNodes.push(node.marks.map((m) => m.type.name));
  });
  check(
    "沒有任何文字同時帶兩種來源標記",
    textNodes.every((m) => !(m.includes(AI_ORIGIN_MARK) && m.includes("externalOrigin"))),
    JSON.stringify(textNodes),
  );
}

// ══ 10. 多行貼上 ════════════════════════════════════════════════════════
console.log("\n【10】多行貼上");

{
  resetCopySources();
  const multi = "第一段內容。\n第二段內容。\n第三段內容。";
  const result = paste(stateWith(""), multi);
  const list = runs(result.state);

  eq("切成三個段落", result.state.doc.childCount, 3);
  eq("三個區段", list.length, 3);
  check(
    "每一段都帶外部來源標記",
    list.every((r) => r.kind === "external"),
  );
  eq("事件記下行數", result.payload.lines, 3);
}

// 單行貼在句子中間不該把段落切開
{
  resetCopySources();
  const state = caretAt(stateWith("開頭結尾"), 3);
  const result = paste(state, "中間插入的字");
  eq("單行貼上：段落數不變", result.state.doc.childCount, 1);
  eq(
    "單行貼上：文字接得起來",
    docPlainText(result.state.doc.toJSON()),
    "開頭中間插入的字結尾",
  );
}

// ══ 11. 位移必須與 Tiptap getText 完全一致 ══════════════════════════════
console.log("\n【11】位移與 editor.getText() 對齊");

{
  resetCopySources();
  rememberCopySource(SESSION, AI_SOURCE);

  let state = stateWith("第一段自己寫的。", "");
  state = caretAt(state, state.doc.content.size - 1);
  state = paste(state, AI_TEXT).state;
  state = state.apply(state.tr.split(state.doc.content.size - 1));
  state = caretAt(state, state.doc.content.size - 1);
  state = state.apply(state.tr.insertText("最後一段收尾。"));

  const json = state.doc.toJSON();
  eq("docPlainText === Tiptap getText", docPlainText(json), tiptapText(state.doc));

  const text = tiptapText(state.doc);
  const list = extractProvenanceRuns(json);
  check(
    "每個區段的位移都切得出原文",
    list.every((r) => AI_TEXT.includes(text.slice(r.start, r.end))),
    `切出來：${JSON.stringify(list.map((r) => text.slice(r.start, r.end)))}`,
  );
}

// 標題與清單也要對齊（學生會用到，而巢狀 block 的分隔符行為最容易寫錯）
{
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "標題" }] },
      { type: "paragraph", content: [{ type: "text", text: "一段文字" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "項目一" }] }],
          },
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "項目二" }] }],
          },
        ],
      },
    ],
  });
  eq("標題／清單文件也對齊", docPlainText(doc.toJSON()), tiptapText(doc));
}

// ══ 12. JSON 往返（localStorage 暫存稿、STEP 7 快照） ═══════════════════
console.log("\n【12】JSON 往返後 attrs 不掉");

{
  resetCopySources();
  rememberCopySource(SESSION, AI_SOURCE);
  const original = paste(stateWith(""), AI_TEXT).state;

  const json = original.doc.toJSON();
  const restored = schema.nodeFromJSON(JSON.parse(JSON.stringify(json)) as object);

  eq("往返後區段完全相同", extractProvenanceRuns(restored.toJSON()), extractProvenanceRuns(json));

  const back = extractProvenanceRuns(restored.toJSON())[0];
  eq("往返後 copyEventId 仍是數字", back?.kind === "ai" ? back.attrs.copyEventId : null, 42);
}

// ── 結果 ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`${passed + failed} 項檢查：${GREEN}${passed} 通過${OFF}，${failed > 0 ? RED : ""}${failed} 失敗${OFF}`);
if (failed > 0) process.exit(1);
console.log(`${GREEN}STEP 6 驗收通過。${OFF}`);
