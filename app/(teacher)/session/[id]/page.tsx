// 教師端單人完整回放（STEP 7）
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { loadReplayData } from "@/lib/replay/queries";
import DnaBarcode from "./DnaBarcode";
import ReplayViewer from "./ReplayViewer";

type Params = { params: Promise<{ id: string }> };

export default async function TeacherSessionPage({ params }: Params) {
  const { id } = await params;
  const claims = await requireRole("teacher", "researcher");

  // 不是這位教師該班的場次一律 404——不透露「這個 id 存在但不歸你管」。
  const data = await loadReplayData(id, claims);
  if (!data) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-5 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">歷程回放</h1>
          <p className="mt-1 text-neutral-600">
            {data.participantCode}　第 {data.assignmentOrderNo} 次　{data.assignmentTitle}

            <span className="text-sm">
              {data.session.status === "active" ? "（尚未交件）" : "（已交件）"}
            </span>
          </p>
        </div>
        <Link href="/dashboard" className="text-sm text-neutral-600 underline">
          回班級總覽
        </Link>
      </header>

      {data.dna ? <DnaBarcode dna={data.dna} text={data.finalText} /> : null}

      <ReplayViewer
        events={data.events}
        anchors={data.anchors}
        startedAt={data.session.started_at}
      />
    </main>
  );
}
