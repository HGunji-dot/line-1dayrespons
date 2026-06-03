-- ─────────────────────────────────────────────
-- フェーズC マイグレーション（AI生成・キャッシュ）
--   会話を開いた時にオンデマンドでAI分析・返信ドラフトを生成し、
--   結果を user_id 単位でキャッシュする。新しい問い合わせ（last_inbound_message_id 変化）
--   が来たときだけ再生成する（再オープンは再課金しない）。
--   sql/init.sql・sql/phaseB.sql を適用済みの DB に対して実行する。
--   （何度実行しても安全な冪等スクリプト）
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- conversation_analysis テーブル（AI生成キャッシュ）
--   - summary / urgency / tags : ③AI分析パネルの内容
--   - suggested_reply          : ④返信ドラフトの初期値
--   - similar_replies          : RAG（タグ一致の過去正解）の根拠。jsonb 配列
--   - last_inbound_message_id  : この値が最新 inbound と一致する間はキャッシュ有効
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_analysis (
    user_id                 TEXT        PRIMARY KEY,
    summary                 TEXT,
    urgency                 TEXT        NOT NULL DEFAULT 'low'
                                        CHECK (urgency IN ('high', 'medium', 'low')),
    tags                    JSONB       NOT NULL DEFAULT '[]',
    suggested_reply         TEXT,
    similar_replies         JSONB       NOT NULL DEFAULT '[]',
    last_inbound_message_id BIGINT,
    model                   TEXT,
    generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Realtime 通知トリガー（phaseB の notify_conversation_change を再利用）
--   生成結果が更新されたら 'conversation-updates' に userId を broadcast し、
--   他スタッフの画面でも分析が反映されるようにする（本文は載せない）。
-- ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_analysis_notify ON conversation_analysis;
CREATE TRIGGER trg_analysis_notify
    AFTER INSERT OR UPDATE ON conversation_analysis
    FOR EACH ROW EXECUTE FUNCTION notify_conversation_change();

-- ─────────────────────────────────────────────
-- 【将来】Voyage 埋め込みによるベクトル RAG への拡張用（任意・今は未使用）
--   Voyage AI のキーが用意できたら以下を有効化し、API 側を
--   タグ一致検索からベクトル近傍検索（match_replies）に差し替える。
-- ─────────────────────────────────────────────
-- CREATE EXTENSION IF NOT EXISTS vector;
-- CREATE TABLE IF NOT EXISTS reply_embeddings (
--     id          BIGSERIAL    PRIMARY KEY,
--     feedback_id TEXT         REFERENCES reply_feedback(id) ON DELETE CASCADE,
--     tags        TEXT[]       NOT NULL DEFAULT '{}',
--     inbound     TEXT,
--     reply       TEXT,
--     embedding   vector(1024),
--     created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
-- );
-- CREATE INDEX IF NOT EXISTS idx_reply_embeddings_vec
--     ON reply_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
