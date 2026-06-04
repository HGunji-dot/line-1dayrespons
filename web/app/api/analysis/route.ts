// ─────────────────────────────────────────────
// POST /api/analysis — 人が確定したタグを保存（フェーズ③）
//   入力 { userId, tags: [{label, confidence?}] }
//   shadow_analysis に upsert（confirmed=true）。生成・学習で使う真値になる。
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let userId = "";
  let tags: Array<{ label: string; confidence?: number }> = [];
  try {
    const body = await req.json();
    userId = typeof body?.userId === "string" ? body.userId : "";
    if (Array.isArray(body?.tags)) {
      tags = body.tags
        .filter((t: unknown) => t && typeof (t as { label?: unknown }).label === "string")
        .map((t: { label: string; confidence?: number }) => ({
          label: t.label,
          confidence: typeof t.confidence === "number" ? t.confidence : 1,
        }));
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("shadow_analysis").upsert(
    {
      user_id: userId,
      tags,
      confirmed: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) {
    return NextResponse.json({ error: `保存失敗: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, tags });
}
