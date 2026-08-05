/**
 * 產生 AUTH_JWT_SECRET。用法：npm run gen:secret
 *
 * 密鑰印在 stdout（方便直接複製或導向檔案），說明印在 stderr。
 */
import { randomBytes } from "node:crypto";

const secret = randomBytes(48).toString("base64url");

console.error("--- 以下這一行就是 AUTH_JWT_SECRET，整行複製 ---");
console.log(secret);
console.error(
  "--- 貼到 Vercel 的環境變數，或本機 .env.local 的 AUTH_JWT_SECRET= 後面 ---",
);
