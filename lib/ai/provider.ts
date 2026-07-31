/**
 * AI 呼叫的唯一出口（CLAUDE.md §7）。任何模組不得直接 import @anthropic-ai/sdk。
 * 預設 Anthropic，可切 Gemini / Ollama；模型與溫度一律由呼叫端從 classes 列帶入，
 * 不得在此寫死——三期之間模型參數必須凍結，凍結的來源是 DB 不是程式碼。
 * 實作於 STEP 4。
 */

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatConfig = {
  model: string;
  temperature: number;
  systemPromptVersion: string;
};

export type ChatProvider = {
  chat(messages: ChatMessage[], config: ChatConfig): AsyncIterable<string>;
};
