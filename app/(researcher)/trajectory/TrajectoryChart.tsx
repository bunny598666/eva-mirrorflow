"use client";

import { useMemo, useState } from "react";
import {
  QUADRANT_LABEL,
  startingQuadrant,
  type QuadrantName,
  type Trajectory,
} from "@/lib/metrics/quadrant";
import {
  colorFor,
  DEFAULT_CHART,
  renderTrajectorySvg,
  scaleFor,
  shapeFor,
  shapePath,
} from "@/lib/metrics/chart";

/**
 * 三期軌跡圖（研究者端）。
 *
 * 畫面與匯出檔用**同一支** renderTrajectorySvg：所見即所得，不會發生
 * 「畫面好好的，匯出卻跑版」。畫面版本額外疊一層透明的 hover 熱區——
 * 那層不進匯出檔，所以匯出的 SVG 裡沒有任何多餘元素。
 */

const FILTERS: { key: QuadrantName | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "free_rider", label: QUADRANT_LABEL.free_rider },
  { key: "outsourcer", label: QUADRANT_LABEL.outsourcer },
  { key: "solo", label: QUADRANT_LABEL.solo },
  { key: "collaborator", label: QUADRANT_LABEL.collaborator },
];

export default function TrajectoryChart({ trajectories }: { trajectories: Trajectory[] }) {
  const [filter, setFilter] = useState<QuadrantName | "all">("all");
  const [hovered, setHovered] = useState<string | null>(null);

  const shown = useMemo(
    () =>
      filter === "all"
        ? trajectories
        : trajectories.filter((t) => startingQuadrant(t) === filter),
    [trajectories, filter],
  );

  const svg = useMemo(() => renderTrajectorySvg(shown, DEFAULT_CHART), [shown]);
  const scale = useMemo(() => scaleFor(DEFAULT_CHART), []);
  const detail = shown.find((t) => t.participantCode === hovered) ?? null;

  function exportSvg(): void {
    // 匯出檔走英文標籤：期刊投稿用，而且英文字母在任何基礎字型裡都有，
    // 不必嵌入字型檔也不會缺字。
    const markup = renderTrajectorySvg(shown, { ...DEFAULT_CHART, english: true });
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mirrorflow-trajectory-${filter}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (trajectories.length === 0) {
    return (
      <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-600">
        還沒有任何象限座標。學生交件之後才會產生。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-600">起始象限：</span>
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              aria-pressed={filter === item.key}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                filter === item.key
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 bg-white text-neutral-700"
              }`}
            >
              {item.label}
            </button>
          ))}
          <span className="text-sm text-neutral-500">
            {shown.length} / {trajectories.length} 人
          </span>
        </div>
        <button
          type="button"
          onClick={exportSvg}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          匯出 SVG
        </button>
      </div>

      <div className="relative overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        {/* 圖本身：與匯出檔完全同一份標記 */}
        {/*
          內容由 lib/metrics/chart.ts 產生：純數值與經 escapeXml 跳脫的代號，
          沒有任何一段來自外部輸入的原始標記。
        */}
        <div className="min-w-[720px]" dangerouslySetInnerHTML={{ __html: svg }} />

        {/* hover 熱區。疊在圖上，不進匯出檔。 */}
        <svg
          className="pointer-events-none absolute inset-0 min-w-[720px]"
          width={DEFAULT_CHART.width}
          height={DEFAULT_CHART.height}
          aria-hidden="true"
        >
          {shown.map((trajectory) =>
            trajectory.points.map((point) => (
              <path
                key={`${trajectory.participantCode}-${point.orderNo}`}
                d={shapePath(shapeFor(point.orderNo), scale.x(point.x), scale.y(point.y), 11)}
                fill="transparent"
                className="pointer-events-auto cursor-pointer"
                onMouseEnter={() => setHovered(trajectory.participantCode)}
                onMouseLeave={() => setHovered(null)}
              />
            )),
          )}
        </svg>
      </div>

      {/* 鍵盤與螢幕報讀器的等價路徑：hover 之外也要讀得到每個人的三期數值 */}
      <details className="rounded-lg border border-neutral-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-medium text-neutral-700">
          逐人數值表（{shown.length} 人）
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-600">
                <th className="py-2 pr-4">代號</th>
                <th className="py-2 pr-4">期別</th>
                <th className="py-2 pr-4">X 互動深度</th>
                <th className="py-2 pr-4">Y 原創性</th>
                <th className="py-2 pr-4">象限</th>
                <th className="py-2 pr-4">輪次</th>
                <th className="py-2 pr-4">平均字數</th>
                <th className="py-2 pr-4">高階提問</th>
                <th className="py-2">基準人數</th>
              </tr>
            </thead>
            <tbody>
              {shown.flatMap((trajectory) =>
                trajectory.points.map((point) => (
                  <tr
                    key={`${trajectory.participantCode}-${point.orderNo}`}
                    className="border-b border-neutral-100"
                    onMouseEnter={() => setHovered(trajectory.participantCode)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <td className="py-1.5 pr-4">
                      <span
                        aria-hidden="true"
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ backgroundColor: colorFor(trajectory.participantCode) }}
                      />
                      {trajectory.participantCode}
                    </td>
                    <td className="py-1.5 pr-4">第 {point.orderNo} 次</td>
                    <td className="py-1.5 pr-4 tabular-nums">{point.x.toFixed(2)}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{point.y.toFixed(3)}</td>
                    <td className="py-1.5 pr-4">{QUADRANT_LABEL[point.quadrant]}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{point.raw.turns}</td>
                    <td className="py-1.5 pr-4 tabular-nums">
                      {point.raw.promptChars.toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-4 tabular-nums">{point.raw.highOrder}</td>
                    <td className="py-1.5 tabular-nums">{point.cohortN}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>

      {detail ? (
        <div className="rounded-lg border border-neutral-300 bg-white p-4">
          <p className="text-sm font-semibold text-neutral-800">{detail.participantCode}</p>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-700">
            {detail.points.map((point) => (
              <li key={point.orderNo} className="tabular-nums">
                第 {point.orderNo} 次：X {point.x.toFixed(2)}　Y {point.y.toFixed(3)}
                {QUADRANT_LABEL[point.quadrant]}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          把游標移到圖上的點（或表格的一列）可看該生三期數值。
        </p>
      )}
    </div>
  );
}
