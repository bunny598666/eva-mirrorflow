"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emitEvent, flush, startEventQueue } from "@/lib/events/queue";
import {
  countsAsVisible,
  VIEW_DWELL_MS,
  VIEW_POLL_MS,
} from "@/lib/mirror/visibility";
import StudentDna from "./StudentDna";
import SimpleReplay from "./SimpleReplay";
import ReflectionForm from "./ReflectionForm";
import type { DnaResult } from "@/lib/dna/attribute";
import type { ReplayAnchor, ReplayEvent } from "@/lib/replay/engine";
import type { ReflectionPrompt, ReflectionRecord } from "@/lib/reflection/types";

/**
 * 鏡子迴圈（CLAUDE.md §4.4）：看鏡子 → 回答反思。順序不可調換。
 *
 * 【「看過」的操作型定義】
 * 一個區塊有 40% 以上連續出現在畫面上滿 1.5 秒，才算看過。
 * 只是捲過去不算——那正是這個介入最容易被繞過的地方，而
 * viewed_dna_at / viewed_replay_at 是論文方法章用來主張「介入確實發生」的證據，
 * 定義鬆掉的話那個主張就站不住。這個門檻若要調整，等同修改研究方法。
 *
 * 每個區塊第一次達標時記一筆 mirror_view 事件（append-only，事後改不掉），
 * 送出反思時再把兩個時間點一併寫進 reflections。前者是證據，後者是摘要。
 */

function Watched({
  onViewed,
  done,
  children,
}: {
  onViewed: () => void;
  done: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // onViewed 由呼叫端以 useCallback 固定住，可以直接進相依陣列。
  useEffect(() => {
    if (done) return;
    const node = ref.current;
    if (!node) return;

    // 累計「確實在畫面上」的時間。捲走就歸零——看過的定義是停留，不是經過。
    let dwell = 0;
    const timer = window.setInterval(() => {
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      if (
        document.visibilityState !== "visible" ||
        !countsAsVisible(node.getBoundingClientRect(), viewport)
      ) {
        dwell = 0;
        return;
      }
      dwell += VIEW_POLL_MS;
      if (dwell >= VIEW_DWELL_MS) {
        window.clearInterval(timer);
        onViewed();
      }
    }, VIEW_POLL_MS);

    return () => window.clearInterval(timer);
  }, [done, onViewed]);

  return <div ref={ref}>{children}</div>;
}

export default function MirrorLoop({
  sessionId,
  dna,
  finalText,
  events,
  anchors,
  prompt,
  existing,
}: {
  sessionId: string;
  dna: DnaResult | null;
  finalText: string;
  events: ReplayEvent[];
  anchors: ReplayAnchor[];
  prompt: ReflectionPrompt;
  existing: ReflectionRecord | null;
}) {
  const [viewedDnaAt, setViewedDnaAt] = useState<string | null>(null);
  const [viewedReplayAt, setViewedReplayAt] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  // 事件佇列：mirror_view 走跟寫作頁一樣的路（先落 IndexedDB，再批次送出）。
  useEffect(() => startEventQueue(sessionId), [sessionId]);

  const markDna = useCallback(() => {
    setViewedDnaAt((current) => {
      if (current) return current;
      const at = new Date().toISOString();
      void emitEvent(sessionId, "mirror_view", { part: "dna", at });
      return at;
    });
  }, [sessionId]);

  const markReplay = useCallback(() => {
    setViewedReplayAt((current) => {
      if (current) return current;
      const at = new Date().toISOString();
      void emitEvent(sessionId, "mirror_view", { part: "replay", at });
      return at;
    });
  }, [sessionId]);

  // 已經寫過反思就直接顯示，不再重新計時、也不再記 mirror_view。
  if (existing) {
    return (
      <>
        {dna ? <StudentDna dna={dna} text={finalText} /> : null}
        <SimpleReplay events={events} anchors={anchors} />
        <ReflectionForm
          sessionId={sessionId}
          prompt={prompt}
          existing={existing}
          viewedDnaAt={existing.viewed_dna_at}
          viewedReplayAt={existing.viewed_replay_at}
        />
      </>
    );
  }

  // 沒有 DNA 表示交件時歸因沒算成功（正常流程不會發生）。
  // 這種情況下讓學生寫反思是沒有意義的——他要「找一段藍色」，但根本沒有條碼。
  if (!dna) {
    return (
      <>
        <SimpleReplay events={events} anchors={anchors} />
        <p role="alert" className="rounded-2xl bg-orange-50 px-5 py-4 text-orange-900">
          你的文章 DNA 還沒算好，跟老師說一聲。
        </p>
      </>
    );
  }

  const ready = viewedDnaAt !== null && viewedReplayAt !== null;

  return (
    <>
      <Watched onViewed={markDna} done={viewedDnaAt !== null}>
        <StudentDna dna={dna} text={finalText} />
      </Watched>

      <Watched onViewed={markReplay} done={viewedReplayAt !== null}>
        <SimpleReplay events={events} anchors={anchors} />
      </Watched>

      {started ? (
        <div ref={formRef}>
          <ReflectionForm
            sessionId={sessionId}
            prompt={prompt}
            existing={null}
            viewedDnaAt={viewedDnaAt}
            viewedReplayAt={viewedReplayAt}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white p-6">
          <h2 className="text-lg font-bold text-neutral-800">接下來寫一下你的想法</h2>
          <p className="mt-1 text-neutral-600">
            {ready
              ? "看完了，可以開始了。"
              : "先把上面兩個部分看完，再回答三個問題。"}
          </p>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              setStarted(true);
              // 事件先推上去再進表單：學生接下來可能會離線打字，
              // mirror_view 不該卡在本機佇列裡等。
              void flush(sessionId);
              // 表單在按鈕原本的位置展開，捲過去才看得到第一題。
              window.setTimeout(
                () => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                50,
              );
            }}
            className="mt-4 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            開始寫想法
          </button>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-neutral-500">
            <li>{viewedDnaAt ? "✓" : "○"} 看過文章 DNA</li>
            <li>{viewedReplayAt ? "✓" : "○"} 看過寫作過程</li>
          </ul>
        </div>
      )}
    </>
  );
}
