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
import { conversations as initialConversations } from "@/lib/mock-data";
import type { Conversation } from "@/lib/types";
import { addFeedback } from "@/lib/feedback-store";

export default function Page() {
  const [conversations, setConversations] = React.useState<Conversation[]>(initialConversations);
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(
    initialConversations[0]?.userId ?? null
  );

  const selected = conversations.find((c) => c.userId === selectedUserId) ?? null;

  // 送信（モック）：未返信フラグを解除し、送信メッセージを履歴に追加。
  // さらに AI下書き(generated) と 送信文(sent) を学習フィードバックとして記録する。
  const handleSend = (userId: string, text: string, generated: string) => {
    const conv = conversations.find((c) => c.userId === userId);
    const now = new Date().toISOString();
    // 本文が空（画像のみ送信）のときは学習ログに記録しない。
    // 空文字を sent として渡すと編集率が100%になり、タグ別統計を汚染するため。
    if (conv && text.trim()) {
      addFeedback({
        id: `fb-${userId}-${Date.now()}`,
        userId,
        displayName: conv.displayName,
        tags: conv.tags.map((t) => t.label),
        inboundText: conv.messages.find((m) => m.direction === "inbound")?.text ?? "",
        generated,
        sent: text,
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
            },
          ],
        };
      })
    );
  };

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />

      {/* 4ペイン本体 */}
      <main className="min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal" autoSaveId="line-reply-layout">
          {/* ① 会話リスト */}
          <ResizablePanel defaultSize={22} minSize={16} className="bg-card">
            <ConversationList
              conversations={conversations}
              selectedUserId={selectedUserId}
              onSelect={setSelectedUserId}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ② トーク履歴 */}
          <ResizablePanel defaultSize={32} minSize={22} className="bg-card">
            <ChatThread conversation={selected} />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ③ AI分析 */}
          <ResizablePanel defaultSize={23} minSize={16} className="bg-card">
            <AnalysisPanel conversation={selected} />
          </ResizablePanel>
          <ResizableHandle withHandle />

          {/* ④ 返信ドラフト */}
          <ResizablePanel defaultSize={23} minSize={18} className="bg-card">
            <ReplyDraft key={selected?.userId ?? "none"} conversation={selected} onSend={handleSend} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </main>
    </div>
  );
}
