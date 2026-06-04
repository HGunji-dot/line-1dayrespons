// ─────────────────────────────────────────────
// POST /api/estimate-tags — AIによるタグ推定（フェーズ③）
//
// 入力 { userId }（並行世界のシャドウ会話）
//   その会話の inbound 本文をまとめ、固定タグマスタの中から確信度付きで推定。
//   推定結果を shadow_analysis.estimated_tags に保存（未確定なら tags にも反映）。
// 出力 { tags: [{label, confidence}], model }
//
// ※ shadow_messages / shadow_analysis のみ。本番テーブル・実LINEには触れない。
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getProvider } from "@/lib/llm/provider";
import { ANALYSIS_SYSTEM, buildAnalysisPrompt, parseAnalysis } from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let userId = "";
  try {
    const body = await req.json();
    userId = typeof body?.userId === "string" ? body.userId : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // 1. 固定タグマスタ
  const tagsRes = await supabase.from("tags").select("label").order("sort_order");
  if (tagsRes.error) {
    return NextResponse.json({ error: `tags 取得失敗: ${tagsRes.error.message}` }, { status: 500 });
  }
  const allowedTags = (tagsRes.data ?? []).map((r) => r.label as string);

  // 2. その会話の inbound 本文（新しすぎる順だと文脈崩れるので時系列）
  const msgRes = await supabase
    .from("shadow_messages")
    .select("text,direction,received_at")
    .eq("user_id", userId)
    .eq("direction", "inbound")
    .order("received_at", { ascending: true });
  if (msgRes.error) {
    return NextResponse.json(
      { error: `shadow_messages 取得失敗: ${msgRes.error.message}` },
      { status: 500 }
    );
  }
  const inboundText = (msgRes.data ?? [])
    .map((m) => (m.text as string | null)?.trim())
    .filter(Boolean)
    .join("\n");

  if (!inboundText) {
    return NextResponse.json({ tags: [], summary: "", model: null, note: "inbound本文が無い会話です" });
  }

  // 3. 分析（要約＋タグ）
  let summary: string;
  let tags: Array<{ label: string; confidence: number }>;
  let model: string;
  try {
    const out = await getProvider().generate({
      systemPrompt: ANALYSIS_SYSTEM,
      userPrompt: buildAnalysisPrompt({ inboundText, allowedTags }),
      maxTokens: 512,
    });
    model = out.model;
    const parsed = parseAnalysis(out.text, allowedTags);
    summary = parsed.summary;
    tags = parsed.tags;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `analysis failed: ${msg}` }, { status: 502 });
  }

  // 4. 保存（要約は常に更新。確定タグ tags は未確定の会話のみ推定で初期化）
  const existing = await supabase
    .from("shadow_analysis")
    .select("confirmed")
    .eq("user_id", userId)
    .maybeSingle();
  const confirmed = existing.data?.confirmed === true;

  const upsertRow: Record<string, unknown> = {
    user_id: userId,
    estimated_tags: tags,
    summary,
    model,
    updated_at: new Date().toISOString(),
  };
  if (!confirmed) upsertRow.tags = tags; // 未確定なら人の編集前の初期値として反映

  const up = await supabase.from("shadow_analysis").upsert(upsertRow, { onConflict: "user_id" });
  if (up.error) {
    return NextResponse.json({ error: `保存失敗: ${up.error.message}` }, { status: 500 });
  }

  return NextResponse.json({ tags, summary, model });
}
