/**
 * Provenance（來源歸屬）的資料模型與純函式。
 *
 * 這個檔案**刻意不 import 任何 Tiptap／React**：STEP 8 的 DNA 歸因要在伺服器端
 * 讀 snapshots.doc（純 JSON）算三色，不該為此把編輯器整包拉進 Node。
 * Tiptap 的 Mark 定義在 lib/editor/marks.ts。
 *
 * 【三種來源，對應 CLAUDE.md §4.3 的三色】
 *   aiOrigin       貼上的內容命中了「學生稍早從 Chat 複製走」的紀錄 → 之後依相似度分藍/綠
 *   externalOrigin 貼上但沒命中（來自 Google、Word、同學的訊息…）→ 系統外部
 *   無 mark        手打 → 橘（你自己寫的）
 */

export const AI_ORIGIN_MARK = "aiOrigin";
export const EXTERNAL_ORIGIN_MARK = "externalOrigin";

/**
 * copyEventId 存的是那筆 copy 事件的 **client_seq**，不是資料庫的 bigint id。
 *
 * 用戶端根本拿不到 DB id（事件是批次非同步送出的，回應也不帶 id），而
 * (session_id, client_seq) 本來就是事件的唯一鍵——用它 join 一樣精確，
 * 而且離線時就能決定，不必等伺服器回話。
 */
export type AiOriginAttrs = {
  copyEventId: number | null;
  messageId: string | null;
  srcStart: number | null;
  srcEnd: number | null;
};

/**
 * 外部來源不記 id 只記指紋：對應的 paste 事件 payload 也帶同一個 sha1，
 * 兩邊靠指紋 join。內容本身不入庫（可能是整篇文章，而且可能含 PII）。
 */
export type ExternalOriginAttrs = {
  sha1: string | null;
  length: number | null;
};

export type ProvenanceRun =
  | { kind: "ai"; start: number; end: number; attrs: AiOriginAttrs }
  | { kind: "external"; start: number; end: number; attrs: ExternalOriginAttrs };

type JsonMark = { type?: unknown; attrs?: unknown };
type JsonNode = { type?: unknown; text?: unknown; marks?: unknown; content?: unknown };

/**
 * Tiptap 的 getText 只把 text 節點串起來，其餘 block 節點之間插入分隔字串。
 * 這裡只需要知道「誰是 inline」，其餘一律當 block——與 ProseMirror 的
 * node.isBlock 在 StarterKit 的節點集合下等價。
 */
const INLINE_TYPES = new Set(["text", "hardBreak"]);

/** 與 Tiptap `editor.getText()` 的預設值一致。改這個會讓歷次資料的位移對不上。 */
export const BLOCK_SEPARATOR = "\n\n";

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function provenanceOf(
  marks: unknown,
): { kind: "ai"; attrs: AiOriginAttrs } | { kind: "external"; attrs: ExternalOriginAttrs } | null {
  if (!Array.isArray(marks)) return null;
  for (const raw of marks as JsonMark[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const attrs = (typeof raw.attrs === "object" && raw.attrs !== null
      ? raw.attrs
      : {}) as Record<string, unknown>;

    if (raw.type === AI_ORIGIN_MARK) {
      return {
        kind: "ai",
        attrs: {
          copyEventId: num(attrs.copyEventId),
          messageId: str(attrs.messageId),
          srcStart: num(attrs.srcStart),
          srcEnd: num(attrs.srcEnd),
        },
      };
    }
    if (raw.type === EXTERNAL_ORIGIN_MARK) {
      return {
        kind: "external",
        attrs: { sha1: str(attrs.sha1), length: num(attrs.length) },
      };
    }
  }
  return null;
}

function sameAttrs(a: ProvenanceRun, b: ProvenanceRun): boolean {
  if (a.kind !== b.kind) return false;
  return JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
}

/**
 * 走訪 Tiptap JSON 文件，同時產出純文字與帶位移的來源區段。
 *
 * 位移必須與 `editor.getText()` 完全一致——STEP 8 的 DNA 條碼、STEP 9 學生看到的
 * 「這一段是誰寫的」都用這組位移去切最終稿。差一個字元，條碼就對錯段落。
 * scripts/verify-step6.ts 會拿真的 Tiptap getText 逐字比對驗證這件事。
 */
export function walkDoc(
  doc: unknown,
  blockSeparator: string = BLOCK_SEPARATOR,
): { text: string; runs: ProvenanceRun[] } {
  let text = "";
  let firstVisited = true;
  const runs: ProvenanceRun[] = [];

  const visit = (node: JsonNode): void => {
    const type = typeof node.type === "string" ? node.type : "";
    if (!INLINE_TYPES.has(type) && !firstVisited) text += blockSeparator;
    firstVisited = false;

    if (type === "text" && typeof node.text === "string") {
      const start = text.length;
      text += node.text;
      const found = provenanceOf(node.marks);
      if (found) {
        const run = { ...found, start, end: text.length } as ProvenanceRun;
        // ProseMirror 會把「相鄰且 mark 完全相同」的文字併成一個 text 節點，
        // 但被 bold 之類的其他 mark 切開時不會。這裡再合一次，讓一次貼上
        // 在同一段落內永遠只算一個區段。
        const previous = runs[runs.length - 1];
        if (previous && previous.end === run.start && sameAttrs(previous, run)) {
          previous.end = run.end;
        } else {
          runs.push(run);
        }
      }
      return;
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content as JsonNode[]) {
        if (typeof child === "object" && child !== null) visit(child);
      }
    }
  };

  const top = doc as JsonNode;
  if (Array.isArray(top?.content)) {
    for (const child of top.content as JsonNode[]) {
      if (typeof child === "object" && child !== null) visit(child);
    }
  }

  return { text, runs };
}

export function extractProvenanceRuns(
  doc: unknown,
  blockSeparator: string = BLOCK_SEPARATOR,
): ProvenanceRun[] {
  return walkDoc(doc, blockSeparator).runs;
}

export function docPlainText(
  doc: unknown,
  blockSeparator: string = BLOCK_SEPARATOR,
): string {
  return walkDoc(doc, blockSeparator).text;
}
