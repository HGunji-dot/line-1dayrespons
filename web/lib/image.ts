// ─────────────────────────────────────────────
// 画像添付（モック）のための小さなヘルパー。
// 実アップロードはせず、選択/D&Dされたファイルを data URL 化してメモリ保持する。
// data URL を採用する理由: 文字列なので React state にそのまま乗り、
// テンプレシードにも焼ける／object URL のような revoke 管理が不要。
// ─────────────────────────────────────────────

/** 受け入れる画像 MIME（admin.html と揃える） */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];

/** input/accept 属性用の文字列 */
export const ACCEPT_ATTR = ALLOWED_IMAGE_TYPES.join(",");

/** 1枚あたりの上限（data URL は Base64 で約1.33倍に膨らむため控えめに） */
export const MAX_IMAGE_SIZE_MB = 5;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/** 添付の上限枚数（テンプレ・ドラフト共通） */
export const MAX_IMAGES = 4;

/** File を data URL 文字列に変換（ブラウザ専用・ユーザー操作起点でのみ呼ぶ） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface ProcessResult {
  /** 既存 + 受理分をマージした新しい配列（上限クリップ済み） */
  next: string[];
  /** スキップ理由の人間向けメッセージ（0件なら空配列） */
  skipped: string[];
}

/**
 * 選択/ドロップされたファイル群を検証して data URL 化し、既存配列にマージする。
 * - 非対応 MIME / サイズ超過 / 重複 / 上限超過 は弾き、理由をまとめて返す。
 * - 重複判定は変換後の data URL の一致で行う（同一画像は同一文字列になる）。
 */
export async function processFiles(
  incoming: FileList | File[],
  existing: string[],
  max: number = MAX_IMAGES
): Promise<ProcessResult> {
  const files = Array.from(incoming);
  let skippedType = 0;
  let skippedSize = 0;

  const valid: File[] = [];
  for (const f of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.type)) {
      skippedType++;
      continue;
    }
    if (f.size > MAX_IMAGE_SIZE_BYTES) {
      skippedSize++;
      continue;
    }
    valid.push(f);
  }

  const urls = await Promise.all(valid.map(fileToDataUrl));

  const next = [...existing];
  let skippedDup = 0;
  let skippedOver = 0;
  for (const url of urls) {
    if (next.includes(url)) {
      skippedDup++;
      continue;
    }
    if (next.length >= max) {
      skippedOver++;
      continue;
    }
    next.push(url);
  }

  const skipped: string[] = [];
  if (skippedType) skipped.push(`${skippedType}件: 対応形式（JPEG / PNG / GIF）外のためスキップしました`);
  if (skippedSize) skipped.push(`${skippedSize}件: ${MAX_IMAGE_SIZE_MB}MB を超えるためスキップしました`);
  if (skippedDup) skipped.push(`${skippedDup}件: すでに追加済みのためスキップしました`);
  if (skippedOver) skipped.push(`${skippedOver}件: 上限 ${max} 枚を超えるためスキップしました`);

  return { next, skipped };
}
