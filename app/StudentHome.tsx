"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import type { AssignmentSummary, WritingSession } from "@/lib/student/queries";

type Item = { assignment: AssignmentSummary; session: WritingSession | null };

export default function StudentHome({
  code,
  items,
}: {
  code: string;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function start(assignmentId: string): Promise<void> {
    setBusy(assignmentId);
    setError("");
    try {
      const data = await api<{ session: { id: string } }>("/api/sessions", {
        method: "POST",
        body: { assignment_id: assignmentId },
      });
      router.push(`/write/${data.session.id}`);
    } catch {
      // 學生端不彈技術訊息（CLAUDE.md §6）
      setError("開不起來，跟老師說一聲");
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-3xl font-bold">歷程之鏡</h1>
        <p className="mt-1 text-neutral-600">{code}，你好。</p>
      </header>

      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-lg bg-neutral-100 px-4 py-3 text-neutral-700">
          還沒有作業，等老師開始。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map(({ assignment, session }) => {
            const done = session?.status === "reflected";
            const submitted = session?.status === "submitted";
            return (
              <li
                key={assignment.id}
                className="rounded-lg border border-neutral-200 bg-white p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white">
                    第 {assignment.order_no} 次
                  </span>
                  <h2 className="text-lg font-semibold">{assignment.title}</h2>
                </div>

                <div className="mt-4">
                  {done ? (
                    <p className="text-neutral-600">這次已經寫完，也寫過想法了。</p>
                  ) : submitted ? (
                    <p className="text-neutral-600">已經交了，等看自己的歷程。</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void start(assignment.id)}
                      disabled={busy !== null}
                      className="rounded-lg bg-neutral-900 px-5 py-3 text-base font-medium text-white disabled:opacity-50"
                    >
                      {busy === assignment.id
                        ? "開啟中…"
                        : session
                          ? "繼續寫"
                          : "開始寫作"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
