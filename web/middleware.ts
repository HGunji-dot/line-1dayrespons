import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// 全ページ・全 API を共有パスワード認証で保護する。
// /login と /api/login（とログアウト）だけは未認証で通す。
const PUBLIC_PATHS = ["/login", "/api/login", "/api/logout"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const secret = process.env.APP_SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = secret ? await verifySessionToken(token, secret) : false;
  if (ok) return NextResponse.next();

  // API は 401 を返す。ページはログイン画面へ。
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // 静的アセットと Next 内部パスは除外。
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
