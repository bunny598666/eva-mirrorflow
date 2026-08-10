/**
 * 送出反思。
 *
 * 順序：驗證 → insert reflections → sessions.status = 'reflected'
 *
 * reflections 是 append-only（002 的 trigger）而且 session_id 有 UNIQUE，
 * 所以重送會撞唯一鍵。那不是錯誤，是冪等：學生連點兩下、或斷網重試，
 * 都應該得到「已經寫過了」而不是一個嚇人的錯誤畫面。
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { badRequest, forbidden, guarded, readJson, str } from "@/lib/api/guard";
import { loadCurrentPrompt } from "@/lib/reflection/queries";
import { countChars, minCharsOf, type ReflectionAnswer } from "@/lib/reflection/types";

type SessionRow = { id: string; participant_id: string; status: string };

/** PostgreSQL 唯一鍵衝突。 */
const UNIQUE_VIOLATION = "23505";

function parseAnswers(raw: unknown): ReflectionAnswer[] {
  if (!Array.isArray(raw)) return [];
  const answers: ReflectionAnswer[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item !== "object" || item === null) continue;
    const id = typeof item.question_id === "string" ? item.question_id : "";
    const text = typeof item.text === "string" ? item.text : "";
    if (id) answers.push({ question_id: id, text });
  }
  return answers;
}

export async function POST(request: Request): Promise<NextResponse> {
  return guarded(["student"], async (claims) => {
    const body = await readJson(request);
    const sessionId = str(body.session_id);
    const viewedDnaAt = str(body.viewed_dna_at);
    const viewedReplayAt = str(body.viewed_replay_at);
    const answers = parseAnswers(body.answers);

    if (!sessionId) return badRequest("缺少 session_id");

    const db = supabaseAdmin();

    const { data: session, error: sErr } = await db
      .from("sessions")
      .select("id, participant_id, status")
      .eq("id", sessionId)
      .maybeSingle<SessionRow>();
    if (sErr) throw new Error(sErr.message);
    if (!session || session.participant_id !== claims.participant_id) {
      return forbidden("這不是你的場次");
    }
    if (session.status === "active") {
      return badRequest("還沒交件，不能寫反思");
    }
    if (session.status === "reflected") {
      return NextResponse.json({ ok: true, alreadyDone: true });
    }

    // 題目版本由伺服器決定，不接受用戶端指定——否則學生（或壞掉的快取）
    // 可以宣稱自己答的是另一版的題目，三期就不再可比。
    const prompt = await loadCurrentPrompt();

    for (const question of prompt.questions) {
      const answer = answers.find((a) => a.question_id === question.id);
      const written = answer ? countChars(answer.text) : 0;
      const required = minCharsOf(question);
      if (written < required) {
        return badRequest(`每一題至少要寫 ${required} 個字`);
      }
    }

    // viewed_dna_at 是 NOT NULL：它是「介入確實發生」的操作型證據，
    // 沒有它這筆反思在論文裡就沒有意義。用戶端沒送就是流程有問題，擋下來。
    if (!viewedDnaAt) return badRequest("還沒看完自己的歷程");

    // 只留題目版本裡有的題，順序也照題目版本——用戶端送什麼進來都一樣。
    const ordered: ReflectionAnswer[] = prompt.questions.map((question) => ({
      question_id: question.id,
      text: answers.find((a) => a.question_id === question.id)?.text.trim() ?? "",
    }));

    const { error: iErr } = await db.from("reflections").insert({
      session_id: sessionId,
      prompt_version: prompt.version,
      answers: ordered,
      viewed_dna_at: viewedDnaAt,
      viewed_replay_at: viewedReplayAt,
    });
    if (iErr) {
      // 已經寫過了（UNIQUE）。這是重送，回成功讓用戶端把草稿清掉。
      if (iErr.code === UNIQUE_VIOLATION) {
        return NextResponse.json({ ok: true, alreadyDone: true });
      }
      throw new Error(iErr.message);
    }

    const { error: uErr } = await db
      .from("sessions")
      .update({ status: "reflected" })
      .eq("id", sessionId)
      .eq("status", "submitted");
    if (uErr) throw new Error(uErr.message);

    return NextResponse.json({ ok: true });
  });
}
