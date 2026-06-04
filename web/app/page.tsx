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
import type { Conversation } from "@/lib/types";
import { addFeedback } from "@/lib/feedback-store";

export default function Page() {
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // 並行世界の会話（shadow_messages）を取得する。
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data?.error ?? `読み込み失敗 (${res.status})`);
          return;
        }
        const convs: Conversation[] = data.conversations ?? [];
        setConversations(convs);
        setSelectedUserId((prev) => prev ?? convs[0]?.userId ?? null);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "通信エラー");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = conversations.find((c) => c.userId === selectedUserId) ?? null;

  // 送信（モック）：未返信フラグを解除し、送信メッセージを履歴に追加。
  // さらに AI下書き(generated) と 送信文(sent) を学習フィードバックとして記録する。
  const handleSend = (userId: string, text: string, generated: string, operator: string) => {
    const conv = conversations.find((c) => c.userId === userId);
    const now = new Date().toISOString();
    if (conv) {
      addFeedback({
        id: `fb-${userId}-${Date.now()}`,
        userId,
        displayName: conv.displayName,
        tags: conv.tags.map((t) => t.label),
        inboundText: conv.messages.find((m) => m.direction === "inbound")?.text ?? "",
        generated,
        sent: text,
        operator,
        createdAt: now,
        status: "pending",
      });
    }
    setConversations((prev) =>
      prev.map((c) => {
        if (c.userId !== userId) return c;
        return {
          ...c,
          unrepliedCount: 0,
          elapsedLabel: "返信済み",
          lastMessageAt: now,
          handlingBy: null, // 対応完了したのでクレームを解放
          messages: [
            ...c.messages.map((m) => ({ ...m, replied: true })),
            {
              id: Date.now(),
              userId: c.userId,
              displayName: c.displayName,
              messageId: `mock-out-${Date.now()}`,
              text,
              direction: "outbound" as const,
              receivedAt: now,
              replied: true,
              repliedAt: now,
              operator,
            },
          ],
        };
      })
    );
  };

  // 対応開始：未対応の会話を自分（operator）のものとして確保する
  const handleClaim = (userId: string, operator: string) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.userId === userId && !c.handlingBy ? { ...c, handlingBy: operator } : c
      )
    );
  };

  // アーカイブ（処理済みを一覧から隠す）/ 解除。返信済みのみアーカイブ可。
  const handleArchive = (userId: string, archived: boolean) => {
    setConversations((prev) => prev.map((c) => (c.userId === userId ? { ...c, archived } : c)));
    // アーカイブして非表示になるなら、表示中の別の会話へ選択を移す
    if (archived && !showArchived && userId === selectedUserId) {
      const next = conversations.find((c) => c.userId !== userId && !c.archived);
      setSelectedUserId(next?.userId ?? null);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />

      {loadError && (
        <p className="bg-rose-50 px-4 py-2 text-xs text-rose-700">
          会話の読み込みに失敗しました：{loadError}（shadow_messages の取込が済んでいるか確認してください）
        </p>
      )}
      {loading && conversations.length === 0 && !loadError && (
        <p className="px-4 py-2 text-xs text-muted-foreground">並行世界の会話を読み込み中…</p>
      )}

      {/* 4ペイン本体 */}
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
            />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ② トーク履歴 */}
          <ResizablePanel defaultSize={32} minSize={22} className="bg-card">
            <ChatThread conversation={selected} onArchive={handleArchive} />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ③ AI分析 */}
          <ResizablePanel defaultSize={23} minSize={16} className="bg-card">
            <AnalysisPanel conversation={selected} />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ④ 返信ドラフト */}
          <ResizablePanel defaultSize={23} minSize={18} className="bg-card">
            <ReplyDraft
              key={selected?.userId ?? "none"}
              conversation={selected}
              onSend={handleSend}
              onClaim={handleClaim}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  );
}
