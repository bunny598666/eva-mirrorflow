/**
 * 回放引擎（STEP 7）。純函式，不碰 DOM、不碰網路、不碰資料庫——所以驗得到。
 *
 * 【重演的是純文字，不是完整文件】
 * keystroke_batch 與 delete_block 的 payload 存的是 diff-match-patch 對
 * `editor.getText()` 的 patch，不是 ProseMirror 的 step。因此重演出來的是
 * 每個時刻的**純文字**。marks（誰寫的）只存在於 snapshots.doc 裡。
 * 這是刻意的取捨：事件流因此小了一個數量級，45 人同堂也撐得住；
 * 而 DNA 三色只在交件時算一次，用最後一份快照的 doc 就夠。
 *
 * 【為什麼要 index 而不是每次從頭重演】
 * 驗收要求 5000 事件任意跳轉 <1 秒。從頭套 5000 個 patch 每跳一次都要重來，
 * 教師拖時間軸會卡住。所以載入時先建一排檢查點，跳轉只需從最近的檢查點
 * 往前套幾十個 patch。
 */
import { diff_match_patch } from "diff-match-patch";
import type { EventType } from "@/lib/events/types";

export type ReplayEvent = {
  client_seq: number;
  type: EventType;
  payload: Record<string, unknown>;
  ts: string;
};

/**
 * 錨點：某個時間點「文稿確實長這樣」的權威紀錄，來自 snapshots。
 * clientSeq 代表這份 doc 已經反映到第幾號事件。
 */
export type ReplayAnchor = { clientSeq: number; text: string };

export type ReplayIssue = {
  clientSeq: number;
  type: EventType;
  kind: "patch_failed" | "discontinuity";
  reason: string;
};

const dmp = new diff_match_patch();

/** 只有這兩種事件會改變文稿。其餘（對話、複製、停頓…）重演時是原地不動。 */
function isTextEvent(type: EventType): boolean {
  return type === "keystroke_batch" || type === "delete_block";
}

/**
 * 套用一個 patch。失敗回 null 而不是硬套。
 *
 * diff-match-patch 的 patch_apply 是模糊比對：基準文字不對時它不會報錯，
 * 而是「盡量」套上去，產出一份看似合理其實錯誤的文稿。研究資料寧可缺一段
 * 並標記為失敗，也不要一份沒人知道錯在哪的假文稿。
 */
export function applyPatch(text: string, patch: string): string | null {
  if (!patch) return text;
  try {
    const parsed = dmp.patch_fromText(patch);
    if (parsed.length === 0) return text;
    const [result, applied] = dmp.patch_apply(parsed, text) as [string, boolean[]];
    return applied.every(Boolean) ? result : null;
  } catch {
    return null;
  }
}

function patchOf(payload: Record<string, unknown>): string {
  return typeof payload.patch === "string" ? payload.patch : "";
}

function beforeLenOf(payload: Record<string, unknown>): number | null {
  return typeof payload.before_len === "number" ? payload.before_len : null;
}

/**
 * 套用一個文字事件，並先檢查基準長度對不對。
 *
 * 【為什麼一定要查 before_len】
 * diff-match-patch 是模糊比對：把一份「從空白開始」的 patch 套到一份已經有
 * 三百字的文稿上，它不會報錯，而是找個看似合理的位置插進去，回傳
 * applied = [true]。結果是一份讀起來通順、但根本沒發生過的文稿——
 * 對研究資料來說，這比「這段缺失」嚴重得多。
 *
 * 這種斷點是真的會發生的：學生換裝置、清瀏覽器資料、或本機暫存稿掉了，
 * 用戶端會從空白重新開始打，事件流卻接著先前的序號往下長。
 */
function applyTextEvent(
  text: string,
  event: ReplayEvent,
): { text: string; issue: ReplayIssue | null } {
  const expected = beforeLenOf(event.payload);
  if (expected !== null && expected !== text.length) {
    return {
      text,
      issue: {
        clientSeq: event.client_seq,
        type: event.type,
        kind: "discontinuity",
        reason: `這一筆是從 ${expected} 字的文稿改起，但重演到這裡是 ${text.length} 字`,
      },
    };
  }

  const next = applyPatch(text, patchOf(event.payload));
  if (next === null) {
    return {
      text,
      issue: {
        clientSeq: event.client_seq,
        type: event.type,
        kind: "patch_failed",
        reason: "patch 套不上",
      },
    };
  }
  return { text: next, issue: null };
}

export type ReplayIndex = {
  /** 已依 client_seq 排序。 */
  events: ReplayEvent[];
  /** checkpoints[k] = 套用完前 k*stride 個事件之後的文字。 */
  checkpoints: string[];
  stride: number;
  /** 套用不上或接不起來的事件。空陣列＝這段歷程完整重演得回去。 */
  issues: ReplayIssue[];
  /** 靠快照把漂掉的文稿拉回來的次數。 */
  repairs: number;
  /** 事件位置 → 該位置之後要採用的快照文字。-1 代表放在最前面。 */
  anchors: Map<number, string>;
};

/** 最多留 100 個檢查點：跳轉成本上限 = 事件數/100，記憶體也不會爆。 */
function strideFor(count: number): number {
  return Math.max(20, Math.ceil(count / 100));
}

/**
 * 建索引。
 *
 * 快照是權威：每個錨點所在的位置，一律以快照記下的文稿為準。事件負責補出
 * 錨點與錨點之間的過程；萬一中間斷了（學生清了瀏覽器資料之類），
 * 下一個錨點就會把文稿拉回正軌，不會一路錯到底。
 */
export function buildReplayIndex(
  events: readonly ReplayEvent[],
  anchorPoints: readonly ReplayAnchor[] = [],
): ReplayIndex {
  const ordered = [...events].sort((a, b) => a.client_seq - b.client_seq);
  const anchors = mapAnchors(ordered, anchorPoints);

  const stride = strideFor(ordered.length);
  const issues: ReplayIssue[] = [];
  let repairs = 0;

  let text = anchors.get(-1) ?? "";
  const checkpoints: string[] = [text];

  for (let i = 0; i < ordered.length; i += 1) {
    const event = ordered[i];
    if (event && isTextEvent(event.type)) {
      const result = applyTextEvent(text, event);
      if (result.issue) issues.push(result.issue);
      text = result.text;
    }

    const anchor = anchors.get(i);
    if (anchor !== undefined && anchor !== text) {
      repairs += 1;
      text = anchor;
    }

    if ((i + 1) % stride === 0) checkpoints.push(text);
  }

  return { events: ordered, checkpoints, stride, issues, repairs, anchors };
}

/** 把快照對到「套用完第幾個事件之後」。兩邊都已排序，單趟走完。 */
function mapAnchors(
  ordered: readonly ReplayEvent[],
  anchorPoints: readonly ReplayAnchor[],
): Map<number, string> {
  const map = new Map<number, string>();
  const sorted = [...anchorPoints].sort((a, b) => a.clientSeq - b.clientSeq);

  let cursor = 0;
  for (const anchor of sorted) {
    while (
      cursor < ordered.length &&
      (ordered[cursor]?.client_seq ?? Number.MAX_SAFE_INTEGER) <= anchor.clientSeq
    ) {
      cursor += 1;
    }
    // cursor 是第一個序號大於錨點的事件，所以錨點落在 cursor - 1 之後。
    map.set(cursor - 1, anchor.text);
  }
  return map;
}

/**
 * 取「套用完前 count 個事件」時的文字。count = 0 是起點，events.length 是終稿。
 * 從最近的檢查點往前補，最多套 stride 個 patch。
 */
export function textAt(index: ReplayIndex, count: number): string {
  const target = Math.max(0, Math.min(count, index.events.length));
  const checkpointNo = Math.floor(target / index.stride);
  const start = checkpointNo * index.stride;
  let text = index.checkpoints[checkpointNo] ?? index.anchors.get(-1) ?? "";

  for (let i = start; i < target; i += 1) {
    const event = index.events[i];
    if (event && isTextEvent(event.type)) {
      text = applyTextEvent(text, event).text;
    }
    const anchor = index.anchors.get(i);
    if (anchor !== undefined) text = anchor;
  }
  return text;
}

/** 終稿。 */
export function finalText(index: ReplayIndex): string {
  return textAt(index, index.events.length);
}

/** 一次算到底。要反覆跳轉請用 buildReplayIndex + textAt。 */
export function replay(
  events: readonly ReplayEvent[],
  anchorPoints: readonly ReplayAnchor[] = [],
): { text: string; issues: ReplayIssue[]; repairs: number } {
  const index = buildReplayIndex(events, anchorPoints);
  return { text: finalText(index), issues: index.issues, repairs: index.repairs };
}

// ── 時間軸（教師端完整回放） ────────────────────────────────────────────

/** BUILD_PLAN §6 STEP 7：紅=提問、黃=複製、藍=輸入、灰=停頓。 */
export type TrackColor = "red" | "yellow" | "blue" | "gray" | "neutral";

export type TimelineEntry = {
  index: number;
  clientSeq: number;
  type: EventType;
  ts: string;
  /** 距離場次開始的毫秒數。 */
  offsetMs: number;
  color: TrackColor;
  label: string;
};

const TRACK: Record<EventType, { color: TrackColor; label: string }> = {
  chat_send: { color: "red", label: "問 AI" },
  chat_receive: { color: "red", label: "AI 回覆" },
  scaffold_click: { color: "red", label: "點鷹架" },
  copy: { color: "yellow", label: "複製" },
  paste: { color: "yellow", label: "貼上" },
  keystroke_batch: { color: "blue", label: "打字" },
  delete_block: { color: "blue", label: "刪掉一大段" },
  idle: { color: "gray", label: "停頓" },
  focus_switch: { color: "neutral", label: "切換視窗" },
  submit: { color: "neutral", label: "交件" },
  mirror_view: { color: "neutral", label: "看歷程" },
  recap_view: { color: "neutral", label: "看上次" },
};

export function buildTimeline(
  events: readonly ReplayEvent[],
  startedAt: string,
): TimelineEntry[] {
  const origin = new Date(startedAt).getTime();
  return events.map((event, index) => {
    const track = TRACK[event.type] ?? { color: "neutral" as const, label: event.type };
    return {
      index,
      clientSeq: event.client_seq,
      type: event.type,
      ts: event.ts,
      offsetMs: Math.max(0, new Date(event.ts).getTime() - origin),
      color: track.color,
      label: track.label,
    };
  });
}

// ── 關鍵節點（學生簡化版） ──────────────────────────────────────────────

/** 學生版只跳關鍵節點：貼上、大段刪除、超過 2 分鐘的停頓。 */
export const KEY_MOMENT_IDLE_MS = 120_000;

export type KeyMomentKind = "paste" | "delete_block" | "long_idle";

export type KeyMoment = {
  /** 對應 ReplayIndex.events 的位置，直接餵給 textAt。 */
  index: number;
  clientSeq: number;
  kind: KeyMomentKind;
  ts: string;
  /** 給 13 歲看的一句話。 */
  headline: string;
  detail: string;
};

function minutes(ms: number): string {
  return String(Math.max(1, Math.round(ms / 60_000)));
}

/**
 * 挑出關鍵節點。
 *
 * 學生端刻意不做逐字重演：13 歲的使用者面對一條可以拖到任何位置的時間軸
 * 會迷失，而且逐字播放會把注意力放在「打字很慢」這種與研究無關的細節上。
 * 只留下少數幾個「當時發生了一件事」的節點，才問得出「那時候你在想什麼」。
 */
export function keyMoments(events: readonly ReplayEvent[]): KeyMoment[] {
  const moments: KeyMoment[] = [];

  events.forEach((event, index) => {
    if (event.type === "paste") {
      // origin='internal' 是學生在自己的文章裡搬動段落，不是「從外面拿東西進來」。
      // 把它算成關鍵節點會讓卡片寫出「你從別的地方貼了一段進來」這種與事實不符的話，
      // 而反思題目正是要學生回答「當時為什麼用了這一段」——問錯前提就問不出東西。
      if (event.payload.origin === "internal") return;

      const fromAi = event.payload.origin === "ai";
      const length = typeof event.payload.length === "number" ? event.payload.length : 0;
      moments.push({
        index: index + 1,
        clientSeq: event.client_seq,
        kind: "paste",
        ts: event.ts,
        headline: fromAi ? "你把 AI 寫的一段貼進文章" : "你從別的地方貼了一段進來",
        detail: `這一段大約 ${length} 個字`,
      });
      return;
    }

    if (event.type === "delete_block") {
      const removed =
        typeof event.payload.removed_chars === "number" ? event.payload.removed_chars : 0;
      moments.push({
        index: index + 1,
        clientSeq: event.client_seq,
        kind: "delete_block",
        ts: event.ts,
        headline: "你把一大段刪掉重寫",
        detail: `刪掉了大約 ${removed} 個字`,
      });
      return;
    }

    if (event.type === "idle") {
      const ms = typeof event.payload.ms === "number" ? event.payload.ms : 0;
      if (ms <= KEY_MOMENT_IDLE_MS) return;
      moments.push({
        index: index + 1,
        clientSeq: event.client_seq,
        kind: "long_idle",
        ts: event.ts,
        headline: "你停下來想了一下",
        detail: `這裡停了大約 ${minutes(ms)} 分鐘`,
      });
    }
  });

  return moments;
}
