-- ═════════════════════════════════════════════
-- AI生成のための取得関数（pg_trgm）  ※sql/init.sql のセクション11と同内容
-- 本番 Supabase の SQL Editor にこのファイルをそのまま貼って実行する。
-- 冪等（CREATE EXTENSION IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE FUNCTION）なので、何度流しても安全。
-- ═════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_templates_title_trgm
    ON templates USING gin (title gin_trgm_ops);

CREATE OR REPLACE FUNCTION match_templates(
    inbound    TEXT,
    tag_labels TEXT[],
    limit_n    INT DEFAULT 6
)
RETURNS TABLE (
    id         TEXT,
    tag_label  TEXT,
    title      TEXT,
    body       TEXT,
    similarity REAL
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        t.id,
        t.tag_label,
        t.title,
        t.body,
        similarity(t.title, COALESCE(inbound, '')) AS similarity
    FROM templates t
    WHERE t.tag_label = ANY(tag_labels)
    ORDER BY similarity DESC, t.updated_at DESC
    LIMIT GREATEST(limit_n, 0)
$$;

CREATE OR REPLACE FUNCTION match_examples(
    inbound    TEXT,
    tag_labels TEXT[],
    limit_n    INT DEFAULT 4
)
RETURNS TABLE (
    id           BIGINT,
    inbound_text TEXT,
    sent         TEXT,
    tags         TEXT[],
    similarity   REAL
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        f.id,
        f.inbound_text,
        f.sent,
        f.tags,
        similarity(COALESCE(f.inbound_text, ''), COALESCE(inbound, '')) AS similarity
    FROM reply_feedback f
    WHERE f.status = 'approved'
      AND f.tags && tag_labels
    ORDER BY similarity DESC, f.approved_at DESC NULLS LAST
    LIMIT GREATEST(limit_n, 0)
$$;

-- 動作確認の例（タグは本番の tags.label に合わせて変更）:
-- SELECT * FROM match_templates('葉が枯れてきた どうすれば', ARRAY['枯れ保証'], 6);
-- SELECT * FROM match_examples('葉が枯れてきた どうすれば', ARRAY['枯れ保証'], 4);
