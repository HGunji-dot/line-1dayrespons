"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";
import { type ReplyFeedback, type FeedbackStatus } from "@/lib/feedback-data";
import { useRealtimeSignal } from "@/lib/realtime";

// ─────────────────────────────────────────────
// 学習フィードバックの共有ストア（フェーズB: Supabase 実接続）。
// /api/feedback を介して reply_feedback テーブルを読み書きする。
// 変更は楽観的にローカル反映し、サーバ確定後に再取得して整合を取る。
// Realtime 通知（他スタッフの操作）でも自動再取得する。
// ─────────────────────────────────────────────

let state: ReplyFeedback[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getFeedback(): ReplyFeedback[] {
  return state;
}

export async function loadFeedback(): Promise<void> {
  try {
    const res = await fetch("/api/feedback", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    state = data.feedback ?? [];
    emit();
  } catch {
    // 取得失敗時は既存表示を維持
  }
}

function patchLocal(id: string, patch: Partial<ReplyFeedback>) {
  state = state.map((f) => (f.id === id ? { ...f, ...patch } : f));
  emit();
}

async function patchServer(id: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`/api/feedback/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) await loadFeedback(); // 失敗したらサーバ状態に戻す
  } catch {
    await loadFeedback();
  }
}

export function setFeedbackStatus(id: string, status: FeedbackStatus) {
  patchLocal(id, { status });
  void patchServer(id, { status });
}

/** 却下したエントリに「正しい返信文」を登録（正解として蓄積） */
export function setCorrectedReply(id: string, correctedReply: string) {
  patchLocal(id, { correctedReply });
  void patchServer(id, { correctedReply });
}

/** アーカイブ（学習ログから外す）/ 解除 */
export function setFeedbackArchived(id: string, archived: boolean) {
  patchLocal(id, { archived });
  void patchServer(id, { archived });
}

/**
 * 蓄積された「正解返信データ」（フェーズCでRAGの教師データになる）。
 * 承認したものは送信文を、却下して修正したものは修正文を正解とする。
 */
export function getAcceptedReplies(): { tags: string[]; reply: string }[] {
  return state
    .map((f) => {
      if (f.status === "approved") return { tags: f.tags, reply: f.sent };
      if (f.status === "rejected" && f.correctedReply) return { tags: f.tags, reply: f.correctedReply };
      return null;
    })
    .filter((x): x is { tags: string[]; reply: string } => x !== null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React から購読するフック。初回ロード＋Realtime 再取得を内包する。 */
export function useFeedback(): ReplyFeedback[] {
  const data = useSyncExternalStore(subscribe, getFeedback, getFeedback);

  React.useEffect(() => {
    void loadFeedback();
  }, []);

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeSignal(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void loadFeedback(), 300);
  });

  return data;
}
