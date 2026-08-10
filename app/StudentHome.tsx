"use client";

import { useState } from "react";
import Link from "next/link";
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

  /**
   * 第 2、3 期一律先經過 recap（「上次的你」），第 1 期直接開始。
   *
   * 判斷條件是「有沒有上一期、上一期交了沒」——與 lib/mirror/recap.ts 同語意。
   * 這裡先擋一層只是為了少跳轉一次；recap 頁自己也會判，沒東西可回顧時
   * 只留一顆開始按鈕。SRL 的迴圈就靠這一步接起來，不能讓學生繞過去。
   */
  function hasRecap(orderNo: number): boolean {
    return items.some(
      (item) =>
        item.assignment.order_no < orderNo &&
        item.session !== null &&
        item.session.status !== "active",
    );
  }

  async function start(assignment: AssignmentSummary): Promise<void> {
    setBusy(assignment.id);
    setError("");

    if (hasRecap(assignment.order_no)) {
      router.push(`/recap/${assignment.id}`);
      return;
    }

    try {
      const data = await api<{ session: { id: string } }>("/api/sessions", {
        method: "POST",
        body: { assignment_id: assignment.id },
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
            const mirrorHref = session ? `/mirror/${session.id}` : "/";
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
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-neutral-600">這次已經寫完，也寫過想法了。</p>
                      <Link
                        href={mirrorHref}
                        className="rounded-lg border border-neutral-300 px-4 py-2 text-base"
                      >
                        再看一次我的歷程
                      </Link>
                    </div>
                  ) : submitted ? (
                    // 交了但還沒寫反思：這是鏡子迴圈的下一步，做成主要動作。
                    <Link
                      href={mirrorHref}
                      className="inline-block rounded-lg bg-neutral-900 px-5 py-3 text-base font-medium text-white"
                    >
                      看看我這次是怎麼寫的
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void start(assignment)}
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
