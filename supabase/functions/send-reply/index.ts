/**
 * send-reply Edge Function
 *
 * 管理者が返信を送るためのエンドポイント。
 * LINE Push API でメッセージを送信し、DB に outbound を記録した上で
 * 対象ユーザーの未返信フラグをまとめて replied=true にする。
 *
 * リクエスト例:
 *   POST /functions/v1/send-reply
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   { "userId": "Uxxxxxxxxx", "message": "テキスト", "imageUrl": "https://..." }
 *
 * message / imageUrl はどちらか一方のみでも可（両方指定時は別メッセージとして順に送信）
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  // 管理者認証（シンプルな Bearer トークン方式）
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { userId?: string; message?: string; imageUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId, message, imageUrl } = body;
  if (!userId) {
    return json({ error: "userId is required" }, 400);
  }
  if (!message && !imageUrl) {
    return json({ error: "message or imageUrl is required" }, 400);
  }

  // 1. LINE へ送信するメッセージオブジェクトを構築
  //    テキストと画像はそれぞれ別メッセージ（最大5件まで一括送信可能）
  type LineMessage =
    | { type: "text"; text: string }
    | { type: "image"; originalContentUrl: string; previewImageUrl: string };

  const lineMessages: LineMessage[] = [];
  if (message) {
    lineMessages.push({ type: "text", text: message });
  }
  if (imageUrl) {
    lineMessages.push({
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    });
  }

  // 2. LINE Push API でメッセージ送信
  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to: userId, messages: lineMessages }),
  });

  if (!lineRes.ok) {
    const errText = await lineRes.text();
    console.error("LINE Push API error:", errText);
    return json({ error: "Failed to send LINE message", detail: errText }, 502);
  }

  const messageId = `push-${Date.now()}-${userId}`;

  // 3. outbound メッセージを DB に記録（テキストがあればその内容、なければ画像URLを記録）
  const { error: insertError } = await supabase.from("messages").insert({
    user_id: userId,
    message_id: messageId,
    text: message ?? imageUrl ?? "",
    direction: "outbound",
    received_at: new Date().toISOString(),
    replied: true,
  });

  if (insertError) {
    console.error("DB insert error (outbound):", insertError);
    return json({ error: "DB insert failed" }, 500);
  }

  // 4. このユーザーの未返信 inbound を一括で replied=true にする
  const { error: rpcError } = await supabase.rpc("mark_user_replied", {
    target_user_id: userId,
  });

  if (rpcError) {
    console.error("DB mark_user_replied error:", rpcError);
    return json({ error: "Failed to update replied status" }, 500);
  }

  return json({ success: true, userId, message, imageUrl });
});

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
