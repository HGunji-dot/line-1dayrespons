/**
 * upload-image Edge Function
 *
 * 管理画面から送られた画像を Supabase Storage に保存し、公開 URL を返す。
 * LINE 画像メッセージの originalContentUrl / previewImageUrl に使用する。
 *
 * リクエスト例:
 *   POST /functions/v1/upload-image
 *   Authorization: Bearer <ADMIN_SECRET>
 *   Content-Type: multipart/form-data
 *   form field "file": 画像ファイル（JPEG / PNG / GIF）
 *
 * レスポンス例:
 *   { "url": "https://xxx.supabase.co/storage/v1/object/public/line-media/uploads/xxx.jpg" }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET")!;
const BUCKET = "line-media";
const FOLDER = "uploads";

// LINE が受け入れる MIME タイプ
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/gif":  "gif",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  // 管理者認証
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader !== `Bearer ${ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  // multipart/form-data をパース
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ error: "file field is required" }, 400);
  }

  const ext = ALLOWED_MIME[file.type];
  if (!ext) {
    return json({ error: "Unsupported file type. Use JPEG, PNG or GIF." }, 415);
  }

  // LINE の制限: 元画像 10MB 以下
  if (file.size > 10 * 1024 * 1024) {
    return json({ error: "File too large. Max 10MB." }, 413);
  }

  // ユニークなファイル名を生成
  const fileName = `${FOLDER}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return json({ error: "Upload failed", detail: uploadError.message }, 500);
  }

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(fileName);

  return json({ url: urlData.publicUrl });
});

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
