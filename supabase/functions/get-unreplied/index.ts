/**
 * get-unreplied Edge Function
 *
 * 管理画面向け: 未返信ユーザー一覧を返すエンドポイント。
 * send-reply と同じ ADMIN_SECRET Bearer 認証を使用する。
 *
 * リクエスト例:
 *   POST /functions/v1/get-unreplied
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   { "unrepliedHours": 24, "reNotifyHours": 24 }   // 省略可（デフォルト 24）
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;

Deno.serve(async (req: Request) => {
  // CORS プリフライト
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  // 管理者認証
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { unrepliedHours?: number; reNotifyHours?: number } = {};
  try {
    body = await req.json();
  } catch {
    // ボディなしでも動作する
  }

  const unrepliedHours = body.unrepliedHours ?? 24;
  const reNotifyHours = body.reNotifyHours ?? 24;

  const thresholdTime = new Date(
    Date.now() - unrepliedHours * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase.rpc("get_unreplied_users", {
    threshold_time: thresholdTime,
    re_notify_hours: reNotifyHours,
  });

  if (error) {
    console.error("get_unreplied_users RPC error:", error);
    return json({ error: "DB query failed", detail: error.message }, 500);
  }

  return json({ users: data ?? [] });
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
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}
