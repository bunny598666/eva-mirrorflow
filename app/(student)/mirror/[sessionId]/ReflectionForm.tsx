"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clearDraft, loadDraft, saveDraft } from "@/lib/reflection/draft";
import {
  countChars,
  minCharsOf,
  type ReflectionAnswer,
  type ReflectionPrompt,
  type ReflectionRecord,
} from "@/lib/reflection/types";

/**
 * 反思表單。
 *
 * 【邊打邊存 IndexedDB】CLAUDE.md §6：學生打的 90 字反思弄丟一次，信任就沒了。
 * 所以不是「送失敗才存」——分頁當掉、平板沒電、家長把瀏覽器關掉，
 * 那些情況「送失敗才存」一樣救不回來。每次輸入都存，送出成功才刪。
 *
 * 【送不出去也不清空】網路斷了就留在畫面上、也留在 IndexedDB 裡，
 * 只告訴學生等一下再按一次。
 */

const SAVE_DEBOUNCE_MS = 500;

export default function ReflectionForm({
  sessionId,
  prompt,
  existing,
  viewedDnaAt,
  viewedReplayAt,
}: {
  sessionId: string;
  prompt: ReflectionPrompt;
  existing: ReflectionRecord | null;
  viewedDnaAt: string | null;
  viewedReplayAt: string | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [restored, setRestored] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // 讀回草稿。已經送出過的就不必了（表單是唯讀的）。
  useEffect(() => {
    if (existing) return;
    let alive = true;
    void loadDraft(sessionId).then((draft) => {
      if (!alive || !draft) return;
      const map: Record<string, string> = {};
      for (const answer of draft.answers) map[answer.question_id] = answer.text;
      setAnswers(map);
      setRestored(Object.values(map).some((text) => text.trim() !== ""));
    });
    return () => {
      alive = false;
    };
  }, [sessionId, existing]);

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, []);

  function update(questionId: string, text: string): void {
    const next = { ...answers, [questionId]: text };
    setAnswers(next);
    setNotice("");

    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveDraft({
        session_id: sessionId,
        prompt_version: prompt.version,
        answers: prompt.questions.map((question) => ({
          question_id: question.id,
          text: next[question.id] ?? "",
        })),
        updated_at: new Date().toISOString(),
      });
    }, SAVE_DEBOUNCE_MS);
  }

  // 唯讀模式：反思是 append-only，寫過就不能改。
  if (existing) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-bold text-neutral-800">你寫的想法</h2>
        <p className="mt-1 text-neutral-600">寫過的就不能改了，這是你當時寫的。</p>
        <ol className="mt-4 flex flex-col gap-4">
          {prompt.questions.map((question, index) => (
            <li key={question.id}>
              <p className="text-base font-medium text-neutral-800">
                {index + 1}. {question.text}
              </p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 px-4 py-3 text-base leading-relaxed text-neutral-800">
                {existing.answers.find((a) => a.question_id === question.id)?.text ?? "（沒有作答）"}
              </p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const complete = prompt.questions.every(
    (question) => countChars(answers[question.id] ?? "") >= minCharsOf(question),
  );

  async function submit(): Promise<void> {
    if (busy || !complete) return;
    setBusy(true);
    setNotice("");

    const payload: ReflectionAnswer[] = prompt.questions.map((question) => ({
      question_id: question.id,
      text: answers[question.id] ?? "",
    }));

    // 送出前先確保草稿是最新的。萬一這次請求失敗、學生又順手關掉分頁，
    // 至少 IndexedDB 裡是他最後打的版本。
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    await saveDraft({
      session_id: sessionId,
      prompt_version: prompt.version,
      answers: payload,
      updated_at: new Date().toISOString(),
    });

    try {
      const res = await fetch("/api/reflections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          answers: payload,
          viewed_dna_at: viewedDnaAt,
          viewed_replay_at: viewedReplayAt,
        }),
      });

      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "現在送不出去，等一下再按一次";
        // 草稿留著，畫面上的字也留著。
        setNotice(message);
        setBusy(false);
        return;
      }

      await clearDraft(sessionId);
      router.push("/");
      router.refresh();
    } catch {
      setNotice("連不上，你打的字有留著，等一下再按一次");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-6">
      <h2 className="text-lg font-bold text-neutral-800">寫一下你的想法</h2>
      <p className="mt-1 text-neutral-600">三個問題，每一題至少寫 30 個字。</p>

      {restored ? (
        <p className="mt-3 rounded-lg bg-neutral-100 px-4 py-2.5 text-sm text-neutral-700">
          幫你留著上次打到一半的內容了。
        </p>
      ) : null}

      <ol className="mt-4 flex flex-col gap-6">
        {prompt.questions.map((question, index) => {
          const value = answers[question.id] ?? "";
          const written = countChars(value);
          const required = minCharsOf(question);
          const enough = written >= required;
          return (
            <li key={question.id}>
              <label
                htmlFor={`q-${question.id}`}
                className="block text-base font-medium text-neutral-800"
              >
                {index + 1}. {question.text}
              </label>
              <textarea
                id={`q-${question.id}`}
                rows={4}
                value={value}
                onChange={(e) => update(question.id, e.target.value)}
                disabled={busy}
                className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base leading-relaxed"
              />
              <p
                className={`mt-1 text-sm ${enough ? "text-green-700" : "text-neutral-500"}`}
                aria-live="polite"
              >
                {enough ? `已經寫了 ${written} 個字，可以了` : `還要 ${required - written} 個字`}
              </p>
            </li>
          );
        })}
      </ol>

      {notice ? (
        <p role="alert" className="mt-4 rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {notice}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !complete}
        className="mt-5 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "送出中…" : "送出"}
      </button>
      {!complete ? (
        <p className="mt-2 text-sm text-neutral-500">三題都寫滿 30 個字才能送出。</p>
      ) : null}
    </section>
  );
}
