-- ─────────────────────────────────────────────────────────────────────────────
-- 活用フェーズ スキーマ（担当者付き返信の実運用＋AI学習の土台）
--   2026-06-03 grill-me 合意の設計に基づく。冪等（再実行しても安全）。
--   適用は Supabase SQL Editor で実行する想定（RLS は書かない＝サーバー仲介で service_role 利用）。
--
-- 関連設計メモ:
--   - 担当者特定 … Supabase Auth で各自ログイン → operator = staff.display_name
--   - reply_events … 活用初日から「顧客→スタッフ返信」を学習用に記録（ai_draft は当面 NULL）
--   - conversation_state … 「対応中: ○○」ソフト表示＋送信時ガードの土台
--   - master_reviews … マスターがスタッフ返信を却下→再構築した育成データ（却下のみ記録）
-- ─────────────────────────────────────────────────────────────────────────────

-- gen_random_uuid() のため（Supabase は既定で有効。念のため）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────
-- 1. staff … スタッフ（auth.users と表示名・権限を紐付け）
--    role='master' は育成評価(/coaching)権限を持つ1人。退職は active=false。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID        UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
    display_name TEXT        NOT NULL,                 -- 通知/担当者表示に使う名前（例: 酢崎）
    role         TEXT        NOT NULL DEFAULT 'staff'
                 CHECK (role IN ('staff', 'master')),
    active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_auth_user_id ON public.staff (auth_user_id);

-- ─────────────────────────────────────────────
-- 2. reply_events … 送信した返信を学習用に1件=1レコードで記録
--    コアは正規化カラム、揺れやすい AI メタは ai_meta(jsonb) に寄せて拡張する。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reply_events (
    id             BIGSERIAL   PRIMARY KEY,
    user_id        TEXT        NOT NULL,               -- 返信先の LINE ユーザー
    inbound_context JSONB      NOT NULL DEFAULT '{}',  -- 返信対象 inbound（message_id 配列＋本文スナップショット）
    sent_text      TEXT        NOT NULL DEFAULT '',    -- 実際に送ったテキスト
    image_urls     JSONB       NOT NULL DEFAULT '[]',  -- 送った画像 URL（あれば）
    staff_id       UUID        REFERENCES public.staff (id) ON DELETE SET NULL,  -- 送ったスタッフ
    ai_draft       TEXT,                               -- AI下書き（AI実装後に投入。今は NULL）
    edit_rate      INTEGER,                            -- ai_draft ↔ sent_text の編集率%（ai_draft がある時のみ）
    ai_meta        JSONB       NOT NULL DEFAULT '{}',  -- タグ/緊急度/モデル名/確信度など（スキーマ変更なしで拡張）
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_events_staff   ON public.reply_events (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_events_user    ON public.reply_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reply_events_created ON public.reply_events (created_at DESC);

-- ─────────────────────────────────────────────
-- 3. conversation_state … 会話ごとの「対応中」状態（二重対応のソフト表示）
--    handling_at が古ければ（数分無操作）UI 側で失効扱いにする＝ハードロックしない。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_state (
    user_id         TEXT        PRIMARY KEY,           -- 会話 = LINE ユーザー単位
    handling_by     UUID        REFERENCES public.staff (id) ON DELETE SET NULL,
    handling_by_name TEXT,                             -- 表示用（JOIN を避けるための非正規化）
    handling_at     TIMESTAMPTZ,                       -- 最後にハートビートした時刻
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 4. master_reviews … マスターがスタッフ返信を却下→再構築した育成レコード
--    却下のみ記録（承認=0% は記録しない）。本文スナップショットを保持し差分を安定化。
--    集計はマスター専用ビュー(/coaching)でのみ使用。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.master_reviews (
    id                BIGSERIAL   PRIMARY KEY,
    reply_event_id    BIGINT      REFERENCES public.reply_events (id) ON DELETE SET NULL,
    reviewed_staff_id UUID        REFERENCES public.staff (id) ON DELETE SET NULL,  -- 直された人
    reviewer_staff_id UUID        REFERENCES public.staff (id) ON DELETE SET NULL,  -- マスター
    original_text     TEXT        NOT NULL,            -- 却下対象＝スタッフ送信文のスナップショット
    rebuilt_text      TEXT        NOT NULL,            -- マスター再構築文（顧客には送らない理想解）
    edit_rate         INTEGER     NOT NULL,            -- editRatePct(original, rebuilt)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_reviews_reviewed ON public.master_reviews (reviewed_staff_id, created_at DESC);

-- 注: reply_feedback（AI下書き vs 送信文の精度評価）は AI フェーズまで延期。
--     受け皿として reply_events.ai_draft / edit_rate / ai_meta を先行して用意済み。
