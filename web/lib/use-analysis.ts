"use client";

import * as React from "react";
import type { ConversationAnalysis } from "@/lib/types";

// 選択中の会話の AI 分析を /api/analyze から取得する。
// 会話を切り替えるたびに取得し、結果は DB キャッシュ越しに返る（再オープンは再課金なし）。
// regenerate() で強制再生成（?force=1）。
export function useAnalysis(userId: string | null) {
  const [analysis, setAnalysis] = React.useState<ConversationAnalysis | null>(null);
  const [loading, setLoading] = React.useState(false);

  const fetchFor = React.useCallback(async (uid: string, force = false) => {
    setLoading(true);
    setAnalysis(null);
    try {
      const res = await fetch(
        `/api/analyze?userId=${encodeURIComponent(uid)}${force ? "&force=1" : ""}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data.analysis ?? null);
      }
    } catch {
      // 取得失敗時はプレースホルダ表示のまま
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (userId) fetchFor(userId);
    else setAnalysis(null);
  }, [userId, fetchFor]);

  const regenerate = React.useCallback(() => {
    if (userId) fetchFor(userId, true);
  }, [userId, fetchFor]);

  return { analysis, loading, regenerate };
}
