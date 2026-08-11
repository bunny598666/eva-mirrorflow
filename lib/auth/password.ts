/**
 * PIN 雜湊（bcrypt）。
 *
 * 只在伺服器端使用——pin_hash 已由 003_rls.sql 的欄位權限擋在前端之外，
 * 讀取它必須走 service_role。
 *
 * 【PIN 只有 6 位數字，熵約 20 bits】bcrypt 擋得住雜湊外洩後的離線破解
 * （每次驗證約 100ms），擋不住線上暴力嘗試——那一層由 lib/auth/throttle.ts
 * 負責（10 分鐘內失敗 10 次鎖 5 分鐘，以代號為單位、不記 IP）。
 * 兩層合起來把一百萬種組合的嘗試時間拉到兩年以上。
 */
import bcrypt from "bcryptjs";

const COST = 10;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
