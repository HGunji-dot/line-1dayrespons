/**
 * webhook-receiver Edge Function
 *
 * LINE の Webhook を受け取り inbound メッセージを DB に保存する。
 *
 * 【L-Step 併用について】
 * LINE 公式アカウントの Webhook URL は1つだけで、本番では L-Step が占有している。
 * そのため L-Step の「Webhook転送」機能で、L-Step が受けた LINE 生イベントを
 * この関数の URL へ転送してもらう構成を取る（L-Step は LINE の生データをそのまま橋渡しする）。
 *
 * 認証は二段構え（どちらか一方が通れば受理）:
 *   1) 共有シークレット: 登録 URL に `?k=<RELAY_SECRET>` を付け、これを検証する。
 *      L-Step 経由で x-line-signature が（再シリアライズ等で）検証できない場合に効く。
 *   2) LINE 署名: x-line-signature を LINE_CHANNEL_SECRET で検証できれば受理する。
 *      LINE 直結、または L-Step が元の body と署名をそのまま転送する場合に効く。
 * → 転送時に署名が保持されるか事前に確定できなくても動く。初期は下の console.log で
 *    どちらの経路で届いているかを観測し、後で認証方式を締められる。
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
// L-Step 転送を識別・認証するための共有シークレット（登録 URL の ?k= と照合）。
// 未設定なら従来どおり LINE 署名のみで認証する（後方互換）。
const RELAY_SECRET = Deno.env.get("RELAY_SECRET") ?? "";

/** Base64 文字列をバイト列に変換（Edge ランタイムで Buffer が使えないため Uint8Array のみ使用） */
function base64ToUint8Array(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * LINEのWebhook署名をタイミング攻撃に耐性のある比較で検証する。
 * 長さが一致しない場合も即 false を返す。
 */
function verifySignature(body: string, signature: string): boolean {
  const digestB64 = createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  const digestBytes = base64ToUint8Array(digestB64);
  const sigBytes = base64ToUint8Array(signature);
  if (!digestBytes || !sigBytes || digestBytes.length !== sigBytes.length) {
    return false;
  }
  return timingSafeEqual(digestBytes, sigBytes);
}

/** 共有シークレット（?k=）をタイミング攻撃に耐性のある比較で検証する。 */
function verifyRelaySecret(provided: string): boolean {
  if (!RELAY_SECRET) return false; // 未設定なら共有シークレット認証は無効
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(RELAY_SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";
  const relayKey = new URL(req.url).searchParams.get("k") ?? "";

  const sigValid = signature !== "" && verifySignature(rawBody, signature);
  const relayValid = verifyRelaySecret(relayKey);

  // 観測用ログ（秘密値は出さない）。どちらの経路・認証で届いているか確認し、後で締めるための材料。
  console.log(
    `webhook auth: sigValid=${sigValid} relayValid=${relayValid} hasSig=${signature !== ""} hasRelayKey=${relayKey !== ""}`
  );

  // LINE 署名か共有シークレットのどちらかが通れば受理する。
  if (!sigValid && !relayValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: LineWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  // L-Step 転送の形式確認用。events が空＝想定外の封筒形式の可能性（生 LINE 形式なら events 配列を含む）。
  if (events.length === 0) {
    console.log(`webhook: events is empty (body keys: ${Object.keys(payload).join(",")})`);
  }

  const errors: string[] = [];

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (event.source?.type !== "user") continue;

    const userId = event.source.userId!;
    const displayName = await fetchDisplayName(userId);

    // 衝突時（同一 message_id）は inbound の内容だけ更新し、
    // replied / replied_at は既存の値を保持する（再送で返信済みが消えるのを防ぐ）。
    const { error } = await supabase.from("messages").upsert(
      {
        user_id: userId,
        display_name: displayName,
        message_id: event.message.id,
        text: event.message.text,
        direction: "inbound",
        received_at: new Date(event.timestamp).toISOString(),
        // replied / replied_at はここで指定しない → ON CONFLICT 時にも触れない
      },
      {
        onConflict: "message_id",
        // ignoreDuplicates: true にすると衝突時はスキップ（replied を保護できる）
        ignoreDuplicates: true,
      }
    );

    if (error) {
      console.error(`INSERT error for message_id=${event.message.id}:`, error);
      errors.push(event.message.id);
    }
  }

  // 1件でも DB 保存に失敗したら 500 を返し、LINE に再送を促す
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "DB save failed", failed_ids: errors }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response("OK", { status: 200 });
});

/** LINE Messaging API でユーザーのプロフィールを取得する */
async function fetchDisplayName(userId: string): Promise<string> {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return userId;

  try {
    const res = await fetch(
      `https://api.line.me/v2/bot/profile/${userId}`,
      { headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    if (!res.ok) return userId;
    const data = await res.json();
    return (data.displayName as string) ?? userId;
  } catch {
    return userId;
  }
}

// --- 型定義 ---

interface LineWebhookPayload {
  destination: string;
  events: LineEvent[];
}

interface LineEvent {
  type: string;
  timestamp: number;
  source: {
    type: string;
    userId?: string;
  };
  message?: {
    id: string;
    type: string;
    text: string;
  };
  replyToken?: string;
}
