"use client";

import { useMemo, useState } from "react";
import {
  buildReplayIndex,
  buildTimeline,
  textAt,
  type ReplayAnchor,
  type ReplayEvent,
  type TrackColor,
} from "@/lib/replay/engine";

/**
 * 教師端完整回放。
 *
 * 時間軸依 BUILD_PLAN §6 STEP 7 上色：紅=提問、黃=複製、藍=輸入、灰=停頓。
 * 可拖曳（range input），也可用方向鍵一格一格走——鍵盤操作是必要的，
 * 教師常常要精確停在某一筆事件上，滑鼠拖不準。
 *
 * 【從場次開頭重演，快照當校正點】教師端要看的是「怎麼變成這樣的」，
 * 所以從空白開始重演；快照則在它記錄的那個時間點把文稿拉回權威版本。
 * 學生換裝置或清掉瀏覽器資料時事件流會斷開，沒有校正點就會一路錯到底。
 */

const COLOR: Record<TrackColor, string> = {
  red: "bg-rose-500",
  yellow: "bg-amber-400",
  blue: "bg-sky-500",
  gray: "bg-neutral-300",
  neutral: "bg-neutral-200",
};

const LEGEND: { color: TrackColor; label: string }[] = [
  { color: "red", label: "問 AI" },
  { color: "yellow", label: "複製貼上" },
  { color: "blue", label: "打字" },
  { color: "gray", label: "停頓" },
  { color: "neutral", label: "其他" },
];

/**
 * 距場次開始多久。一節課通常在一小時內，但場次可能被掛著沒交件，
 * 那時 mm:ss 會變成「5639:04」這種讀不出意義的數字，所以超過一小時就補上時數。
 */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function ReplayViewer({
  events,
  anchors,
  startedAt,
}: {
  events: ReplayEvent[];
  anchors: ReplayAnchor[];
  startedAt: string;
}) {
  // 建索引是這個元件唯一昂貴的動作，只做一次。之後任何跳轉都只套幾十個 patch。
  const index = useMemo(() => buildReplayIndex(events, anchors), [events, anchors]);
  const timeline = useMemo(() => buildTimeline(index.events, startedAt), [index, startedAt]);

  const total = index.events.length;
  const [position, setPosition] = useState(total);

  const text = useMemo(() => textAt(index, position), [index, position]);
  const current = position > 0 ? timeline[position - 1] : null;

  if (total === 0) {
    return (
      <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-600">
        這個場次還沒有任何事件。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {index.issues.length > 0 ? (
        <p role="alert" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          有 {index.issues.length} 筆變更接不起來（序號{" "}
          {index.issues.map((f) => f.clientSeq).join("、")}
          ），最可能的原因是學生中途換了裝置或清掉瀏覽器資料。
          {index.repairs > 0
            ? `已用 ${index.repairs} 份快照把文稿校正回來，斷點前後的過程仍可能不完整。`
            : "這段區間的文稿可能不完整。"}
          事件本身完整保存在資料庫裡。
        </p>
      ) : null}

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-neutral-600">
            第 <span className="font-mono font-semibold">{position}</span> / {total} 筆
            {current ? (
              <>
                　<span className="font-mono">{clock(current.offsetMs)}</span>
                　<span className="font-medium text-neutral-800">{current.label}</span>
              </>
            ) : (
              <>　場次開始</>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-600">
            {LEGEND.map((item) => (
              <span key={item.color} className="flex items-center gap-1.5">
                <span className={`inline-block h-3 w-3 rounded-sm ${COLOR[item.color]}`} />
                {item.label}
              </span>
            ))}
          </div>
        </div>

        {/* 事件密度帶：每一筆事件一條，顏色即類別 */}
        <div className="mt-3 flex h-8 w-full overflow-hidden rounded" aria-hidden="true">
          {timeline.map((entry) => (
            <span
              key={entry.clientSeq}
              className={`h-full flex-1 ${COLOR[entry.color]} ${
                entry.index < position ? "" : "opacity-25"
              }`}
              style={{ minWidth: "1px" }}
            />
          ))}
        </div>

        <label htmlFor="replay-position" className="sr-only">
          回放位置
        </label>
        <input
          id="replay-position"
          type="range"
          min={0}
          max={total}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className="mt-2 w-full"
        />

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setPosition(0)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            回到開頭
          </button>
          <button
            type="button"
            onClick={() => setPosition((p) => Math.max(0, p - 1))}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            上一筆
          </button>
          <button
            type="button"
            onClick={() => setPosition((p) => Math.min(total, p + 1))}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            下一筆
          </button>
          <button
            type="button"
            onClick={() => setPosition(total)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            跳到終稿
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-700">
          這個時刻的文稿（{text.length} 字）
        </h2>
        <pre className="max-h-[28rem] overflow-y-auto whitespace-pre-wrap px-5 py-4 font-sans text-base leading-relaxed text-neutral-800">
          {text || "（還是空白）"}
        </pre>
      </div>
    </div>
  );
}
