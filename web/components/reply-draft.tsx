"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Send, Check, FileText } from "lucide-react";
import type { Conversation } from "@/lib/types";
import { initialTemplates } from "@/lib/template-data";
import { editRatePct } from "@/lib/diff";

interface Props {
  conversation: Conversation | null;
  // sent=実際に送る文 / generated=AIの元下書き（学習用の差分計算に使う）
  onSend: (userId: string, sent: string, generated: string) => void;
}

/** ④ 返信ドラフト：AI生成文（ダミー）を編集して送信。送信は人が最終承認 */
export function ReplyDraft({ conversation, onSend }: Props) {
  // 親から key={userId} で会話ごとに作り直すため、初期値を props から直接セットできる。
  // useEffect を使わないので初回描画（SSR）から下書きが入った状態になる。
  const [text, setText] = React.useState(conversation?.suggestedReply ?? "");
  const [justSent, setJustSent] = React.useState(false);

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        会話を選ぶと返信ドラフトが表示されます
      </div>
    );
  }

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(conversation.userId, text, conversation.suggestedReply);
    setJustSent(true);
  };

  // この会話のタグに紐づく登録済みテンプレ（挿入候補）
  // ※ モックではシードを参照。フェーズBで保存済みテンプレの取得に置き換える。
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
                  onClick={() => {
                    setText(tpl.body);
                    setJustSent(false);
                  }}
                  title={tpl.body}
                  className="max-w-full truncate rounded-full border bg-background px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
                >
                  {tpl.tagLabel}：{tpl.title}
                </button>
              ))}
            </div>
          </div>
        )}
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setJustSent(false);
          }}
          className="flex-1 resize-none text-sm leading-relaxed"
          placeholder="AIが返信案を生成します…"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{text.length} 文字</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setText(conversation.suggestedReply)}
            >
              <RefreshCw className="h-4 w-4" />
              再生成（モック）
            </Button>
            <Button variant="line" size="sm" onClick={handleSend} disabled={!text.trim()}>
              <Send className="h-4 w-4" />
              送信（モック）
            </Button>
          </div>
        </div>
        {justSent && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            ✓ 送信しました（モック）。AI下書きとの<strong>編集率 {editRatePct(conversation.suggestedReply, text)}%</strong>を
            <a href="/learning" className="underline">学習ログ</a>に記録しました。本番では send-reply を呼びます。
          </p>
        )}
      </div>
    </div>
  );
}
