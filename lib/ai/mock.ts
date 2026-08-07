/**
 * 測試用 provider。**不是**繞過抽象層——它就活在抽象層裡面，
 * 這正是 lib/ai/provider.ts 存在的理由之一。
 *
 * 用途有三：
 *   1. 驗收「半截回覆不入庫」。這條規則只有在串流真的中斷時才驗得到，
 *      拿真實 API 很難穩定重現，也會白燒論文預算。
 *   2. 沒有 ANTHROPIC_API_KEY 時仍可開發與測試整套系統（STEP 5–12 均不需真實 AI）。
 *   3. STEP 6 的貼上攔截與 STEP 8 的 DNA 歸因需要「有份量、像真的寫作建議」的
 *      文字才測得準——三句罐頭字複製不出可供改寫的段落。
 *
 * 【決定性】回覆內容由輸入雜湊決定，同樣的問題永遠得到同樣的回答。
 * 隨機回覆會讓 DNA 相似度的驗收變成擲骰子。
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

/** 訊息含此字串時，串流會在吐出前幾段後中途失敗。 */
export const MOCK_ABORT_MARKER = "__MOCK_ABORT__";

/** 每段之間的延遲毫秒。預設 0（測試要快）；示範時設 30 可看見逐字效果。 */
function streamDelayMs(): number {
  const raw = process.env.MOCK_STREAM_DELAY_MS;
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

type Intent = "brainstorm" | "feedback" | "example" | "general";

function detectIntent(text: string): Intent {
  if (/不知道|想不出|沒靈感|幫我想|要寫什麼/.test(text)) return "brainstorm";
  if (/清楚|修改|改進|看看|順不順|通順|我寫了|這一段/.test(text)) return "feedback";
  if (/例子|舉例|範例|比如/.test(text)) return "example";
  return "general";
}

/** 決定性雜湊，用來在同一 intent 的多份範本中挑一份。 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * 每份範本都是一則完整的寫作助教回覆：兩到三段、數百字、句式自然。
 * 刻意寫得像真的，因為 STEP 6／8 要從這裡複製段落再改寫，
 * 罐頭短句測不出 Levenshtein 相似度的分色門檻。
 */
const TEMPLATES: Readonly<Record<Intent, readonly string[]>> = {
  brainstorm: [
    [
      "想不出來很正常，我們先不急著寫，先把你腦袋裡已經有的東西挖出來。",
      "",
      "我先問你三個問題，你不用馬上回答得很完整，想到什麼就說什麼：第一，最近三個月裡，有沒有哪一件事讓你覺得「這樣不太對」？第二，那件事發生的時候，你人在哪裡、旁邊有誰？第三，如果你可以改掉它的一個地方，你會先改哪裡？",
      "",
      "這三題的重點不是要你講出漂亮的答案，而是要找到一個你真的有感覺的具體場景。有場景，文章才會有東西可以寫；只有想法沒有場景，寫出來會很空。你先挑一題回我。",
    ].join("\n"),
    [
      "先別急著找「好題目」，好題目通常是寫到一半才浮出來的。",
      "",
      "我們換個方式：你今天從起床到現在，有沒有哪一個瞬間讓你有一點點情緒——不管是煩、無奈、開心還是覺得奇怪？把那個瞬間講給我聽，越具體越好，包括當時你看到什麼、聽到什麼、心裡冒出什麼念頭。",
      "",
      "很多好文章的起點就是這種小事。你先描述那個瞬間，我們再一起看它可以往哪裡延伸。",
    ].join("\n"),
  ],
  feedback: [
    [
      "我看得出你想說的是：這件事讓你覺得不公平，而且你認為問題出在規定本身，不是在人。這個核心蠻清楚的。",
      "",
      "有一個地方可以更清楚：你在第二段說「大家都覺得很困擾」，但沒有說是誰、在什麼情況下困擾。讀的人會不知道這是你自己的感覺，還是真的很多人這樣想。如果你能換成一個具體的畫面——例如某天午休你看到誰做了什麼——說服力會強很多，因為讀者可以自己判斷，而不是只能相信你的結論。",
      "",
      "另外，你最後一句收得有點快。你已經說了「應該要改」，但沒說改成什麼樣子。你心裡有想法嗎？講出來會讓整篇文章有重量。",
    ].join("\n"),
    [
      "這一段的優點是你有寫出自己的感受，不是只在描述事情，這很好。",
      "",
      "可以更清楚的地方有一個：句子跟句子之間的關係不太明確。你先說了規定的內容，接著說你的不滿，但中間少了一步——為什麼這個規定會讓你不滿？是因為它沒有道理，還是因為它對某些人特別不公平？把這一步補上，讀的人才跟得上你的思路。",
      "",
      "我不會直接幫你改寫，因為這是你的想法，你自己補才會準。你先想想那個「為什麼」，寫個一兩句試試看。",
    ].join("\n"),
  ],
  example: [
    [
      "可以，我舉一個國中生應該蠻有感覺的例子。",
      "",
      "假設學校規定所有人午休都要趴在桌上睡，不能看書也不能寫作業。有的同學中午根本睡不著，趴著四十分鐘只是在發呆，起來反而更累；但也有同學是真的需要那段時間補眠，因為他早上五點就要出門搭車。同一條規定，對這兩種人的效果完全相反。",
      "",
      "這個例子的重點不是「午休制度不好」，而是「一條規定套在所有人身上時，會產生它原本沒打算造成的結果」。你可以想想，你自己遇過的事情裡，有沒有類似的結構？",
    ].join("\n"),
    [
      "好，給你一個生活裡的例子。",
      "",
      "很多學校的資源回收桶就放在垃圾桶旁邊，兩個桶子長得差不多，蓋子上的字又小。結果大家趕時間的時候隨手一丟，回收桶裡混了一堆廚餘，最後整桶都當一般垃圾處理掉。制度是有的，但因為設計沒有考慮到人在趕時間時的行為，等於沒有用。",
      "",
      "這種「立意良好但實際失效」的例子，通常比單純抱怨更有說服力，因為它同時指出了問題和原因。你要不要試著找一個你身邊的？",
    ].join("\n"),
  ],
  general: [
    [
      "我先確認一下我有沒有理解你的意思，再回答你。",
      "",
      "你想問的是怎麼把這件事寫得比較有說服力，對嗎？如果是的話，通常有兩個方向：一個是把抽象的判斷換成具體的場景，讓讀者自己得出結論；另一個是把你的理由講得更完整，不要只停在「我覺得」。",
      "",
      "這兩個方向適合的情況不太一樣。你先跟我說說你現在卡在哪一段，我們針對那一段來看。",
    ].join("\n"),
    [
      "這個問題可以從兩個角度想。",
      "",
      "第一個角度是內容：你手上的材料夠不夠？如果你只有一個模糊的印象，不管怎麼組織都會顯得單薄，這時候要做的是先回去把細節想清楚。第二個角度是結構：如果材料夠，但讀起來散散的，那問題出在順序，需要決定先講什麼、後講什麼。",
      "",
      "你覺得你現在比較像哪一種？告訴我之後我們再往下談。",
    ].join("\n"),
  ],
};

/** 依標點切成串流片段，模擬真實 API 的逐段送達。 */
function toChunks(text: string): string[] {
  const chunks = text.match(/[^。！？\n]*[。！？\n]+|[^。！？\n]+/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}

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

      const intent = detectIntent(last);
      const pool = TEMPLATES[intent];
      const reply = pool[hash(last) % pool.length] ?? pool[0] ?? "";
      const chunks = toChunks(reply);
      const delay = streamDelayMs();

      let resolveUsage: (usage: TokenUsage) => void = () => undefined;
      let rejectUsage: (reason: Error) => void = () => undefined;
      const usage = new Promise<TokenUsage>((resolve, reject) => {
        resolveUsage = resolve;
        rejectUsage = reject;
      });
      usage.catch(() => undefined);

      async function* generate(): AsyncGenerator<string> {
        try {
          for (let i = 0; i < chunks.length; i += 1) {
            // 中斷點取在第三段之後：確保中斷前已經送出足夠內容，
            // 驗收才驗得到「畫面上有半截、資料庫沒有」。
            if (shouldAbort && i === 3) {
              throw new Error("mock：刻意在串流中途失敗");
            }
            if (delay > 0) {
              await new Promise((r) => setTimeout(r, delay));
            }
            yield chunks[i] ?? "";
          }
          // 粗略但穩定的估算：中文約 1 字 1.5 token。
          const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
          resolveUsage({
            inputTokens: Math.max(1, Math.round(inputChars * 1.5)),
            outputTokens: Math.max(1, Math.round(reply.length * 1.5)),
          });
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
