/**
 * get-unreplied Edge Function
 *
 * 管理画面向け: 未返信ユーザー一覧と各ユーザーのメモを返すエンドポイント。
 * send-reply と同じ ADMIN_SECRET Bearer 認証を使用する。
 *
 * 管理画面では閾値を 0 時間・re_notify_hours を 0 にして
 * 受信直後から全件表示する（24時間制限を撤廃）。
 *
 * リクエスト例:
 *   POST /functions/v1/get-unreplied
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: application/json
 *   {}   // ボディは省略可
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

  // 管理画面では閾値を「今」に設定 → 受信直後の未返信もすべて対象
  // re_notify_hours=0 により通知済み抑制フィルターをスキップ
  const thresholdTime = new Date().toISOString();

  const { data: users, error: rpcError } = await supabase.rpc(
    "get_unreplied_users",
    {
      threshold_time: thresholdTime,
      re_notify_hours: 0,
    }
  );

  if (rpcError) {
    console.error("get_unreplied_users RPC error:", rpcError);
    return json({ error: "DB query failed", detail: rpcError.message }, 500);
  }

  if (!users || users.length === 0) {
    return json({ users: [] });
  }

  // メモを一括取得して users にマージ
  const userIds = users.map((u: { user_id: string }) => u.user_id);
  const { data: notes } = await supabase
    .from("admin_notes")
    .select("user_id, note")
    .in("user_id", userIds);

  const noteMap: Record<string, string> = {};
  for (const row of notes ?? []) {
    noteMap[row.user_id] = row.note;
  }

  const enriched = users.map((u: Record<string, unknown>) => ({
    ...u,
    note: noteMap[u.user_id as string] ?? "",
  }));

  return json({ users: enriched });
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
