import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 対応開始（クレーム）/ 解放。claim_conversation は原子的に「未対応なら確保」を行い、
// 確定後の対応者を返す（他人が既に対応中なら自分は取れない）。
export async function POST(req: Request) {
  let body: { userId?: string; operator?: string; action?: "claim" | "release" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, operator, action = "claim" } = body;
  if (!userId) {
    return NextResponse.json({ error: "userId は必須です" }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  if (action === "release") {
    const { error } = await supabase.rpc("release_conversation", { target_user_id: userId });
    if (error) {
      console.error("release_conversation error:", error);
      return NextResponse.json({ error: "解放に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, handlingBy: null });
  }

  if (!operator) {
    return NextResponse.json({ error: "operator は必須です" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("claim_conversation", {
    target_user_id: userId,
    op: operator,
  });
  if (error) {
    console.error("claim_conversation error:", error);
    return NextResponse.json({ error: "対応開始に失敗しました" }, { status: 500 });
  }

  // RPC は handling_by を1行返す。確定後の対応者を返却（自分でなければ二重対応ブロック）。
  const handlingBy = Array.isArray(data) ? data[0]?.handling_by ?? null : null;
  return NextResponse.json({ ok: true, handlingBy, claimed: handlingBy === operator });
}
