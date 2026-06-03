import type { Conversation, Message, Urgency } from "@/lib/types";

// ─────────────────────────────────────────────
// Supabase の messages 行 + conversation_state 行から、
// 画面が使う Conversation[]（user_id 単位の会話ビュー）を組み立てる。
// AI 由来のフィールド（summary / urgency / tags / suggestedReply）は
// フェーズC で AI 生成に差し替える。ここでは本文を一切作らない簡易プレースホルダ。
// ─────────────────────────────────────────────

export interface MessageRow {
  id: number;
  user_id: string;
  display_name: string | null;
  message_id: string;
  text: string | null;
  direction: "inbound" | "outbound";
  received_at: string;
  replied: boolean;
  replied_at: string | null;
  operator: string | null;
}

export interface StateRow {
  user_id: string;
  handling_by: string | null;
  archived: boolean;
}

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-indigo-500",
];

/** user_id から決定的にアバター色を選ぶ（再読込でも色が変わらない）。 */
function avatarColorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name ?? r.user_id,
    messageId: r.message_id,
    text: r.text ?? "",
    direction: r.direction,
    receivedAt: r.received_at,
    replied: r.replied,
    repliedAt: r.replied_at,
    operator: r.operator ?? undefined,
  };
}

/** 経過時間ラベルと緊急度（フェーズC で AI 判定に置換予定の簡易ヒューリスティック）。 */
function elapsed(oldestUnrepliedIso: string | null, now: number): { label: string; urgency: Urgency } {
  if (!oldestUnrepliedIso) return { label: "返信済み", urgency: "low" };
  const hours = Math.floor((now - new Date(oldestUnrepliedIso).getTime()) / 3_600_000);
  const label = hours >= 24 ? `約${Math.floor(hours / 24)}日${hours % 24}時間未返信` : `約${hours}時間未返信`;
  const urgency: Urgency = hours >= 24 ? "high" : hours >= 6 ? "medium" : "low";
  return { label, urgency };
}

export function buildConversations(
  messageRows: MessageRow[],
  stateRows: StateRow[],
  now: number = Date.now()
): Conversation[] {
  const stateByUser = new Map(stateRows.map((s) => [s.user_id, s]));
  const byUser = new Map<string, MessageRow[]>();
  for (const r of messageRows) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push(r);
    byUser.set(r.user_id, arr);
  }

  const conversations: Conversation[] = [];
  for (const [userId, rows] of byUser) {
    rows.sort((a, b) => a.received_at.localeCompare(b.received_at));
    const messages = rows.map(toMessage);
    const displayName = [...rows].reverse().find((r) => r.display_name)?.display_name ?? userId;

    const unreplied = rows.filter((r) => r.direction === "inbound" && !r.replied);
    const oldestUnreplied = unreplied.length
      ? unreplied.reduce((min, r) => (r.received_at < min ? r.received_at : min), unreplied[0].received_at)
      : null;
    const { label, urgency } = elapsed(oldestUnreplied, now);
    const state = stateByUser.get(userId);

    // フェーズC で AI に差し替えるフィールドはプレースホルダ。
    const latestInbound = [...rows].reverse().find((r) => r.direction === "inbound");

    conversations.push({
      userId,
      displayName,
      avatarInitial: displayName.slice(0, 1),
      avatarColor: avatarColorFor(userId),
      messages,
      unrepliedCount: unreplied.length,
      lastMessageAt: rows[rows.length - 1]?.received_at ?? new Date(now).toISOString(),
      elapsedLabel: label,
      handlingBy: state?.handling_by ?? null,
      archived: state?.archived ?? false,
      // --- フェーズC（AI）で生成。今は未接続のプレースホルダ ---
      summary: latestInbound?.text ?? "",
      urgency,
      tags: [],
      suggestedReply: "",
    });
  }

  // 未返信が古い順 → そのあと最新メッセージ順で並べる。
  conversations.sort((a, b) => {
    if (a.unrepliedCount > 0 && b.unrepliedCount === 0) return -1;
    if (a.unrepliedCount === 0 && b.unrepliedCount > 0) return 1;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
  return conversations;
}
