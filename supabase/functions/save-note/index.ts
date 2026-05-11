/**
 * save-note Edge Function
 *
 * 管理者がお客様ごとにつける社内メモを保存するエンドポイント。
 * メモは返信済みになっても削除されず、次回以降も参照できる。
 *
 * リクエスト例:
 *   POST /functions/v1/save-note
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   { "userId": "Uxxxxxxxxx", "note": "折り返し済み。明日再確認予定。" }
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

  let body: { userId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const { userId, note } = body;
  if (!userId) {
    return json({ error: "userId is required" }, 400);
  }

  const { error } = await supabase.rpc("upsert_admin_note", {
    target_user_id: userId,
    new_note: note ?? "",
  });

  if (error) {
    console.error("upsert_admin_note RPC error:", error);
    return json({ error: "DB save failed", detail: error.message }, 500);
  }

  return json({ success: true });
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
