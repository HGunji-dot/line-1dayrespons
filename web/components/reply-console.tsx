"use client";

import * as React from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { AppHeader, type HeaderStaff } from "@/components/app-header";
import { ConversationList } from "@/components/conversation-list";
import { ChatThread } from "@/components/chat-thread";
import { AnalysisPanel } from "@/components/analysis-panel";
import { ReplyDraft } from "@/components/reply-draft";
import type { Conversation } from "@/lib/types";
import { addFeedback } from "@/lib/feedback-store";

interface Props {
  initialConversations: Conversation[];
  // 実バックエンド(Supabase)接続時は true。送信が /api/send-reply 経由の実送信になる。
  useRealBackend: boolean;
  // ログイン本人（実モードのみ）。あれば対応者＝本人に固定する。
  currentStaff?: HeaderStaff | null;
}

export function ReplyConsole({ initialConversations, useRealBackend, currentStaff }: Props) {
  const [conversations, setConversations] = React.useState<Conversation[]>(initialConversations);
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(
    initialConversations[0]?.userId ?? null
  );
  const [showArchived, setShowArchived] = React.useState(false);

  const selected = conversations.find((c) => c.userId === selectedUserId) ?? null;

  // 実モード：自分が見ている会話を「対応中」としてサーバーにハートビートする。
  const heartbeat = React.useCallback(
    (userId: string) => {
      if (!useRealBackend || !userId) return;
      fetch("/api/handling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      }).catch(() => {});
    },
    [useRealBackend]
  );

  // 選択中の会話が変わるたびにハートビート（他スタッフに「対応中: 自分」を見せる）。
  React.useEffect(() => {
    if (selectedUserId) heartbeat(selectedUserId);
  }, [selectedUserId, heartbeat]);

  // 他スタッフの「対応中」状態を 8 秒ごとにポーリングして取り込む。
  React.useEffect(() => {
    if (!useRealBackend) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/handling", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          handling?: { userId: string; handlingByName: string }[];
        };
        if (cancelled || !data.handling) return;
        const map = new Map(data.handling.map((h) => [h.userId, h.handlingByName]));
        setConversations((prev) =>
          prev.map((c) => ({ ...c, handlingBy: map.get(c.userId) ?? null }))
        );
      } catch {
        /* ネットワーク断は次の周期で回復 */
      }
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [useRealBackend]);

  // 送信：実モードでは /api/send-reply 経由で送信し、成功したら画面状態を更新する。
  // 失敗時は例外を投げ、返信ドラフト側でエラー表示する（画面状態は変えない）。
  const handleSend = async (userId: string, text: string, generated: string, operator: string) => {
    if (useRealBackend) {
      const res = await fetch("/api/send-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message: text, staff: operator }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `送信に失敗しました (${res.status})`);
      }
    }

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
              messageId: `out-${Date.now()}`,
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
    if (useRealBackend) heartbeat(userId); // サーバーにも「自分が対応中」を伝える
    setConversations((prev) =>
      prev.map((c) =>
        c.userId === userId && !c.handlingBy ? { ...c, handlingBy: operator } : c
      )
    );
  };

  // アーカイブ（処理済みを一覧から隠す）/ 解除。返信済みのみアーカイブ可。
  const handleArchive = (userId: string, archived: boolean) => {
    setConversations((prev) => prev.map((c) => (c.userId === userId ? { ...c, archived } : c)));
    if (archived && !showArchived && userId === selectedUserId) {
      const next = conversations.find((c) => c.userId !== userId && !c.archived);
      setSelectedUserId(next?.userId ?? null);
    }
  };

  return (
    <div className="flex h-screen flex-col">
      <AppHeader currentStaff={currentStaff} />

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
