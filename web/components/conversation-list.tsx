"use client";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

const urgencyDot: Record<Conversation["urgency"], string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-slate-300",
};

interface Props {
  conversations: Conversation[];
  selectedUserId: string | null;
  onSelect: (userId: string) => void;
}

/** ① 会話リスト：未返信が上、緊急度ドット・経過時間・未返信件数を表示 */
export function ConversationList({ conversations, selectedUserId, onSelect }: Props) {
  // 未返信(>0)を上に、その中では最も古い未返信を先頭に
  const sorted = [...conversations].sort((a, b) => {
    if ((b.unrepliedCount > 0 ? 1 : 0) !== (a.unrepliedCount > 0 ? 1 : 0)) {
      return (b.unrepliedCount > 0 ? 1 : 0) - (a.unrepliedCount > 0 ? 1 : 0);
    }
    return a.lastMessageAt.localeCompare(b.lastMessageAt);
  });

  const unrepliedTotal = conversations.filter((c) => c.unrepliedCount > 0).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="whitespace-nowrap text-sm font-semibold">会話一覧</h2>
        <Badge variant="danger" className="whitespace-nowrap">{unrepliedTotal}件 未返信</Badge>
      </div>
      <ScrollArea className="flex-1">
        <ul className="divide-y">
          {sorted.map((c) => {
            const last = c.messages[c.messages.length - 1];
            const active = c.userId === selectedUserId;
            return (
              <li key={c.userId}>
                <button
                  onClick={() => onSelect(c.userId)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent",
                    active && "bg-accent"
                  )}
                >
                  <Avatar className={c.avatarColor}>{c.avatarInitial}</Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", urgencyDot[c.urgency])} />
                      <span className="truncate text-sm font-medium">{c.displayName}</span>
                      {c.unrepliedCount > 0 && (
                        <span className="ml-auto shrink-0 rounded-full bg-rose-500 px-1.5 text-xs font-semibold text-white">
                          {c.unrepliedCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{last?.text}</p>
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        c.unrepliedCount > 0 ? "text-rose-500" : "text-muted-foreground"
                      )}
                    >
                      {c.elapsedLabel}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
