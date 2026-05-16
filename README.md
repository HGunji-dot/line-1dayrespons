# LINE 未返信通知（line-1dayrespons）

未返信通知機能 — お客様からの LINE メッセージが一定時間返信されていない場合に、**Messaging API（Push / Multicast）** で管理者へアラートを送る仕組みです。

> **LINE Notify について**  
> LINE Notify は 2025年3月31日をもって提供終了しました。本リポジトリの定期チェックは **Messaging API のチャネルアクセストークン** と **管理者のユーザーID** で通知します。

## 構成

| コンポーネント | 役割 |
|----------------|------|
| Supabase（PostgreSQL） | メッセージ保存・未返信集計（RPC） |
| Edge Function `webhook-receiver` | LINE Webhook を受け取り DB に保存 |
| Edge Function `send-reply` | 管理者からの返信（Push）と `replied` 更新 |
| Edge Function `check-unreplied-notify` | 外部スケジューラーから呼ばれ未返信を検知し管理者へ通知 |
| cron-job.org（外部スケジューラー） | 平日 15:00 JST に `check-unreplied-notify` を HTTP POST で呼び出す |

## 前提

- Supabase プロジェクト
- LINE Developers の **Messaging API** チャネル（チャネルシークレット・アクセストークン）
- [cron-job.org](https://cron-job.org/) アカウント（外部スケジューラー）

## セットアップ概要

1. **DB**  
   Supabase の SQL Editor で `sql/init.sql` を実行する。

2. **Edge Functions**  
   リポジトリの `supabase/config.toml` で **`webhook-receiver` / `send-reply` は `verify_jwt = false`**（LINE Webhook と独自 Bearer は Supabase JWT を付けないため）。  
   Supabase CLI でデプロイする。

   **自動で入る環境変数（Secrets では設定しない）**

   ホスト済み Edge Function には、Supabase が **`SUPABASE_URL`** と **`SUPABASE_SERVICE_ROLE_KEY`** などを **自動注入**します。  
   そのため **`supabase secrets set` で `SUPABASE_` で始まる名前は指定できず、スキップされる**のが正常です（手動設定不要）。

   **CLI で設定する Secrets（`SUPABASE_` 以外だけ）**

   | 名前 | 用途 |
   |------|------|
   | `LINE_CHANNEL_SECRET` | Webhook 署名検証（`webhook-receiver`） |
   | `LINE_CHANNEL_ACCESS_TOKEN` | プロフィール取得・Push（各 Function） |
   | `ADMIN_SECRET` | `send-reply` の `Authorization: Bearer ...` との照合 |
   | `NOTIFY_SECRET` | `check-unreplied-notify` の Bearer 認証用（**未設定だと全リクエストが 401 になるため必須**） |
   | `ADMIN_NOTIFY_USER_IDS` | 未返信通知を受け取る管理者の LINE ユーザーID（`U...`）。複数はカンマ区切り |

   **CLI の認証（どちらか一方）**

   - ターミナルで `npx supabase@latest login`（ブラウザでログイン）  
   - または [Account Access Tokens](https://supabase.com/dashboard/account/tokens) で **`sbp_` で始まるトークン**を発行し、環境変数 `SUPABASE_ACCESS_TOKEN` に設定（**service_role の JWT は使えない**）

   **コマンド例**（`<project-ref>` は Project URL の `https://<project-ref>.supabase.co` の部分）

   ```bash
   cd line-1dayrespons

   npx supabase@latest secrets set --project-ref <project-ref> \
     LINE_CHANNEL_SECRET=<チャネルシークレット> \
     LINE_CHANNEL_ACCESS_TOKEN=<チャネルアクセストークン> \
     ADMIN_SECRET=<send-reply 用の長いランダム文字列> \
     NOTIFY_SECRET=<check-unreplied-notify 用の長いランダム文字列> \
     ADMIN_NOTIFY_USER_IDS=<管理者の LINE ユーザーID（複数はカンマ区切り）>

   npx supabase@latest functions deploy webhook-receiver --project-ref <project-ref>
   npx supabase@latest functions deploy send-reply --project-ref <project-ref>
   npx supabase@latest functions deploy check-unreplied-notify --project-ref <project-ref>
   ```

3. **cron-job.org（外部スケジューラー）の設定**

   [cron-job.org](https://cron-job.org/) にログインし、新規ジョブを以下の内容で作成する。

   | 項目 | 設定値 |
   |------|--------|
   | URL | `https://<project-ref>.supabase.co/functions/v1/check-unreplied-notify` |
   | Method | POST |
   | Header | `Authorization: Bearer <NOTIFY_SECRET の値>` |
   | Schedule | 月〜金 06:00 UTC（= 15:00 JST）|

   > **注意**: `NOTIFY_SECRET` を Supabase Secrets に設定した値と**完全一致**させること。  
   > 異なる場合は 401 Unauthorized となり通知されない。

   **テスト送信**（設定確認用）  
   ボディに `{"force_test": true}` を付けて手動実行すると、日曜・祝日でも強制送信される（`notification_log` は更新しない）。

4. **LINE Webhook**  
   Messaging API の Webhook URL を `webhook-receiver` の URL に設定する。  
   既に L-Step など別サービスが Webhook を使っている場合は **URL は1つだけ** のため、併用の可否を確認すること。

## 管理者のユーザーID（`ADMIN_NOTIFY_USER_IDS`）

管理者が **公式アカウントを友だち追加**し、ボットにメッセージを送る。  
Supabase の `messages` テーブルに記録される `user_id`（`U` で始まる文字列）をそのまま設定する。  
Push は友だち追加済みのユーザーにのみ届く。

## ローカルでのスクリプト実行（任意）

`.env.example` を `.env` にコピーして値を埋め、環境変数を読み込んだうえで実行する。

```bash
pip install -r requirements.txt
python scripts/check_unreplied.py
```

必要な変数: `SUPABASE_URL`, `SUPABASE_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `ADMIN_NOTIFY_USER_IDS`（ほか任意）。

## ライセンス

用途に合わせてリポジトリ管理者が定義してください。
