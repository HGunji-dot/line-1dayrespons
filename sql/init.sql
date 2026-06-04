-- LINE未返信通知システム: テーブル・関数定義

-- ─────────────────────────────────────────────
-- 1. messages テーブル
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    display_name    TEXT,
    message_id      TEXT        UNIQUE NOT NULL,
    text            TEXT,
    direction       TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    replied         BOOLEAN     NOT NULL DEFAULT FALSE,
    replied_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_unreplied
    ON messages (received_at)
    WHERE direction = 'inbound' AND replied = FALSE;

CREATE INDEX IF NOT EXISTS idx_messages_user_id
    ON messages (user_id, received_at DESC);

-- ─────────────────────────────────────────────
-- 2. notification_log テーブル
--    ユーザーごとに「最後に通知した日時」を記録する。
--    replied になったら削除し、次の未返信で最初からカウントし直す。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
    user_id         TEXT        PRIMARY KEY,
    first_notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 最初の通知日時
    last_notified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- 最後の通知日時
    notified_count  INTEGER     NOT NULL DEFAULT 1         -- 通知回数
);

-- ─────────────────────────────────────────────
-- 3. get_unreplied_users 関数
--    以下の条件を満たすユーザーだけを返す:
--      A) 24時間以上前の未返信 inbound がある
--      B) かつ「まだ一度も通知していない」
--         または「前回通知から re_notify_hours 時間以上経過した」
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_unreplied_users(
    threshold_time   TIMESTAMPTZ,   -- now() - 24h
    re_notify_hours  INTEGER DEFAULT 24
)
RETURNS TABLE (
    user_id            TEXT,
    display_name       TEXT,
    unreplied_count    BIGINT,
    oldest_received_at TIMESTAMPTZ,
    oldest_text        TEXT,
    is_first_notify    BOOLEAN   -- true: 初回通知 / false: 再通知
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        m.user_id,
        MAX(m.display_name)                                     AS display_name,
        COUNT(*)                                                AS unreplied_count,
        MIN(m.received_at)                                      AS oldest_received_at,
        MIN(m.text) FILTER (
            WHERE m.received_at = (
                SELECT MIN(m2.received_at)
                FROM messages m2
                WHERE m2.user_id    = m.user_id
                  AND m2.direction  = 'inbound'
                  AND m2.replied    = FALSE
                  AND m2.received_at < threshold_time
            )
        )                                                       AS oldest_text,
        (nl.user_id IS NULL)                                    AS is_first_notify
    FROM messages m
    LEFT JOIN notification_log nl ON nl.user_id = m.user_id
    WHERE m.direction   = 'inbound'
      AND m.replied     = FALSE
      AND m.received_at < threshold_time
      -- 通知条件: 未通知 OR 前回通知から re_notify_hours 時間以上経過
      AND (
          nl.user_id IS NULL
          OR nl.last_notified_at < NOW() - (re_notify_hours || ' hours')::INTERVAL
      )
    GROUP BY m.user_id, nl.user_id
    ORDER BY MIN(m.received_at) ASC;  -- 最も古い未返信を持つユーザーが先頭
$$;

-- ─────────────────────────────────────────────
-- 4. record_notification 関数
--    通知送信後に呼び出し、notification_log を更新する。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_notification(target_user_id TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO notification_log (user_id, first_notified_at, last_notified_at, notified_count)
    VALUES (target_user_id, NOW(), NOW(), 1)
    ON CONFLICT (user_id) DO UPDATE
        SET last_notified_at = NOW(),
            notified_count   = notification_log.notified_count + 1;
$$;

-- ─────────────────────────────────────────────
-- 5. mark_user_replied 関数
--    管理者返信時に inbound を replied=true にし、
--    notification_log も削除して次の未返信でゼロから再カウントする。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mark_user_replied(target_user_id TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE messages
    SET replied    = TRUE,
        replied_at = NOW()
    WHERE user_id   = target_user_id
      AND direction = 'inbound'
      AND replied   = FALSE;

    DELETE FROM notification_log
    WHERE user_id = target_user_id;
$$;

-- ─────────────────────────────────────────────
-- 6. admin_notes テーブル
--    管理者がお客様ごとにつける社内メモ。
--    返信済みになっても削除しない（次回以降も参照できる）。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_notes (
    user_id    TEXT        PRIMARY KEY,
    note       TEXT        NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 7. upsert_admin_note 関数
--    メモの作成・更新を1操作で行う。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_admin_note(
    target_user_id TEXT,
    new_note       TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO admin_notes (user_id, note, updated_at)
    VALUES (target_user_id, new_note, NOW())
    ON CONFLICT (user_id) DO UPDATE
        SET note       = EXCLUDED.note,
            updated_at = NOW();
$$;

-- ═════════════════════════════════════════════
-- AI学習 / データ収集（フェーズB〜C）
--   - tags           : 固定タグマスタ（toiawaseqa.xlsx の11シート名）
--   - templates      : タグ→返信例（Q&A）。RAG/生成の種
--   - reply_feedback : AI下書き↔実送信文。承認済みが学習の正解例になる
-- ═════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 8. tags テーブル（固定タグマスタ）
--    AI は自由記述せず、この語彙の中から確信度付きで選ぶ。
--    新タグは管理者が追加する（表揺れ防止＝結合キーの安定）。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
    label      TEXT        PRIMARY KEY,         -- 例: 枯れ、芽吹かない / 在庫確認・入荷連絡
    sort_order INTEGER     NOT NULL DEFAULT 0,  -- 一覧表示順（インポート時の出現順）
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 9. templates テーブル（タグ→返信例。Q&A対）
--    id は決定的ハッシュ（tag_label|title）にし、再インポートで
--    重複せず更新されるようにする（冪等な取り込み）。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
    id         TEXT        PRIMARY KEY,                 -- sha1(tag_label || '|' || title) の先頭16桁
    tag_label  TEXT        NOT NULL REFERENCES tags(label),
    title      TEXT        NOT NULL,                    -- =Q列（問い合わせ内容）
    body       TEXT        NOT NULL,                    -- =A列（返信文）
    images     TEXT[],                                  -- 任意（mock互換のため列だけ用意）
    source     TEXT,                                    -- 取り込み元（例: toiawaseqa.xlsx）
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_tag
    ON templates (tag_label);

-- ─────────────────────────────────────────────
-- 10. reply_feedback テーブル（学習フィードバック）
--    送信のたびに「AI下書き(generated) ↔ 実送信文(sent)」を記録する。
--    人が approved にしたものだけが、フェーズCで生成の正解例になる。
--    （web/lib/feedback-data.ts の ReplyFeedback に対応）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_feedback (
    id           BIGSERIAL   PRIMARY KEY,
    user_id      TEXT        NOT NULL,
    display_name TEXT,
    tags         TEXT[]      NOT NULL DEFAULT '{}',     -- 人が確定したタグ
    inbound_text TEXT,                                  -- きっかけになった顧客メッセージ
    generated    TEXT        NOT NULL DEFAULT '',       -- AIの下書き（無AI期は空）
    sent         TEXT        NOT NULL,                  -- 実際に送った文
    status       TEXT        NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reply_feedback_status
    ON reply_feedback (status, created_at DESC);

-- ═════════════════════════════════════════════
-- 11. AI生成のための取得（リトリーバル）  ※フェーズC v1
--    方針（メモリ line-1dayrespons-backend-plan）:
--      - タグは「人が確定した入力」前提（タグ推定はこの段では行わない）
--      - 複数タグは OR（和集合）で対象を絞る
--      - 1タグに約100件の Q&A があるため、タグ内は
--        「顧客メッセージ ↔ title の語彙類似」で上位 N 件に絞る
--      - 類似は pg_trgm（similarity）で代用。pgvector は後追い。
--    呼び出しは web/ の Route Handler から supabase.rpc() で行う。
-- ═════════════════════════════════════════════

-- title / inbound_text の trigram 類似検索を有効化
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- title への GIN(trgm) インデックス（類似検索の高速化）
CREATE INDEX IF NOT EXISTS idx_templates_title_trgm
    ON templates USING gin (title gin_trgm_ops);

-- ─────────────────────────────────────────────
-- match_templates: タグOR で templates を絞り、顧客メッセージ(inbound)に
--   title が近い順で上位 limit_n 件を返す。
--   inbound が空でも動くよう、同点・無類似時は updated_at 新しい順で補う。
--   N は引数で可変（最適解の模索のため。アプリ再デプロイ不要で試せる）。
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- match_examples: approved な reply_feedback（人が承認/添削した実例）から、
--   タグが重なり かつ inbound_text が近い順で上位 limit_n 件を返す。
--   承認済み実例は「最も価値の高い学習信号」＝生成の正解例として優先する。
--   収集初期は0件になり得る（その場合は templates のみで生成）。
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
        f.sent,
        f.tags,
        similarity(COALESCE(f.inbound_text, ''), COALESCE(inbound, '')) AS similarity
    FROM reply_feedback f
    WHERE f.status = 'approved'
      AND f.tags && tag_labels          -- 配列の重なり（OR）
    ORDER BY similarity DESC, f.approved_at DESC NULLS LAST
    LIMIT GREATEST(limit_n, 0)
$$;
