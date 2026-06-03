"use client";

import * as React from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AppHeader } from "@/components/app-header";
import { ConversationList } from "@/components/conversation-list";
import { ChatThread } from "@/components/chat-thread";
import { AnalysisPanel } from "@/components/analysis-panel";
import { ReplyDraft } from "@/components/reply-draft";
import { useConversations } from "@/lib/use-conversations";
import { useAnalysis } from "@/lib/use-analysis";

export default function Page() {
  const { conversations, loading, error, refetch } = useConversations();
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // 初回ロード後、未選択なら先頭の会話を選ぶ。
  React.useEffect(() => {
    if (!selectedUserId && conversations.length > 0) {
      const first = conversations.find((c) => !c.archived) ?? conversations[0];
      setSelectedUserId(first.userId);
    }
  }, [conversations, selectedUserId]);

  const selectedBase = conversations.find((c) => c.userId === selectedUserId) ?? null;

  // フェーズC: 選択中の会話の AI 分析（要約・緊急度・タグ・返信ドラフト・RAG）を取得し、
  // 会話ビューに上書きマージする（未取得・キー未設定時はプレースホルダのまま）。
  const { analysis, loading: analysisLoading, regenerate } = useAnalysis(selectedUserId);
  const selected = React.useMemo(() => {
    if (!selectedBase) return null;
    if (!analysis) return selectedBase;
    return {
      ...selectedBase,
      summary: analysis.summary,
      urgency: analysis.urgency,
      tags: analysis.tags,
      suggestedReply: analysis.suggestedReply,
    };
  }, [selectedBase, analysis]);

  async function call(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error ?? "操作に失敗しました");
    return data;
  }

  // 返信送信：send-reply 経由で LINE 送信＋DB更新し、学習ログにも記録する。
  const handleSend = async (userId: string, text: string, generated: string, operator: string) => {
    // 送信対象は選択中の会話。AI 分析済みのタグ等を学習ログに残すため selected を使う。
    const conv = (selected?.userId === userId ? selected : null) ?? conversations.find((c) => c.userId === userId);
    // 1) 返信送信（クリティカル）。失敗時のみ「送信失敗」として扱い、再送を促す。
    try {
      await call("/api/reply", { userId, message: text, operator });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "送信に失敗しました");
      throw e;
    }
    setActionError(null);
    // 2) 学習ログ記録はベストエフォート。LINE は既に送信済みなので、ここで失敗しても
    //    「送信成功」は取り消さない（取り消すとオペレーターが再送し顧客へ二重送信になる）。
    try {
      await call("/api/feedback", {
        userId,
        displayName: conv?.displayName,
        tags: conv?.tags.map((t) => t.label) ?? [],
        inboundText: conv?.messages.find((m) => m.direction === "inbound")?.text ?? "",
        generated,
        sent: text,
        operator,
        status: "pending",
      });
    } catch (e) {
      console.error("学習ログの記録に失敗しました（返信送信は成功しています）:", e);
    }
    await refetch();
  };

  // 対応開始（二重対応ガード）。サーバが確定後の対応者を返す。
  const handleClaim = async (userId: string, operator: string) => {
    try {
      await call("/api/claim", { userId, operator, action: "claim" });
      setActionError(null);
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "対応開始に失敗しました");
    }
  };

  const handleArchive = async (userId: string, archived: boolean) => {
    try {
      await call("/api/archive", { userId, archived });
      if (archived && !showArchived && userId === selectedUserId) {
        const next = conversations.find((c) => c.userId !== userId && !c.archived);
        setSelectedUserId(next?.userId ?? null);
      }
      await refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "アーカイブに失敗しました");
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />

      {(error || actionError) && (
        <div className="shrink-0 bg-rose-50 px-4 py-1.5 text-xs text-rose-700">
          {actionError ?? `会話の読み込みに失敗しました: ${error}`}
        </div>
      )}

      <main className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" autoSaveId="line-reply-layout">
          {/* ① 会話リスト */}
          <ResizablePanel defaultSize={22} minSize={16} className="bg-card">
            <ConversationList
              conversations={conversations}
              selectedUserId={selectedUserId}
              onSelect={setSelectedUserId}
              showArchived={showArchived}
              onToggleArchived={() => setShowArchived((v) => !v)}
              loading={loading}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ② トーク履歴 */}
          <ResizablePanel defaultSize={32} minSize={22} className="bg-card">
            <ChatThread conversation={selected} onArchive={handleArchive} />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ③ AI分析（フェーズC で接続） */}
          <ResizablePanel defaultSize={23} minSize={16} className="bg-card">
            <AnalysisPanel conversation={selected} analysis={analysis} loading={analysisLoading} />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ④ 返信ドラフト */}
          <ResizablePanel defaultSize={23} minSize={18} className="bg-card">
            <ReplyDraft
              key={selected?.userId ?? "none"}
              conversation={selected}
              onSend={handleSend}
              onClaim={handleClaim}
              onRegenerate={regenerate}
              generating={analysisLoading}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  );
}
