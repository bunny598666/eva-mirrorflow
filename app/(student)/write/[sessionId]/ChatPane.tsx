"use client";

import { useRef, useState } from "react";
import { emitEvent } from "@/lib/events/queue";
import type { ScaffoldButton } from "@/lib/scaffold/types";
import type { ChatHistoryItem } from "@/lib/student/queries";

type Bubble = { role: "user" | "assistant"; content: string };

/**
 * 對話欄。
 *
 * 鷹架按鈕全程開啟（CLAUDE.md §4.6）：點擊把模板塞進輸入框、記一筆
 * scaffold_click，並把該 scaffold_id 掛到「接下來送出的那則訊息」上，
 * 讓事件與訊息在分析時對得起來。
 *
 * 串流以 SSE 逐字顯示。中途失敗時只留下已顯示的文字並提示重問——
 * 伺服器端不會把半截回覆寫進資料庫。
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

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || streaming || disabled) return;

    onActivity();
    const scaffoldId = pendingScaffold.current;
    pendingScaffold.current = null;

    setBubbles((prev) => [...prev, { role: "user", content: text }]);
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
            void emitEvent(sessionId, "chat_receive", {
              length: answer.length,
              input_tokens: event.input_tokens ?? null,
              output_tokens: event.output_tokens ?? null,
            });
          } else if (event.type === "error") {
            setNotice("回覆中斷了，再問一次");
          }
        }
      }

      if (finished) {
        setBubbles((prev) => [...prev, { role: "assistant", content: answer }]);
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
