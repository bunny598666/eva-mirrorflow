/**
 * 測試用 provider。**不是**繞過抽象層——它就活在抽象層裡面，
 * 這正是 lib/ai/provider.ts 存在的理由之一。
 *
 * 用途有二：
 *   1. 驗收「半截回覆不入庫」。這條規則只有在串流真的中斷時才驗得到，
 *      拿真實 API 很難穩定重現，也會白燒論文預算。
 *   2. 沒有 ANTHROPIC_API_KEY 時仍可開發與測試前端。
 *
 * 【安全鎖】正式環境一律拒絕載入。研究資料若混進假的 AI 回覆，
 * 整個 DNA 歸因與對話分析都會失真。
 */
import type {
  ChatConfig,
  ChatMessage,
  ChatProvider,
  ChatStream,
  TokenUsage,
} from "./provider";

/** 訊息含此字串時，串流會在吐出兩段文字後中途失敗。 */
export const MOCK_ABORT_MARKER = "__MOCK_ABORT__";

export function createMockProvider(): ChatProvider {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_AI !== "1") {
    throw new Error(
      "AI_PROVIDER=mock 不可用於正式環境。假的 AI 回覆一旦混進研究資料，" +
        "DNA 歸因與對話分析全部失真。",
    );
  }

  return {
    // config 刻意不使用：mock 不呼叫任何模型，但簽章必須與真實 provider 一致。
    chat(messages: ChatMessage[], config: ChatConfig): ChatStream {
      void config;
      const last = messages[messages.length - 1]?.content ?? "";
      const shouldAbort = last.includes(MOCK_ABORT_MARKER);

      let resolveUsage: (usage: TokenUsage) => void = () => undefined;
      let rejectUsage: (reason: Error) => void = () => undefined;
      const usage = new Promise<TokenUsage>((resolve, reject) => {
        resolveUsage = resolve;
        rejectUsage = reject;
      });
      usage.catch(() => undefined);

      async function* generate(): AsyncGenerator<string> {
        const parts = ["這是測試回覆的第一段。", "這是第二段。", "這是最後一段。"];
        try {
          for (let i = 0; i < parts.length; i += 1) {
            if (shouldAbort && i === 2) {
              throw new Error("mock：刻意在串流中途失敗");
            }
            yield parts[i] ?? "";
          }
          resolveUsage({ inputTokens: 42, outputTokens: 17 });
        } catch (err) {
          rejectUsage(err instanceof Error ? err : new Error(String(err)));
          throw err;
        } finally {
          rejectUsage(new Error("串流中斷"));
        }
      }

      return Object.assign(generate(), { usage });
    },
  };
}
