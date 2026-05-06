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
| GitHub Actions（毎朝 8:00 JST） | `scripts/check_unreplied.py` で未返信を検知し管理者へ通知 |

## 前提

- Supabase プロジェクト
- LINE Developers の **Messaging API** チャネル（チャネルシークレット・アクセストークン）
- GitHub リポジトリ（Actions 用）

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
   | `LINE_CHANNEL_ACCESS_TOKEN` | プロフィール取得・Push（両 Function） |
   | `ADMIN_SECRET` | `send-reply` の `Authorization: Bearer ...` との照合 |

   **CLI の認証（どちらか一方）**

   - ターミナルで `npx supabase@latest login`（ブラウザでログイン）  
   - または [Account Access Tokens](https://supabase.com/dashboard/account/tokens) で **`sbp_` で始まるトークン**を発行し、環境変数 `SUPABASE_ACCESS_TOKEN` に設定（**service_role の JWT は使えない**）

   **コマンド例**（`<project-ref>` は Project URL の `https://<project-ref>.supabase.co` の部分）

   ```bash
   cd line-1dayrespons

   npx supabase@latest secrets set --project-ref <project-ref> \
     LINE_CHANNEL_SECRET=<チャネルシークレット> \
     LINE_CHANNEL_ACCESS_TOKEN=<チャネルアクセストークン> \
     ADMIN_SECRET=<send-reply 用の長いランダム文字列>

   npx supabase@latest functions deploy webhook-receiver --project-ref <project-ref>
   npx supabase@latest functions deploy send-reply --project-ref <project-ref>
   ```

3. **LINE Webhook**  
   Messaging API の Webhook URL を `webhook-receiver` の URL に設定する。  
   既に L-Step など別サービスが Webhook を使っている場合は **URL は1つだけ** のため、併用の可否を確認すること。

4. **GitHub Actions**  
   既定では **毎日 08:00（JST）** にワークフローが動く（cron は UTC の `0 23 * * *`）。  
   **日曜・日本の祝日**はスクリプトが即終了し通知しない。連休後は **休み明け最初の平日・非祝日の朝** に、DB の状態を踏まえて通常どおり一括チェックする。

   Repository の Secrets に以下を登録する。

   | Secret | 説明 |
   |--------|------|
   | `SUPABASE_URL` | プロジェクト URL |
   | `SUPABASE_KEY` | **service_role**（秘密鍵。クライアントに載せない） |
   | `LINE_CHANNEL_ACCESS_TOKEN` | 定期チェックから Push する際に使用 |
   | `ADMIN_NOTIFY_USER_IDS` | 通知先の LINE ユーザーID（`U...`）。複数はカンマ区切り |

   任意: Repository Variables で `UNREPLIED_HOURS` / `RE_NOTIFY_HOURS` を上書き可能（ワークフロー参照）。

   **テスト送信（例外）**  
   Actions の **Run workflow** で **`force_report_test`** にチェックを入れて実行すると、`FORCE_REPORT_TEST` が有効になります。  
   - 日曜・祝日でもスキップしない  
   - 未返信対象が **0件** でも、現行と同じ体裁のヘッダでテスト用 LINE を 1 通送る（`notification_log` は更新しない）  
   - 対象があるときは通常どおり送り、`【テスト送信】` を先頭に付ける  

   ローカルでは `FORCE_REPORT_TEST=true` を付けて `python scripts/check_unreplied.py` でも同様。

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
