"use client";

import { useSyncExternalStore } from "react";
import { initialFeedback, type ReplyFeedback, type FeedbackStatus } from "@/lib/feedback-data";

// ─────────────────────────────────────────────
// ルート間で共有する軽量な「学習フィードバック」ストア。
// モジュールスコープの配列なので、SPA遷移(Linkでの画面移動)の間は状態が保持され、
// 「会話ページで送信 → 学習ログページに即反映」が体験できる。
// （フルリロードするとシードに戻る。本番では Supabase に置き換える。）
// ─────────────────────────────────────────────

let state: ReplyFeedback[] = [...initialFeedback];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getFeedback(): ReplyFeedback[] {
  return state;
}

export function addFeedback(item: ReplyFeedback) {
  state = [item, ...state];
  emit();
}

export function setFeedbackStatus(id: string, status: FeedbackStatus) {
  state = state.map((f) => (f.id === id ? { ...f, status } : f));
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React から購読するフック（サーバー/クライアントとも同じスナップショットを返す） */
export function useFeedback(): ReplyFeedback[] {
  return useSyncExternalStore(subscribe, getFeedback, getFeedback);
}
