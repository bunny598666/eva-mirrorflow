/** 對應 001_core.sql 中 events.type 的 CHECK 約束。伺服器與用戶端共用。 */
export const EVENT_TYPES = [
  "chat_send",
  "chat_receive",
  "copy",
  "paste",
  "keystroke_batch",
  "delete_block",
  "focus_switch",
  "scaffold_click",
  "idle",
  "submit",
  "mirror_view",
  "recap_view",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type OutgoingEvent = {
  client_seq: number;
  type: EventType;
  payload: Record<string, unknown>;
  ts: string;
};
