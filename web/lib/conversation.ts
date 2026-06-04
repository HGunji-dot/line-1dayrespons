// ─────────────────────────────────────────────
// shadow_messages の行（DBスキーマそのまま）→ 画面用 Conversation への組み立て。
// AI欄（summary/urgency/tags/suggestedReply）はこの段では空。
// フェーズ③（タグ推定）・④（生成）でシャドウ側の生成物から埋める。
// ─────────────────────────────────────────────

import type { AnalysisTag, Conversation, Message, Urgency } from "@/lib/types";

export interface ShadowMessageRow {
  id: number;
  user_id: string;
  display_name: string | null;
  message_id: string | null;
  text: string | null;
  direction: "inbound" | "outbound";
  received_at: string;
  replied: boolean;
  replied_at: string | null;
}

export interface ShadowAnalysisRow {
  user_id: string;
  estimated_tags: AnalysisTag[] | null;
  tags: AnalysisTag[] | null;
  summary: string | null;
  confirmed: boolean;
}

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-pink-500",
];

/** user_id から決定的に色を選ぶ（再読込で色が変わらないように） */
function avatarColorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** 最新メッセージからの経過を日本語ラベルにする（nowMs は呼び出し側から渡す） */
export function elapsedLabel(lastMs: number, nowMs: number, unreplied: number): string {
  if (unreplied === 0) return "返信済み";
  const diffMin = Math.max(0, Math.floor((nowMs - lastMs) / 60000));
  if (diffMin < 60) return `約${diffMin}分未返信`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 48) return `約${diffH}時間未返信`;
  return `約${Math.floor(diffH / 24)}日未返信`;
}

/** shadow_messages 行を user_id でまとめて Conversation[] にする。最新会話が先頭。 */
export function buildConversations(
  rows: ShadowMessageRow[],
  nowMs: number,
  analysisByUser?: Map<string, ShadowAnalysisRow>
): Conversation[] {
  const byUser = new Map<string, ShadowMessageRow[]>();
  for (const r of rows) {
    const arr = byUser.get(r.user_id);
    if (arr) arr.push(r);
    else byUser.set(r.user_id, [r]);
  }

  const convs: Conversation[] = [];
  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.received_at.localeCompare(b.received_at));

    const messages: Message[] = list.map((r) => ({
      id: r.id,
      userId: r.user_id,
      displayName: r.display_name ?? "",
      messageId: r.message_id ?? String(r.id),
      text: r.text ?? "",
      direction: r.direction,
      receivedAt: r.received_at,
      replied: r.replied,
      repliedAt: r.replied_at,
    }));

    // 表示名は最新の非空を採用
    const displayName =
      [...list].reverse().find((r) => r.display_name)?.display_name ?? "（名前なし）";
    const last = list[list.length - 1];
    const unrepliedCount = list.filter((r) => r.direction === "inbound" && !r.replied).length;
    const lastMs = new Date(last.received_at).getTime();
    const initial = displayName.trim().charAt(0) || "?";

    // shadow_analysis があれば確定タグ（無ければ推定）を反映
    const analysis = analysisByUser?.get(userId);
    const tags: AnalysisTag[] =
      (analysis?.tags && analysis.tags.length ? analysis.tags : analysis?.estimated_tags) ?? [];

    convs.push({
      userId,
      displayName,
      avatarInitial: initial,
      avatarColor: avatarColorFor(userId),
      messages,
      unrepliedCount,
      lastMessageAt: last.received_at,
      elapsedLabel: elapsedLabel(lastMs, nowMs, unrepliedCount),
      handlingBy: null,
      archived: false,
      // --- AI欄：shadow_analysis から（要約はフェーズ後続） ---
      summary: analysis?.summary ?? "",
      urgency: "low" as Urgency,
      tags,
      tagsConfirmed: analysis?.confirmed ?? false,
      suggestedReply: "",
    });
  }

  // 未返信を上に、その中で最新メッセージが新しい順
  convs.sort((a, b) => {
    if (a.unrepliedCount > 0 !== b.unrepliedCount > 0) return a.unrepliedCount > 0 ? -1 : 1;
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });

  return convs;
}
