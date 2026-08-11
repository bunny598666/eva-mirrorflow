// 去識別化匯出：events / chat / dna / quadrant / reflections / metrics + manifest（STEP 12）
import { requireRole } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";

type AuditRow = {
  researcher_code: string;
  ts: string;
  manifest: { counts?: Record<string, number>; pii_scan?: { findings?: unknown[] } };
};

export default async function ExportPage() {
  await requireRole("researcher");

  const { data, error } = await supabaseAdmin()
    .from("export_audit")
    .select("researcher_code, ts, manifest")
    .order("ts", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  const history = (data ?? []) as AuditRow[];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">去識別化匯出</h1>
        <p className="mt-1 text-neutral-600">
          七個檔案打包成一個 zip：events.csv、chat.csv、dna.json、quadrant.csv、
          reflections.csv、metrics.csv、manifest.json。
        </p>
      </header>

      <a
        href="/api/export"
        download
        className="self-start rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white"
      >
        產生並下載
      </a>

      <section className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
        <h2 className="font-semibold">釋出資料前必讀</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>
            系統本身不存 PII（無姓名、Email、學號、IP），匯出只帶 participant
            code。但 <strong>chat.csv 與 reflections.csv 是學生自己打的字</strong>——
            他可能在文章裡寫了自己或同學的名字。
          </li>
          <li>
            manifest 裡的 <code>pii_scan</code> 只掃得到機械樣態（身分證字號、
            Email、手機、長數字）。<strong>姓名、綽號、校名一律掃不出來。</strong>
            釋出前務必人工通讀那兩個檔案。
          </li>
          <li>
            每次匯出都會留下稽核紀錄（誰、何時、幾列、用哪組參數），且不可刪改。
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-700">最近 10 次匯出</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">還沒有匯出紀錄。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((row) => {
              const counts = row.manifest?.counts ?? {};
              const findings = row.manifest?.pii_scan?.findings ?? [];
              return (
                <li
                  key={`${row.ts}-${row.researcher_code}`}
                  className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm"
                >
                  <p className="font-medium text-neutral-800">
                    {new Date(row.ts).toLocaleString("zh-TW")}　{row.researcher_code}
                  </p>
                  <p className="mt-1 text-neutral-600">
                    {Object.entries(counts)
                      .map(([name, n]) => `${name} ${n} 列`)
                      .join("　")}
                  </p>
                  {findings.length > 0 ? (
                    <p className="mt-1 text-orange-700">
                      PII 掃描有 {findings.length} 類命中，需人工確認
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
