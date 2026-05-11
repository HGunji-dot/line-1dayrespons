/**
 * mark-replied Edge Function
 *
 * LINEアプリなど send-reply API 以外で返信した場合に、
 * LINE メッセージを送らずに DB の replied フラグだけ更新するエンドポイント。
 *
 * リクエスト例:
 *   POST /functions/v1/mark-replied
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   { "userId": "Uxxxxxxxxx" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;

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

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId } = body;
  if (!userId) {
    return json({ error: "userId is required" }, 400);
  }

  const { error } = await supabase.rpc("mark_user_replied", {
    target_user_id: userId,
  });

  if (error) {
    console.error("mark_user_replied RPC error:", error);
    return json({ error: "DB update failed", detail: error.message }, 500);
  }

  return json({ success: true, userId });
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
