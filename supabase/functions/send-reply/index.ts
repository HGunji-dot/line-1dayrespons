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
 *   {
 *     "userId": "Uxxxxxxxxx",
 *     "message": "テキスト",          // 省略可
 *     "imageUrls": ["https://..."]    // 省略可・複数枚対応
 *   }
 *
 * LINE の制約: テキスト + 画像の合計が 5件以内
 * message あり → 画像は最大 4枚 / message なし → 画像は最大 5枚
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;
const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;
const LINE_MAX_MESSAGES = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { userId?: string; message?: string; imageUrls?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId, message, imageUrls = [] } = body;
  if (!userId) {
    return json({ error: "userId is required" }, 400);
  }
  if (!message && imageUrls.length === 0) {
    return json({ error: "message or imageUrls is required" }, 400);
  }

  // LINE メッセージ数バリデーション（テキスト + 画像 ≤ 5件）
  const textCount  = message ? 1 : 0;
  const imageCount = imageUrls.length;
  const total      = textCount + imageCount;
  if (total > LINE_MAX_MESSAGES) {
    return json(
      {
        error: `LINE の1回の送信上限は ${LINE_MAX_MESSAGES} 件です。` +
               `現在 テキスト ${textCount} 件 + 画像 ${imageCount} 枚 = ${total} 件になっています。` +
               `画像を ${total - LINE_MAX_MESSAGES} 枚減らしてください。`,
      },
      422
    );
  }

  // LINE メッセージオブジェクトを構築
  type LineMessage =
    | { type: "text"; text: string }
    | { type: "image"; originalContentUrl: string; previewImageUrl: string };

  const lineMessages: LineMessage[] = [];
  if (message) {
    lineMessages.push({ type: "text", text: message });
  }
  for (const url of imageUrls) {
    lineMessages.push({
      type: "image",
      originalContentUrl: url,
      previewImageUrl: url,
    });
  }

  // LINE Push API で送信
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

  // outbound を DB に記録
  const { error: insertError } = await supabase.from("messages").insert({
    user_id: userId,
    message_id: messageId,
    text: message ?? imageUrls[0] ?? "",
    direction: "outbound",
    received_at: new Date().toISOString(),
    replied: true,
  });

  if (insertError) {
    console.error("DB insert error (outbound):", insertError);
    return json({ error: "DB insert failed" }, 500);
  }

  // 未返信 inbound を一括で replied=true にする
  const { error: rpcError } = await supabase.rpc("mark_user_replied", {
    target_user_id: userId,
  });

  if (rpcError) {
    console.error("DB mark_user_replied error:", rpcError);
    return json({ error: "Failed to update replied status" }, 500);
  }

  return json({ success: true, userId, message, imageUrls });
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
