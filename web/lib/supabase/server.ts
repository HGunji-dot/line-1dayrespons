// Supabase SSR サーバークライアント（Server Component / Route Handler / Server Action 用）。
// Cookie ベースのセッションを読み書きする。認証(ログイン状態の確認)専用。
// データ読み取りは従来どおり lib/backend.ts の素のfetch＋service_role を使う。
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** 認証用の Supabase クライアント。env が無いときは null（モード判定は hasAuth() を使う）。 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Component から呼ばれた場合は set 不可（middleware 側で更新するので無視してよい）。
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          /* Server Component からの set は無視 */
        }
      },
    },
  });
}

/** 認証(ログインゲート)が有効な構成かどうか。env が無ければモックモードでゲート無効。 */
export function hasAuth(): boolean {
  return Boolean(URL && ANON);
}
