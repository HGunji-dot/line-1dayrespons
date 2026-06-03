import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ReplyFeedback } from "@/lib/feedback-data";

export const dynamic = "force-dynamic";

interface FeedbackRow {
  id: string;
  user_id: string;
  display_name: string | null;
  tags: string[] | null;
  inbound_text: string | null;
  generated: string | null;
  sent: string | null;
  operator: string | null;
  corrected_reply: string | null;
  status: ReplyFeedback["status"];
  archived: boolean;
  created_at: string;
}

function toFeedback(r: FeedbackRow): ReplyFeedback {
  return {
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name ?? r.user_id,
    tags: r.tags ?? [],
    inboundText: r.inbound_text ?? "",
    generated: r.generated ?? "",
    sent: r.sent ?? "",
    operator: r.operator ?? "",
    correctedReply: r.corrected_reply ?? undefined,
    createdAt: r.created_at,
    status: r.status,
    archived: r.archived,
  };
}

// 学習ログ一覧
export async function GET() {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("reply_feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) {
    console.error("feedback fetch error:", error);
    return NextResponse.json({ error: "DB fetch failed" }, { status: 500 });
  }
  return NextResponse.json({ feedback: (data ?? []).map((r) => toFeedback(r as FeedbackRow)) });
}

// 学習ログ追加（返信送信時に記録）
export async function POST(req: Request) {
  let body: Partial<ReplyFeedback>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.userId) {
    return NextResponse.json({ error: "userId は必須です" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  // 主キー。Date.now() は同一ミリ秒で衝突しうるため UUID を使う
  // （複数スタッフ/複数タブが同時に同じユーザーへ返信しても重複しない）。
  const id = body.id ?? `fb-${body.userId}-${crypto.randomUUID()}`;
  const { error } = await supabase.from("reply_feedback").insert({
    id,
    user_id: body.userId,
    display_name: body.displayName ?? null,
    tags: body.tags ?? [],
    inbound_text: body.inboundText ?? null,
    generated: body.generated ?? null,
    sent: body.sent ?? null,
    operator: body.operator ?? null,
    status: body.status ?? "pending",
  });
  if (error) {
    console.error("feedback insert error:", error);
    return NextResponse.json({ error: "DB insert failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });
}
