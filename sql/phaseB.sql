-- ─────────────────────────────────────────────
-- フェーズB マイグレーション
--   Web 返信管理画面を Supabase に実接続するための追加スキーマ。
--   sql/init.sql を適用済みの DB に対して、Supabase SQL Editor で実行する。
--   （何度実行しても安全な冪等スクリプト）
-- ─────────────────────────────────────────────

-- 1. messages に「誰が送ったか（対応者）」を記録する列を追加
--    inbound は NULL、outbound はスタッフ名が入る。
ALTER TABLE messages ADD COLUMN IF NOT EXISTS operator TEXT;

-- ─────────────────────────────────────────────
-- 2. conversation_state テーブル
--    会話（user_id）単位の運用状態。
--    - handling_by : 現在対応中のスタッフ（二重対応ガード用のクレーム）
--    - archived    : 処理済みで一覧から隠す
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_state (
    user_id        TEXT        PRIMARY KEY,
    handling_by    TEXT,
    handling_since TIMESTAMPTZ,
    archived       BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. reply_feedback テーブル（学習ログ）
--    AI下書き(generated) と 送信文(sent) のペア＋文脈を保存する。
--    承認(approved)したもの、または却下(rejected)して正解を入れたものが
--    フェーズC で RAG の教師データになる。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reply_feedback (
    id              TEXT        PRIMARY KEY,
    user_id         TEXT        NOT NULL,
    display_name    TEXT,
    tags            TEXT[]      NOT NULL DEFAULT '{}',
    inbound_text    TEXT,
    generated       TEXT,
    sent            TEXT,
    operator        TEXT,
    corrected_reply TEXT,
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'rejected')),
    archived        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_feedback_created
    ON reply_feedback (created_at DESC);

-- ─────────────────────────────────────────────
-- 4. claim_conversation 関数
--    「未対応なら自分が確保、対応者ありならその人を維持」を1クエリで原子的に行う。
--    返り値は確定後の対応者（=自分が取れたか、他人が対応中かを呼び出し側が判定できる）。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_conversation(target_user_id TEXT, op TEXT)
RETURNS TABLE (handling_by TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO conversation_state (user_id, handling_by, handling_since, updated_at)
    VALUES (target_user_id, op, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
        SET handling_by    = CASE WHEN conversation_state.handling_by IS NULL
                                  THEN EXCLUDED.handling_by
                                  ELSE conversation_state.handling_by END,
            handling_since = CASE WHEN conversation_state.handling_by IS NULL
                                  THEN NOW()
                                  ELSE conversation_state.handling_since END,
            updated_at     = NOW();

    RETURN QUERY
        SELECT cs.handling_by FROM conversation_state cs WHERE cs.user_id = target_user_id;
END;
$$;

-- ─────────────────────────────────────────────
-- 5. set_archived 関数（アーカイブ/解除。行が無ければ作る）
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_archived(target_user_id TEXT, is_archived BOOLEAN)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO conversation_state (user_id, archived, updated_at)
    VALUES (target_user_id, is_archived, NOW())
    ON CONFLICT (user_id) DO UPDATE
        SET archived = EXCLUDED.archived, updated_at = NOW();
$$;

-- ─────────────────────────────────────────────
-- 6. release_conversation 関数
--    返信送信後などに対応中クレームを外す（次の人が対応できる状態に戻す）。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION release_conversation(target_user_id TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE conversation_state
    SET handling_by = NULL, handling_since = NULL, updated_at = NOW()
    WHERE user_id = target_user_id;
$$;

-- ─────────────────────────────────────────────
-- 7. Realtime 変更通知トリガー
--    messages / conversation_state / reply_feedback の変更で、
--    顧客本文を含まない最小ペイロード（userId のみ）を public チャンネル
--    'conversation-updates' に broadcast する。
--    ブラウザは anon 鍵でこの broadcast を購読し、通知が来たら
--    Next.js サーバ(API/service_role)から権威データを再取得する。
--    → 顧客メッセージ本文を anon 鍵に晒さずに複数スタッフ間で同期できる。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION notify_conversation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    uid TEXT;
BEGIN
    uid := COALESCE(NEW.user_id, OLD.user_id);
    PERFORM realtime.send(
        jsonb_build_object('userId', uid, 'source', TG_TABLE_NAME),
        'changed',
        'conversation-updates',
        false  -- public（anon 購読可。本文は載せない）
    );
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_notify ON messages;
CREATE TRIGGER trg_messages_notify
    AFTER INSERT OR UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION notify_conversation_change();

DROP TRIGGER IF EXISTS trg_convstate_notify ON conversation_state;
CREATE TRIGGER trg_convstate_notify
    AFTER INSERT OR UPDATE ON conversation_state
    FOR EACH ROW EXECUTE FUNCTION notify_conversation_change();

DROP TRIGGER IF EXISTS trg_feedback_notify ON reply_feedback;
CREATE TRIGGER trg_feedback_notify
    AFTER INSERT OR UPDATE ON reply_feedback
    FOR EACH ROW EXECUTE FUNCTION notify_conversation_change();
