// ─────────────────────────────────────────────
// サーバー専用 Supabase クライアント（service_role）
//
// 方針（決定: Route Handler は service_role でサーバー側接続）:
//   RLS をかけている前提なので anon では templates / reply_feedback を読めない。
//   service_role は RLS をバイパスする。このキーは絶対にクライアントへ出さない。
//   （NEXT_PUBLIC_ を付けない env 名にしてある）
//
// Route Handler / Server Component からのみ import すること。
// ─────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  _admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
