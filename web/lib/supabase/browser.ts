"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ブラウザ専用の anon クライアント。Realtime(broadcast) 購読だけに使う。
// 顧客本文の取得には使わない（それは Next.js サーバ経由）。
let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // 未設定でも画面は動く（同期だけ無効化）ように null を返す。
  if (!url || !anon) return null;
  if (cached) return cached;
  cached = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
