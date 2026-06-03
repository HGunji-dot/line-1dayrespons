"use client";

import * as React from "react";
import { useSyncExternalStore } from "react";

// ─────────────────────────────────────────────
// 「現在の対応者（自分は誰か）」をルート間で共有する軽量ストア。
// 共有パスワード認証では誰がログインしたか分からないため、対応者は
// ヘッダーで選び、localStorage に保存して再読込でも保持する。
// （認証ユーザーと対応者を結びつけるのはフェーズBの拡張余地）
// ─────────────────────────────────────────────

const STORAGE_KEY = "line_reply_operator";

let current: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getOperator(): string | null {
  return current;
}

export function setOperator(name: string | null) {
  current = name;
  try {
    if (name) localStorage.setItem(STORAGE_KEY, name);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage 不可な環境では記憶しないだけ
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOperator(): string | null {
  const value = useSyncExternalStore(subscribe, getOperator, () => null);

  // 初回マウント時に localStorage から復元（SSR とのハイドレーション不整合を避ける）
  React.useEffect(() => {
    if (hydrated) return;
    hydrated = true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && saved !== current) {
        current = saved;
        emit();
      }
    } catch {
      // ignore
    }
  }, []);

  return value;
}
