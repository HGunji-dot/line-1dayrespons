// ─────────────────────────────────────────────
// 共有パスワードによるアクセス保護（並行世界の web 公開用）
//
// 全ルートを保護し、未ログインは /login へ。除外は /login と /api/login と静的アセット。
// ログイン成立の判定は cookie "pw_session" === env AUTH_SECRET（ランダム秘密）。
// パスワード本体（APP_PASSWORD）の照合は /api/login（サーバー側）で行う。
//
// ※ これはアクセスゲートであり、実LINEには無関係。送信はモック/シャドウのまま。
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/login"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 公開パスと Next 内部アセットは素通し
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET;
  const session = req.cookies.get("pw_session")?.value;

  // AUTH_SECRET 未設定なら保護を有効化できないので、誤って全公開しないよう拒否する。
  if (!secret) {
    return new NextResponse("AUTH_SECRET is not configured", { status: 503 });
  }

  if (session === secret) {
    return NextResponse.next();
  }

  // API は 401 を返す。画面は /login へリダイレクト。
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // 静的ファイル等を除いた全パスに適用
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
