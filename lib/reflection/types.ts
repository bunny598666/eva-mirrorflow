/**
 * 反思的資料形狀。伺服器與用戶端共用，因此這個檔案不 import 任何伺服器相依。
 */

export type ReflectionQuestion = { id: string; text: string; min_chars: number };

export type ReflectionPrompt = {
  version: string;
  questions: ReflectionQuestion[];
};

export type ReflectionAnswer = { question_id: string; text: string };

export type ReflectionRecord = {
  prompt_version: string;
  answers: ReflectionAnswer[];
  viewed_dna_at: string;
  viewed_replay_at: string | null;
  ts: string;
};

/** 預設最少字數。題目沒指定時用它（CLAUDE.md §4.4：每題最少 30 字）。 */
export const DEFAULT_MIN_CHARS = 30;

export function minCharsOf(question: ReflectionQuestion): number {
  return Number.isFinite(question.min_chars) && question.min_chars > 0
    ? question.min_chars
    : DEFAULT_MIN_CHARS;
}

/**
 * 計算「已經寫了幾個字」。
 *
 * 用 Array.from 而不是 .length：13 歲的學生會用 emoji，而 emoji 在
 * UTF-16 裡佔兩個單位。用 .length 會讓「打了 15 個 emoji」通過 30 字門檻，
 * 那顯然不是我們要的反思。這裡要的是「人看到幾個字」。
 * 前後空白不算。
 */
export function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

export function questionsValid(
  questions: readonly ReflectionQuestion[],
  answers: readonly ReflectionAnswer[],
): boolean {
  return questions.every((question) => {
    const answer = answers.find((a) => a.question_id === question.id);
    return answer ? countChars(answer.text) >= minCharsOf(question) : false;
  });
}
