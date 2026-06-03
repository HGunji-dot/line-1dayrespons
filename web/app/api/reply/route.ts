import { NextResponse } from "next/server";
import { SUPABASE_URL, ADMIN_SECRET } from "@/lib/env";

export const dynamic = "force-dynamic";

// 返信送信：send-reply Edge Function を呼び、LINE 送信＋outbound記録＋replied更新＋クレーム解放を行う。
// （service_role を直接使わず Edge Function に集約することで「返信送信」の経路を1本化する）
export async function POST(req: Request) {
  let body: { userId?: string; message?: string; operator?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, message, operator } = body;
  if (!userId || !message?.trim()) {
    return NextResponse.json({ error: "userId と message は必須です" }, { status: 400 });
  }

  const res = await fetch(`${SUPABASE_URL()}/functions/v1/send-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_SECRET()}`,
    },
    body: JSON.stringify({ userId, message, operator }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("send-reply error:", data);
    return NextResponse.json(
      { error: data.error ?? "返信の送信に失敗しました", detail: data.detail },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true });
}
