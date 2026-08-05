/**
 * 開始（或繼續）一次寫作場次。
 * sessions 有 unique (participant_id, assignment_id)，因此同一份作業永遠只有
 * 一個場次——重複點「開始寫作」會回到原本那一場，不會另開一場把歷程切成兩半。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, guarded, readJson, str } from "@/lib/api/guard";
import type { WritingSession } from "@/lib/student/queries";

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["student"], async (claims) => {
    const body = await readJson(request);
    const assignmentId = str(body.assignment_id);
    if (!assignmentId) return badRequest("請指定作業");

    const db = supabaseAdmin();

    const { data: existing, error: exErr } = await db
      .from("sessions")
      .select("id, participant_id, assignment_id, started_at, submitted_at, status")
      .eq("participant_id", claims.participant_id)
      .eq("assignment_id", assignmentId)
      .maybeSingle<WritingSession>();
    if (exErr) throw new Error(exErr.message);
    if (existing) return NextResponse.json({ session: existing });

    const { data, error } = await db
      .from("sessions")
      .insert({
        participant_id: claims.participant_id,
        assignment_id: assignmentId,
      })
      .select("id, participant_id, assignment_id, started_at, submitted_at, status")
      .single();
    if (error) {
      if (error.code === "23503") return badRequest("查無這份作業");
      throw new Error(error.message);
    }
    return NextResponse.json({ session: data }, { status: 201 });
  });
}
