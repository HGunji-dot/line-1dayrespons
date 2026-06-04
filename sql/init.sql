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
