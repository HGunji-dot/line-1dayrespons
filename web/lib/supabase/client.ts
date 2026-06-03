// Supabase SSR ブラウザクライアント（Client Component 用＝ログインフォーム）。
// ログイン(signInWithPassword)・ログアウトにのみ使う。
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  );
}
