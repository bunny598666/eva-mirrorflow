"use client";

import StartWriting from "./StartWriting";
import type { DnaColor } from "@/lib/dna/attribute";
import type { RecapData } from "@/lib/mirror/recap";

/**
 * 「上次的你」摘要卡。
 *
 * 這張卡把上一期學生自己寫下的「下次想做的改變」原文放回他眼前，
 * 就在他要開始下一次寫作的前一刻。SRL 的「自我反應」因此接回「自我觀察」，
 * 迴圈才閉得起來（CLAUDE.md §4.4）。
 *
 * 【文案不做評價】不說「上次 AI 用了 60%，有點多」。一旦帶了價值判斷，
 * 學生就會為了數字好看而改行為，量到的是迎合而不是學習。
 */

const PALETTE: Record<DnaColor, { fill: string; label: string }> = {
  blue: { fill: "#2563eb", label: "AI 寫的，你沒改" },
  green: { fill: "#16a34a", label: "AI 寫的，你改過" },
  orange: { fill: "#ea580c", label: "你自己寫的" },
};

const ORDER: DnaColor[] = ["blue", "green", "orange"];

function Ring({ ratios }: { ratios: Record<DnaColor, number> }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const arcs: { color: DnaColor; length: number; offset: number }[] = [];
  let cursor = 0;
  for (const color of ORDER) {
    const length = (ratios[color] ?? 0) * circumference;
    arcs.push({ color, length, offset: cursor });
    cursor += length;
  }

  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0" role="img" aria-label="上次的三色比例">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="#e5e5e5" strokeWidth="18" />
      {arcs.map((arc) => (
        <circle
          key={arc.color}
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke={PALETTE[arc.color].fill}
          strokeWidth="18"
          strokeDasharray={`${arc.length} ${circumference - arc.length}`}
          strokeDashoffset={-arc.offset}
          transform="rotate(-90 60 60)"
        />
      ))}
    </svg>
  );
}

export default function RecapCard({ recap }: { recap: RecapData }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">開始第 {recap.orderNo} 次之前</h1>
        <p className="mt-1 text-neutral-600">先看一下上次的你。</p>
      </header>

      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-bold text-neutral-800">
          上次（第 {recap.previous.orderNo} 次．{recap.previous.assignmentTitle}）
        </h2>

        {recap.previous.ratios ? (
          <div className="mt-4 flex flex-wrap items-center gap-5">
            <Ring ratios={recap.previous.ratios} />
            <ul className="flex min-w-[13rem] flex-1 flex-col gap-2">
              {ORDER.map((color) => (
                <li key={color} className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0 rounded"
                    style={{ backgroundColor: PALETTE[color].fill }}
                  />
                  <span className="flex-1 text-base text-neutral-800">
                    {PALETTE[color].label}
                  </span>
                  <span className="text-xl font-bold tabular-nums text-neutral-900">
                    {Math.round((recap.previous.ratios?.[color] ?? 0) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-neutral-600">上次的文章 DNA 沒有算出來。</p>
        )}
      </section>

      {recap.previous.intention ? (
        <section className="rounded-2xl border-2 border-neutral-800 bg-white p-6">
          <h2 className="text-lg font-bold text-neutral-800">上次你說，下次想這樣做</h2>
          <blockquote className="mt-3 whitespace-pre-wrap border-l-4 border-neutral-300 pl-4 text-lg leading-relaxed text-neutral-900">
            {recap.previous.intention}
          </blockquote>
          <p className="mt-3 text-sm text-neutral-500">這是你自己寫的。</p>
        </section>
      ) : null}

      <StartWriting
        assignmentId={recap.assignmentId}
        recapPayload={{
          previous_order_no: recap.previous.orderNo,
          had_intention: recap.previous.intention !== null,
          had_ratios: recap.previous.ratios !== null,
        }}
      />
    </main>
  );
}
