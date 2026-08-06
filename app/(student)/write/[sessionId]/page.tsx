import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { loadWritingContext } from "@/lib/student/queries";
import { writingMinutes } from "@/lib/student/config";
import WriteWorkspace from "./WriteWorkspace";

type Params = { params: Promise<{ sessionId: string }> };

export default async function WritePage({ params }: Params) {
  const { sessionId } = await params;
  const claims = await requireRole("student");

  // 場次不存在、或不是本人的，一律 404——不透露「這個 id 存在但不是你的」。
  const context = await loadWritingContext(sessionId, claims);
  if (!context) notFound();

  return (
    <WriteWorkspace
      sessionId={context.session.id}
      title={context.assignment.title}
      instructions={context.assignment.instructions}
      orderNo={context.assignment.order_no}
      startedAt={context.session.started_at}
      minutes={writingMinutes()}
      scaffolds={context.scaffolds}
      history={context.history}
      submitted={context.session.status !== "active"}
    />
  );
}
