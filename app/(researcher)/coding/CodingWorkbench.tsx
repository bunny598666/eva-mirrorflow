"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CodingMaterial, CodingUnit } from "@/lib/coding/queries";
import type { CodeAssignment, CodingScheme } from "@/lib/coding/scheme";

/**
 * 人工編碼工作台：左邊材料（對話全文 + 反思全文），右邊編碼架構。
 *
 * 【看不到別人的編碼】畫面上沒有任何地方顯示其他編碼者的判定——
 * 那不是漏做，是刻意的：乙看得到甲編了什麼，兩人的判定就不獨立，κ 失去意義。
 *
 * 【類目定義就擺在選項旁邊】編碼一致性大半取決於編碼者記不記得住定義。
 * 要編碼者另外開一份手冊對照，就是在製造不一致。
 */
export default function CodingWorkbench({
  coderCode,
  scheme,
  units,
  material,
}: {
  coderCode: string;
  scheme: CodingScheme;
  units: CodingUnit[];
  material: CodingMaterial | null;
}) {
  const router = useRouter();
  const [codes, setCodes] = useState<CodeAssignment>(material?.myCodes ?? {});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const complete = scheme.dimensions.every((d) => Boolean(codes[d.id]));
  const codedCount = units.filter((u) => u.coded).length;

  async function save(): Promise<void> {
    if (!material || busy || !complete) return;
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/coding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: material.sessionId,
          scheme_version: scheme.version,
          codes,
        }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        setNotice(
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: unknown }).error)
            : "存不起來，等一下再試",
        );
        setBusy(false);
        return;
      }
      // 存好之後跳到下一個還沒編的場次，減少來回點選。
      const index = units.findIndex((u) => u.sessionId === material.sessionId);
      const next = units.slice(index + 1).find((u) => !u.coded) ?? null;
      router.push(next ? `/coding?session=${next.sessionId}` : "/coding");
      router.refresh();
    } catch {
      setNotice("連不上，等一下再試");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">人工編碼</h1>
          <p className="mt-1 text-sm text-neutral-600">
            編碼者 <span className="font-mono font-semibold">{coderCode}</span>　架構{" "}
            <code>{scheme.version}</code>　進度 {codedCount} / {units.length}
          </p>
        </div>
        <p className="max-w-md text-xs text-neutral-500">
          你只看得到自己的編碼。兩位編碼者必須各自獨立判定，κ 才有意義。
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[220px_1fr_320px]">
        {/* 場次清單 */}
        <nav className="max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white">
          <h2 className="border-b border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700">
            場次
          </h2>
          <ul>
            {units.map((unit) => {
              const active = unit.sessionId === material?.sessionId;
              return (
                <li key={unit.sessionId}>
                  <a
                    href={`/coding?session=${unit.sessionId}`}
                    className={`flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 text-sm ${
                      active ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"
                    }`}
                  >
                    <span>
                      {unit.participantCode}　第 {unit.orderNo} 次
                    </span>
                    <span className={active ? "text-neutral-300" : "text-neutral-400"}>
                      {unit.coded ? "✓" : "○"}
                    </span>
                  </a>
                </li>
              );
            })}
            {units.length === 0 ? (
              <li className="px-3 py-4 text-sm text-neutral-500">
                還沒有已交件的場次。
              </li>
            ) : null}
          </ul>
        </nav>

        {/* 材料 */}
        <section className="max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-5">
          {material ? (
            <>
              <h2 className="text-lg font-semibold text-neutral-800">
                {material.participantCode}　第 {material.orderNo} 次．
                {material.assignmentTitle}
              </h2>

              <h3 className="mt-5 text-sm font-semibold text-neutral-700">對話全文</h3>
              {material.chat.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">這個場次沒有任何對話。</p>
              ) : (
                <ol className="mt-2 flex flex-col gap-2">
                  {material.chat.map((message, index) => (
                    <li
                      key={index}
                      className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
                        message.role === "user"
                          ? "bg-neutral-900 text-white"
                          : "bg-neutral-100 text-neutral-800"
                      }`}
                    >
                      <span className="mb-1 block text-xs opacity-70">
                        {message.role === "user" ? "學生" : "AI"}
                      </span>
                      {message.content}
                    </li>
                  ))}
                </ol>
              )}

              <h3 className="mt-6 text-sm font-semibold text-neutral-700">反思全文</h3>
              {material.reflection ? (
                <ol className="mt-2 flex flex-col gap-3">
                  {material.reflection.map((item, index) => (
                    <li key={index}>
                      <p className="text-sm font-medium text-neutral-700">
                        {index + 1}. {item.question}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 px-3 py-2 text-sm leading-relaxed text-neutral-800">
                        {item.answer || "（沒有作答）"}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-sm text-neutral-500">
                  這位學生還沒寫反思。反思相關的向度請依「沒有意圖／描述」判定，
                  或先跳過這個場次。
                </p>
              )}
            </>
          ) : (
            <p className="text-neutral-600">從左邊挑一個場次開始編碼。</p>
          )}
        </section>

        {/* 編碼架構 */}
        <aside className="max-h-[80vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-700">編碼架構</h2>
          {material ? (
            <>
              <div className="mt-3 flex flex-col gap-5">
                {scheme.dimensions.map((dimension) => (
                  <fieldset key={dimension.id}>
                    <legend className="text-sm font-semibold text-neutral-800">
                      {dimension.label}
                      <span className="ml-2 font-normal text-xs text-neutral-500">
                        {dimension.material === "chat"
                          ? "看對話"
                          : dimension.material === "reflection"
                            ? "看反思"
                            : "看全部"}
                      </span>
                    </legend>
                    <div className="mt-2 flex flex-col gap-2">
                      {dimension.categories.map((category) => (
                        <label
                          key={category.id}
                          className={`flex cursor-pointer gap-2 rounded-lg border px-3 py-2 ${
                            codes[dimension.id] === category.id
                              ? "border-neutral-900 bg-neutral-50"
                              : "border-neutral-200"
                          }`}
                        >
                          <input
                            type="radio"
                            name={dimension.id}
                            value={category.id}
                            checked={codes[dimension.id] === category.id}
                            onChange={() =>
                              setCodes((current) => ({
                                ...current,
                                [dimension.id]: category.id,
                              }))
                            }
                            className="mt-1"
                          />
                          <span>
                            <span className="block text-sm font-medium text-neutral-900">
                              {category.label}
                            </span>
                            <span className="block text-xs leading-relaxed text-neutral-600">
                              {category.definition}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>

              {notice ? (
                <p role="alert" className="mt-4 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-800">
                  {notice}
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !complete}
                className="mt-4 w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? "儲存中…" : "儲存並跳到下一個"}
              </button>
              {!complete ? (
                <p className="mt-2 text-xs text-neutral-500">每個向度都要選一個類目。</p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-sm text-neutral-500">選了場次才會出現。</p>
          )}
        </aside>
      </div>
    </div>
  );
}
