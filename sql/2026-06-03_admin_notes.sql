-- admin_notes: お客様ごとの社内メモ（本番 project tqrrleghrlxattqnskxs に既存・リポジトリ未収録だったものを追補）
--
-- 参照元:
--   - Edge Function `save-note`     … upsert_admin_note(target_user_id, new_note) を呼ぶ
--   - Edge Function `get-unreplied` … admin_notes から (user_id, note) を select して一覧に結合
--
-- メモは返信済みになっても消えず、次回以降も参照できる（messages とは独立）。
-- 冪等（再実行しても安全）。

CREATE TABLE IF NOT EXISTS public.admin_notes (
    user_id     TEXT        PRIMARY KEY,
    note        TEXT        NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- メモの upsert（save-note が呼ぶ）。空文字なら実質クリア。
CREATE OR REPLACE FUNCTION public.upsert_admin_note(
    target_user_id TEXT,
    new_note       TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO public.admin_notes (user_id, note, updated_at)
    VALUES (target_user_id, COALESCE(new_note, ''), NOW())
    ON CONFLICT (user_id) DO UPDATE
        SET note       = EXCLUDED.note,
            updated_at = NOW();
$$;
