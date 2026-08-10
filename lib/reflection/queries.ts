/**
 * 反思的伺服器端讀取。
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reflectionPromptVersion } from "./config";
import type { ReflectionPrompt, ReflectionQuestion, ReflectionRecord } from "./types";

function parseQuestions(raw: unknown): ReflectionQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: ReflectionQuestion[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (typeof item !== "object" || item === null) continue;
    const id = typeof item.id === "string" ? item.id : "";
    const text = typeof item.text === "string" ? item.text : "";
    const minChars = typeof item.min_chars === "number" ? item.min_chars : 0;
    if (id && text) questions.push({ id, text, min_chars: minChars });
  }
  return questions;
}

/**
 * 取現行版題目。
 *
 * 找不到就丟例外而不是靜靜退回別的版本——反思題目是研究工具本身，
 * 出錯了要立刻炸開讓人發現，不能讓學生答到一組沒人預期的題目。
 */
export async function loadCurrentPrompt(): Promise<ReflectionPrompt> {
  const version = reflectionPromptVersion();
  const { data, error } = await supabaseAdmin()
    .from("reflection_prompts")
    .select("version, questions")
    .eq("version", version)
    .maybeSingle<{ version: string; questions: unknown }>();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      `找不到反思題目版本「${version}」。請確認 supabase/migrations/007 已套用，` +
        `或環境變數 REFLECTION_PROMPT_VERSION 指到正確版本。`,
    );
  }

  const questions = parseQuestions(data.questions);
  if (questions.length === 0) {
    throw new Error(`反思題目版本「${version}」沒有任何題目。`);
  }
  return { version: data.version, questions };
}

export async function loadReflection(sessionId: string): Promise<ReflectionRecord | null> {
  const { data, error } = await supabaseAdmin()
    .from("reflections")
    .select("prompt_version, answers, viewed_dna_at, viewed_replay_at, ts")
    .eq("session_id", sessionId)
    .maybeSingle<ReflectionRecord>();
  if (error) throw new Error(error.message);
  return data ?? null;
}
