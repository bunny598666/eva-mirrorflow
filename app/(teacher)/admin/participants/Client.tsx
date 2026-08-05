"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import type { ClassRow, ParticipantRow } from "@/lib/admin/types";

type Credential = { code: string; pin: string };

export default function ParticipantsClient({
  classes,
  rows,
}: {
  classes: ClassRow[];
  rows: ParticipantRow[];
}) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [count, setCount] = useState("45");
  const [prefix, setPrefix] = useState("S");
  const [fresh, setFresh] = useState<Credential[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function generate(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFresh(null);
    try {
      const data = await api<{ credentials: Credential[] }>("/api/admin/participants", {
        method: "POST",
        body: { class_id: classId, count: Number(count), prefix },
      });
      setFresh(data.credentials);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "產生失敗");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv(): void {
    if (!fresh) return;
    const lines = ["code,pin", ...fresh.map((c) => `${c.code},${c.pin}`)];
    const blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `participants-${prefix}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">參與者代號</h1>
        <p className="mt-2 text-sm text-neutral-600">
          只產生代號與 PIN，不輸入任何姓名或學號。PIN 明碼只在產生的當下顯示一次，
          資料庫只存雜湊——關掉就查不回來了，請先下載 CSV。
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}

      {fresh ? (
        <section className="rounded-lg border-2 border-amber-400 bg-amber-50 p-5">
          <h2 className="text-lg font-semibold text-amber-900">
            剛產生的 {fresh.length} 組帳號 —— 只會顯示這一次
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            現在就下載 CSV。離開這一頁之後，這些 PIN 明碼無法再取得，
            只能作廢重發。下載後請妥善保管，發完即銷毀。
          </p>
          <button
            type="button"
            onClick={downloadCsv}
            className="mt-3 rounded bg-amber-900 px-4 py-2 text-white"
          >
            下載 CSV
          </button>
          <div className="mt-4 grid gap-1 font-mono text-sm sm:grid-cols-3">
            {fresh.map((c) => (
              <div key={c.code}>
                {c.code} · {c.pin}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <form
        onSubmit={generate}
        className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-5"
      >
        <h2 className="text-lg font-semibold">批次產生</h2>
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">班級</span>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              required
              className="rounded border border-neutral-300 px-3 py-2"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">人數</span>
            <input
              value={count}
              onChange={(e) => setCount(e.target.value)}
              type="number"
              min="1"
              max="60"
              required
              className="w-28 rounded border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-700">代號前綴</span>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
              maxLength={4}
              required
              className="w-24 rounded border border-neutral-300 px-3 py-2 font-mono"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={busy || classes.length === 0}
          className="self-start rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "產生中…" : "產生代號與 PIN"}
        </button>
        {classes.length === 0 ? (
          <p className="text-sm text-neutral-500">請先建立班級。</p>
        ) : null}
      </form>

      <section className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3">代號</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">同意書</th>
              <th className="px-4 py-3">家長同意</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-neutral-500">
                  還沒有參與者。
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3 font-mono">{row.code}</td>
                  <td className="px-4 py-3">{row.role}</td>
                  <td className="px-4 py-3">{row.consent_at ? "✓" : "—"}</td>
                  <td className="px-4 py-3">{row.guardian_consent_at ? "✓" : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
