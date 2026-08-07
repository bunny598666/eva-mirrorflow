/**
 * Provenance Marks（STEP 6）：兩個 Tiptap 自訂 mark。
 *
 *   aiOrigin{copyEventId,messageId,srcStart,srcEnd}  貼上內容命中 Chat 複製紀錄
 *   externalOrigin{sha1,length}                      貼上但未命中（系統外部）
 *   手打不掛 mark
 *
 * 【三個關鍵設定，改動前請先看理由】
 *
 * 1. `inclusive: false`
 *    ProseMirror 預設 mark 是「延伸性」的：游標停在標記文字尾端繼續打字，
 *    新字會自動繼承那個 mark。對一般的粗體那是對的，對來源歸屬是災難——
 *    學生貼了一句 AI 的話，接著自己往下寫兩百字，那兩百字會全部被算成 AI 寫的，
 *    整份 DNA 條碼直接失真。關掉它，邊界外的輸入一律不繼承。
 *
 * 2. `keepOnSplit: true`（預設值，這裡明寫出來以免日後被誤改）
 *    學生在貼上的段落中間按 Enter 切成兩段時，兩段都要留著 mark。
 *    這就是驗收條件「編輯拆分後 mark 隨區段分裂」。
 *
 * 3. **不上任何視覺樣式**
 *    本研究的介入是「交件後回看歷程」（CLAUDE.md §4.4），不是即時上色。
 *    如果寫作當下就把 AI 來源標成藍色，學生會邊寫邊調整以求好看，
 *    那是另一種介入，會污染研究設計。marks 在寫作頁必須完全隱形，
 *    只以 data-* 屬性存在於 DOM 與 JSON 裡。
 */
import { Mark, mergeAttributes } from "@tiptap/core";
import { Fragment, Slice, type Mark as PMMark, type Schema } from "@tiptap/pm/model";
import {
  AI_ORIGIN_MARK,
  EXTERNAL_ORIGIN_MARK,
  type AiOriginAttrs,
  type ExternalOriginAttrs,
} from "./provenance.ts";

/** 兩個 mark 互斥：一段文字不可能同時「來自 AI」又「來自外部」。 */
const EXCLUSIVE = `${AI_ORIGIN_MARK} ${EXTERNAL_ORIGIN_MARK}`;

function numberAttr(dataName: string) {
  return {
    default: null as number | null,
    parseHTML: (element: HTMLElement): number | null => {
      const raw = element.getAttribute(dataName);
      if (raw === null) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    },
    renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
      const key = dataName.replace(/^data-mf-/, "");
      const value = attributes[toCamel(key)];
      return typeof value === "number" ? { [dataName]: String(value) } : {};
    },
  };
}

function stringAttr(dataName: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement): string | null => element.getAttribute(dataName),
    renderHTML: (attributes: Record<string, unknown>): Record<string, string> => {
      const key = dataName.replace(/^data-mf-/, "");
      const value = attributes[toCamel(key)];
      return typeof value === "string" && value ? { [dataName]: value } : {};
    },
  };
}

function toCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export const AiOrigin = Mark.create({
  name: AI_ORIGIN_MARK,
  inclusive: false,
  keepOnSplit: true,
  excludes: EXCLUSIVE,

  addAttributes() {
    return {
      copyEventId: numberAttr("data-mf-copy-event-id"),
      messageId: stringAttr("data-mf-message-id"),
      srcStart: numberAttr("data-mf-src-start"),
      srcEnd: numberAttr("data-mf-src-end"),
    };
  },

  parseHTML() {
    return [{ tag: `span[data-mf-origin="ai"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-mf-origin": "ai" }), 0];
  },
});

export const ExternalOrigin = Mark.create({
  name: EXTERNAL_ORIGIN_MARK,
  inclusive: false,
  keepOnSplit: true,
  excludes: EXCLUSIVE,

  addAttributes() {
    return {
      sha1: stringAttr("data-mf-sha1"),
      length: numberAttr("data-mf-length"),
    };
  },

  parseHTML() {
    return [{ tag: `span[data-mf-origin="external"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-mf-origin": "external" }), 0];
  },
});

export const PROVENANCE_EXTENSIONS = [AiOrigin, ExternalOrigin];

/** 依 schema 建出要掛的 mark。schema 裡沒有這個 mark 就回 null（不該發生，防呆）。 */
export function createProvenanceMark(
  schema: Schema,
  origin:
    | { kind: "ai"; attrs: AiOriginAttrs }
    | { kind: "external"; attrs: ExternalOriginAttrs },
): PMMark | null {
  const type = schema.marks[origin.kind === "ai" ? AI_ORIGIN_MARK : EXTERNAL_ORIGIN_MARK];
  return type ? type.create({ ...origin.attrs }) : null;
}

/**
 * 把一段純文字包成帶 mark 的 Slice。
 *
 * 單行走 inline slice（openStart/openEnd = 0），才不會把當前段落切開——
 * 學生在句子中間貼一個詞，段落不該裂成兩段。
 * 多行走 block slice（openStart/openEnd = 1），讓首尾與現有內容自然接起來。
 */
export function provenanceSlice(schema: Schema, text: string, mark: PMMark): Slice {
  const lines = text.split(/\r\n|\r|\n/);

  if (lines.length === 1) {
    const only = lines[0] ?? "";
    if (!only) return Slice.empty;
    return new Slice(Fragment.from(schema.text(only, [mark])), 0, 0);
  }

  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return Slice.empty;

  const nodes = lines.map((line) =>
    // schema.text("") 會丟例外，空行要建成沒有內容的段落。
    paragraph.create(null, line ? schema.text(line, [mark]) : null),
  );
  return new Slice(Fragment.fromArray(nodes), 1, 1);
}
