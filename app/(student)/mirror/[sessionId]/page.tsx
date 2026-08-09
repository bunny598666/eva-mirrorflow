// ★鏡子頁：學生版 DNA 條碼 → 簡化回放 → 反思表單
//
// STEP 7 先接上簡化回放（關鍵節點卡片）。DNA 條碼於 STEP 8、
// 反思表單與 viewed_dna_at / viewed_replay_at 的記錄於 STEP 9 補上；
// 屆時順序鎖成「看鏡子 → 回答反思」，不可調換（CLAUDE.md §4.4）。
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { loadReplayData } from "@/lib/replay/queries";
import SimpleReplay from "./SimpleReplay";
import StudentDna from "./StudentDna";

type Params = { params: Promise<{ sessionId: string }> };

export default async function MirrorPage({ params }: Params) {
  const { sessionId } = await params;
  const claims = await requireRole("student");

  const data = await loadReplayData(sessionId, claims);
  if (!data) notFound();

  // 交件之後才照鏡子。寫作當下就看得到歷程回饋，會變成即時介入，
  // 那是另一個研究設計（CLAUDE.md §4.4）。
  if (data.session.status === "active") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-bold">我的歷程</h1>
        <p className="rounded-2xl bg-neutral-100 px-5 py-4 text-neutral-700">
          這次還沒交出去，交出去之後就可以看到你這次是怎麼寫的。
        </p>
        <Link
          href={`/write/${sessionId}`}
          className="self-start rounded-lg bg-neutral-900 px-4 py-2.5 text-white"
        >
          回去繼續寫
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">我的歷程</h1>
        <p className="mt-1 text-neutral-600">
          第 {data.assignmentOrderNo} 次．{data.assignmentTitle}
        </p>
      </header>

      {/* 順序不可調換（CLAUDE.md §4.4）：先看鏡子（DNA），再看歷程回放。 */}
      {data.dna ? <StudentDna dna={data.dna} text={data.finalText} /> : null}

      <SimpleReplay events={data.events} anchors={data.anchors} />

      <p className="text-sm text-neutral-500">
        這裡只看得到你自己的東西，同學看不到你的，你也看不到同學的。
      </p>
    </main>
  );
}
