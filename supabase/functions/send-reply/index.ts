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
 *   { "userId": "Uxxxxxxxxx", "message": "お問い合わせありがとうございます。", "operator": "郡司" }
 *
 * operator は任意。送信したスタッフ名を outbound に記録する（誰が返信したかの記録用）。
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

  let body: { userId?: string; message?: string; operator?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId, message, operator } = body;
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
  //    LINE 送信は既に成功しているため、ここで 500 を返すとオペレーターが再送し
  //    顧客へ二重送信になる。operator 列が未マイグレーション（phaseB.sql 未適用）の
  //    環境でも記録を残せるよう、operator 付き insert が失敗したら operator 無しで再試行する。
  const baseRow = {
    user_id: userId,
    message_id: messageId,
    text: message,
    direction: "outbound",
    received_at: new Date().toISOString(),
    replied: true,
  };

  let { error: insertError } = await supabase
    .from("messages")
    .insert({ ...baseRow, operator: operator ?? null });

  if (insertError && operator != null) {
    console.warn(
      "outbound insert with operator failed; retrying without operator (apply phaseB.sql to record operator):",
      insertError
    );
    ({ error: insertError } = await supabase.from("messages").insert(baseRow));
  }

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

  // 4. 返信が完了したので対応中クレームを解放する（次の未返信で再度確保される）。
  //    conversation_state がまだ無い場合は何もしない（エラーにしない）。
  const { error: releaseError } = await supabase.rpc("release_conversation", {
    target_user_id: userId,
  });
  if (releaseError) {
    // 解放失敗は致命的ではない（手動でも外せる）のでログのみ。
    console.error("DB release_conversation error:", releaseError);
  }

  return json({ success: true, userId, message });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
