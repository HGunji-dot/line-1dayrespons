import { NextResponse } from "next/server";
import { hasRealBackend, upsertHandling, getActiveHandling } from "@/lib/backend";
import { getCurrentStaff } from "@/lib/auth";
import { hasAuth } from "@/lib/supabase/server";

// 「対応中」状態（conversation_state）のハートビート＆取得。
// POST {userId} … 自分が対応中だと記録（数分でTTL失効）。
// GET            … 直近に対応中の会話一覧（他スタッフの「対応中: ○○」表示用）。
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasRealBackend()) return NextResponse.json({ mock: true });

  const staff = await getCurrentStaff();
  if (hasAuth() && !staff) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = body.userId?.trim();
  if (!userId) {
    return NextResponse.json({ error: "userId は必須です" }, { status: 400 });
  }

  await upsertHandling(userId, staff?.id ?? null, staff?.displayName ?? "");
  return NextResponse.json({ ok: true });
}

export async function GET() {
  if (!hasRealBackend()) return NextResponse.json({ handling: [] });
  const handling = await getActiveHandling();
  return NextResponse.json({ handling });
}
