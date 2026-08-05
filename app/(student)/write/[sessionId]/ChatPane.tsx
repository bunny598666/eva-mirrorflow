"use client";

/**
 * 對話欄。
 *
 * STEP 3 只做外框：訊息串版面與輸入框，尚未接上 AI。
 * SSE 串流、鷹架按鈕與 token 入庫於 STEP 4；訊息複製攔截於 STEP 6。
 * 輸入框刻意 disabled 並寫明原因，不做「按了沒反應」的假介面。
 */
export default function ChatPane() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <h2 className="border-b border-neutral-200 px-4 py-3 text-base font-semibold text-neutral-700">
        和 AI 討論
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <p className="rounded-lg bg-neutral-100 px-4 py-3 text-neutral-600">
          這裡可以問 AI 問題，想到什麼都可以問。
        </p>
      </div>

      <div className="border-t border-neutral-200 p-3">
        <label htmlFor="chat-input" className="sr-only">
          想問 AI 什麼
        </label>
        <textarea
          id="chat-input"
          rows={2}
          disabled
          placeholder="對話功能還沒開放"
          className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-base disabled:bg-neutral-50 disabled:text-neutral-500"
        />
      </div>
    </div>
  );
}
