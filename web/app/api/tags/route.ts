// GET /api/tags — 固定タグマスタの一覧（人がタグを増減するUIの選択肢）。
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("tags").select("label").order("sort_order");
  if (error) {
    return NextResponse.json({ error: `tags 取得失敗: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ tags: (data ?? []).map((r) => r.label as string) });
}
