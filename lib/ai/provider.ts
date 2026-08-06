/**
 * AI 呼叫的唯一出口（CLAUDE.md §7）。任何模組不得直接 import @anthropic-ai/sdk。
 * 預設 Anthropic，可切 Gemini / Ollama；模型與溫度一律由呼叫端從 classes 列帶入，
 * 不得在此寫死——三期之間模型參數必須凍結，凍結的來源是 DB 不是程式碼。
 */
import { createAnthropicProvider } from "./anthropic";
import { createMockProvider } from "./mock";

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

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

/**
 * BUILD_PLAN §6 STEP 4 規定 chat() 回傳 AsyncIterable<string>；本型別即是
 * AsyncIterable<string>，額外掛一個 usage promise 讓 token 用量得以入庫。
 * usage 在串流正常結束後才 resolve；串流中斷則 reject——「半截回覆不入庫」
 * 因此有型別層的依據，而不是靠呼叫端自律。
 */
export type ChatStream = AsyncIterable<string> & {
  usage: Promise<TokenUsage>;
};

export type ChatProvider = {
  chat(messages: ChatMessage[], config: ChatConfig): ChatStream;
};

export function getProvider(): ChatProvider {
  const name = process.env.AI_PROVIDER ?? "anthropic";
  switch (name) {
    case "anthropic":
      return createAnthropicProvider();
    case "mock":
      // 測試與無金鑰開發用，正式環境會被 createMockProvider 自己擋下。
      return createMockProvider();
    case "gemini":
    case "ollama":
      throw new Error(
        `AI_PROVIDER=${name} 尚未實作。目前僅支援 anthropic；` +
          `新增供應商請在此檔擴充，不要繞過本抽象層直接呼叫 SDK。`,
      );
    default:
      throw new Error(`未知的 AI_PROVIDER：${name}`);
  }
}
