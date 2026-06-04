// ─────────────────────────────────────────────
// /api/feedback — 採点・学習ループ（フェーズ④）の永続化
//   POST  : 送信（モック）時に1件記録（status=pending）
//   GET   : 学習ログ一覧
//   PATCH : 承認/却下/正解返信/アーカイブの更新
//
// すべて shadow_feedback（並行世界）に対して行う。実LINEには影響しない。
// approved / rejected+正解 は match_examples 経由で次の生成へ還元される。
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT =
  "id,user_id,display_name,tags,inbound_text,generated,sent,corrected_reply,operator,status,edit_rate,archived,created_at,approved_at";

export async function GET() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("shadow_feedback")
    .select(SELECT)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: `feedback 取得失敗: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ feedback: data ?? [] });
}

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = typeof b.userId === "string" ? b.userId : "";
  const sent = typeof b.sent === "string" ? b.sent : "";
  if (!userId || !sent.trim()) {
    return NextResponse.json({ error: "userId と sent は必須です" }, { status: 400 });
  }

  const row = {
    user_id: userId,
    display_name: typeof b.displayName === "string" ? b.displayName : null,
    tags: Array.isArray(b.tags) ? (b.tags as unknown[]).filter((t) => typeof t === "string") : [],
    inbound_text: typeof b.inboundText === "string" ? b.inboundText : null,
    generated: typeof b.generated === "string" ? b.generated : "",
    sent,
    operator: typeof b.operator === "string" ? b.operator : null,
    edit_rate: typeof b.editRate === "number" ? b.editRate : null,
    status: "pending" as const,
  };

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("shadow_feedback").insert(row).select(SELECT).single();
  if (error) {
    return NextResponse.json({ error: `記録失敗: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ feedback: data });
}

export async function PATCH(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = b.id;
  if (typeof id !== "number" && typeof id !== "string") {
    return NextResponse.json({ error: "id は必須です" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof b.status === "string" && ["pending", "approved", "rejected"].includes(b.status)) {
    patch.status = b.status;
    patch.approved_at = b.status === "approved" ? new Date().toISOString() : null;
  }
  if (typeof b.correctedReply === "string") patch.corrected_reply = b.correctedReply;
  if (typeof b.archived === "boolean") patch.archived = b.archived;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("shadow_feedback")
    .update(patch)
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) {
    return NextResponse.json({ error: `更新失敗: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ feedback: data });
}
