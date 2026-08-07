/**
 * 對話（SSE 串流）。
 *
 * 模型參數一律取自該學生所屬 classes 列，不接受用戶端指定——否則學生可自行
 * 改動模型或 temperature，三期就不再可比。呼叫一律經 lib/ai/provider.ts。
 *
 * 【半截回覆不入庫】assistant 訊息只在串流正常結束（provider 的 usage resolve）
 * 後才寫入。學生關掉分頁、網路斷掉、供應商中途出錯，都不會留下一段殘缺的
 * 「AI 說過的話」——那會讓 DNA 歸因把不存在的來源算進去。
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AuthError, requireRole } from "@/lib/auth/session";
import { getProvider, type ChatMessage } from "@/lib/ai/provider";
import { parseScaffoldButtons } from "@/lib/scaffold/types";

type SessionRow = { id: string; participant_id: string; status: string; assignment_id: string };
type ClassRow = { model: string; temperature: number; system_prompt_version: string };

function sse(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let claims;
  try {
    claims = await requireRole("student");
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    throw err;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("格式不正確", 400);
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const text = typeof body.message === "string" ? body.message.trim() : "";
  const scaffoldId =
    typeof body.scaffold_id === "string" && body.scaffold_id ? body.scaffold_id : null;

  if (!sessionId) return errorResponse("缺少 session_id", 400);
  if (!text) return errorResponse("訊息不可空白", 400);

  const db = supabaseAdmin();

  const { data: session, error: sErr } = await db
    .from("sessions")
    .select("id, participant_id, status, assignment_id")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (sErr) return errorResponse("系統忙碌中，稍後再試", 500);
  if (!session || session.participant_id !== claims.participant_id) {
    return errorResponse("這不是你的場次", 403);
  }
  if (session.status !== "active") {
    return errorResponse("這次作業已經交出去了，不能再對話", 409);
  }

  // 模型設定只認資料庫，不認用戶端。
  const { data: participant, error: pErr } = await db
    .from("participants")
    .select("class_id")
    .eq("id", claims.participant_id)
    .maybeSingle<{ class_id: string | null }>();
  if (pErr || !participant?.class_id) return errorResponse("找不到班級設定", 500);

  const { data: klass, error: cErr } = await db
    .from("classes")
    .select("model, temperature, system_prompt_version")
    .eq("id", participant.class_id)
    .maybeSingle<ClassRow>();
  if (cErr || !klass) return errorResponse("找不到班級設定", 500);

  // scaffold_id 必須真的存在於該作業的鷹架設定裡，否則不記——
  // 否則附屬分析會出現對不到按鈕的孤兒 id。
  let validScaffoldId: string | null = null;
  if (scaffoldId) {
    const { data: assignment } = await db
      .from("assignments")
      .select("scaffold_buttons")
      .eq("id", session.assignment_id)
      .maybeSingle<{ scaffold_buttons: unknown }>();
    const buttons = parseScaffoldButtons(assignment?.scaffold_buttons);
    validScaffoldId = buttons.some((b) => b.id === scaffoldId) ? scaffoldId : null;
  }

  const { data: history, error: hErr } = await db
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("ts", { ascending: true });
  if (hErr) return errorResponse("系統忙碌中，稍後再試", 500);

  const messages: ChatMessage[] = [
    ...((history ?? []) as ChatMessage[]),
    { role: "user", content: text },
  ];

  // provider 必須先建起來才寫入使用者訊息。順序反過來的話，金鑰缺失或設定
  // 錯誤時每按一次「送出」就留下一則永遠沒有回覆的孤兒訊息——它們會被當成
  // 對話歷史送進下一次請求（AI 看到同一題問三遍），也會灌水 STEP 10 象限
  // 座標的「對話輪次」。chat_messages 是 append-only，事後刪不掉。
  let stream;
  try {
    stream = getProvider().chat(messages, {
      model: klass.model,
      temperature: Number(klass.temperature),
      systemPromptVersion: klass.system_prompt_version,
    });
  } catch (err) {
    console.error("[api/chat] provider 初始化失敗，使用者訊息未入庫", {
      session_id: sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
    return errorResponse("AI 現在有點忙，等一下再問一次", 503);
  }

  // 到這裡才算「這句話真的送出去了」。串流之後若中斷，使用者訊息仍然保留——
  // 那是真實發生過的一次提問，只是沒等到完整回覆。
  const { error: insErr } = await db.from("chat_messages").insert({
    session_id: sessionId,
    role: "user",
    content: text,
    scaffold_id: validScaffoldId,
  });
  if (insErr) return errorResponse("系統忙碌中，稍後再試", 500);

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of stream) {
          full += chunk;
          controller.enqueue(encoder.encode(sse({ type: "delta", text: chunk })));
        }

        // usage 只在串流正常結束時 resolve；中斷則 reject 並跳到 catch。
        const usage = await stream.usage;

        // 回傳 id：STEP 6 的 aiOrigin mark 要用它指回這則訊息，
        // STEP 8 才能拿原文算相似度。沒有 id 就只剩「某則 AI 回覆」，對不回去。
        const { data: inserted, error } = await db
          .from("chat_messages")
          .insert({
            session_id: sessionId,
            role: "assistant",
            content: full,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
          })
          .select("id")
          .single<{ id: string }>();
        if (error) throw new Error(error.message);

        controller.enqueue(
          encoder.encode(
            sse({
              type: "done",
              message_id: inserted?.id ?? null,
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
            }),
          ),
        );
      } catch (err) {
        console.error("[api/chat] 串流中斷，assistant 訊息未入庫", {
          session_id: sessionId,
          message: err instanceof Error ? err.message : String(err),
        });
        try {
          controller.enqueue(
            encoder.encode(sse({ type: "error", message: "回覆中斷了，再問一次" })),
          );
        } catch {
          // 連線已關閉，寫不進去也無妨。
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 已關閉。
        }
      }
    },
  });

  return new Response(body$, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
