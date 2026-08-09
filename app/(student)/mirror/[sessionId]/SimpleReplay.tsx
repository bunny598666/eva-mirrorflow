"use client";

import { useMemo, useState } from "react";
import {
  buildReplayIndex,
  keyMoments,
  textAt,
  type ReplayAnchor,
  type ReplayEvent,
} from "@/lib/replay/engine";

/**
 * 學生版簡化回放。
 *
 * 【刻意不做逐字播放】13 歲的使用者面對一條可以拖到任何位置的時間軸會迷失，
 * 而且逐字重播會把注意力吸到「我打字好慢」這種與研究無關的地方。
 * 這裡只留幾張「那時候發生了一件事」的卡片，點開看當時的文章長什麼樣——
 * 這樣才問得出「你那時候在想什麼」，也就是反思題目要的東西。
 *
 * 【文案標準】國中生 10 秒看懂。不出現「事件」「歸因」「序號」這類詞。
 */

const ICON: Record<string, string> = {
  paste: "📋",
  delete_block: "✂️",
  long_idle: "💭",
};

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function SimpleReplay({
  events,
  anchors,
}: {
  events: ReplayEvent[];
  anchors: ReplayAnchor[];
}) {
  const index = useMemo(() => buildReplayIndex(events, anchors), [events, anchors]);
  const moments = useMemo(() => keyMoments(index.events), [index]);
  const [openAt, setOpenAt] = useState<number | null>(null);

  const text = useMemo(
    () => (openAt === null ? "" : textAt(index, openAt)),
    [index, openAt],
  );

  if (moments.length === 0) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-bold text-neutral-800">你這次的寫作過程</h2>
        <p className="mt-3 text-neutral-600">
          這次你是一路寫下來的，沒有貼上、也沒有刪掉一大段。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="text-lg font-bold text-neutral-800">你這次的寫作過程</h2>
      <p className="mt-1 text-neutral-600">
        這是你寫這篇的時候，比較關鍵的幾個時刻。點一下可以看當時的文章長什麼樣。
      </p>

      <ol className="mt-4 flex flex-col gap-3">
        {moments.map((moment) => {
          const open = openAt === moment.index;
          return (
            <li key={moment.clientSeq}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenAt(open ? null : moment.index)}
                className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  open
                    ? "border-neutral-800 bg-neutral-50"
                    : "border-neutral-200 hover:bg-neutral-50"
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900`}
              >
                <span aria-hidden="true" className="text-2xl leading-none">
                  {ICON[moment.kind] ?? "•"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium text-neutral-900">
                    {moment.headline}
                  </span>
                  <span className="block text-sm text-neutral-600">
                    {timeOfDay(moment.ts)}　{moment.detail}
                  </span>
                </span>
                <span aria-hidden="true" className="text-neutral-400">
                  {open ? "▲" : "▼"}
                </span>
              </button>

              {open ? (
                <div className="mt-2 rounded-xl bg-neutral-100 px-4 py-3">
                  <p className="mb-2 text-sm font-medium text-neutral-700">
                    那個時候，你的文章是這樣：
                  </p>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap font-sans text-base leading-relaxed text-neutral-800">
                    {text || "（那時候還是空白的）"}
                  </pre>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
