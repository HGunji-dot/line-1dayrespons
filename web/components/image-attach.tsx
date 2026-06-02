"use client";
/* eslint-disable @next/next/no-img-element */
// data URL のサムネを素の <img> で表示する（モック・next/image は不要）。

import * as React from "react";
import { ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCEPT_ATTR, MAX_IMAGES, processFiles } from "@/lib/image";

export interface ImageAttachProps {
  /** data URL の配列（制御コンポーネント） */
  value: string[];
  /** 追加・削除のたびに新しい配列を返す */
  onChange: (next: string[]) => void;
  /** 上限枚数（既定 4） */
  max?: number;
  /** 見出しラベル（省略時は非表示） */
  label?: string;
  /** input id 衝突回避用プレフィックス（一覧で複数並ぶ場合に必須） */
  idPrefix?: string;
  className?: string;
}

/**
 * 共通画像添付エディタ（D&D + ファイル選択 + サムネ + 個別削除 + 上限）。
 * ④返信ドラフトと /templates の追加・編集カードで使い回す（制御コンポーネント）。
 */
export function ImageAttach({
  value,
  onChange,
  max = MAX_IMAGES,
  label,
  idPrefix = "img",
  className,
}: ImageAttachProps) {
  const inputId = `${idPrefix}-image-input`;
  const [isDragging, setIsDragging] = React.useState(false);
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const full = value.length >= max;

  const handleFiles = async (files: FileList | File[]) => {
    const { next, skipped: msgs } = await processFiles(files, value, max);
    setSkipped(msgs);
    if (next.length !== value.length) onChange(next);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = ""; // 同じファイルを連続選択できるようリセット
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  const removeAt = (i: number) => {
    onChange(value.filter((_, j) => j !== i));
    setSkipped([]);
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <ImagePlus className="h-3 w-3" />
          {label}
        </span>
      )}

      {/* サムネイル */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((src, i) => (
            <div key={`${src.slice(0, 24)}-${i}`} className="relative">
              <img
                src={src}
                alt={`添付画像 ${i + 1}`}
                className="h-16 w-16 rounded-md border object-cover"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`${i + 1}枚目を削除`}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ドロップゾーン（上限に達したら隠す） */}
      {!full && (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border border-dashed px-3 py-3 text-center text-[11px] text-muted-foreground transition-colors hover:bg-accent",
            isDragging && "border-line bg-line/5"
          )}
        >
          <span className="pointer-events-none">
            画像をドラッグ＆ドロップ、または
            <span className="font-medium text-foreground">ファイルを選択</span>
          </span>
          <span className="pointer-events-none text-[10px]">
            JPEG / PNG / GIF・最大 {max} 枚
          </span>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            className="hidden"
            onChange={onInputChange}
          />
        </label>
      )}

      {/* 枚数表示 + スキップ通知 */}
      {(value.length > 0 || skipped.length > 0) && (
        <div className="space-y-0.5" role="status" aria-live="polite">
          {value.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {value.length} / {max} 枚
            </span>
          )}
          {skipped.map((m, i) => (
            <p key={i} className="text-[10px] text-rose-600">
              {m}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
