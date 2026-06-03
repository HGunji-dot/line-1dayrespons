import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { buildConversations, type MessageRow, type StateRow } from "@/lib/conversation";

export const dynamic = "force-dynamic";

// 会話一覧＋履歴を返す。messages を user_id でまとめ、conversation_state を結合する。
export async function GET() {
  const supabase = supabaseAdmin();

  const [{ data: messages, error: mErr }, { data: states, error: sErr }] = await Promise.all([
    supabase
      .from("messages")
      .select("id,user_id,display_name,message_id,text,direction,received_at,replied,replied_at,operator")
      .order("received_at", { ascending: true })
      .limit(2000),
    supabase.from("conversation_state").select("user_id,handling_by,archived"),
  ]);

  if (mErr || sErr) {
    console.error("conversations fetch error:", mErr ?? sErr);
    return NextResponse.json({ error: "DB fetch failed" }, { status: 500 });
  }

  const conversations = buildConversations(
    (messages ?? []) as MessageRow[],
    (states ?? []) as StateRow[]
  );
  return NextResponse.json({ conversations });
}
