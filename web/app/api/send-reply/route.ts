import { NextResponse } from "next/server";
import { sendReply, hasRealBackend } from "@/lib/backend";

// ブラウザに ADMIN_SECRET / service_role を出さないためのサーバー側プロキシ。
// ブラウザ → このルート → send-reply Edge Function、という経路で返信を送る。
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { userId?: string; message?: string; staff?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim();
  const message = body.message?.trim();
  const staff = body.staff?.trim();
  if (!userId || !message) {
    return NextResponse.json({ error: "userId と message は必須です" }, { status: 400 });
  }
  if (!staff) {
    return NextResponse.json({ error: "対応者(staff)を選択してください" }, { status: 400 });
  }

  if (!hasRealBackend()) {
    // モックモード（公開デモなど）。実送信はしないことを明示。
    return NextResponse.json({ mock: true, message: "モックモードのため実送信しません" }, { status: 200 });
  }

  const result = await sendReply(userId, message, staff);
  if (!result.ok) {
    return NextResponse.json(
      { error: "送信に失敗しました", detail: result.detail },
      { status: result.status === 503 ? 503 : 502 }
    );
  }
  return NextResponse.json({ success: true });
}
