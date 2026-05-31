"use client";

import * as React from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar } from "@/components/ui/avatar";
import { DiffView, DiffLegend } from "@/components/diff-view";
import {
  useFeedback,
  setFeedbackStatus,
  setCorrectedReply,
  setFeedbackArchived,
} from "@/lib/feedback-store";
import type { ReplyFeedback } from "@/lib/feedback-data";
import { editRatePct } from "@/lib/diff";
import { cn, formatClock } from "@/lib/utils";
import { Check, X, Pencil, TrendingUp, UserCheck, Archive, ArchiveRestore } from "lucide-react";

// この閾値を超えるタグは「テンプレ改善提案」を出す
const IMPROVE_THRESHOLD = 25;

function editRateBadgeVariant(rate: number): "success" | "warning" | "danger" {
  if (rate < 15) return "success";
  if (rate < 30) return "warning";
  return "danger";
}

export default function LearningPage() {
  const feedback = useFeedback();
  const [showArchived, setShowArchived] = React.useState(false);
  // アーカイブは既定で学習ログから隠す（承認/却下では消えず、アーカイブで消える）
  const visible = showArchived ? feedback : feedback.filter((f) => !f.archived);
  const archivedCount = feedback.filter((f) => f.archived).length;

  // タグ別の平均編集率を集計（表示中のものを対象）
  const tagStats = React.useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const f of visible) {
      const rate = editRatePct(f.generated, f.sent);
      for (const tag of f.tags) {
        const cur = map.get(tag) ?? { total: 0, count: 0 };
        cur.total += rate;
        cur.count += 1;
        map.set(tag, cur);
      }
    }
    return Array.from(map.entries())
      .map(([tag, v]) => ({ tag, avg: Math.round(v.total / v.count), count: v.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [visible]);

  const total = visible.length;
  const pending = visible.filter((f) => f.status === "pending").length;
  const approved = visible.filter((f) => f.status === "approved").length;
  const avgEdit =
    total === 0
      ? 0
      : Math.round(visible.reduce((s, f) => s + editRatePct(f.generated, f.sent), 0) / total);

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />
      <ScrollArea className="flex-1 bg-muted/20">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          {/* サマリー */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="記録件数" value={`${total}`} />
            <Stat label="平均編集率" value={`${avgEdit}%`} hint="低いほどAIが正確" />
            <Stat label="承認待ち" value={`${pending}`} />
            <Stat label="学習済み(承認)" value={`${approved}`} />
          </div>

          {/* タグ別 改善提案 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-violet-500" />
                タグ別の編集率（テンプレ改善の手がかり）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tagStats.map((t) => {
                const needImprove = t.avg >= IMPROVE_THRESHOLD;
                return (
                  <div key={t.tag} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 truncate font-medium">{t.tag}</span>
                    {/* バー */}
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={
                          t.avg < 15
                            ? "h-full bg-emerald-400"
                            : t.avg < 30
                              ? "h-full bg-amber-400"
                              : "h-full bg-rose-400"
                        }
                        style={{ width: `${Math.min(t.avg, 100)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right tabular-nums">{t.avg}%</span>
                    <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">
                      {t.count}件
                    </span>
                    {needImprove ? (
                      <Link
                        href={`/templates?tag=${encodeURIComponent(t.tag)}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-100"
                      >
                        <Pencil className="h-3 w-3" />
                        改善提案
                      </Link>
                    ) : (
                      <span className="w-[68px] shrink-0" />
                    )}
                  </div>
                );
              })}
              {tagStats.length === 0 && (
                <p className="text-sm text-muted-foreground">まだデータがありません。</p>
              )}
            </CardContent>
          </Card>

          {/* フィードバック一覧（差分＋承認/却下＋アーカイブ） */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold">送信ログ（AI下書き → 送信文 の差分）</h2>
                {archivedCount > 0 && (
                  <button
                    onClick={() => setShowArchived((v) => !v)}
                    className={cn(
                      "inline-flex items-center gap-1 whitespace-nowrap text-[11px] transition-colors",
                      showArchived ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Archive className="h-3 w-3" />
                    {showArchived ? "アーカイブを隠す" : "アーカイブを表示"}（{archivedCount}）
                  </button>
                )}
              </div>
              <DiffLegend />
            </div>

            {visible.map((f) => (
              <FeedbackEntry key={f.id} f={f} />
            ))}
            {visible.length === 0 && (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                表示するログがありません。
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

/** 1件のフィードバック（差分表示・承認/却下・却下時は正解入力） */
function FeedbackEntry({ f }: { f: ReplyFeedback }) {
  const rate = editRatePct(f.generated, f.sent);
  const [correction, setCorrection] = React.useState(f.correctedReply ?? f.sent);
  const [savedCorrection, setSavedCorrection] = React.useState(false);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7 bg-slate-400 text-xs">{f.displayName.slice(0, 1)}</Avatar>
          <span className="text-sm font-medium">{f.displayName}</span>
          <Badge variant="secondary" className="ml-1 gap-1">
            <UserCheck className="h-3 w-3" />
            {f.operator}
          </Badge>
          <Badge variant={editRateBadgeVariant(rate)}>編集率 {rate}%</Badge>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{formatClock(f.createdAt)}</span>
            {f.status === "approved" && (
              <Badge variant="success" className="gap-1">
                <Check className="h-3 w-3" />
                学習済み
              </Badge>
            )}
            {f.status === "rejected" && (
              <Badge variant="outline" className="text-muted-foreground">
                却下
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {f.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>

        <p className="rounded bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          顧客：{f.inboundText}
        </p>

        <div className="rounded-md border p-3">
          <DiffView generated={f.generated} sent={f.sent} />
        </div>

        {/* 却下時：正しい返信文を入力（正解として裏で蓄積される） */}
        {f.status === "rejected" && (
          <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50/50 p-3">
            <label className="flex items-center gap-1 text-xs font-medium text-rose-700">
              <Pencil className="h-3.5 w-3.5" />
              正しい返信文を入力（正解として蓄積されます）
            </label>
            <Textarea
              value={correction}
              onChange={(e) => {
                setCorrection(e.target.value);
                setSavedCorrection(false);
              }}
              className="min-h-[80px] bg-white text-sm leading-relaxed"
              placeholder="この問い合わせにはこう返すべき、という正しい返信文…"
            />
            <div className="flex items-center justify-end gap-2">
              {savedCorrection && (
                <span className="text-xs text-emerald-600">✓ 正解として蓄積しました</span>
              )}
              <Button
                variant="line"
                size="sm"
                disabled={!correction.trim()}
                onClick={() => {
                  setCorrectedReply(f.id, correction);
                  setSavedCorrection(true);
                }}
              >
                <Check className="h-4 w-4" />
                正解として保存
              </Button>
            </div>
          </div>
        )}

        {/* 承認/却下は状態を変えるだけ。学習ログから消すにはアーカイブを押す。 */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {f.status === "pending" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setFeedbackStatus(f.id, "rejected")}>
                <X className="h-4 w-4" />
                却下
              </Button>
              <Button variant="line" size="sm" onClick={() => setFeedbackStatus(f.id, "approved")}>
                <Check className="h-4 w-4" />
                承認（学習に追加）
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFeedbackStatus(f.id, "pending")}
            >
              承認状態を戻す
            </Button>
          )}
          {f.archived ? (
            <Button variant="outline" size="sm" onClick={() => setFeedbackArchived(f.id, false)}>
              <ArchiveRestore className="h-4 w-4" />
              アーカイブ解除
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setFeedbackArchived(f.id, true)}>
              <Archive className="h-4 w-4" />
              アーカイブ
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
