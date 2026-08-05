"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import type { PromptQuestion, PromptRow } from "@/lib/admin/types";

/**
 * 【鐵則三／UI 層】本頁刻意不提供任何編輯或刪除既有版本的介面——
 * 沒有編輯按鈕、沒有刪除按鈕、既有版本一律唯讀呈現。
 * 這是 BUILD_PLAN STEP 2 驗收要求的「UI 層拒絕」；API 層見
 * app/api/admin/prompts/route.ts，資料庫層見 004_prompt_version_freeze.sql。
 */
const EMPTY_QUESTION: PromptQuestion = { id: "", text: "", min_chars: 30 };

export default function PromptsClient({ rows }: { rows: PromptRow[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState("");
  const [questions, setQuestions] = useState<PromptQuestion[]>([
    { id: "q1", text: "", min_chars: 30 },
    { id: "q2", text: "", min_chars: 30 },
    { id: "q3", text: "", min_chars: 30 },
  ]);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/prompts", {
        method: "POST",
        body: { version, questions },
      });
      setVersion("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }

  function patchQuestion(index: number, patch: Partial<PromptQuestion>): void {
    setQuestions(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">反思題目</h1>
        <p className="mt-2 text-sm text-neutral-600">
          三次作業必須使用同一版題目。既有版本一經建立即凍結，
          <strong className="font-semibold">本頁不提供編輯與刪除</strong>
          ——需要調整只能新增版本，且僅限正式研究開始前。
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">已建立的版本（唯讀）</h2>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white px-4 py-6 text-neutral-500">
            還沒有任何版本。
          </p>
        ) : (
          rows.map((row) => (
            <article
              key={row.id}
              className="rounded-lg border border-neutral-200 bg-white p-5"
            >
              <div className="flex items-center gap-3">
                <h3 className="font-mono font-semibold">{row.version}</h3>
                <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                  已凍結
                </span>
              </div>
              <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-sm">
                {row.questions.map((q) => (
                  <li key={q.id}>
                    {q.text}
                    <span className="ml-2 text-neutral-500">
                      （至少 {q.min_chars} 字）
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          ))
        )}
      </section>

      <form
        onSubmit={create}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5"
      >
        <h2 className="text-lg font-semibold">新增版本</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">版本名稱</span>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="例如 v1"
            required
            className="w-full max-w-xs rounded border border-neutral-300 px-3 py-2 font-mono"
          />
        </label>

        {questions.map((q, index) => (
          <fieldset
            key={index}
            className="flex flex-col gap-2 rounded border border-neutral-200 p-4"
          >
            <legend className="px-1 text-sm font-medium">第 {index + 1} 題</legend>
            <div className="flex flex-wrap gap-3">
              <input
                value={q.id}
                onChange={(e) => patchQuestion(index, { id: e.target.value })}
                placeholder="題目 id"
                required
                className="w-32 rounded border border-neutral-300 px-3 py-2 font-mono text-sm"
              />
              <input
                value={String(q.min_chars)}
                onChange={(e) =>
                  patchQuestion(index, { min_chars: Number(e.target.value) })
                }
                type="number"
                min="1"
                required
                className="w-28 rounded border border-neutral-300 px-3 py-2 text-sm"
              />
              <span className="self-center text-xs text-neutral-500">最少字數</span>
            </div>
            <textarea
              value={q.text}
              onChange={(e) => patchQuestion(index, { text: e.target.value })}
              rows={2}
              placeholder="題幹，例如：找一段藍色，當時為什麼直接用了 AI 的句子？"
              required
              className="w-full rounded border border-neutral-300 px-3 py-2"
            />
          </fieldset>
        ))}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setQuestions([...questions, { ...EMPTY_QUESTION }])}
            className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50"
          >
            再加一題
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {busy ? "建立中…" : "建立新版本"}
          </button>
        </div>
      </form>
    </div>
  );
}
