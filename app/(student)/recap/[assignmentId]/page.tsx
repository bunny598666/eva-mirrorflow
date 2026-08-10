// ★「上次的你」摘要卡：第 2、3 期寫作前強制經過（CLAUDE.md §4.4）
//
// 沒有上一期（第 1 期）、或上一期沒交件，就沒有東西可回顧——那種情況只留
// 一顆開始按鈕，不要卡一張空卡片在中間。
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadRecap } from "@/lib/mirror/recap";
import RecapCard from "./RecapCard";
import StartWriting from "./StartWriting";

type Params = { params: Promise<{ assignmentId: string }> };

export default async function RecapPage({ params }: Params) {
  const { assignmentId } = await params;
  const claims = await requireRole("student");

  const recap = await loadRecap(assignmentId, claims);
  if (recap) return <RecapCard recap={recap} />;

  // 沒有可回顧的東西。確認這份作業存在（否則 404），然後直接讓他開始。
  const { data: assignment, error } = await supabaseAdmin()
    .from("assignments")
    .select("title, order_no")
    .eq("id", assignmentId)
    .maybeSingle<{ title: string; order_no: number }>();
  if (error) throw new Error(error.message);
  if (!assignment) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 p-6">
      <header>
        <h1 className="text-2xl font-bold">
          第 {assignment.order_no} 次．{assignment.title}
        </h1>
        <p className="mt-1 text-neutral-600">準備好就開始吧。</p>
      </header>
      <StartWriting assignmentId={assignmentId} recapPayload={null} />
    </main>
  );
}
