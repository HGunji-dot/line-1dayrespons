"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatClock } from "@/lib/utils";
import type { Conversation } from "@/lib/types";

interface Props {
  conversation: Conversation | null;
}

/** ② トーク履歴：LINE 風の左右吹き出し（inbound=左/灰, outbound=右/緑） */
export function ChatThread({ conversation }: Props) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        左の一覧から会話を選択してください
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">{conversation.displayName}</h2>
        <p className="text-xs text-muted-foreground">{conversation.userId}</p>
      </div>
      <ScrollArea className="flex-1 bg-muted/30 px-4 py-4">
        <div className="flex flex-col gap-3">
          {conversation.messages.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <div key={m.id} className={cn("flex flex-col gap-1", outbound ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm",
                    outbound
                      ? "rounded-br-sm bg-line text-line-foreground"
                      : "rounded-bl-sm bg-white text-foreground"
                  )}
                >
                  {m.text}
                </div>
                <span className="px-1 text-[10px] text-muted-foreground">
                  {formatClock(m.receivedAt)}
                  {outbound ? ` ・${m.operator ? `${m.operator} が送信` : "送信済み"}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
