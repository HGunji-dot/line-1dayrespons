import { NextResponse } from "next/server";
import {
  sendReply,
  hasRealBackend,
  getUnrepliedInbound,
  recordReplyEvent,
} from "@/lib/backend";
import { getCurrentStaff } from "@/lib/auth";
import { hasAuth } from "@/lib/supabase/server";

// ブラウザに ADMIN_SECRET / service_role を出さないためのサーバー側プロキシ。
// ブラウザ → このルート → send-reply Edge Function、という経路で返信を送る。
// 担当者(operator)はクライアント指定を信用せず、ログインセッションから確定する。
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { userId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim();
  const message = body.message?.trim();
  if (!userId || !message) {
    return NextResponse.json({ error: "userId と message は必須です" }, { status: 400 });
  }

  if (!hasRealBackend()) {
    // モックモード（公開デモなど）。実送信はしないことを明示。
    return NextResponse.json(
      { mock: true, message: "モックモードのため実送信しません" },
      { status: 200 }
    );
  }

  // 担当者＝ログイン本人。認証が有効なのに未ログインなら送信させない。
  const staff = await getCurrentStaff();
  if (hasAuth() && !staff) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  const operatorName = staff?.displayName ?? "";

  // 送信ガード＋reply_events 文脈: 送信時点の未返信 inbound を先に捕捉する。
  // （send-reply が replied=true にする前に取得する必要がある）
  const inboundContext = await getUnrepliedInbound(userId);
  if (inboundContext.count === 0) {
    // 開いてから誰かが先に返信済みにした → 二重送信を防ぐ。
    return NextResponse.json(
      { error: "この会話はすでに返信済みです。画面を更新してください。" },
      { status: 409 }
    );
  }

  const result = await sendReply(userId, message, operatorName);
  if (!result.ok) {
    return NextResponse.json(
      { error: "送信に失敗しました", detail: result.detail },
      { status: result.status === 503 ? 503 : 502 }
    );
  }

  // 学習用に記録（失敗しても送信は成立しているので 200 を返す）。
  const rec = await recordReplyEvent({
    userId,
    sentText: message,
    staffId: staff?.id ?? null,
    inboundContext,
  });
  if (!rec.ok) {
    console.warn("reply_events 記録に失敗:", rec.detail);
  }

  return NextResponse.json({ success: true, operator: operatorName });
}
