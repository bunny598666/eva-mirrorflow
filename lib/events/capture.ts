/**
 * 事件擷取（STEP 5）：keystroke 每 4 秒或停頓 1.5 秒打包 diff；
 * 另捕捉 focus_switch、idle>30s、delete_block>50 字、mirror_view、recap_view。
 */

/** 對應 events.type 的 CHECK 約束（BUILD_PLAN §4）。 */
export type EventType =
  | "chat_send"
  | "chat_receive"
  | "copy"
  | "paste"
  | "keystroke_batch"
  | "delete_block"
  | "focus_switch"
  | "scaffold_click"
  | "idle"
  | "submit"
  | "mirror_view"
  | "recap_view";

export type CapturedEvent = {
  sessionId: string;
  clientSeq: number;
  type: EventType;
  payload: Record<string, unknown>;
  ts: string;
};
