/**
 * PIN 雜湊（bcrypt）。
 *
 * 只在伺服器端使用——pin_hash 已由 003_rls.sql 的欄位權限擋在前端之外，
 * 讀取它必須走 service_role。
 *
 * 【已知限制】PIN 是 6 位數字，熵僅約 20 bits。bcrypt 擋得住雜湊外洩後的離線
 * 破解（每次驗證約 100ms），但擋不住線上暴力嘗試。正式課堂前應補上登入次數
 * 限制——記錄於 PILOT_NOTES.md，STEP 13 壓測時一併處理。
 */
import bcrypt from "bcryptjs";

const COST = 10;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
