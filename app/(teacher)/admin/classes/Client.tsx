"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import type { ClassRow } from "@/lib/admin/types";

const GRADES = [
  { value: "junior_high", label: "國中" },
  { value: "senior_high", label: "高中" },
  { value: "university", label: "大學" },
];

export default function ClassesClient({ rows }: { rows: ClassRow[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    label: "",
    grade_level: "junior_high",
    model: "claude-haiku-4-5-20251001",
    temperature: "0.7",
    system_prompt_version: "v1",
  });

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/classes", {
        method: "POST",
        body: { ...form, temperature: Number(form.temperature) },
      });
      setForm({ ...form, label: "" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">班級</h1>
        <p className="mt-2 text-sm text-neutral-600">
          模型、temperature 與 system prompt 版本是三期可比的基礎。一旦該班有任何
          作答紀錄，這三項就不能再改。
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}

      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3">班級</th>
              <th className="px-4 py-3">學制</th>
              <th className="px-4 py-3">模型</th>
              <th className="px-4 py-3">temperature</th>
              <th className="px-4 py-3">prompt 版本</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-neutral-500">
                  還沒有班級。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{row.label}</td>
                  <td className="px-4 py-3">
                    {GRADES.find((g) => g.value === row.grade_level)?.label ??
                      row.grade_level}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{row.model}</td>
                  <td className="px-4 py-3">{row.temperature}</td>
                  <td className="px-4 py-3">{row.system_prompt_version}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <form
        onSubmit={create}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5"
      >
        <h2 className="text-lg font-semibold">新增班級</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="班級名稱">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              required
              className="w-full rounded border border-neutral-300 px-3 py-2"
            />
          </Field>
          <Field label="學制">
            <select
              value={form.grade_level}
              onChange={(e) => setForm({ ...form, grade_level: e.target.value })}
              className="w-full rounded border border-neutral-300 px-3 py-2"
            >
              {GRADES.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模型">
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              required
              className="w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm"
            />
          </Field>
          <Field label="temperature">
            <input
              value={form.temperature}
              onChange={(e) => setForm({ ...form, temperature: e.target.value })}
              type="number"
              step="0.05"
              min="0"
              max="2"
              required
              className="w-full rounded border border-neutral-300 px-3 py-2"
            />
          </Field>
          <Field label="system prompt 版本">
            <input
              value={form.system_prompt_version}
              onChange={(e) =>
                setForm({ ...form, system_prompt_version: e.target.value })
              }
              required
              className="w-full rounded border border-neutral-300 px-3 py-2"
            />
          </Field>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "建立中…" : "建立班級"}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}
