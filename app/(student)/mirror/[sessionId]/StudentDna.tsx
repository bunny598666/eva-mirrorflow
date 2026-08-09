"use client";

import { useRef, useState } from "react";
import type { DnaColor, DnaResult, DnaSegment } from "@/lib/dna/attribute";

/**
 * 學生版文章 DNA。
 *
 * 【驗收條件是「非資訊背景成人 10 秒內能說出三色意義」】所以：
 *   - 圖例就是三句白話，不解釋演算法、不出現「相似度」「門檻」「歸因」
 *   - 百分比用大字，色塊用大面積，不用細條紋
 *   - 顏色不是唯一線索：每一色都有文字標籤，色塊有 aria-label，
 *     色盲的學生照樣讀得出來
 *
 * 【只看得到自己】沒有任何同儕或全班數字（CLAUDE.md §4.4）。
 * 也刻意不對比例下任何評價——不說「AI 用太多」，那是價值判斷，
 * 會讓學生為了好看而改行為，反思就失真了。
 */

const PALETTE: Record<DnaColor, { fill: string; text: string; label: string }> = {
  blue: { fill: "#2563eb", text: "text-blue-700", label: "AI 寫的，你沒改" },
  green: { fill: "#16a34a", text: "text-green-700", label: "AI 寫的，你改過" },
  orange: { fill: "#ea580c", text: "text-orange-700", label: "你自己寫的" },
};

const ORDER: DnaColor[] = ["blue", "green", "orange"];

function percent(ratio: number): number {
  return Math.round(ratio * 100);
}

/** 三色比例圓環。用 stroke-dasharray 畫，不需要任何圖表套件。 */
function Ring({ ratios }: { ratios: Record<DnaColor, number> }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  // 先把每一段的起點算好再畫。在 map 裡累加會被 React 編譯器判為
  // 渲染期間的副作用（react-hooks/immutability），而且重跑時會算錯。
  const arcs: { color: DnaColor; length: number; offset: number }[] = [];
  let cursor = 0;
  for (const color of ORDER) {
    const length = ratios[color] * circumference;
    arcs.push({ color, length, offset: cursor });
    cursor += length;
  }

  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label="三色比例圓環">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="#e5e5e5" strokeWidth="20" />
      {arcs.map((arc) => (
        <circle
          key={arc.color}
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={PALETTE[arc.color].fill}
          strokeWidth="20"
          strokeDasharray={`${arc.length} ${circumference - arc.length}`}
          strokeDashoffset={-arc.offset}
          transform="rotate(-90 70 70)"
        />
      ))}
    </svg>
  );
}

export default function StudentDna({
  dna,
  text,
}: {
  dna: DnaResult;
  text: string;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const paragraphRef = useRef<HTMLDivElement>(null);

  if (dna.textLength === 0) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-bold text-neutral-800">你這篇的文章 DNA</h2>
        <p className="mt-3 text-neutral-600">這次沒有寫進任何文字，所以沒有東西可以看。</p>
      </section>
    );
  }

  function reveal(index: number): void {
    setFocused(index);
    const node = paragraphRef.current?.querySelector(`[data-segment="${index}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="text-lg font-bold text-neutral-800">你這篇的文章 DNA</h2>
      <p className="mt-1 text-neutral-600">
        這篇文章裡，哪些是 AI 寫的、哪些是你自己寫的。
      </p>

      {/* 比例：圓環 + 三行大字 */}
      <div className="mt-5 flex flex-wrap items-center gap-6">
        <Ring ratios={dna.ratios} />
        <ul className="flex min-w-[14rem] flex-1 flex-col gap-3">
          {ORDER.map((color) => (
            <li key={color} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="h-6 w-6 shrink-0 rounded"
                style={{ backgroundColor: PALETTE[color].fill }}
              />
              <span className="flex-1 text-base text-neutral-800">
                {PALETTE[color].label}
              </span>
              <span className={`text-2xl font-bold tabular-nums ${PALETTE[color].text}`}>
                {percent(dna.ratios[color])}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* 條碼：大色塊。點一下捲到文章對應的地方 */}
      <h3 className="mt-6 text-base font-semibold text-neutral-800">
        整篇文章長這樣（點一下顏色，看那是哪一段）
      </h3>
      <div className="mt-2 flex h-12 w-full overflow-hidden rounded-lg">
        {dna.segments.map((segment, index) => (
          <button
            key={`${segment.start}-${segment.end}`}
            type="button"
            onClick={() => reveal(index)}
            aria-label={`第 ${index + 1} 段，${PALETTE[segment.color].label}，${
              segment.end - segment.start
            } 個字`}
            title={PALETTE[segment.color].label}
            className={`h-full transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-neutral-900 ${
              focused !== null && focused !== index ? "opacity-35" : ""
            }`}
            style={{
              backgroundColor: PALETTE[segment.color].fill,
              flexGrow: segment.end - segment.start,
              flexBasis: 0,
              minWidth: "3px",
            }}
          />
        ))}
      </div>

      {/* 文稿：同一組顏色標在字上 */}
      <h3 className="mt-6 text-base font-semibold text-neutral-800">你的文章</h3>
      <div
        ref={paragraphRef}
        className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-neutral-50 px-4 py-3 text-lg leading-loose"
      >
        {dna.segments.map((segment, index) => (
          <mark
            key={`${segment.start}-${segment.end}`}
            data-segment={index}
            className={`rounded px-0.5 ${focused === index ? "ring-2 ring-neutral-900" : ""}`}
            style={{
              backgroundColor: `${PALETTE[segment.color].fill}26`,
              // 底線是給色盲學生的第二個線索：三色的線型不同。
              textDecoration: "underline",
              textDecorationColor: PALETTE[segment.color].fill,
              textDecorationThickness: "3px",
              textUnderlineOffset: "4px",
              textDecorationStyle:
                segment.color === "blue"
                  ? "solid"
                  : segment.color === "green"
                    ? "double"
                    : "dotted",
            }}
          >
            {text.slice(segment.start, segment.end)}
          </mark>
        ))}
      </div>

      {focused !== null ? (
        <FocusDetail segment={dna.segments[focused]} text={text} />
      ) : null}
    </section>
  );
}

/**
 * 點到綠色時，把「AI 本來寫的」跟「你改成的」擺在一起。
 * 這正是反思題目要問的東西：「找一段綠色，你改了什麼？為什麼？」
 * 沒有這個對照，學生答不出來——他早就忘記原本長什麼樣了。
 */
function FocusDetail({ segment, text }: { segment: DnaSegment | undefined; text: string }) {
  if (!segment) return null;
  const current = text.slice(segment.start, segment.end);

  if (segment.color === "green" && segment.sourceText) {
    return (
      <div className="mt-4 rounded-xl bg-neutral-100 p-4">
        <p className="text-base font-semibold text-neutral-800">這一段你改過</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-neutral-600">AI 本來寫的</p>
            <p className="rounded-lg bg-white px-3 py-2 text-base leading-relaxed text-neutral-700">
              {segment.sourceText}
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-neutral-600">你改成的</p>
            <p className="rounded-lg bg-white px-3 py-2 text-base leading-relaxed text-neutral-900">
              {current}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl bg-neutral-100 px-4 py-3">
      <p className="text-base text-neutral-800">
        {segment.color === "blue"
          ? "這一段是 AI 寫的，你直接用了，沒有改。"
          : "這一段是你自己打的。"}
        {"　"}
        <span className="text-neutral-600">共 {segment.end - segment.start} 個字</span>
      </p>
    </div>
  );
}
