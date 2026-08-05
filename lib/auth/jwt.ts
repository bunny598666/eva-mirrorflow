/**
 * HS256 JWT 簽發與驗證。
 *
 * 刻意使用 Web Crypto（crypto.subtle）而非 node:crypto——proxy.ts 的路由守衛
 * 需要驗證 token，而 proxy 跑在 Edge runtime，node:crypto 在那裡不存在。
 * Web Crypto 在 Edge 與 Node 22 都可用，同一份程式碼兩邊通用。
 *
 * 驗證時明確只接受 alg='HS256'，杜絕 alg 混淆與 alg='none' 攻擊。
 */
import { isRole, type Role, type SessionClaims } from "./types";

const ALG = "HS256";
const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 回傳型別綁定 ArrayBuffer（而非 ArrayBufferLike），crypto.subtle 的
// BufferSource 不接受可能是 SharedArrayBuffer 的視圖。
function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export type NewSession = {
  participantId: string;
  code: string;
  role: Role;
  classId: string | null;
};

/** 課堂單節 90 分鐘，取 12 小時涵蓋整個上課日，避免學生寫到一半被登出。 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function signToken(
  session: NewSession,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    participant_id: session.participantId,
    code: session.code,
    app_role: session.role,
    class_id: session.classId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };

  const header = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: ALG, typ: "JWT" })),
  );
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;

  const signature = await crypto.subtle.sign(
    "HMAC",
    await importKey(secret),
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** 驗證失敗一律回 null，絕不拋例外——呼叫端只需判斷「有沒有合法身分」。 */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<SessionClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  try {
    const decodedHeader: unknown = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(header)),
    );
    if (
      typeof decodedHeader !== "object" ||
      decodedHeader === null ||
      (decodedHeader as { alg?: unknown }).alg !== ALG
    ) {
      return null;
    }

    const valid = await crypto.subtle.verify(
      "HMAC",
      await importKey(secret),
      base64UrlDecode(signature),
      encoder.encode(`${header}.${payload}`),
    );
    if (!valid) return null;

    const claims: unknown = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payload)),
    );
    return parseClaims(claims);
  } catch {
    return null;
  }
}

function parseClaims(value: unknown): SessionClaims | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;

  if (typeof c.participant_id !== "string") return null;
  if (typeof c.code !== "string") return null;
  if (!isRole(c.app_role)) return null;
  if (c.class_id !== null && typeof c.class_id !== "string") return null;
  if (typeof c.iat !== "number" || typeof c.exp !== "number") return null;
  if (c.exp <= Math.floor(Date.now() / 1000)) return null;

  return {
    participant_id: c.participant_id,
    code: c.code,
    app_role: c.app_role,
    class_id: c.class_id,
    iat: c.iat,
    exp: c.exp,
  };
}
