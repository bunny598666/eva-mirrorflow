/** 三種角色（CLAUDE.md §1）。researcher 不隸屬班級，class_id 為 null。 */
export type Role = "student" | "teacher" | "researcher";

export const ROLES: readonly Role[] = ["student", "teacher", "researcher"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * JWT 內的宣告。欄位名稱刻意對齊 003_rls.sql 的 app.participant_id() /
 * app.app_role() / app.class_id()，日後若改為讓瀏覽器直連 Supabase，
 * 同一份 token 不必改欄位就能餵給 PostgREST。
 */
export type SessionClaims = {
  participant_id: string;
  code: string;
  app_role: Role;
  class_id: string | null;
  iat: number;
  exp: number;
};
