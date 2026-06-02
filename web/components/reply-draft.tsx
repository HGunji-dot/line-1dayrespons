"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Send, Check, FileText, ImageIcon } from "lucide-react";
import type { Conversation } from "@/lib/types";
import { initialTemplates, type ReplyTemplate } from "@/lib/template-data";
import { editRatePct } from "@/lib/diff";
import { ImageAttach } from "@/components/image-attach";
import { MAX_IMAGES } from "@/lib/image";

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
  // 添付画像（data URL）。key={userId} で会話切替時に作り直されるため自動リセットされる。
  const [images, setImages] = React.useState<string[]>([]);
  const [justSent, setJustSent] = React.useState(false);

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        会話を選ぶと返信ドラフトが表示されます
      </div>
    );
  }

  // 本文 or 画像のいずれかがあれば送信可（画像のみ送信を許可）
  const canSend = text.trim().length > 0 || images.length > 0;

  const handleSend = () => {
    if (!canSend) return;
    // 学習ログの汚染を避けるため、画像は onSend に渡さない（要件: 学習ログは画像を無視）。
    // 本文が空（画像のみ）の場合の addFeedback ガードは親の handleSend 側で行う。
    onSend(conversation.userId, text, conversation.suggestedReply);
    setJustSent(true);
  };

  // ひな形を挿入：本文も画像も置換する。
  // 手動で追加済みの画像が失われる場合だけ確認を挟む（テキスト置換は従来どおり無確認）。
  const applyTemplate = (tpl: ReplyTemplate) => {
    const tplImages = (tpl.images ?? []).slice(0, MAX_IMAGES);
    const willLoseImages =
      images.length > 0 && JSON.stringify(images) !== JSON.stringify(tplImages);
    if (willLoseImages && typeof window !== "undefined") {
      const ok = window.confirm(
        `現在の添付画像 ${images.length} 枚を、このテンプレの内容に置き換えます。よろしいですか？`
      );
      if (!ok) return;
    }
    setText(tpl.body);
    setImages(tplImages);
    setJustSent(false);
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
              {matchedTemplates.map((tpl) => {
                const imgCount = tpl.images?.length ?? 0;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    title={tpl.body}
                    className="flex max-w-full items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    <span className="truncate">
                      {tpl.tagLabel}：{tpl.title}
                    </span>
                    {imgCount > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                        <ImageIcon className="h-2.5 w-2.5" />
                        {imgCount}
                      </span>
                    )}
                  </button>
                );
              })}
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
          placeholder="AIが返信案を生成します…（画像のみの場合は空でも可）"
        />
        <ImageAttach
          value={images}
          onChange={(next) => {
            setImages(next);
            setJustSent(false);
          }}
          max={MAX_IMAGES}
          label="画像を添付（任意）"
          idPrefix="reply"
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
            <Button variant="line" size="sm" onClick={handleSend} disabled={!canSend}>
              <Send className="h-4 w-4" />
              送信（モック）
            </Button>
          </div>
        </div>
        {justSent &&
          (text.trim() ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              ✓ 送信しました（モック）
              {images.length > 0 && `・画像 ${images.length} 枚`}。AI下書きとの
              <strong>編集率 {editRatePct(conversation.suggestedReply, text)}%</strong>を
              <a href="/learning" className="underline">学習ログ</a>に記録しました。本番では send-reply を呼びます。
            </p>
          ) : (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              ✓ 画像 {images.length} 枚を送信しました（モック）。本文が空のため学習ログには記録していません。本番では send-reply を呼びます。
            </p>
          ))}
      </div>
    </div>
  );
}
