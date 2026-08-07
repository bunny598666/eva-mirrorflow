"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startEventQueue } from "@/lib/events/queue";
import type { CaptureHandle } from "@/lib/events/capture";
import AssignmentBrief from "./AssignmentBrief";
import ChatPane from "./ChatPane";
import EditorPane from "./EditorPane";
import RemainingTime from "./RemainingTime";
import SaveStatus, { type SaveState } from "./SaveStatus";
import SplitHandle from "./SplitHandle";
import type { ScaffoldButton } from "@/lib/scaffold/types";
import type { ChatHistoryItem } from "@/lib/student/queries";

type Pane = "chat" | "editor";

/**
 * 雙欄工作區。
 *
 * 【版型】桌機／iPad 橫向（≥1024px）走左右分欄，預設 40/60、可拖曳。
 * iPad 直向只有 768px，40/60 會讓對話欄剩不到 310px，13 歲的使用者根本讀不了，
 * 因此小螢幕改為上方兩顆大分頁切換，一次專心一件事。
 *
 * 兩種版型共用同一份 DOM，靠 CSS 切換而非 JS 偵測寬度——後者會在 SSR 與
 * 用戶端之間產生 hydration 不一致。欄寬走 CSS 變數，小螢幕才不會被 inline
 * style 蓋掉 w-full。
 */
export default function WriteWorkspace({
  sessionId,
  title,
  instructions,
  orderNo,
  startedAt,
  minutes,
  scaffolds,
  history,
  submitted,
}: {
  sessionId: string;
  title: string;
  instructions: string;
  orderNo: number;
  startedAt: string;
  minutes: number;
  scaffolds: ScaffoldButton[];
  history: ChatHistoryItem[];
  submitted: boolean;
}) {
  const [percent, setPercent] = useState(40);
  const [pane, setPane] = useState<Pane>("editor");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const capture = useRef<CaptureHandle | null>(null);

  // 事件送出的背景排程。與外部系統（IndexedDB + 網路）同步，屬 effect 的正當用途。
  useEffect(() => startEventQueue(sessionId), [sessionId]);

  const onCaptureReady = useCallback((handle: CaptureHandle | null) => {
    capture.current = handle;
  }, []);

  // 對話與鷹架也算「有在動」，否則學生跟 AI 討論五分鐘會被誤記成停頓。
  const onChatActivity = useCallback(() => {
    capture.current?.noteActivity();
  }, []);

  const splitVars = { ["--split"]: `${percent}%` } as React.CSSProperties;

  return (
    <div className="flex h-dvh flex-col gap-3 bg-neutral-50 p-3">
      <header className="flex flex-col gap-3">
        <AssignmentBrief
          title={title}
          instructions={instructions}
          orderNo={orderNo}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-sm">
          <RemainingTime startedAt={startedAt} minutes={minutes} />
          <SaveStatus state={saveState} />
        </div>
      </header>

      {/* 小螢幕的分頁切換；≥lg 隱藏，因為那時兩欄同時看得到 */}
      <div role="tablist" aria-label="切換畫面" className="flex gap-2 lg:hidden">
        {(
          [
            ["editor", "我的文章"],
            ["chat", "和 AI 討論"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={pane === key}
            onClick={() => setPane(key)}
            className={`flex-1 rounded-lg border px-4 py-3 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 ${
              pane === key
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-300 bg-white text-neutral-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <main
        style={splitVars}
        className="flex min-h-0 flex-1 flex-col gap-0 lg:flex-row lg:gap-1"
      >
        <div
          className={`${pane === "chat" ? "flex" : "hidden"} min-h-0 w-full flex-1 lg:flex lg:w-[var(--split)] lg:flex-none`}
        >
          <div className="min-h-0 w-full">
            <ChatPane
              sessionId={sessionId}
              scaffolds={scaffolds}
              history={history}
              disabled={submitted}
              onActivity={onChatActivity}
            />
          </div>
        </div>

        <SplitHandle percent={percent} onChange={setPercent} />

        <div
          className={`${pane === "editor" ? "flex" : "hidden"} min-h-0 w-full flex-1 lg:flex`}
        >
          <div className="min-h-0 w-full">
            <EditorPane
              sessionId={sessionId}
              onSaveStateChange={setSaveState}
              onCaptureReady={onCaptureReady}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
