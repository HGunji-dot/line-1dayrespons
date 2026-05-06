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
 *   { "userId": "Uxxxxxxxxx", "message": "お問い合わせありがとうございます。" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  // 管理者認証（シンプルな Bearer トークン方式）
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { userId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId, message } = body;
  if (!userId || !message) {
    return json({ error: "userId and message are required" }, 400);
  }

  // 1. LINE Push API でメッセージ送信
  const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: message }],
    }),
  });

  if (!lineRes.ok) {
    const errText = await lineRes.text();
    console.error("LINE Push API error:", errText);
    return json({ error: "Failed to send LINE message", detail: errText }, 502);
  }

  const messageId = `push-${Date.now()}-${userId}`;

  // 2. outbound メッセージを DB に記録
  const { error: insertError } = await supabase.from("messages").insert({
    user_id: userId,
    message_id: messageId,
    text: message,
    direction: "outbound",
    received_at: new Date().toISOString(),
    replied: true,
  });

  if (insertError) {
    console.error("DB insert error (outbound):", insertError);
    return json({ error: "DB insert failed" }, 500);
  }

  // 3. このユーザーの未返信 inbound を一括で replied=true にする
  const { error: rpcError } = await supabase.rpc("mark_user_replied", {
    target_user_id: userId,
  });

  if (rpcError) {
    console.error("DB mark_user_replied error:", rpcError);
    return json({ error: "Failed to update replied status" }, 500);
  }

  return json({ success: true, userId, message });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
