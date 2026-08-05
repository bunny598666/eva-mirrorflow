"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SaveState } from "./SaveStatus";

/**
 * Tiptap 編輯器。
 *
 * STEP 3 只做外框：純文字編輯 + 本機暫存。
 * Provenance Marks（貼上來源歸屬）於 STEP 6、事件記錄於 STEP 5、
 * 快照與回放於 STEP 7 接上——那些都掛在同一個 editor 實例上。
 *
 * immediatelyRender: false 是 SSR 必要設定，否則伺服器與用戶端渲染不一致。
 */
export default function EditorPane({
  sessionId,
  onSaveStateChange,
}: {
  sessionId: string;
  onSaveStateChange: (state: SaveState) => void;
}) {
  const draftKey = `mf-draft-${sessionId}`;
  const timer = useRef<number | null>(null);

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

  // 讀回本機暫存稿。這是與外部系統（localStorage）同步，屬於 effect 的正當用途。
  useEffect(() => {
    if (!editor) return;
    const saved = window.localStorage.getItem(draftKey);
    if (!saved) return;
    try {
      editor.commands.setContent(JSON.parse(saved) as object, { emitUpdate: false });
      // 畫面上已經有回復的內容，狀態就不該還寫「還沒開始寫」——
      // 學生看到那句話會以為剛才打的東西沒了。
      onSaveStateChange("saved");
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [editor, draftKey, onSaveStateChange]);

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
