"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { emitEvent, flush } from "@/lib/events/queue";

/**
 * 建立（或接回）這一期的場次，然後進寫作頁。
 *
 * recap_view 事件在場次建立之後才記——事件必須掛在一個真的場次上，
 * 而學生按下按鈕之前，這一期的場次可能還不存在。
 */
export default function StartWriting({
  assignmentId,
  recapPayload,
}: {
  assignmentId: string;
  /** 有值代表這次真的顯示過 recap 卡，要記一筆 recap_view。 */
  recapPayload: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<{ session: { id: string } }>("/api/sessions", {
        method: "POST",
        body: { assignment_id: assignmentId },
      });
      if (recapPayload) {
        await emitEvent(data.session.id, "recap_view", recapPayload);
        await flush(data.session.id);
      }
      router.push(`/write/${data.session.id}`);
    } catch {
      // 學生端不彈技術訊息（CLAUDE.md §6）
      setError("開不起來，跟老師說一聲");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        className="rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white disabled:opacity-50"
      >
        {busy ? "開啟中…" : "開始這次寫作"}
      </button>
    </div>
  );
}
