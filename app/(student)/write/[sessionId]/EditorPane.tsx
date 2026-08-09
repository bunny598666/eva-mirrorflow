"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { startCapture, type CaptureHandle } from "@/lib/events/capture";
import { emitEvent, peekSeq } from "@/lib/events/queue";
import { startSnapshots } from "@/lib/replay/snapshot";
import { PROVENANCE_EXTENSIONS } from "@/lib/editor/marks";
import { decidePaste } from "@/lib/editor/paste";
import { hydrateCopySources } from "@/lib/editor/clipboard";
import type { SaveState } from "./SaveStatus";

/**
 * Tiptap 編輯器。
 *
 * STEP 3 做外框與本機暫存；STEP 5 接上事件擷取（keystroke 打包、大段刪除、
 * 停頓、焦點切換）；STEP 6 接上貼上攔截與 Provenance Marks；STEP 7 接上快照
 * （每 60 秒或 200 個事件存一份含 marks 的 doc），全部掛在同一個 editor 實例上。
 *
 * immediatelyRender: false 是 SSR 必要設定，否則伺服器與用戶端渲染不一致。
 */
type StoredDraft = { doc: unknown; clientSeq: number };

/**
 * 讀本機暫存稿。
 *
 * 舊格式只存了 doc 本身（沒有序號）。那種一律當成 clientSeq = 0，
 * 有快照時讓快照勝出——舊格式只存在於開發期，不值得為它冒著接錯事件流的風險。
 */
function readLocalDraft(key: string): StoredDraft | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.doc === "object" && record.doc !== null) {
      const seq = typeof record.clientSeq === "number" ? record.clientSeq : 0;
      return { doc: record.doc, clientSeq: seq };
    }
    // 舊格式：整個物件就是 doc。
    return record.type === "doc" ? { doc: record, clientSeq: 0 } : null;
  } catch {
    return null;
  }
}

export default function EditorPane({
  sessionId,
  snapshotIntervalMs,
  snapshotEventCount,
  latestSnapshot,
  onSaveStateChange,
  onCaptureReady,
}: {
  sessionId: string;
  snapshotIntervalMs: number;
  snapshotEventCount: number;
  latestSnapshot: StoredDraft | null;
  onSaveStateChange: (state: SaveState) => void;
  onCaptureReady: (capture: CaptureHandle | null) => void;
}) {
  const draftKey = `mf-draft-${sessionId}`;
  const timer = useRef<number | null>(null);
  const capture = useRef<CaptureHandle | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, ...PROVENANCE_EXTENSIONS],
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

      /**
       * 貼上攔截（STEP 6）。整段接管貼上，只取純文字，依來源掛 mark。
       * 判斷邏輯在 lib/editor/paste.ts（可離線驗證），這裡只負責接線。
       *
       * 這一步是整個 DNA 三色歸因的地基：沒有它，最終稿裡「AI 寫的」與
       * 「自己寫的」就完全分不出來。
       */
      handlePaste: (view, event) => {
        const outcome = decidePaste(
          view.state,
          event.clipboardData?.getData("text/plain") ?? "",
          event.clipboardData?.getData("text/html") ?? "",
        );
        if (!outcome) return false;

        void emitEvent(sessionId, "paste", outcome.payload);
        if (!outcome.handled || !outcome.tr) return false;

        view.dispatch(outcome.tr);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      capture.current?.onDocChange();

      onSaveStateChange("saving");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void (async () => {
          try {
            // 一併記下當下的事件序號：下次開啟時才判斷得出本機這份與伺服器
            // 快照哪一份比較新。沒有序號就只能瞎猜，猜錯會接錯事件流。
            const clientSeq = await peekSeq(sessionId);
            window.localStorage.setItem(
              draftKey,
              JSON.stringify({ doc: instance.getJSON(), clientSeq }),
            );
            onSaveStateChange("saved");
          } catch {
            onSaveStateChange("error");
          }
        })();
      }, 800);
    },
  });

  // 讀回本機暫存稿，然後才啟動事件擷取——順序很重要：
  // 若先啟動擷取，回復草稿會被當成「學生剛剛打了一整篇」記成一筆巨大的 keystroke_batch。
  // 把先前的複製紀錄灌回記憶體。學生重整頁面後再貼上，仍認得出那是 AI 的話。
  useEffect(() => {
    void hydrateCopySources(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!editor) return;

    // 本機暫存稿與伺服器快照，取「反映到比較後面的事件」那一份。
    //
    // 平常本機那份比較新（快照最多 60 秒存一次），所以走本機。
    // 但本機那份會消失——換裝置、換瀏覽器、被清掉網頁資料。那時候若從空白重來，
    // 事件流會從「已經寫了 200 字」直接接到「從 0 字開始改」，重演就永久斷掉。
    // 快照就是為了補這條路才存在的。
    const local = readLocalDraft(draftKey);
    // 用 falsy 判斷而不是 === null：這個值一路從伺服器元件傳下來，
    // 少接一層或型別鬆掉時會是 undefined，硬讀 .clientSeq 就會讓整個編輯器炸掉，
    // 而學生看到的是一片空白——沒有比這更糟的失敗方式。
    const snapshot = latestSnapshot ?? null;
    const useLocal = local !== null && (!snapshot || local.clientSeq >= snapshot.clientSeq);
    const restored = useLocal ? local : snapshot;

    if (restored) {
      try {
        editor.commands.setContent(restored.doc as object, { emitUpdate: false });
        onSaveStateChange("saved");
      } catch {
        window.localStorage.removeItem(draftKey);
      }
    }

    const handle = startCapture(sessionId, () => editor.getText());
    capture.current = handle;
    onCaptureReady(handle);

    // 快照必須在擷取啟動之後才開始：它會先呼叫 flushPending 結清批次，
    // 沒有 capture 就無從結清，doc 與 seq_event_id 會對不上。
    const stopSnapshots = startSnapshots({
      sessionId,
      getDoc: () => editor.getJSON(),
      flushPending: () => handle.flushPending(),
      peekSeq: () => peekSeq(sessionId),
      intervalMs: snapshotIntervalMs,
      eventCount: snapshotEventCount,
    });

    return () => {
      stopSnapshots();
      handle.stop();
      capture.current = null;
      onCaptureReady(null);
    };
  }, [
    editor,
    draftKey,
    sessionId,
    snapshotIntervalMs,
    snapshotEventCount,
    latestSnapshot,
    onSaveStateChange,
    onCaptureReady,
  ]);

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
