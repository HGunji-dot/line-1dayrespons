// ─────────────────────────────────────────────
// GET /api/conversations — シャドウ会話一覧（並行世界の表示元）
//
// shadow_messages（本番messagesの1回スナップショット）を service_role で読み、
// user_id でまとめて Conversation[] を返す。本番テーブル・実LINEには触れない。
// AI欄（タグ/要約/ドラフト）はこの段では空（フェーズ③/④で埋める）。
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  buildConversations,
  type ShadowMessageRow,
  type ShadowAnalysisRow,
} from "@/lib/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 1000; // PostgREST 既定上限。全件取り切るためページングする。

export async function GET() {
  const supabase = getSupabaseAdmin();

  const rows: ShadowMessageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("shadow_messages")
      .select("id,user_id,display_name,message_id,text,direction,received_at,replied,replied_at")
      .order("received_at", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      return NextResponse.json(
        { error: `shadow_messages 読み取り失敗: ${error.message}` },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as ShadowMessageRow[]));
    if (data.length < PAGE) break;
  }

  // shadow_analysis（確定/推定タグ）を取得してマップ化
  const analysisByUser = new Map<string, ShadowAnalysisRow>();
  const an = await supabase
    .from("shadow_analysis")
    .select("user_id,estimated_tags,tags,summary,confirmed");
  if (!an.error && an.data) {
    for (const row of an.data as ShadowAnalysisRow[]) analysisByUser.set(row.user_id, row);
  }

  const conversations = buildConversations(rows, Date.now(), analysisByUser);
  return NextResponse.json({ conversations, total: conversations.length });
}
