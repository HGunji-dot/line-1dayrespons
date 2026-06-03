# 本番の構成メモ（2026-06-03 時点）

このリポジトリは一時期、本番（Supabase project `tqrrleghrlxattqnskxs` = "HGunji-dot's Project"）より遅れていた。
2026-06-03 に本番の Edge Functions をリポジトリへ同期した記録と、現状の構成・既知のギャップを残す。

## L-Step 併用（未返信通知の再開）

- LINE 公式アカウントの Webhook URL は1つだけで、本番では **L-Step** が保持する。
- L-Step の **「Webhook転送」オプション（月額5,500円・有効化済）** で、L-Step が受けた LINE 生イベントを
  当システムの `webhook-receiver` へ転送している。
  - 登録場所: L-Step 管理画面 → アカウント設定 → 外部連携設定 → 「LINE Webhook転送設定」。
  - 登録 URL: `https://tqrrleghrlxattqnskxs.supabase.co/functions/v1/webhook-receiver?k=<RELAY_SECRET>`
- `webhook-receiver` は **二段構え認証**（LINE 署名 か `?k=<RELAY_SECRET>` のどちらかで受理）。
  `RELAY_SECRET` は Supabase の Edge Function シークレットに設定済み。
- 2026-06-03 に E2E 確認済み（テスト送信が `messages` に着信）。

## 担当者（返信した人）

- `messages.staff_name`（outbound のみ）に返信したスタッフを記録する。
- `send-reply` は `staff` を受け取れば記録する（後方互換のため必須ではない）。
- `get_unreplied_users` RPC は `last_operator`（前回返信したスタッフ）を返す。
- 未返信通知 `check-unreplied-notify` は本文に `[担当: 名前]` / `[未割当]` を表示する。
- 担当者は、管理画面から担当者付きで返信が送られ始めると埋まる。

## 本番の Edge Functions（このコミットで同期済み）

| 関数 | 役割 |
|------|------|
| `webhook-receiver` | LINE / L-Step転送 の受信 → messages 保存（二段構え認証） |
| `send-reply` | 管理者返信（テキスト＋画像対応・CORS・staff 記録） |
| `get-unreplied` | 管理画面向け: 未返信ユーザー一覧＋`admin_notes` のメモを返す |
| `mark-replied` | 返信済みフラグの更新 |
| `check-unreplied-notify` | 未返信アラートの送信（cron-job.org が `NOTIFY_SECRET` で叩く。`get_unreplied_users`＋`record_notification` 使用） |
| `save-note` | 顧客メモ（`admin_notes`）の保存 |
| `upload-image` | 画像アップロード |

## 既知のギャップ / TODO

- ~~**`admin_notes` テーブルのスキーマがリポジトリ未収録**~~ → 解消（`sql/2026-06-03_admin_notes.sql` に追補。`admin_notes` ＋ `upsert_admin_note` RPC）。
- ~~**二重通知**~~ → 解消（通知は `check-unreplied-notify`（cron-job.org・日曜/祝日スキップ実装済）に一本化。`.github/workflows/check-unreplied.yml` は `schedule` をコメントアウトし手動実行のみに変更）。
- **web/ の実接続（フェーズ3）**: `web/lib/backend.ts` は messages を直読みする実装。本番の `get-unreplied` 方式と二重になりうるため整理が必要。実バックエンド接続はアクセス制御された環境でのみ有効化すること。
- DB マイグレーションの適用記録は `sql/2026-06-03_add_staff_name_and_last_operator.sql`。

## 活用フェーズのスキーマ（2026-06-03 追加・SQL Editor で要適用）

- `sql/2026-06-03_activation_schema.sql` … `staff` / `reply_events` / `conversation_state` / `master_reviews` を新設（冪等）。
  - `staff`: auth.users と表示名・権限(role: staff/master)・active を紐付け。
  - `reply_events`: 送信返信を学習用に記録（`ai_draft`/`ai_meta` は AI フェーズ用の受け皿）。
  - `conversation_state`: 「対応中」ソフト表示＋送信ガードの土台。
  - `master_reviews`: マスター育成評価（却下→再構築の差分・編集率）。
- 適用は Supabase SQL Editor（RLS は書かない＝サーバー仲介・service_role 前提）。
- 設定: 一般サインアップ無効化、スタッフを招待、1人を `role='master'` に。
