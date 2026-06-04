"use client";

import * as React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Plus, Pencil, X, Check, Loader2, RefreshCw } from "lucide-react";
import type { AnalysisTag, Conversation } from "@/lib/types";

interface Props {
  conversation: Conversation | null;
  // 確定タグを親(page)へ反映し、返信ドラフト生成に流す
  onTagsChange: (userId: string, tags: AnalysisTag[], confirmed: boolean) => void;
}

/** ③ AI分析：固定タグマスタからのAIタグ推定 → 人が修正 → 確定保存 */
export function AnalysisPanel({ conversation, onTagsChange }: Props) {
  const [allTags, setAllTags] = React.useState<string[]>([]);
  const [estimating, setEstimating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);

  // タグマスタ取得（増減UIの選択肢）
  React.useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => setAllTags(d.tags ?? []))
      .catch(() => {});
  }, []);

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        会話を選ぶとAI分析が表示されます
      </div>
    );
  }

  const { userId, tags, tagsConfirmed } = conversation;

  const handleEstimate = async () => {
    setEstimating(true);
    setError(null);
    try {
      const res = await fetch("/api/estimate-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `推定失敗 (${res.status})`);
        return;
      }
      onTagsChange(userId, data.tags ?? [], false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setEstimating(false);
    }
  };

  const removeTag = (label: string) => {
    onTagsChange(
      userId,
      tags.filter((t) => t.label !== label),
      false
    );
  };

  const addTag = (label: string) => {
    setAdding(false);
    if (tags.some((t) => t.label === label)) return;
    onTagsChange(userId, [...tags, { label, confidence: 1 }], false);
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tags }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? `保存失敗 (${res.status})`);
        return;
      }
      onTagsChange(userId, tags, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー");
    } finally {
      setSaving(false);
    }
  };

  const unusedTags = allTags.filter((t) => !tags.some((x) => x.label === t));
  const hasTags = tags.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
        <h2 className="whitespace-nowrap text-sm font-semibold">AI分析</h2>
        {tagsConfirmed ? (
          <Badge variant="success" className="ml-auto shrink-0 gap-1 text-[10px]">
            <Check className="h-3 w-3" />
            タグ確定済み
          </Badge>
        ) : (
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            未確定
          </Badge>
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>抽出タグ（固定マスタから）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!hasTags && (
                <p className="text-[11px] text-muted-foreground">
                  まだタグがありません。「AIでタグ推定」を押すと、固定タグから候補を出します。
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t.label}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs"
                  >
                    <Link
                      href={`/templates?tag=${encodeURIComponent(t.label)}`}
                      title={`「${t.label}」の返信例を編集`}
                      className="hover:underline"
                    >
                      {t.label}
                    </Link>
                    <span className="text-[10px] text-muted-foreground">
                      {Math.round((t.confidence ?? 1) * 100)}%
                    </span>
                    <button
                      onClick={() => removeTag(t.label)}
                      className="text-muted-foreground hover:text-rose-600"
                      title="このタグを外す"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>

              {/* タグ追加（マスタから選ぶ） */}
              <div className="flex flex-wrap items-center gap-3">
                {adding ? (
                  <select
                    autoFocus
                    className="rounded-md border bg-background px-2 py-1 text-xs"
                    defaultValue=""
                    onChange={(e) => e.target.value && addTag(e.target.value)}
                    onBlur={() => setAdding(false)}
                  >
                    <option value="" disabled>
                      タグを選ぶ…
                    </option>
                    {unusedTags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    onClick={() => setAdding(true)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                    タグを追加
                  </button>
                )}
                <Link
                  href="/templates"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                  テンプレートを管理
                </Link>
              </div>

              {error && <p className="text-xs text-rose-600">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={handleEstimate} disabled={estimating}>
                  {estimating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : hasTags ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {estimating ? "推定中…" : hasTags ? "再推定" : "AIでタグ推定"}
                </Button>
                <Button
                  variant="line"
                  size="sm"
                  onClick={handleConfirm}
                  disabled={saving || !hasTags}
                  title="このタグを確定（返信生成・学習の真値になります）"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  確定して保存
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>類似の過去対応（RAG・モック）</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs leading-relaxed text-muted-foreground">
                承認済みの実例が貯まると、ここに「正解返信」を根拠として表示します。
              </p>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
