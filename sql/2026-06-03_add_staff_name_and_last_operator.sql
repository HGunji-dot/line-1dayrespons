-- 2026-06-03 適用済みマイグレーション（本番 project: tqrrleghrlxattqnskxs）
-- 目的: 未返信アラートに「担当者（前回返信したスタッフ）」を表示するための土台。
--
-- 注意: get_unreplied_users は戻り値（RETURNS TABLE）に列を追加するため、
--       CREATE OR REPLACE では「cannot change return type」エラーになる。
--       既存DBに適用する場合は下記のとおり DROP してから再作成すること。
--       （sql/init.sql は新規構築用。既存DBへはこのファイルを使う。）

-- 1) messages に担当者列を追加（outbound のみ設定。inbound は NULL）
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS staff_name TEXT;

-- 2) get_unreplied_users に last_operator（前回返信したスタッフ）を追加
DROP FUNCTION IF EXISTS public.get_unreplied_users(timestamptz, integer);

CREATE FUNCTION public.get_unreplied_users(
    threshold_time   TIMESTAMPTZ,
    re_notify_hours  INTEGER DEFAULT 24
)
RETURNS TABLE (
    user_id            TEXT,
    display_name       TEXT,
    unreplied_count    BIGINT,
    oldest_received_at TIMESTAMPTZ,
    oldest_text        TEXT,
    is_first_notify    BOOLEAN,
    last_operator      TEXT   -- 前回返信したスタッフ名。一度も返信がなければ NULL
)
LANGUAGE sql
STABLE
AS $func$
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
        (nl.user_id IS NULL)                                    AS is_first_notify,
        (
            SELECT mo.staff_name
            FROM messages mo
            WHERE mo.user_id    = m.user_id
              AND mo.direction  = 'outbound'
              AND mo.staff_name IS NOT NULL
            ORDER BY mo.received_at DESC
            LIMIT 1
        )                                                       AS last_operator
    FROM messages m
    LEFT JOIN notification_log nl ON nl.user_id = m.user_id
    WHERE m.direction   = 'inbound'
      AND m.replied     = FALSE
      AND m.received_at < threshold_time
      AND (
          nl.user_id IS NULL
          OR nl.last_notified_at < NOW() - (re_notify_hours || ' hours')::INTERVAL
      )
    GROUP BY m.user_id, nl.user_id
    ORDER BY MIN(m.received_at) ASC;
$func$;
