// サーバ側でのみ参照する環境変数のアクセサ。
// ブラウザにバンドルされないよう、これらは Server Component / API Route からだけ import する。

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`環境変数 ${name} が未設定です（web/.env.local を確認してください）。`);
  }
  return v;
}

/** Supabase プロジェクト URL（サーバ用。NEXT_PUBLIC 版が無ければこちらを使う） */
export const SUPABASE_URL = () => process.env.SUPABASE_URL ?? required("NEXT_PUBLIC_SUPABASE_URL");

/** service_role キー（サーバ専用・絶対に公開しない） */
export const SUPABASE_SERVICE_ROLE_KEY = () => required("SUPABASE_SERVICE_ROLE_KEY");

/** send-reply Edge Function の認証シークレット */
export const ADMIN_SECRET = () => required("ADMIN_SECRET");

/** 画面アクセス用の共有パスワード */
export const APP_PASSWORD = () => required("APP_PASSWORD");

/** ログインセッションのクッキー署名鍵 */
export const APP_SESSION_SECRET = () => required("APP_SESSION_SECRET");
