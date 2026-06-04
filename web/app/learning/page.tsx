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
import { editRatePct } from "@/lib/diff";
import { cn, formatClock } from "@/lib/utils";
import { Check, X, Pencil, TrendingUp, UserCheck, Archive, ArchiveRestore, Loader2 } from "lucide-react";

// shadow_feedback の1行（API GET の戻り）
interface FeedbackRow {
  id: number;
  display_name: string | null;
  tags: string[];
  inbound_text: string | null;
  generated: string;
  sent: string;
  corrected_reply: string | null;
  operator: string | null;
  status: "pending" | "approved" | "rejected";
  archived: boolean;
  created_at: string;
}

const IMPROVE_THRESHOLD = 25;

function editRateBadgeVariant(rate: number): "success" | "warning" | "danger" {
  if (rate < 15) return "success";
  if (rate < 30) return "warning";
  return "danger";
}

export default function LearningPage() {
  const [feedback, setFeedback] = React.useState<FeedbackRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/feedback")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setFeedback(d.feedback ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "通信エラー"))
      .finally(() => setLoading(false));
  }, []);

  // 1件の更新を API に投げ、成功したら state を差し替える
  const patch = React.useCallback(async (id: number, body: Record<string, unknown>) => {
    const res = await fetch("/api/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    const data = await res.json();
    if (res.ok && data.feedback) {
      setFeedback((prev) => prev.map((f) => (f.id === id ? data.feedback : f)));
    }
  }, []);

  const visible = showArchived ? feedback : feedback.filter((f) => !f.archived);
  const archivedCount = feedback.filter((f) => f.archived).length;

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
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 学習ログを読み込み中…
            </p>
          )}
          {error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="記録件数" value={`${total}`} />
            <Stat label="平均編集率" value={`${avgEdit}%`} hint="低いほどAIが正確" />
            <Stat label="承認待ち" value={`${pending}`} />
            <Stat label="学習済み(承認)" value={`${approved}`} />
          </div>

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
              {tagStats.length === 0 && !loading && (
                <p className="text-sm text-muted-foreground">まだデータがありません。</p>
              )}
            </CardContent>
          </Card>

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
              <FeedbackEntry key={f.id} f={f} onPatch={patch} />
            ))}
            {visible.length === 0 && !loading && (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                表示するログがありません。返信ドラフトで「送信（モック）」すると、ここに記録されます。
              </p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function FeedbackEntry({
  f,
  onPatch,
}: {
  f: FeedbackRow;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<void>;
}) {
  const rate = editRatePct(f.generated, f.sent);
  const [correction, setCorrection] = React.useState(f.corrected_reply ?? f.sent);
  const [savedCorrection, setSavedCorrection] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await onPatch(f.id, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7 bg-slate-400 text-xs">
            {(f.display_name ?? "?").slice(0, 1)}
          </Avatar>
          <span className="text-sm font-medium">{f.display_name ?? "（名前なし）"}</span>
          {f.operator && (
            <Badge variant="secondary" className="ml-1 gap-1">
              <UserCheck className="h-3 w-3" />
              {f.operator}
            </Badge>
          )}
          <Badge variant={editRateBadgeVariant(rate)}>編集率 {rate}%</Badge>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{formatClock(f.created_at)}</span>
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
          顧客：{f.inbound_text}
        </p>

        <div className="rounded-md border p-3">
          <DiffView generated={f.generated} sent={f.sent} />
        </div>

        {f.status === "rejected" && (
          <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50/50 p-3">
            <label className="flex items-center gap-1 text-xs font-medium text-rose-700">
              <Pencil className="h-3.5 w-3.5" />
              正しい返信文を入力（正解として蓄積され、次の生成に使われます）
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
                disabled={!correction.trim() || busy}
                onClick={async () => {
                  await act({ correctedReply: correction });
                  setSavedCorrection(true);
                }}
              >
                <Check className="h-4 w-4" />
                正解として保存
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {f.status === "pending" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => act({ status: "rejected" })}
              >
                <X className="h-4 w-4" />
                却下
              </Button>
              <Button
                variant="line"
                size="sm"
                disabled={busy}
                onClick={() => act({ status: "approved" })}
              >
                <Check className="h-4 w-4" />
                承認（学習に追加）
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={busy}
              onClick={() => act({ status: "pending" })}
            >
              承認状態を戻す
            </Button>
          )}
          {f.archived ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ archived: false })}>
              <ArchiveRestore className="h-4 w-4" />
              アーカイブ解除
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act({ archived: true })}>
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
