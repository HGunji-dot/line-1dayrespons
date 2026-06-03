// 簡易・共有パスワード認証のためのセッションクッキー署名/検証。
// Web Crypto（globalThis.crypto.subtle）だけを使うので、
// Edge ランタイムの middleware でも Node の API Route でも同じコードで動く。

export const SESSION_COOKIE = "line_reply_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7日

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64url(new Uint8Array(sig));
}

/** ログイン成功時に発行するクッキー値（`<issuedAtSec>.<signature>`）。 */
export async function createSessionToken(secret: string): Promise<string> {
  const issued = Math.floor(Date.now() / 1000).toString();
  const sig = await hmac(secret, issued);
  return `${issued}.${sig}`;
}

/** クッキー値が有効（署名一致かつ未期限切れ）かを検証する。 */
export async function verifySessionToken(
  token: string | undefined,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const issued = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, issued);
  // 長さ一致かつ定数時間比較
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;

  const issuedSec = Number(issued);
  if (!Number.isFinite(issuedSec)) return false;
  const ageSec = Math.floor(Date.now() / 1000) - issuedSec;
  return ageSec >= 0 && ageSec <= MAX_AGE_SEC;
}

export const SESSION_MAX_AGE = MAX_AGE_SEC;
