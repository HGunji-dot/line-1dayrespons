import { NextResponse } from "next/server";
import { APP_PASSWORD, APP_SESSION_SECRET } from "@/lib/env";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken } from "@/lib/auth";

// 共有パスワードを受け取り、一致すれば署名付きセッションクッキーを発行する。
export async function POST(req: Request) {
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.password || body.password !== APP_PASSWORD()) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  const token = await createSessionToken(APP_SESSION_SECRET());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
