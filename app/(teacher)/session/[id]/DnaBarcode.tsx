"use client";

import { useState } from "react";
import type { DnaColor, DnaResult, SegmentOrigin } from "@/lib/dna/attribute";

/**
 * 研究者／教師版 DNA 條碼。
 *
 * 與學生版是同一份資料、不同呈現：這裡可以用學術語彙、顯示相似度數值、
 * 把「外部貼上」從橘色裡拆出來——那些東西給 13 歲看只會造成誤解。
 *
 * hover（或鍵盤 focus）任一區段顯示 Before/After 對照，這是人工檢核歸因
 * 正確性的入口：θ 敏感度分析要靠研究者一段一段看過來。
 */

const FILL: Record<DnaColor, string> = {
  blue: "#2563eb",
  green: "#16a34a",
  orange: "#ea580c",
};

const COLOR_LABEL: Record<DnaColor, string> = {
  blue: "AI 原文（未修改）",
  green: "AI 原文（已修改）",
  orange: "學生自撰／外部",
};

const ORIGIN_LABEL: Record<SegmentOrigin, string> = {
  ai: "AI 來源",
  external: "外部貼上",
  typed: "手動輸入",
};

const ORDER: DnaColor[] = ["blue", "green", "orange"];

export default function DnaBarcode({ dna, text }: { dna: DnaResult; text: string }) {
  const [active, setActive] = useState<number | null>(null);
  const segment = active === null ? null : dna.segments[active];

  if (dna.textLength === 0) {
    return (
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-neutral-700">文章 DNA</h2>
        <p className="mt-2 text-sm text-neutral-600">終稿為空，無可歸因區段。</p>
      </section>
    );
  }

  const width = 1000;

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">文章 DNA</h2>
        <p className="text-xs text-neutral-500">
          θ_high {dna.theta.high}／θ_low {dna.theta.low}　全文 {dna.textLength} 字
        </p>
      </div>

      {/* SVG 條碼。可直接另存為向量圖放進論文。 */}
      <svg
        viewBox={`0 0 ${width} 44`}
        preserveAspectRatio="none"
        className="mt-3 h-11 w-full rounded"
        role="img"
        aria-label="文章三色歸因條碼"
      >
        {dna.segments.map((item, index) => {
          const x = (item.start / dna.textLength) * width;
          const w = Math.max(((item.end - item.start) / dna.textLength) * width, 0.75);
          return (
            <rect
              key={`${item.start}-${item.end}`}
              x={x}
              y={0}
              width={w}
              height={44}
              fill={FILL[item.color]}
              opacity={active !== null && active !== index ? 0.3 : 1}
              tabIndex={0}
              role="button"
              aria-label={`${item.start}–${item.end} 字，${COLOR_LABEL[item.color]}`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onBlur={() => setActive(null)}
              style={{ cursor: "pointer" }}
            />
          );
        })}
      </svg>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-600">
        {ORDER.map((color) => (
          <span key={color} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: FILL[color] }}
            />
            {COLOR_LABEL[color]}
            <span className="tabular-nums font-medium">
              {dna.counts[color]} 字（{Math.round(dna.ratios[color] * 100)}%）
            </span>
          </span>
        ))}
      </div>

      {/*
        橘色把「學生自撰」與「外部貼上」合在一起——三色是給學生看的框架，
        不能再多一色。研究者端要分得開，所以另外列出來。
      */}
      <p className="mt-2 text-xs text-neutral-500">
        來源拆分：AI {dna.originCounts.ai} 字／外部貼上 {dna.originCounts.external} 字／
        手動輸入 {dna.originCounts.typed} 字
      </p>

      <div className="mt-4 min-h-[7rem] rounded-lg bg-neutral-50 p-4">
        {segment ? (
          <>
            <p className="text-xs text-neutral-600">
              {segment.start}–{segment.end} 字　{COLOR_LABEL[segment.color]}
              {ORIGIN_LABEL[segment.origin]}
              {segment.similarity !== null
                ? `　相似度 ${segment.similarity.toFixed(3)}`
                : segment.origin === "ai"
                  ? "　相似度 無法計算（來源訊息對不上）"
                  : ""}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-500">Before（AI 原文）</p>
                <p className="whitespace-pre-wrap rounded bg-white px-3 py-2 text-sm leading-relaxed text-neutral-700">
                  {segment.sourceText ?? "—"}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-500">After（終稿）</p>
                <p className="whitespace-pre-wrap rounded bg-white px-3 py-2 text-sm leading-relaxed text-neutral-900">
                  {text.slice(segment.start, segment.end)}
                </p>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-neutral-500">
            將游標移到條碼上（或以 Tab 鍵聚焦）檢視該區段的 Before/After 對照。
          </p>
        )}
      </div>
    </section>
  );
}
