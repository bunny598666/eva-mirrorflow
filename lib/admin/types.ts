/** 後台頁面共用的資料形狀（對應 001_core.sql 的欄位，snake_case）。 */

export type ClassRow = {
  id: string;
  label: string;
  grade_level: string;
  model: string;
  temperature: number;
  system_prompt_version: string;
};

export type AssignmentRow = {
  id: string;
  title: string;
  instructions: string;
  order_no: number;
  scaffold_buttons: unknown;
};

export type PromptQuestion = { id: string; text: string; min_chars: number };

export type PromptRow = {
  id: string;
  version: string;
  questions: PromptQuestion[];
};

export type ParticipantRow = {
  id: string;
  code: string;
  role: string;
  class_id: string | null;
  consent_at: string | null;
  guardian_consent_at: string | null;
};
