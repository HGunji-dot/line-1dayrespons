-- ═════════════════════════════════════════════
-- 並行世界（シャドウ環境）  ※フェーズC
--   本番 messages を「1回スナップショット」して shadow_messages に複製する。
--   以降の表示・実験（再タグ付け・生成・採点）はすべてシャドウ側に対して行い、
--   本番テーブルと実LINEには一切影響させない。
--
--   本番 Supabase の SQL Editor にこのファイルを貼って実行する。
--   冪等（IF NOT EXISTS / ON CONFLICT DO NOTHING）なので再実行しても安全＝
--   「取り込みは1回でよい」を満たしつつ、誤って2回流しても重複しない。
-- ═════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- shadow_messages: 本番 messages のミラー（+ snapshot_at）
--   id は本番 messages.id をそのまま主キーに使い、重複取込を防ぐ。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shadow_messages (
    id           BIGINT      PRIMARY KEY,   -- 本番 messages.id をそのまま保持
    user_id      TEXT        NOT NULL,
    display_name TEXT,
    message_id   TEXT,
    text         TEXT,
    direction    TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    received_at  TIMESTAMPTZ NOT NULL,
    replied      BOOLEAN     NOT NULL DEFAULT FALSE,
    replied_at   TIMESTAMPTZ,
    snapshot_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- いつ取り込んだか
);

CREATE INDEX IF NOT EXISTS idx_shadow_messages_user
    ON shadow_messages (user_id, received_at);

-- ─────────────────────────────────────────────
-- 1回スナップショット: messages → shadow_messages
--   ON CONFLICT DO NOTHING で、既に取り込んだ行は触らない（冪等）。
--   ※本番 messages は読むだけ。書き換えない。
-- ─────────────────────────────────────────────
INSERT INTO shadow_messages
    (id, user_id, display_name, message_id, text, direction, received_at, replied, replied_at)
SELECT
    id, user_id, display_name, message_id, text, direction, received_at, replied, replied_at
FROM messages
ON CONFLICT (id) DO NOTHING;

-- 取込結果の確認:
-- SELECT count(*) AS rows, count(DISTINCT user_id) AS users FROM shadow_messages;

-- ─────────────────────────────────────────────
-- shadow_analysis: 会話ごとのAI分析（フェーズ③タグ推定）
--   estimated_tags = AIが固定タグマスタから選んだ推定（確信度つき）
--   tags           = 人が確認・修正した「確定タグ」（生成・学習に使う真値）
--   confirmed      = 人がレビュー済みか（タグ正解率の指標にも使う）
--   ※ 並行世界の実験データ。本番テーブルには影響しない。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shadow_analysis (
    user_id        TEXT        PRIMARY KEY,
    estimated_tags JSONB       NOT NULL DEFAULT '[]',  -- [{label, confidence}]
    tags           JSONB       NOT NULL DEFAULT '[]',  -- 人が確定 [{label, confidence}]
    summary        TEXT,                               -- 任意（将来：要約）
    confirmed      BOOLEAN     NOT NULL DEFAULT FALSE,
    model          TEXT,                               -- 推定に使ったモデル
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- shadow_feedback: 採点・学習ループ（フェーズ④）
--   並行世界での「送信（モック）」と採点を記録する。実LINEには飛ばない。
--   承認(approved)→sent / 却下(rejected)→corrected_reply が「正解例」になり、
--   match_examples 経由で次の生成に還元される（磨くほど良くなる）。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shadow_feedback (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    display_name    TEXT,
    tags            TEXT[]      NOT NULL DEFAULT '{}',  -- 確定タグ
    inbound_text    TEXT,                               -- きっかけの顧客メッセージ
    generated       TEXT        NOT NULL DEFAULT '',    -- AIの下書き
    sent            TEXT        NOT NULL DEFAULT '',    -- 採用した最終文（モック送信）
    corrected_reply TEXT,                               -- 却下時に人が入れた正解返信
    operator        TEXT,                               -- 対応スタッフ
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
    edit_rate       INT,                                -- generated→sent の編集率%（任意）
    archived        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shadow_feedback_status
    ON shadow_feedback (status, created_at DESC);

-- ─────────────────────────────────────────────
-- match_examples を shadow_feedback 読みに切替（並行世界の学習を生成へ還元）。
--   approved → sent を、rejected＋正解あり → corrected_reply を「正解例」とする。
--   archived は除外。返り値の sent はその「正解例」テキスト。
--   ※ /api/generate はこの関数の戻り（id, inbound_text, sent, tags, similarity）に依存。
-- ─────────────────────────────────────────────
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
        CASE
            WHEN f.status = 'approved' THEN f.sent
            ELSE COALESCE(NULLIF(btrim(f.corrected_reply), ''), f.sent)
        END AS sent,
        f.tags,
        similarity(COALESCE(f.inbound_text, ''), COALESCE(inbound, '')) AS similarity
    FROM shadow_feedback f
    WHERE f.archived = FALSE
      AND f.tags && tag_labels
      AND (
            (f.status = 'approved' AND btrim(f.sent) <> '')
         OR (f.status = 'rejected' AND btrim(COALESCE(f.corrected_reply, '')) <> '')
      )
    ORDER BY similarity DESC, f.approved_at DESC NULLS LAST
    LIMIT GREATEST(limit_n, 0)
$$;
