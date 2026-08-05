"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const HOME_BY_ROLE: Record<string, string> = {
  student: "/",
  teacher: "/dashboard",
  researcher: "/trajectory",
};

export default function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, pin }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const message =
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error: unknown }).error)
            : "代號或密碼不對，再試一次";
        setError(message);
        return;
      }
      const role =
        typeof data === "object" && data !== null && "role" in data
          ? String((data as { role: unknown }).role)
          : "student";
      router.push(next ?? HOME_BY_ROLE[role] ?? "/");
      router.refresh();
    } catch {
      // 學生端不彈技術訊息（CLAUDE.md §6）
      setError("連不上，檢查一下網路再試一次");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-lg font-medium">你的代號</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="username"
          autoCapitalize="characters"
          placeholder="例如 S-07"
          required
          className="rounded-lg border-2 border-neutral-300 px-4 py-3 text-xl focus:border-neutral-900 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-lg font-medium">密碼</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="6 位數字"
          required
          className="rounded-lg border-2 border-neutral-300 px-4 py-3 text-xl tracking-widest focus:border-neutral-900 focus:outline-none"
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-lg bg-orange-50 px-4 py-3 text-orange-800">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg bg-neutral-900 px-4 py-3 text-lg font-medium text-white disabled:opacity-50"
      >
        {busy ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
