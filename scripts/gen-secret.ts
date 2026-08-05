/** 產生 AUTH_JWT_SECRET。用法：npm run gen:secret */
import { randomBytes } from "node:crypto";

console.log(randomBytes(48).toString("base64url"));
