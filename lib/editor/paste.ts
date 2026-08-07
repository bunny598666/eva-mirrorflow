/**
 * 貼上攔截的決策核心（STEP 6）。
 *
 * 刻意抽成純函式而不是寫死在 EditorPane 裡：貼上判定是 DNA 三色歸因的地基，
 * 判錯一次，那份文稿的來源歸屬就永久錯了（events 是 append-only，事後改不掉）。
 * 抽出來才驗得到——scripts/verify-step6.ts 用真的 ProseMirror schema 跑這支函式，
 * 不必開瀏覽器。
 *
 * 這裡不碰 IndexedDB、不送事件、不 dispatch，只回答一件事：
 * 「這次貼上要掛什麼 mark、要記什麼事件。」
 */
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { createProvenanceMark, provenanceSlice } from "./marks.ts";
import { fingerprint, lookupCopySource, normalizeClipboardText } from "./clipboard.ts";

export type PasteOutcome = {
  /** true = 我們自己插入了內容，呼叫端要 dispatch 並回 true 給 ProseMirror。 */
  handled: boolean;
  /** handled 為 true 時必定有值。 */
  tr: Transaction | null;
  /** 要寫進 events 的 payload（type = 'paste'）。 */
  payload: Record<string, unknown>;
};

/**
 * ProseMirror 自己的剪貼簿 HTML 會帶 data-pm-slice。看到它就代表這段是從
 * 本編輯器內部複製出去的——學生在搬自己的段落。那種情況交回 ProseMirror 預設
 * 處理：它會連同原有的 marks 一起貼回來，既不會把學生自己寫的誤標成外部，
 * 也不會把既有的 AI 來源標記洗掉。
 */
function isInternalPaste(html: string): boolean {
  return html.includes("data-pm-slice");
}

export function decidePaste(
  state: EditorState,
  plainText: string,
  html: string,
): PasteOutcome | null {
  const text = normalizeClipboardText(plainText);
  // 圖片等非文字內容：回 null，呼叫端交回預設處理。
  if (!text) return null;

  const sha1 = fingerprint(text);

  if (isInternalPaste(html)) {
    return {
      handled: false,
      tr: null,
      payload: { origin: "internal", sha1, length: text.length },
    };
  }

  const source = lookupCopySource(sha1);
  const mark = createProvenanceMark(
    state.schema,
    source
      ? {
          kind: "ai",
          attrs: {
            copyEventId: source.copyEventId,
            messageId: source.messageId,
            srcStart: source.srcStart,
            srcEnd: source.srcEnd,
          },
        }
      : { kind: "external", attrs: { sha1, length: text.length } },
  );
  if (!mark) return null;

  const slice = provenanceSlice(state.schema, text, mark);
  if (slice.size === 0) return null;

  // setStoredMarks([])：貼完之後接著打的字不繼承來源標記。
  // marks.ts 的 inclusive:false 已經擋掉大部分情況，這裡是第二道保險。
  const tr = state.tr.replaceSelection(slice).setStoredMarks([]).scrollIntoView();

  return {
    handled: true,
    tr,
    payload: {
      origin: source ? "ai" : "external",
      matched: Boolean(source),
      sha1,
      length: text.length,
      lines: text.split("\n").length,
      copy_event_id: source?.copyEventId ?? null,
      message_id: source?.messageId ?? null,
      src_start: source?.srcStart ?? null,
      src_end: source?.srcEnd ?? null,
    },
  };
}
