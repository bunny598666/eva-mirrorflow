"use client";

import { useRef, useState } from "react";
import { emitEvent } from "@/lib/events/queue";
import {
  fingerprint,
  normalizeClipboardText,
  rememberCopySource,
} from "@/lib/editor/clipboard";
import type { ScaffoldButton } from "@/lib/scaffold/types";
import type { ChatHistoryItem } from "@/lib/student/queries";

type Bubble = { id: string | null; role: "user" | "assistant"; content: string };

/**
 * 找出這次選取在原訊息中的位置。
 *
 * 泡泡把整則訊息渲染成單一 text 節點，所以絕大多數情況直接讀 Range 的 offset
 * 就是精確位置。跨節點選取（例如選到了時間戳）或正規化後對不上時，退回用
 * indexOf 找；再找不到就誠實回 null——寧可少一組位移，也不要記一組錯的，
 * 錯的位移會讓 STEP 8 拿錯段原文去比相似度，DNA 的藍綠分界就跟著錯。
 */
function locateSelection(
  selection: Selection | null,
  content: string,
  text: string,
): { start: number | null; end: number | null } {
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (
    range &&
    range.startContainer === range.endContainer &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    normalizeClipboardText(range.startContainer.textContent ?? "") === content
  ) {
    const start = Math.min(range.startOffset, range.endOffset);
    return { start, end: start + text.length };
  }
  const index = content.indexOf(text);
  return index >= 0
    ? { start: index, end: index + text.length }
    : { start: null, end: null };
}

/**
 * 對話欄。
 *
 * 鷹架按鈕全程開啟（CLAUDE.md §4.6）：點擊把模板塞進輸入框、記一筆
 * scaffold_click，並把該 scaffold_id 掛到「接下來送出的那則訊息」上，
 * 讓事件與訊息在分析時對得起來。
 *
 * 串流以 SSE 逐字顯示。中途失敗時只留下已顯示的文字並提示重問——
 * 伺服器端不會把半截回覆寫進資料庫。
 *
 * 【複製攔截（STEP 6）】學生從這裡複製走的每一段都記一筆 copy 事件，AI 的回覆
 * 另外登記進來源簿；等一下貼進編輯器時就認得出「這段是 AI 寫的」。
 */
export default function ChatPane({
  sessionId,
  scaffolds,
  history,
  disabled,
  onActivity,
}: {
  sessionId: string;
  scaffolds: ScaffoldButton[];
  history: ChatHistoryItem[];
  disabled: boolean;
  onActivity: () => void;
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>(history);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [notice, setNotice] = useState("");
  const pendingScaffold = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function applyScaffold(button: ScaffoldButton): void {
    onActivity();
    pendingScaffold.current = button.id;
    setDraft((current) =>
      current.trim() ? `${current.trimEnd()}\n${button.template}` : button.template,
    );
    inputRef.current?.focus();
    void emitEvent(sessionId, "scaffold_click", {
      scaffold_id: button.id,
      label: button.label,
    });
  }

  /**
   * 複製攔截。
   *
   * 來源簿先同步寫一筆（copyEventId 還是 null），再等 client_seq 回來補上——
   * 學生「複製完立刻貼上」只差幾十毫秒，等 IndexedDB 回應才登記的話，那一貼
   * 會查不到來源而被誤判成外部。少一個 copyEventId 不影響歸屬判定，
   * 判錯來源才是真的會毀掉資料。
   */
  function handleCopy(bubble: Bubble): void {
    const selection = window.getSelection();
    const text = normalizeClipboardText(selection ? selection.toString() : "");
    if (!text.trim()) return;

    onActivity();

    const content = normalizeClipboardText(bubble.content);
    const { start, end } = locateSelection(selection, content, text);
    const sha1 = fingerprint(text);
    const source = {
      sha1,
      length: text.length,
      messageId: bubble.id,
      srcStart: start,
      srcEnd: end,
    };
    const isAi = bubble.role === "assistant";

    if (isAi) rememberCopySource(sessionId, { ...source, copyEventId: null });

    void emitEvent(sessionId, "copy", {
      from: bubble.role,
      message_id: bubble.id,
      sha1,
      length: text.length,
      src_start: start,
      src_end: end,
    }).then((seq) => {
      if (isAi && seq !== null) rememberCopySource(sessionId, { ...source, copyEventId: seq });
    });
  }

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || streaming || disabled) return;

    onActivity();
    const scaffoldId = pendingScaffold.current;
    pendingScaffold.current = null;

    setBubbles((prev) => [...prev, { id: null, role: "user", content: text }]);
    setDraft("");
    setPartial("");
    setNotice("");
    setStreaming(true);

    void emitEvent(sessionId, "chat_send", {
      length: text.length,
      scaffold_id: scaffoldId,
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          scaffold_id: scaffoldId,
        }),
      });

      if (!res.ok || !res.body) {
        setNotice("AI 現在有點忙，等一下再問一次");
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let finished = false;
      let messageId: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.type === "delta" && typeof event.text === "string") {
            answer += event.text;
            setPartial(answer);
          } else if (event.type === "done") {
            finished = true;
            messageId = typeof event.message_id === "string" ? event.message_id : null;
            void emitEvent(sessionId, "chat_receive", {
              length: answer.length,
              message_id: messageId,
              input_tokens: event.input_tokens ?? null,
              output_tokens: event.output_tokens ?? null,
            });
          } else if (event.type === "error") {
            setNotice("回覆中斷了，再問一次");
          }
        }
      }

      if (finished) {
        setBubbles((prev) => [
          ...prev,
          { id: messageId, role: "assistant", content: answer },
        ]);
      } else if (answer) {
        // 伺服器沒有寫入這段殘缺回覆，畫面上也不留下它假裝是完整答案。
        setNotice("回覆中斷了，再問一次");
      }
    } catch {
      setNotice("連不上，檢查一下網路再問一次");
    } finally {
      setPartial("");
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold text-neutral-700">
        和 AI 討論
      </h2>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {bubbles.length === 0 && !partial ? (
          <p className="rounded-lg bg-neutral-100 px-4 py-3 text-neutral-600">
            這裡可以問 AI 問題，想到什麼都可以問。
          </p>
        ) : null}

        {bubbles.map((bubble, index) => (
          <div
            key={index}
            onCopy={() => handleCopy(bubble)}
            className={
              bubble.role === "user"
                ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-900 px-4 py-2.5 text-white"
                : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-4 py-2.5 text-neutral-800"
            }
          >
            {bubble.content}
          </div>
        ))}

        {partial ? (
          <div
            aria-live="polite"
            className="mr-auto max-w-[90%] whitespace-pre-wrap rounded-lg bg-neutral-100 px-4 py-2.5 text-neutral-800"
          >
            {partial}
          </div>
        ) : null}

        {notice ? (
          <p role="alert" className="rounded-lg bg-orange-50 px-4 py-2.5 text-orange-800">
            {notice}
          </p>
        ) : null}
      </div>

      {scaffolds.length > 0 ? (
        <div className="border-t border-neutral-200 px-3 pt-3">
          <h3 className="mb-2 text-xs font-medium text-neutral-500">
            不知道怎麼問的話，點一個
          </h3>
          <div className="flex flex-wrap gap-2">
            {scaffolds.map((button) => (
              <button
                key={button.id}
                type="button"
                onClick={() => applyScaffold(button)}
                disabled={disabled || streaming}
                className="rounded-full border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
              >
                {button.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 border-t border-neutral-200 p-3">
        <label htmlFor="chat-input" className="sr-only">
          想問 AI 什麼
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter 送出、Shift+Enter 換行。注音選字中的 Enter 不可攔截，
            // 否則學生選第一個候選字就把訊息送出去了。
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={disabled || streaming}
          placeholder={disabled ? "這次已經交出去了" : "想問什麼就打在這裡"}
          className="min-h-0 w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-base disabled:bg-neutral-50 disabled:text-neutral-500"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={disabled || streaming || !draft.trim()}
          className="shrink-0 self-end rounded-lg bg-neutral-900 px-4 py-2.5 text-base font-medium text-white disabled:opacity-40"
        >
          {streaming ? "…" : "送出"}
        </button>
      </div>
    </div>
  );
}
