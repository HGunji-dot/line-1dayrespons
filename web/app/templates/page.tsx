"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatClock } from "@/lib/utils";
import { initialTemplates, getAllTagLabels, type ReplyTemplate } from "@/lib/template-data";
import { ImageAttach } from "@/components/image-attach";
import { MAX_IMAGES } from "@/lib/image";
import { Plus, Trash2, Save, Tag } from "lucide-react";

function TemplatesInner() {
  const searchParams = useSearchParams();
  const tagFromUrl = searchParams.get("tag");

  const tagLabels = React.useMemo(() => getAllTagLabels(), []);
  const [templates, setTemplates] = React.useState<ReplyTemplate[]>(initialTemplates);
  const [selectedTag, setSelectedTag] = React.useState<string>(
    tagFromUrl && tagLabels.includes(tagFromUrl) ? tagFromUrl : tagLabels[0] ?? ""
  );

  // URL の ?tag= が変わったら選択を合わせる（③のタグから飛んできたとき）
  React.useEffect(() => {
    if (tagFromUrl && tagLabels.includes(tagFromUrl)) setSelectedTag(tagFromUrl);
  }, [tagFromUrl, tagLabels]);

  const countByTag = (label: string) => templates.filter((t) => t.tagLabel === label).length;
  const current = templates.filter((t) => t.tagLabel === selectedTag);

  // 新規追加フォーム
  const [newTitle, setNewTitle] = React.useState("");
  const [newBody, setNewBody] = React.useState("");
  const [newImages, setNewImages] = React.useState<string[]>([]);

  const stamp = () => new Date().toISOString();

  const addTemplate = () => {
    if (!newBody.trim()) return;
    setTemplates((prev) => [
      ...prev,
      {
        id: `tpl-${selectedTag}-${Date.now()}`,
        tagLabel: selectedTag,
        title: newTitle.trim() || "無題のテンプレ",
        body: newBody.trim(),
        images: newImages.length > 0 ? newImages : undefined,
        updatedAt: stamp(),
      },
    ]);
    setNewTitle("");
    setNewBody("");
    setNewImages([]);
  };

  const updateTemplate = (id: string, patch: Partial<ReplyTemplate>) =>
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: stamp() } : t))
    );

  const deleteTemplate = (id: string) =>
    setTemplates((prev) => prev.filter((t) => t.id !== id));

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        {/* 左：タグ一覧 */}
        <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">タグ</h2>
            <p className="text-xs text-muted-foreground">返信例を登録するタグを選択</p>
          </div>
          <ScrollArea className="flex-1">
            <ul className="p-2">
              {tagLabels.map((label) => {
                const active = label === selectedTag;
                const count = countByTag(label);
                return (
                  <li key={label}>
                    <button
                      onClick={() => setSelectedTag(label)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
                        active && "bg-accent font-medium"
                      )}
                    >
                      <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{label}</span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 text-xs",
                          count > 0
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </aside>

        {/* 右：選択タグの返信例（複数） */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-6 py-3">
            <h2 className="text-base font-semibold">
              「{selectedTag}」の返信例
            </h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
              {current.length} 件
            </span>
          </div>

          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-3xl space-y-4 p-6">
              {/* 既存テンプレ一覧 */}
              {current.length === 0 && (
                <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  まだ返信例がありません。下のフォームから追加してください。
                </p>
              )}

              {current.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onSave={(patch) => updateTemplate(t.id, patch)}
                  onDelete={() => deleteTemplate(t.id)}
                />
              ))}

              {/* 新規追加 */}
              <Card className="border-emerald-200 bg-emerald-50/40">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <Plus className="h-4 w-4" />
                    新しい返信例を追加
                  </div>
                  <Input
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="バリエーション名（例: 丁寧 / 簡潔）"
                  />
                  <Textarea
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    placeholder={`「${selectedTag}」が付いたときの返信例を入力…`}
                    className="min-h-[100px]"
                  />
                  <ImageAttach
                    value={newImages}
                    onChange={setNewImages}
                    max={MAX_IMAGES}
                    label="画像を添付（任意・最大4枚）"
                    idPrefix="new-tpl"
                  />
                  <div className="flex justify-end">
                    <Button variant="line" size="sm" onClick={addTemplate} disabled={!newBody.trim()}>
                      <Plus className="h-4 w-4" />
                      このタグに追加
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}

/** 1件の返信例カード（その場で編集・保存・削除） */
function TemplateCard({
  template,
  onSave,
  onDelete,
}: {
  template: ReplyTemplate;
  onSave: (patch: Partial<ReplyTemplate>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = React.useState(template.title);
  const [body, setBody] = React.useState(template.body);
  const [images, setImages] = React.useState<string[]>(template.images ?? []);
  const [saved, setSaved] = React.useState(false);

  const imagesChanged =
    JSON.stringify(images) !== JSON.stringify(template.images ?? []);
  const dirty = title !== template.title || body !== template.body || imagesChanged;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setSaved(false);
            }}
            className="h-8 max-w-xs text-sm font-medium"
          />
          <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
            更新 {formatClock(template.updatedAt)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="削除"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <Textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
          className="min-h-[96px] text-sm leading-relaxed"
        />
        <ImageAttach
          value={images}
          onChange={(next) => {
            setImages(next);
            setSaved(false);
          }}
          max={MAX_IMAGES}
          label="画像を添付（任意・最大4枚）"
          idPrefix={template.id}
        />
        <div className="flex items-center justify-end gap-2">
          {saved && <span className="text-xs text-emerald-600">✓ 保存しました（モック）</span>}
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty}
            onClick={() => {
              onSave({ title, body, images: images.length > 0 ? images : undefined });
              setSaved(true);
            }}
          >
            <Save className="h-4 w-4" />
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">読み込み中…</div>}>
      <TemplatesInner />
    </Suspense>
  );
}
