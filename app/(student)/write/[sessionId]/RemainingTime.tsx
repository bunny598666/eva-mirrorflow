"use client";

import { useEffect, useState } from "react";

/**
 * 剩餘時間。
 *
 * 時間到「不會」自動交件——強制交件會讓學生正在打的段落憑空消失，
 * 那是資料遺失，也是信任崩壞。時間到只換成提醒文字。
 *
 * 首次渲染刻意顯示「—」：倒數依賴當下時間，若在伺服器端就算好會與
 * 用戶端對不上而產生 hydration 不一致。
 */
export default function RemainingTime({
  startedAt,
  minutes,
}: {
  startedAt: string;
  minutes: number;
}) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const deadline = new Date(startedAt).getTime() + minutes * 60_000;
    const tick = (): void => setLeft(deadline - Date.now());
    const timer = window.setInterval(tick, 1000);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [startedAt, minutes]);

  if (left === null) {
    return (
      <span className="tabular-nums text-neutral-500" aria-live="off">
        —
      </span>
    );
  }

  if (left <= 0) {
    return (
      <span className="font-medium text-orange-700">
        時間到了，寫完就可以交
      </span>
    );
  }

  const totalSeconds = Math.floor(left / 1000);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  const urgent = left < 5 * 60_000;

  return (
    <span
      // 每秒都播報會吵死螢幕閱讀器使用者；只在最後五分鐘才提醒。
      aria-live={urgent ? "polite" : "off"}
      className={`tabular-nums ${urgent ? "font-medium text-orange-700" : "text-neutral-600"}`}
    >
      還有 {mm}:{String(ss).padStart(2, "0")}
    </span>
  );
}
