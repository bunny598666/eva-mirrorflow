"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { emitEvent, flush } from "@/lib/events/queue";
import type { CaptureHandle } from "@/lib/events/capture";

/**
 * 交件。
 *
 * 【送出前要先把該落地的東西全部落地】順序是：
 *   結清打字批次 → 記 submit 事件 → 把事件推上去 → 存最後一份快照 → 呼叫 API
 *
 * 最後那份快照是 DNA 歸因唯一的輸入（marks 只存在快照裡）。少了它，
 * 學生最後幾十秒寫的東西就不會出現在條碼上——而交件不可回退，補不回來。
 * 所以快照沒送成功就不送出交件，寧可讓學生再按一次。
 */
export default function SubmitButton({
  sessionId,
  capture,
  saveSnapshot,
}: {
  sessionId: string;
  capture: () => CaptureHandle | null;
  saveSnapshot: () => Promise<boolean>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNotice("");

    try {
      await capture()?.flushPending();
      await emitEvent(sessionId, "submit", {});
      await flush(sessionId);

      const stored = await saveSnapshot();
      if (!stored) {
        setNotice("你的文章還沒存好，檢查一下網路，等一下再按一次");
        setBusy(false);
        return;
      }

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "現在交不出去，等一下再按一次";
        setNotice(message);
        setBusy(false);
        return;
      }

      router.push(`/mirror/${sessionId}`);
    } catch {
      setNotice("連不上，檢查一下網路再按一次");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          交出去
        </button>
        {notice ? (
          <p role="alert" className="text-sm text-orange-700">
            {notice}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-3">
      {/* 交件不可回退（資料庫層擋住狀態倒退），所以一定要問清楚。 */}
      <p className="text-base text-neutral-800">交出去之後就不能再改了，確定嗎？</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-lg border border-neutral-300 px-4 py-2.5 text-base"
        >
          再想想
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-base font-medium text-white disabled:opacity-50"
        >
          {busy ? "正在交…" : "確定交出去"}
        </button>
      </div>
      {notice ? (
        <p role="alert" className="text-sm text-orange-700">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
