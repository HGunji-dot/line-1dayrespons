import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 学習ログの更新（承認/却下、正解返信、アーカイブ）。
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: { status?: string; correctedReply?: string; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (!["pending", "approved", "rejected"].includes(body.status)) {
      return NextResponse.json({ error: "不正な status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.correctedReply !== undefined) patch.corrected_reply = body.correctedReply;
  if (body.archived !== undefined) patch.archived = body.archived;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { error } = await supabase.from("reply_feedback").update(patch).eq("id", params.id);
  if (error) {
    console.error("feedback update error:", error);
    return NextResponse.json({ error: "DB update failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
