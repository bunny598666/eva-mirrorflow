/**
 * 批次產生參與者代號與 PIN。
 *
 * 【鐵則二／零 PII】只產生代號（如 S-07），不接受也不儲存任何姓名資訊。
 * 【明碼不落庫】PIN 明碼僅在本次 HTTP 回應中出現一次，資料庫只存 bcrypt 雜湊。
 * 教師錯過就得重新產生一批新的——這是刻意的，明碼可回查等於明碼落庫。
 */
import { randomInt } from "node:crypto";
import { hashPin } from "@/lib/auth/password";

export const PIN_LENGTH = 6;

export type GeneratedCredential = { code: string; pin: string };

/** 6 位數字，允許前導零；以 CSPRNG 產生，不用 Math.random。 */
export function generatePin(): string {
  let pin = "";
  for (let i = 0; i < PIN_LENGTH; i += 1) pin += String(randomInt(0, 10));
  return pin;
}

export function buildCodes(prefix: string, count: number, taken: Set<string>): string[] {
  const codes: string[] = [];
  let n = 1;
  while (codes.length < count) {
    const code = `${prefix}-${String(n).padStart(2, "0")}`;
    if (!taken.has(code)) codes.push(code);
    n += 1;
    if (n > 999) break;
  }
  return codes;
}

export async function withHashes(
  codes: readonly string[],
): Promise<{ credentials: GeneratedCredential[]; rows: { code: string; pin_hash: string }[] }> {
  const credentials: GeneratedCredential[] = [];
  const rows: { code: string; pin_hash: string }[] = [];
  for (const code of codes) {
    const pin = generatePin();
    credentials.push({ code, pin });
    rows.push({ code, pin_hash: await hashPin(pin) });
  }
  return { credentials, rows };
}

/** CSV 只含代號與 PIN，無任何 PII。BOM 讓 Excel 正確辨識 UTF-8。 */
export function toCsv(credentials: readonly GeneratedCredential[]): string {
  const lines = ["code,pin", ...credentials.map((c) => `${c.code},${c.pin}`)];
  return `﻿${lines.join("\r\n")}\r\n`;
}
