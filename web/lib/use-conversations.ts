"use client";

import * as React from "react";
import type { Conversation } from "@/lib/types";
import { useRealtimeSignal } from "@/lib/realtime";

// 会話一覧を Next.js サーバ(API)から取得し、Realtime 変更通知が来たら再取得する。
export function useConversations() {
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  // Realtime: 変更があれば再取得（軽いデバウンスで連続更新をまとめる）
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeSignal(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refetch, 300);
  });

  return { conversations, loading, error, refetch };
}
