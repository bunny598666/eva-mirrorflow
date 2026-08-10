// ★鏡子頁：學生版 DNA 條碼 → 簡化回放 → 反思表單（CLAUDE.md §4.4）
//
// 順序不可調換，而且不是靠版面順序而已：兩個區塊都真的被看過（見 MirrorLoop
// 的操作型定義）之後，「開始寫想法」才會啟用。viewed_dna_at / viewed_replay_at
// 是論文方法章用來主張「介入確實發生」的證據。
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { loadReplayData } from "@/lib/replay/queries";
import { loadCurrentPrompt, loadReflection } from "@/lib/reflection/queries";
import MirrorLoop from "./MirrorLoop";

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

  const [prompt, existing] = await Promise.all([
    loadCurrentPrompt(),
    loadReflection(sessionId),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">我的歷程</h1>
        <p className="mt-1 text-neutral-600">
          第 {data.assignmentOrderNo} 次．{data.assignmentTitle}
        </p>
      </header>

      <MirrorLoop
        sessionId={sessionId}
        dna={data.dna}
        finalText={data.finalText}
        events={data.events}
        anchors={data.anchors}
        prompt={prompt}
        existing={existing}
      />

      <p className="text-sm text-neutral-500">
        這裡只看得到你自己的東西，同學看不到你的，你也看不到同學的。
      </p>
      <Link href="/" className="self-start text-sm text-neutral-600 underline">
        回首頁
      </Link>
    </main>
  );
}
