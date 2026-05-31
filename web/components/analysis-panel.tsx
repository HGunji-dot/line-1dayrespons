"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Plus, Pencil } from "lucide-react";
import type { Conversation, Urgency } from "@/lib/types";

const urgencyLabel: Record<Urgency, { text: string; variant: "danger" | "warning" | "secondary" }> = {
  high: { text: "緊急度：高", variant: "danger" },
  medium: { text: "緊急度：中", variant: "warning" },
  low: { text: "緊急度：低", variant: "secondary" },
};

interface Props {
  conversation: Conversation | null;
}

/** ③ AI分析：要約・緊急度・ドメイン特化タグ（確信度つき）。今はダミー値 */
export function AnalysisPanel({ conversation }: Props) {
  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        会話を選ぶとAI分析が表示されます
      </div>
    );
  }

  const u = urgencyLabel[conversation.urgency];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        <h2 className="whitespace-nowrap text-sm font-semibold">AI分析</h2>
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
          ダミー
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>要約</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-muted-foreground">{conversation.summary}</p>
            </CardContent>
          </Card>

          <div>
            <Badge variant={u.variant}>{u.text}</Badge>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>抽出タグ</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                タグをクリックすると返信例（テンプレ）の編集へ移動します
              </p>
              <div className="flex flex-wrap gap-2">
                {conversation.tags.map((t) => (
                  <Link
                    key={t.label}
                    href={`/templates?tag=${encodeURIComponent(t.label)}`}
                    title={`「${t.label}」の返信例を編集`}
                  >
                    <Badge
                      variant="secondary"
                      className="cursor-pointer gap-1 whitespace-nowrap hover:bg-secondary/60"
                    >
                      {t.label}
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(t.confidence * 100)}%
                      </span>
                    </Badge>
                  </Link>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Plus className="h-3 w-3" />
                  新規タグを提案（モック）
                </button>
                <Link
                  href="/templates"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  テンプレートを管理
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>類似の過去対応（RAG・モック）</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs leading-relaxed text-muted-foreground">
                フェーズCで、似た問い合わせの「正解返信」をベクトル検索して、ここに根拠として表示します。
              </p>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
