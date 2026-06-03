import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { aiEnabled, generateAnalysis, generateDraft } from "@/lib/ai/claude";
import type { AnalysisTag, ConversationAnalysis, SimilarReply, Urgency } from "@/lib/types";

export const dynamic = "force-dynamic";

// 会話を開いた時に呼ばれ、AI 分析＋返信ドラフトをオンデマンド生成する。
// 結果は conversation_analysis にキャッシュし、新しい問い合わせが来るまで再利用する。
// ?force=1 で強制再生成（「再生成」ボタン）。

interface MsgRow {
  id: number;
  text: string | null;
  direction: "inbound" | "outbound";
  received_at: string;
}

function heuristicUrgency(rows: MsgRow[], now: number): Urgency {
  const unreplied = rows.filter((r) => r.direction === "inbound");
  const oldest = unreplied.length ? unreplied[0].received_at : null;
  if (!oldest) return "low";
  const hours = (now - new Date(oldest).getTime()) / 3_600_000;
  return hours >= 24 ? "high" : hours >= 6 ? "medium" : "low";
}

// タグ一致で過去の正解返信（承認 or 却下＋修正）を取り出す（Voyage 不要の簡易 RAG）。
async function fetchSimilar(
  supabase: SupabaseClient,
  tagLabels: string[]
): Promise<SimilarReply[]> {
  if (tagLabels.length === 0) return [];
  const { data } = await supabase
    .from("reply_feedback")
    .select("tags,inbound_text,sent,corrected_reply,status")
    .in("status", ["approved", "rejected"])
    .order("created_at", { ascending: false })
    .limit(200);

  const scored = (data ?? [])
    .map((r) => {
      const reply = r.status === "approved" ? r.sent : r.corrected_reply;
      if (!reply) return null;
      const tags: string[] = r.tags ?? [];
      const overlap = tags.filter((t) => tagLabels.includes(t)).length;
      if (overlap === 0) return null;
      return { overlap, item: { tags, inbound: r.inbound_text ?? "", reply } as SimilarReply };
    })
    .filter((x): x is { overlap: number; item: SimilarReply } => x !== null)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 3);

  return scored.map((s) => s.item);
}

function cacheToAnalysis(row: Record<string, unknown>): ConversationAnalysis {
  return {
    summary: (row.summary as string) ?? "",
    urgency: (row.urgency as Urgency) ?? "low",
    tags: (row.tags as AnalysisTag[]) ?? [],
    suggestedReply: (row.suggested_reply as string) ?? "",
    similarReplies: (row.similar_replies as SimilarReply[]) ?? [],
    aiConnected: true,
    model: (row.model as string) ?? "",
    generatedAt: (row.generated_at as string) ?? new Date().toISOString(),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const force = url.searchParams.get("force") === "1";
  if (!userId) return NextResponse.json({ error: "userId は必須です" }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: msgs, error: mErr } = await supabase
    .from("messages")
    .select("id,text,direction,received_at")
    .eq("user_id", userId)
    .order("received_at", { ascending: true })
    .limit(100);
  if (mErr) {
    console.error("analyze fetch error:", mErr);
    return NextResponse.json({ error: "DB fetch failed" }, { status: 500 });
  }

  const rows = (msgs ?? []) as MsgRow[];
  const lastInbound = [...rows].reverse().find((r) => r.direction === "inbound");
  const lastInboundId = lastInbound?.id ?? null;

  // キャッシュ確認（最新 inbound が一致していれば再生成しない）。
  const { data: cacheRow } = await supabase
    .from("conversation_analysis")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!force && cacheRow && cacheRow.last_inbound_message_id === lastInboundId) {
    return NextResponse.json({ cached: true, analysis: cacheToAnalysis(cacheRow) });
  }

  // キー未設定ならプレースホルダにフォールバック（既存挙動を維持）。
  if (!aiEnabled()) {
    const fallback: ConversationAnalysis = {
      summary: lastInbound?.text ?? "",
      urgency: heuristicUrgency(rows, Date.now()),
      tags: [],
      suggestedReply: "",
      similarReplies: [],
      aiConnected: false,
      model: "",
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json({ cached: false, analysis: fallback });
  }

  const conversationText = rows
    .map((r) => `${r.direction === "inbound" ? "お客様" : "スタッフ"}: ${r.text ?? ""}`)
    .join("\n");

  // 1) 分析（要約・緊急度・タグ）
  let summary = lastInbound?.text ?? "";
  let urgency = heuristicUrgency(rows, Date.now());
  let tags: AnalysisTag[] = [];
  try {
    const a = await generateAnalysis(conversationText);
    if (a) {
      summary = a.summary || summary;
      urgency = a.urgency;
      tags = a.tags;
    }
  } catch (e) {
    console.error("analysis generation error:", e);
  }

  // 2) RAG（タグ一致の過去正解）
  const similarReplies = await fetchSimilar(supabase, tags.map((t) => t.label));

  // 3) 返信ドラフト（過去正解を文脈に）
  let suggestedReply = "";
  try {
    suggestedReply =
      (await generateDraft(
        conversationText,
        similarReplies.map((s) => ({ inbound: s.inbound, reply: s.reply }))
      )) ?? "";
  } catch (e) {
    console.error("draft generation error:", e);
  }

  const result: ConversationAnalysis = {
    summary,
    urgency,
    tags,
    suggestedReply,
    similarReplies,
    aiConnected: true,
    model: "haiku-4-5 + sonnet-4-6",
    generatedAt: new Date().toISOString(),
  };

  // キャッシュ保存（best-effort。失敗しても結果は返す）。
  const { error: upErr } = await supabase.from("conversation_analysis").upsert({
    user_id: userId,
    summary: result.summary,
    urgency: result.urgency,
    tags: result.tags,
    suggested_reply: result.suggestedReply,
    similar_replies: result.similarReplies,
    last_inbound_message_id: lastInboundId,
    model: result.model,
    generated_at: result.generatedAt,
  });
  if (upErr) console.error("analysis cache upsert error:", upErr);

  return NextResponse.json({ cached: false, analysis: result });
}
