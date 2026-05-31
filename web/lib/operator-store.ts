"use client";

import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────
// 「現在の対応者（自分は誰か）」をルート間で共有する軽量ストア。
// ヘッダーで選び、返信ドラフトがこれを参照して編集/送信の可否を判定する。
// （フルリロードで未選択に戻るモック挙動。本番は認証ユーザーに置き換える）
// ─────────────────────────────────────────────

let current: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getOperator(): string | null {
  return current;
}

export function setOperator(name: string | null) {
  current = name;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOperator(): string | null {
  return useSyncExternalStore(subscribe, getOperator, getOperator);
}
