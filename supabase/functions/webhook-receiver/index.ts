import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac, timingSafeEqual } from "node:crypto";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")!;
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;

/**
 * リッチメニューのタップで送られてくる定型キーワード（カンマ区切り）。
 * 外部ツール（L-Step / エルメ 等）が自動で返信するため、これらは
 * 顧客からの問い合わせではなく、未返信アラートの対象にすべきではない。
 * 一致したメッセージは replied=true で保存し、記録は残しつつアラートから除外する。
 * 未設定（空）の場合は何も除外しない＝従来どおりの挙動。
 */
const RICHMENU_KEYWORDS = (Deno.env.get("RICHMENU_KEYWORDS") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** 受信テキストがリッチメニューの定型キーワードと完全一致するか（前後空白は無視） */
function isRichMenuKeyword(text: string): boolean {
  if (RICHMENU_KEYWORDS.length === 0) return false;
  return RICHMENU_KEYWORDS.includes(text.trim());
}

/**
 * リッチメニュー応答を担う外部ツール（L-Step / エルメ 等）の Webhook URL。
 * LINE の Webhook URL は 1 つしか登録できないため、この Function が 1 次受けし、
 * 受信内容をそのまま外部ツールへ転送（リレー）して両立させる。
 * 未設定なら転送しない（＝従来どおり、本システム単独で受信）。
 */
const RELAY_WEBHOOK_URL = Deno.env.get("RELAY_WEBHOOK_URL") ?? "";

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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!verifySignature(rawBody, signature)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: LineWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  // 外部ツール（リッチメニュー応答用）へ並行して転送する。DB 保存と同時に走らせ、
  // 最後にまとめて待つことで、お客様への自動応答の遅延を最小化する。
  const relayPromise = relayWebhook(rawBody, signature);

  const errors: string[] = [];

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    if (event.source?.type !== "user") continue;

    const userId = event.source.userId!;
    const displayName = await fetchDisplayName(userId);
    const receivedAt = new Date(event.timestamp).toISOString();

    // リッチメニューのタップ（定型キーワード）は外部ツールが自動返信するため、
    // 未返信アラートの対象から外す。replied=true で保存し記録だけ残す。
    const isMenuTap = isRichMenuKeyword(event.message.text);

    // 衝突時（同一 message_id）は inbound の内容だけ更新し、
    // replied / replied_at は既存の値を保持する（再送で返信済みが消えるのを防ぐ）。
    const { error } = await supabase.from("messages").upsert(
      {
        user_id: userId,
        display_name: displayName,
        message_id: event.message.id,
        text: event.message.text,
        direction: "inbound",
        received_at: receivedAt,
        // 通常メッセージは replied / replied_at を指定しない → ON CONFLICT 時にも触れない。
        // メニュータップのみ replied=true で記録し、アラート集計から除外する。
        ...(isMenuTap ? { replied: true, replied_at: receivedAt } : {}),
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

  // 外部ツールへの転送完了を待つ（失敗してもここでは throw されない）
  await relayPromise;

  // 1件でも DB 保存に失敗したら 500 を返し、LINE に再送を促す
  if (errors.length > 0) {
    return new Response(
      JSON.stringify({ error: "DB save failed", failed_ids: errors }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response("OK", { status: 200 });
});

/**
 * 受信した Webhook を外部ツール（リッチメニュー応答用）へそのまま転送する。
 * 生ボディと元の x-line-signature を転送するため、外部ツールは同じ
 * チャネルシークレットで署名検証して通る。
 * RELAY_WEBHOOK_URL が未設定なら何もしない。失敗しても LINE への応答は止めない。
 */
async function relayWebhook(rawBody: string, signature: string): Promise<void> {
  if (!RELAY_WEBHOOK_URL) return;
  try {
    const res = await fetch(RELAY_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`Webhook 転送失敗: ${res.status} ${body}`);
    }
  } catch (e) {
    console.error("Webhook 転送エラー:", e);
  }
}

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
