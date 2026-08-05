/**
 * Route Handler 的授權外殼。
 *
 * proxy.ts 只擋得住路徑，擋不住「這筆資料是不是你的」，因此每個 Route Handler
 * 仍須各自 requireRole()，並在查詢中以 class_id / participant_id 收斂範圍。
 * 這不是重複——service_role 繞過 RLS，應用層是唯一一道授權。
 */
import { NextResponse } from "next/server";
import { AuthError, requireRole } from "@/lib/auth/session";
import type { Role, SessionClaims } from "@/lib/auth/types";

export async function guarded(
  roles: readonly Role[],
  fn: (session: SessionClaims) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const session = await requireRole(...roles);
    return await fn(session);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // API 錯誤結構化 log（CLAUDE.md §6）
    console.error("[api] 未預期錯誤", {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "系統錯誤" }, { status: 500 });
  }
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
