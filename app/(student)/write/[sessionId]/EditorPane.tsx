"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { startCapture, type CaptureHandle } from "@/lib/events/capture";
import type { SaveState } from "./SaveStatus";

/**
 * Tiptap 編輯器。
 *
 * STEP 3 做外框與本機暫存；STEP 5 接上事件擷取（keystroke 打包、大段刪除、
 * 停頓、焦點切換）。Provenance Marks 於 STEP 6、快照與回放於 STEP 7 接上，
 * 都掛在同一個 editor 實例上。
 *
 * immediatelyRender: false 是 SSR 必要設定，否則伺服器與用戶端渲染不一致。
 */
export default function EditorPane({
  sessionId,
  onSaveStateChange,
  onCaptureReady,
}: {
  sessionId: string;
  onSaveStateChange: (state: SaveState) => void;
  onCaptureReady: (capture: CaptureHandle | null) => void;
}) {
  const draftKey = `mf-draft-${sessionId}`;
  const timer = useRef<number | null>(null);
  const capture = useRef<CaptureHandle | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    immediatelyRender: false,
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose-none min-h-full w-full max-w-none px-6 py-5 text-lg leading-relaxed focus:outline-none",
        "aria-label": "文章編輯區",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: instance }) => {
      capture.current?.onDocChange();

      onSaveStateChange("saving");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        try {
          window.localStorage.setItem(draftKey, JSON.stringify(instance.getJSON()));
          onSaveStateChange("saved");
        } catch {
          onSaveStateChange("error");
        }
      }, 800);
    },
  });

  // 讀回本機暫存稿，然後才啟動事件擷取——順序很重要：
  // 若先啟動擷取，回復草稿會被當成「學生剛剛打了一整篇」記成一筆巨大的 keystroke_batch。
  useEffect(() => {
    if (!editor) return;

    const saved = window.localStorage.getItem(draftKey);
    if (saved) {
      try {
        editor.commands.setContent(JSON.parse(saved) as object, { emitUpdate: false });
        onSaveStateChange("saved");
      } catch {
        window.localStorage.removeItem(draftKey);
      }
    }

    const handle = startCapture(sessionId, () => editor.getText());
    capture.current = handle;
    onCaptureReady(handle);

    return () => {
      handle.stop();
      capture.current = null;
      onCaptureReady(null);
    };
  }, [editor, draftKey, sessionId, onSaveStateChange, onCaptureReady]);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <h2 className="border-b border-neutral-200 px-6 py-3 text-base font-semibold text-neutral-700">
        我的文章
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
