"use client";

import { useCallback, useRef } from "react";

/**
 * 左右欄的拖曳分隔線。
 *
 * 無障礙：role="separator" + aria-valuenow，並支援方向鍵調整——
 * 只能用滑鼠拖的分隔線對鍵盤與輔助技術使用者等於不存在。
 * 螢幕寬度小於 lg 時整條隱藏（那時是上下分頁切換，沒有左右欄可分）。
 */
export default function SplitHandle({
  percent,
  onChange,
}: {
  percent: number;
  onChange: (next: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const clamp = (value: number): number => Math.min(70, Math.max(25, value));

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = ref.current?.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();

      const move = (e: PointerEvent): void => {
        onChange(clamp(((e.clientX - rect.left) / rect.width) * 100));
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onChange],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 10 : 2;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onChange(clamp(percent - step));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onChange(clamp(percent + step));
      }
    },
    [percent, onChange],
  );

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="調整左右兩欄的寬度"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={25}
      aria-valuemax={70}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="hidden w-3 shrink-0 cursor-col-resize touch-none items-center justify-center rounded bg-neutral-200 hover:bg-neutral-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 lg:flex"
    >
      <span aria-hidden className="h-8 w-0.5 rounded bg-neutral-400" />
    </div>
  );
}
