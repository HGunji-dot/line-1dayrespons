import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind のクラス名を安全に結合するヘルパー（shadcn 標準） */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * ISO 文字列を "5/31 14:23" のような表記にする。
 * Date のタイムゾーン変換を使わず文字列から直接取り出すことで、
 * サーバー(SSR)とクライアントで表示がズレる（ハイドレーション不整合）のを防ぐ。
 */
export function formatClock(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, , month, day, hh, mm] = m;
  return `${Number(month)}/${Number(day)} ${hh}:${mm}`;
}
