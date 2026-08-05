"use client";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * 儲存狀態指示。
 *
 * 【STEP 3 的誠實界線】目前只反映「暫存在這台裝置」（localStorage），
 * 因為事件寫入要到 STEP 5、快照要到 STEP 7 才接上資料庫。文案因此寫
 * 「存在這台裝置」而不是「已儲存」——對學生謊稱已存檔，一次就把信任賠光。
 */
export default function SaveStatus({ state }: { state: SaveState }) {
  const text =
    state === "saving"
      ? "存檔中…"
      : state === "saved"
        ? "已存在這台裝置"
        : state === "error"
          ? "存不起來，先別關掉這一頁"
          : "還沒開始寫";

  const tone =
    state === "error" ? "text-orange-700 font-medium" : "text-neutral-500";

  return (
    <span role="status" aria-live="polite" className={tone}>
      {text}
    </span>
  );
}
