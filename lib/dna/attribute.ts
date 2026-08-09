/**
 * DNA 三色歸因（STEP 8）。純函式——輸入最終文稿與 AI 原文，輸出三色區段。
 *
 * 【三色的意思】（CLAUDE.md §4.3，學生端文案）
 *   藍 = AI 寫的、你沒改      相似度 >= θ_high
 *   綠 = AI 寫的、你改過      θ_low <= 相似度 < θ_high
 *   橘 = 你自己寫的           沒有來源標記，或改到幾乎看不出原樣（相似度 < θ_low）
 *
 * 【θ 一律讀環境變數】CLAUDE.md §7 禁止寫死。門檻是研究參數，三期凍結；
 * 寫死在程式碼裡等於把研究設計藏進 diff 裡。
 *
 * 【外部貼上怎麼算】
 * 三色是給 13 歲學生看的，不能再多一色。從 Google／Word 貼進來的東西不是
 * AI 寫的，所以歸橘——但那顯然也不是「你自己寫的」。因此區段另外記下
 * origin（ai / external / typed）：學生只看到三色，研究者能把 external
 * 拆出來單獨分析。這個取捨要寫進論文的操作型定義。
 */
import { similarityAtLeast } from "./similarity.ts";
import { extractProvenanceRuns, walkDoc, type ProvenanceRun } from "../editor/provenance.ts";

/** 藍 = AI 寫的你沒改；綠 = AI 寫的你改過；橘 = 你自己寫的。 */
export type DnaColor = "blue" | "green" | "orange";

/** 這段文字是怎麼進到文稿裡的。三色的下一層，只有研究者端會用到。 */
export type SegmentOrigin = "ai" | "external" | "typed";

export type DnaSegment = {
  start: number;
  end: number;
  color: DnaColor;
  origin: SegmentOrigin;
  /** 只有 origin='ai' 才有值：與 AI 原文的相似度。 */
  similarity: number | null;
  /** 只有 origin='ai' 才有值：被複製的那則訊息。 */
  messageId: string | null;
  /** AI 原文（做 Before/After 對照用）。過長會截斷。 */
  sourceText: string | null;
  /**
   * 這個區段裡有幾個字是學生後來插進去的（原本沒有 AI 標記）。
   * 只有 origin='ai' 且區段被學生改過時才會大於 0。
   */
  insertedChars: number;
};

export type DnaThresholds = { high: number; low: number };

export type DnaResult = {
  theta: DnaThresholds;
  /** 依 color 的字數統計。 */
  counts: Record<DnaColor, number>;
  /** 依 color 的字數占比，總和為 1（文稿為空時全為 0）。 */
  ratios: Record<DnaColor, number>;
  /** 依 origin 的字數統計。研究者端用，學生端不顯示。 */
  originCounts: Record<SegmentOrigin, number>;
  segments: DnaSegment[];
  textLength: number;
};

/** Before/After 對照用的原文上限。超過就截斷，避免 analyses 無限膨脹。 */
const SOURCE_TEXT_LIMIT = 2000;

/** 查一則 AI 訊息的內容。查不到回 null（訊息被刪、或 mark 記的 id 對不上）。 */
export type SourceLookup = (messageId: string) => string | null;

function emptyCounts(): Record<DnaColor, number> {
  return { blue: 0, green: 0, orange: 0 };
}

/**
 * 與 STEP 6 複製時的正規化一致。srcStart / srcEnd 是對正規化後的字串取的位移，
 * 這裡不先正規化就會切錯位置（Windows 的 \r\n 每行差一個字元）。
 */
function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function sliceSource(
  content: string,
  start: number | null,
  end: number | null,
): string {
  const normalized = normalize(content);
  if (start === null || end === null) return normalized;
  if (start < 0 || end > normalized.length || start >= end) return normalized;
  return normalized.slice(start, end);
}

function colorFor(
  sim: number,
  theta: DnaThresholds,
): DnaColor {
  if (sim >= theta.high) return "blue";
  if (sim >= theta.low) return "green";
  // 改到連 θ_low 都達不到＝已經是學生自己的句子了，不該再算 AI 的功勞。
  return "orange";
}

/**
 * 一次貼上、後來被學生從中間改過的文字，在 ProseMirror 裡會裂成好幾段
 * mark（學生插進去的字沒有標記，把原本連續的一段切開了）。
 *
 * 這些碎片必須當成**同一段**來比對，否則每一片各自去跟完整的 AI 原文比，
 * 相似度會被長度差壓垮：實測時一段 46 字的 AI 文字被改過之後裂成 14 字與
 * 16 字兩片，各自算出 0.30 / 0.35，雙雙掉到 θ_low 以下變成橘色——
 * 「AI 寫的、你改過」這個綠色類別直接消失，而那正是本研究最想看到的行為。
 *
 * 合併規則：相鄰、來源完全相同（同一則訊息的同一段位移），且中間隔開的
 * 字數不超過原文長度。最後那個上限是操作型定義的一部分：學生插進去的字
 * 比 AI 原文還多時，這塊區域已經是他自己的段落，不該再算成「改寫 AI」。
 */
function sameSource(a: ProvenanceRun, b: ProvenanceRun): boolean {
  if (a.kind !== "ai" || b.kind !== "ai") return false;
  return (
    a.attrs.messageId === b.attrs.messageId &&
    a.attrs.srcStart === b.attrs.srcStart &&
    a.attrs.srcEnd === b.attrs.srcEnd
  );
}

function clusterRuns(runs: ProvenanceRun[], sourceLengthOf: (run: ProvenanceRun) => number): ProvenanceRun[][] {
  const clusters: ProvenanceRun[][] = [];
  for (const run of runs) {
    const current = clusters[clusters.length - 1];
    const last = current?.[current.length - 1];
    if (current && last && sameSource(last, run)) {
      const gap = run.start - last.end;
      if (gap >= 0 && gap <= sourceLengthOf(run)) {
        current.push(run);
        continue;
      }
    }
    clusters.push([run]);
  }
  return clusters;
}

/**
 * 逐區段歸因。
 *
 * 沒有 mark 的地方（手打）不會出現在 runs 裡，所以要自己把空隙補成橘色區段——
 * 條碼必須涵蓋整份文稿，中間不能有洞，否則比例算不準也畫不出來。
 */
export function attribute(
  doc: unknown,
  lookup: SourceLookup,
  theta: DnaThresholds,
): DnaResult {
  const { text, runs } = walkDoc(doc);
  const segments: DnaSegment[] = [];

  const ordered = [...runs].sort((a, b) => a.start - b.start);
  const sourceOf = (run: ProvenanceRun): string => {
    if (run.kind !== "ai" || !run.attrs.messageId) return "";
    const content = lookup(run.attrs.messageId);
    return content === null
      ? ""
      : sliceSource(content, run.attrs.srcStart, run.attrs.srcEnd);
  };

  let cursor = 0;
  for (const cluster of clusterRuns(ordered, (run) => sourceOf(run).length)) {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    if (!first || !last) continue;
    // 重疊的區段不該存在（ProseMirror 的 mark 互斥），但真的出現時
    // 寧可跳過也不要產出重疊的條碼。
    if (first.start < cursor) continue;
    if (first.start > cursor) segments.push(typedSegment(cursor, first.start));

    segments.push(attributeCluster(cluster, text, lookup, theta));
    cursor = last.end;
  }
  if (cursor < text.length) segments.push(typedSegment(cursor, text.length));

  const counts = emptyCounts();
  const originCounts: Record<SegmentOrigin, number> = { ai: 0, external: 0, typed: 0 };
  for (const segment of segments) {
    const length = segment.end - segment.start;
    counts[segment.color] += length;
    // 學生插在 AI 區段中間的字，顏色算在這一段上（那是「改寫過的 AI 段落」），
    // 但來源歸給手打——兩種視角各自誠實。
    originCounts[segment.origin] += length - segment.insertedChars;
    if (segment.insertedChars > 0) originCounts.typed += segment.insertedChars;
  }

  const total = text.length;
  const ratios: Record<DnaColor, number> = total
    ? { blue: counts.blue / total, green: counts.green / total, orange: counts.orange / total }
    : emptyCounts();

  return { theta, counts, ratios, originCounts, segments, textLength: total };
}

function typedSegment(start: number, end: number): DnaSegment {
  return {
    start,
    end,
    color: "orange",
    origin: "typed",
    similarity: null,
    messageId: null,
    sourceText: null,
    insertedChars: 0,
  };
}

function attributeCluster(
  cluster: ProvenanceRun[],
  text: string,
  lookup: SourceLookup,
  theta: DnaThresholds,
): DnaSegment {
  const first = cluster[0]!;
  const last = cluster[cluster.length - 1]!;
  const start = first.start;
  const end = last.end;
  // 區段總長減去有標記的部分＝學生插進去的字數。
  const marked = cluster.reduce((sum, run) => sum + (run.end - run.start), 0);
  const insertedChars = end - start - marked;

  if (first.kind === "external") {
    return {
      start,
      end,
      color: "orange",
      origin: "external",
      similarity: null,
      messageId: null,
      sourceText: null,
      insertedChars,
    };
  }

  const messageId = first.attrs.messageId;
  const content = messageId ? lookup(messageId) : null;

  // mark 說這段來自 AI，但原文找不到（訊息對不上）。
  // 沒有原文就算不出相似度，硬猜一個顏色等於捏造資料——記成綠色並把
  // similarity 留 null，讓匯出時看得出來這一段的歸因是不完整的。
  if (content === null) {
    return {
      start,
      end,
      color: "green",
      origin: "ai",
      similarity: null,
      messageId,
      sourceText: null,
      insertedChars,
    };
  }

  const source = sliceSource(content, first.attrs.srcStart, first.attrs.srcEnd);
  // 拿整個區段（含學生插進去的字）去比：那些字正是「改寫」這個動作本身。
  const current = text.slice(start, end);
  const sim = similarityAtLeast(source, current, theta.low);

  return {
    start,
    end,
    color: colorFor(sim, theta),
    origin: "ai",
    similarity: Math.max(0, Math.min(1, sim)),
    messageId,
    sourceText:
      source.length > SOURCE_TEXT_LIMIT ? `${source.slice(0, SOURCE_TEXT_LIMIT)}…` : source,
    insertedChars,
  };
}

/** 給只要區段、不要統計的呼叫端（例如條碼元件重新計算時）。 */
export { extractProvenanceRuns };
