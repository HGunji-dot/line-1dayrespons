"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Send, Check, FileText, Lock, AlertTriangle, UserCheck } from "lucide-react";
import type { Conversation } from "@/lib/types";
import { initialTemplates } from "@/lib/template-data";
import { editRatePct } from "@/lib/diff";
import { useOperator } from "@/lib/operator-store";

interface Props {
  conversation: Conversation | null;
  // sent=実際に送る文 / generated=AIの元下書き / operator=対応者
  onSend: (userId: string, sent: string, generated: string, operator: string) => void;
  // 対応開始（会話を自分のものとしてクレーム）
  onClaim: (userId: string, operator: string) => void;
}

/** ④ 返信ドラフト：対応者を選んでから編集・送信。二重対応はブロックする */
export function ReplyDraft({ conversation, onSend, onClaim }: Props) {
  // 親から key={userId} で会話ごとに作り直すため、初期値を props から直接セットできる。
  const [text, setText] = React.useState(conversation?.suggestedReply ?? "");
  const [justSent, setJustSent] = React.useState(false);
  const operator = useOperator();

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        会話を選ぶと返信ドラフトが表示されます
      </div>
    );
  }

  const handlingBy = conversation.handlingBy ?? null;
  const noOperator = !operator;
  const takenByOther = !!operator && !!handlingBy && handlingBy !== operator;
  const blocked = noOperator || takenByOther;

  const handleFocus = () => {
    // 未対応の会話なら、編集開始時に自分の対応として確保する
    if (operator && !blocked && handlingBy !== operator) {
      onClaim(conversation.userId, operator);
    }
  };

  const handleSend = () => {
    if (!text.trim() || blocked || !operator) return;
    onSend(conversation.userId, text, conversation.suggestedReply, operator);
    setJustSent(true);
  };

  // この会話のタグに紐づく登録済みテンプレ（挿入候補）
  const tagLabels = conversation.tags.map((t) => t.label);
  const matchedTemplates = initialTemplates.filter((tpl) => tagLabels.includes(tpl.tagLabel));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="whitespace-nowrap text-sm font-semibold">返信ドラフト</h2>
        <Badge variant="success" className="ml-auto shrink-0 gap-1 text-[10px]">
          <Check className="h-3 w-3" />
          AI自動生成（送信は手動）
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* 対応者の状態バナー */}
        {noOperator && (
          <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            ヘッダーで<strong>「対応者」</strong>を選択すると、編集・送信できます。
          </p>
        )}
        {takenByOther && (
          <p className="flex items-center gap-2 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            この会話は<strong>{handlingBy}</strong>さんが対応中です。二重対応になるため編集・送信できません。
          </p>
        )}
        {!blocked && handlingBy === operator && (
          <p className="flex items-center gap-1.5 text-[11px] text-emerald-600">
            <UserCheck className="h-3.5 w-3.5 shrink-0" />
            あなた（{operator}）が対応中
          </p>
        )}

        {matchedTemplates.length > 0 && (
          <div className="space-y-1.5">
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <FileText className="h-3 w-3" />
              タグに紐づくテンプレを挿入
            </span>
            <div className="flex flex-wrap gap-1.5">
              {matchedTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  disabled={blocked}
                  onClick={() => {
                    setText(tpl.body);
                    setJustSent(false);
                  }}
                  title={tpl.body}
                  className="max-w-full truncate rounded-full border bg-background px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tpl.tagLabel}：{tpl.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <Textarea
          value={text}
          disabled={blocked}
          onFocus={handleFocus}
          onChange={(e) => {
            setText(e.target.value);
            setJustSent(false);
          }}
          className="flex-1 resize-none text-sm leading-relaxed disabled:cursor-not-allowed disabled:bg-muted/40"
          placeholder="AIが返信案を生成します…"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length} 文字</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={blocked}
              onClick={() => setText(conversation.suggestedReply)}
            >
              <RefreshCw className="h-4 w-4" />
              再生成（モック）
            </Button>
            <Button
              variant="line"
              size="sm"
              onClick={handleSend}
              disabled={blocked || !text.trim()}
            >
              <Send className="h-4 w-4" />
              送信（モック）
            </Button>
          </div>
        </div>
        {justSent && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            ✓ <strong>{operator}</strong>として送信しました（モック）。AI下書きとの
            <strong>編集率 {editRatePct(conversation.suggestedReply, text)}%</strong>を
            <a href="/learning" className="underline">学習ログ</a>に記録しました。本番では send-reply を呼びます。
          </p>
        )}
      </div>
    </div>
  );
}
