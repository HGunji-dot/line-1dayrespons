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
