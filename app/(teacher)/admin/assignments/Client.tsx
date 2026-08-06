"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { parseScaffoldButtons, type ScaffoldButton } from "@/lib/scaffold/types";
import type { AssignmentRow } from "@/lib/admin/types";

const BLANK: ScaffoldButton = { id: "", label: "", template: "" };

export default function AssignmentsClient({ rows }: { rows: AssignmentRow[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", instructions: "", order_no: "1" });
  const [scaffolds, setScaffolds] = useState<ScaffoldButton[]>([
    { id: "ask-idea", label: "幫我想想", template: "我不知道要寫什麼，可以問我幾個問題嗎？" },
    { id: "ask-why", label: "問我為什麼", template: "我寫了這一段，你覺得哪裡可以講得更清楚？" },
  ]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editScaffolds, setEditScaffolds] = useState<ScaffoldButton[]>([]);

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/assignments", {
        method: "POST",
        body: {
          ...form,
          order_no: Number(form.order_no),
          scaffold_buttons: scaffolds.filter((s) => s.id && s.label && s.template),
        },
      });
      setForm({ title: "", instructions: "", order_no: form.order_no });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }

  async function saveScaffolds(id: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/assignments/${id}`, {
        method: "PATCH",
        body: {
          scaffold_buttons: editScaffolds.filter((s) => s.id && s.label && s.template),
        },
      });
      setEditing(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  const usedOrders = new Set(rows.map((r) => r.order_no));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">作業</h1>
        <p className="mt-2 text-sm text-neutral-600">
          三期各一份，期別 1／2／3 各只能有一份。作業說明與鷹架按鈕都是研究的
          刺激材料，一旦有學生開始作答就不能再修改。
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        {[1, 2, 3].map((order) => {
          const row = rows.find((r) => r.order_no === order);
          const buttons = row ? parseScaffoldButtons(row.scaffold_buttons) : [];
          return (
            <article
              key={order}
              className="rounded-lg border border-neutral-200 bg-white p-5"
            >
              <div className="flex items-center gap-3">
                <span className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white">
                  第 {order} 期
                </span>
                <h2 className="font-semibold">{row ? row.title : "尚未建立"}</h2>
              </div>

              {row ? (
                <>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">
                    {row.instructions}
                  </p>

                  <div className="mt-4 border-t border-neutral-100 pt-4">
                    <h3 className="text-sm font-medium text-neutral-700">
                      鷹架按鈕（全程開啟）
                    </h3>

                    {editing === row.id ? (
                      <div className="mt-3 flex flex-col gap-3">
                        <ScaffoldEditor
                          value={editScaffolds}
                          onChange={setEditScaffolds}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void saveScaffolds(row.id)}
                            className="rounded bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                          >
                            儲存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="rounded border border-neutral-300 px-4 py-2 text-sm"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {buttons.length === 0 ? (
                          <p className="mt-2 text-sm text-neutral-500">還沒設定。</p>
                        ) : (
                          <ul className="mt-2 flex flex-col gap-1 text-sm">
                            {buttons.map((b) => (
                              <li key={b.id}>
                                <span className="rounded-full border border-neutral-300 px-2 py-0.5">
                                  {b.label}
                                </span>
                                <span className="ml-2 text-neutral-500">
                                  {b.template}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(row.id);
                            setEditScaffolds(
                              buttons.length ? buttons : [{ ...BLANK }],
                            );
                          }}
                          className="mt-3 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
                        >
                          編輯鷹架按鈕
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : null}
            </article>
          );
        })}
      </section>

      <form
        onSubmit={create}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5"
      >
        <h2 className="text-lg font-semibold">新增作業</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">期別</span>
          <select
            value={form.order_no}
            onChange={(e) => setForm({ ...form, order_no: e.target.value })}
            className="w-40 rounded border border-neutral-300 px-3 py-2"
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={String(n)} disabled={usedOrders.has(n)}>
                第 {n} 期{usedOrders.has(n) ? "（已建立）" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">標題</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="w-full rounded border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-neutral-700">作業說明</span>
          <textarea
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            rows={5}
            required
            className="w-full rounded border border-neutral-300 px-3 py-2"
          />
        </label>

        <fieldset className="flex flex-col gap-3 rounded border border-neutral-200 p-4">
          <legend className="px-1 text-sm font-medium">鷹架按鈕</legend>
          <p className="text-xs text-neutral-500">
            學生點了按鈕，模板文字會塞進對話輸入框，並記錄一筆 scaffold_click。
          </p>
          <ScaffoldEditor value={scaffolds} onChange={setScaffolds} />
        </fieldset>

        <button
          type="submit"
          disabled={busy}
          className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "建立中…" : "建立作業"}
        </button>
      </form>
    </div>
  );
}

function ScaffoldEditor({
  value,
  onChange,
}: {
  value: ScaffoldButton[];
  onChange: (next: ScaffoldButton[]) => void;
}) {
  const patch = (index: number, part: Partial<ScaffoldButton>): void =>
    onChange(value.map((b, i) => (i === index ? { ...b, ...part } : b)));

  return (
    <div className="flex flex-col gap-3">
      {value.map((button, index) => (
        <div key={index} className="flex flex-wrap items-start gap-2">
          <label className="sr-only" htmlFor={`sc-id-${index}`}>
            按鈕 id
          </label>
          <input
            id={`sc-id-${index}`}
            value={button.id}
            onChange={(e) => patch(index, { id: e.target.value })}
            placeholder="id"
            className="w-28 rounded border border-neutral-300 px-2 py-1.5 font-mono text-sm"
          />
          <label className="sr-only" htmlFor={`sc-label-${index}`}>
            按鈕文字
          </label>
          <input
            id={`sc-label-${index}`}
            value={button.label}
            onChange={(e) => patch(index, { label: e.target.value })}
            placeholder="按鈕文字"
            className="w-32 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <label className="sr-only" htmlFor={`sc-tpl-${index}`}>
            插入的句子
          </label>
          <input
            id={`sc-tpl-${index}`}
            value={button.template}
            onChange={(e) => patch(index, { template: e.target.value })}
            placeholder="點下去會塞進輸入框的句子"
            className="min-w-48 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
            aria-label={`刪除第 ${index + 1} 個鷹架按鈕`}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            刪除
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, { ...BLANK }])}
        className="self-start rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
      >
        再加一個按鈕
      </button>
    </div>
  );
}
