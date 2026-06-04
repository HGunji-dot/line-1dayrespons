// POST /api/login — 共有パスワードを照合し、セッションcookieを発行する。
// 照合成功時のみ cookie "pw_session"=AUTH_SECRET（httpOnly）をセット。
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!expected || !secret) {
    return NextResponse.json(
      { error: "APP_PASSWORD / AUTH_SECRET が未設定です" },
      { status: 503 }
    );
  }

  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (password !== expected) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("pw_session", secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30日
  });
  return res;
}
