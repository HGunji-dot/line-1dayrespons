// ─────────────────────────────────────────────
// サーバー側バックエンド層（フェーズ3：実データ接続）
//
// 設計（決定事項）:
// - データアクセスはサーバー側のみ。service_role キーで Supabase の PostgREST / Edge Function を叩く。
//   キーや ADMIN_SECRET はブラウザに出さない（NEXT_PUBLIC_ は付けない）。
// - 新規依存を増やさないため @supabase/supabase-js は使わず素の fetch を使う。
// - 環境変数が無いとき（公開デモなど）は従来のモックにフォールバックする。
//   → env の有無で自動的にモック / 実接続を切り替える。
//
// このファイルは Server Component / Route Handler からのみ import すること。
// ─────────────────────────────────────────────

import type { Conversation, Message, Direction } from "@/lib/types";
import { conversations as mockConversations } from "@/lib/mock-data";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
// GitHub Actions 側は SUPABASE_KEY(service_role) を使うため両方を許容する。
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? "";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

/** 実バックエンド（Supabase）に接続できる構成かどうか。無ければモックで動く。 */
export function hasRealBackend(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

// --- messages 行（PostgREST のレスポンス形） ---
interface MessageRow {
  id: number;
  user_id: string;
  display_name: string | null;
  message_id: string;
  text: string | null;
  direction: Direction;
  received_at: string;
  replied: boolean;
  replied_at: string | null;
  staff_name: string | null;
}

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-teal-500",
];

/** user_id から決定的にアバター色を選ぶ（再読込でも色が変わらないように） */
function avatarColorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function elapsedLabel(oldestUnrepliedAt: string | null): string {
  if (!oldestUnrepliedAt) return "返信済み";
  const hours = Math.floor((Date.now() - new Date(oldestUnrepliedAt).getTime()) / 3_600_000);
  if (hours < 1) return "1時間未満 未返信";
  if (hours < 24) return `約${hours}時間未返信`;
  return `約${Math.floor(hours / 24)}日未返信`;
}

function rowToMessage(r: MessageRow): Message {
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
    operator: r.staff_name ?? undefined,
  };
}

/** messages 行を user_id でまとめて Conversation[] を組み立てる。AI由来の項目は今はプレースホルダ。 */
function buildConversations(rows: MessageRow[]): Conversation[] {
  const byUser = new Map<string, MessageRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.user_id) ?? [];
    list.push(r);
    byUser.set(r.user_id, list);
  }

  const convs: Conversation[] = [];
  for (const [userId, list] of byUser) {
    list.sort((a, b) => a.received_at.localeCompare(b.received_at));
    const messages = list.map(rowToMessage);
    const displayName =
      [...list].reverse().find((r) => r.display_name)?.display_name ?? userId;
    const unreplied = list.filter((r) => r.direction === "inbound" && !r.replied);
    const oldestUnrepliedAt = unreplied.length
      ? unreplied.reduce((min, r) => (r.received_at < min ? r.received_at : min), unreplied[0].received_at)
      : null;
    const lastMessageAt = list[list.length - 1]?.received_at ?? new Date().toISOString();

    convs.push({
      userId,
      displayName,
      avatarInitial: displayName.trim().charAt(0) || "?",
      avatarColor: avatarColorFor(userId),
      messages,
      unrepliedCount: unreplied.length,
      lastMessageAt,
      elapsedLabel: elapsedLabel(oldestUnrepliedAt),
      handlingBy: null,
      archived: false,
      // --- AI由来（フェーズCでAI生成に差し替え。今は空のプレースホルダ） ---
      summary: "",
      urgency: "medium",
      tags: [],
      suggestedReply: "",
    });
  }

  // 未返信があるものを上に、その中では最古の未返信が先頭（通知の並びと揃える）
  convs.sort((a, b) => {
    if ((b.unrepliedCount > 0 ? 1 : 0) !== (a.unrepliedCount > 0 ? 1 : 0)) {
      return (b.unrepliedCount > 0 ? 1 : 0) - (a.unrepliedCount > 0 ? 1 : 0);
    }
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
  return convs;
}

/** 会話一覧を返す。実バックエンドがあれば messages から、無ければモック。 */
export async function getConversations(): Promise<Conversation[]> {
  if (!hasRealBackend()) return mockConversations;

  const url =
    `${SUPABASE_URL}/rest/v1/messages` +
    `?select=id,user_id,display_name,message_id,text,direction,received_at,replied,replied_at,staff_name` +
    `&order=received_at.asc&limit=2000`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`messages の取得に失敗しました (${res.status}): ${await res.text()}`);
  }
  const rows = (await res.json()) as MessageRow[];
  return buildConversations(rows);
}

export interface SendReplyResult {
  ok: boolean;
  status: number;
  detail?: string;
}

/** send-reply Edge Function を呼び、対応者(staff)付きで返信を送る。 */
export async function sendReply(
  userId: string,
  message: string,
  staff: string
): Promise<SendReplyResult> {
  if (!hasRealBackend() || !ADMIN_SECRET) {
    return { ok: false, status: 503, detail: "実バックエンド未設定（モックモード）" };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify({ userId, message, staff }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, detail: await res.text() };
  }
  return { ok: true, status: res.status };
}
