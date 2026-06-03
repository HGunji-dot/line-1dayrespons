import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 会話のアーカイブ/解除（処理済みを一覧から隠す）。
export async function POST(req: Request) {
  let body: { userId?: string; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, archived } = body;
  if (!userId || typeof archived !== "boolean") {
    return NextResponse.json({ error: "userId と archived(boolean) は必須です" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase.rpc("set_archived", {
    target_user_id: userId,
    is_archived: archived,
  });
  if (error) {
    console.error("set_archived error:", error);
    return NextResponse.json({ error: "アーカイブ更新に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
