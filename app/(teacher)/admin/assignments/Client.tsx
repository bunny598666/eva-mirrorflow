"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import type { AssignmentRow } from "@/lib/admin/types";

export default function AssignmentsClient({ rows }: { rows: AssignmentRow[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: "", instructions: "", order_no: "1" });

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/assignments", {
        method: "POST",
        body: { ...form, order_no: Number(form.order_no) },
      });
      setForm({ title: "", instructions: "", order_no: form.order_no });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
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
          三期各一份，期別 1／2／3 各只能有一份。作業說明是研究的刺激材料，
          一旦有學生開始作答就不能再修改。
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
                <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">
                  {row.instructions}
                </p>
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
