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
