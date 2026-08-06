/**
 * Anthropic 實作。只有 lib/ai/provider.ts 可以 import 本檔（CLAUDE.md §7）。
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { resolveSystemPrompt } from "./system-prompts";
import type {
  ChatConfig,
  ChatMessage,
  ChatProvider,
  ChatStream,
  TokenUsage,
} from "./provider";

function maxTokens(): number {
  const raw = process.env.AI_MAX_TOKENS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1024;
}

export function createAnthropicProvider(): ChatProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 ANTHROPIC_API_KEY，請檢查環境變數設定。");
  }
  const client = new Anthropic({ apiKey });

  return {
    chat(messages: ChatMessage[], config: ChatConfig): ChatStream {
      let resolveUsage: (usage: TokenUsage) => void = () => undefined;
      let rejectUsage: (reason: Error) => void = () => undefined;
      const usage = new Promise<TokenUsage>((resolve, reject) => {
        resolveUsage = resolve;
        rejectUsage = reject;
      });
      // 串流中斷時 usage 會 reject。若沒人 await 它，Node 會噴
      // unhandledRejection；掛一個空的 catch 讓它安靜，實際處理仍在呼叫端。
      usage.catch(() => undefined);

      async function* generate(): AsyncGenerator<string> {
        let inputTokens = 0;
        let outputTokens = 0;
        let completed = false;

        try {
          const stream = await client.messages.create({
            model: config.model,
            max_tokens: maxTokens(),
            temperature: config.temperature,
            system: resolveSystemPrompt(config.systemPromptVersion),
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            stream: true,
          });

          for await (const event of stream) {
            if (event.type === "message_start") {
              inputTokens = event.message.usage.input_tokens;
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              yield event.delta.text;
            } else if (event.type === "message_delta") {
              outputTokens = event.usage.output_tokens;
            } else if (event.type === "message_stop") {
              completed = true;
            }
          }

          if (completed) {
            resolveUsage({ inputTokens, outputTokens });
          } else {
            rejectUsage(new Error("串流未正常結束"));
          }
        } catch (err) {
          rejectUsage(err instanceof Error ? err : new Error(String(err)));
          throw err;
        } finally {
          // 呼叫端提早 break（例如學生關掉分頁）會走到這裡而不經過上面的
          // resolve；此時 usage 仍是 pending，補一個 reject 讓它不會永遠掛著。
          rejectUsage(new Error("串流中斷"));
        }
      }

      return Object.assign(generate(), { usage });
    },
  };
}
