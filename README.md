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
   | `RICHMENU_KEYWORDS` | （任意）リッチメニューのタップで送られる定型キーワード。複数はカンマ区切り。一致した受信メッセージは `replied=true` で保存し、未返信アラートから除外する。未設定なら従来どおり全件をアラート対象にする。詳細は「リッチメニューとの併用」を参照 |

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

## リッチメニュー（外部ツール）との併用

### 前提となる制約

**LINE の Webhook URL はチャネルに 1 つしか登録できない。** このプロジェクトのリッチメニュー／キーワード自動応答は **外部ツール（L-Step / エルメ(L Message) / L ステップ 等）** が Webhook を受け取って動いている。一方、本システムの未返信通知は `webhook-receiver`（Supabase）が Webhook を受け取る必要がある。

そのため、Webhook URL を `webhook-receiver` に向けると外部ツールにイベントが届かなくなり、**リッチメニューのタップに自動応答が返らなくなる**（逆もまた然り）。

### チャネルアクセストークンの共有（重要）

L-Step などの外部ツールは **チャネルアクセストークン（長期）** を使って返信・リッチメニュー操作を行う。本システムの構築時に LINE Developers Console でこのトークンを **「再発行」すると、外部ツールが保存している旧トークンが無効化され、外部ツールが返信できなくなる**（Webhook が届いても 401 で送信失敗）。

チャネルアクセストークンは複数システムで **同じ値を共有して同時に使える**。したがって:

- **現在有効なトークン**（本システムの Supabase Secret `LINE_CHANNEL_ACCESS_TOKEN` に入っている値＝通知が実際に送れているならこれが有効）を、**外部ツール側の設定にも貼り直す**。
- 以後、どちらかの都合でトークンを **再発行したら、両方を必ず更新する**。
- チャネルシークレットは再発行で変わらないため、Webhook 署名検証・中継（署名転送）には影響しない。

### 「タップしても返事が来ない」場合の即時復旧

原因は次の 2 つが重なっていることが多い。両方を戻す。

1. **Webhook URL**: LINE Developers Console → 対象チャネル → **Messaging API 設定 → Webhook URL** を、**外部ツールの Webhook URL に戻す**。
2. **チャネルアクセストークン**: 上記「チャネルアクセストークンの共有」のとおり、外部ツール側に現行の有効なトークンを **貼り直す**。

これでリッチメニューは復活する。ただしこの状態では `webhook-receiver` にメッセージが届かないため、**未返信通知は停止する**（併用するには次の中継方式へ）。

### 両立させる方法（Webhook 中継 / fan-out）

Webhook URL は 1 つなので、受け取った 1 つの Function が **外部ツールへそのまま転送（リレー）** することで両立させる。

```
[LINE] → Webhook(1つ) → webhook-receiver
                          ├─ messages テーブルへ保存（未返信通知用）
                          └─ 生ボディ＋x-line-signature を外部ツールの Webhook URL へ転送（リッチメニュー応答用）
```

- LINE Webhook URL は **`webhook-receiver` に向ける**。
- `webhook-receiver` は環境変数 **`RELAY_WEBHOOK_URL`**（＝外部ツールの Webhook URL）が設定されていれば、**受信した生ボディと `x-line-signature` ヘッダーをそのまま** その URL へ POST する。署名は元のものを転送するので、外部ツールは同じチャネルシークレットで検証して通る。
- 加えて、リッチメニューのタップで送られる定型キーワード（例: `オススメの植木`, `樹種の相談`, `植木の調子が悪い`, `その他のお問い合わせ`）を **`RICHMENU_KEYWORDS`** に登録する。一致した受信メッセージは `replied=true` で保存され、`get_unreplied_users`（`replied=FALSE` のみ集計）から除外されるため、メニュータップが未返信アラートのノイズにならない。記録自体は残る。

> **注意（中継方式の依存関係）**: この方式では外部ツールの応答が `webhook-receiver` を経由する。`webhook-receiver` が停止すると **リッチメニュー応答と通知の両方** が止まる。可用性が重要なら、外部ツール側に Webhook 転送機能があるか（＝外部ツールを 1 次受けにして Supabase へ転送できるか）も検討する。

### 併用へのロールアウト手順

1. まず即時復旧（上記）で外部ツールに Webhook を戻し、**かつチャネルアクセストークンを貼り直して**リッチメニューを復活させる。
2. `webhook-receiver` に中継処理を入れてデプロイし、`RELAY_WEBHOOK_URL`（＝外部ツールの Webhook URL）と `RICHMENU_KEYWORDS` を設定する。
   ```bash
   npx supabase@latest secrets set --project-ref <project-ref> \
     RELAY_WEBHOOK_URL="<外部ツールの Webhook URL>" \
     RICHMENU_KEYWORDS="オススメの植木,樹種の相談,植木の調子が悪い,その他のお問い合わせ"
   npx supabase@latest functions deploy webhook-receiver --project-ref <project-ref>
   ```
3. LINE Webhook URL を `webhook-receiver` の URL に切り替える。
4. 実機でリッチメニューをタップし、**自動応答が返ること**＋ **`messages` に該当キーワードが `replied=true` で入ること** を確認する。
5. （任意・推奨）フィルタ導入前に溜まったメニュータップ分を一括で除外する。
   ```sql
   UPDATE messages
   SET replied = TRUE, replied_at = NOW()
   WHERE direction = 'inbound'
     AND replied = FALSE
     AND text = ANY (ARRAY['オススメの植木','樹種の相談','植木の調子が悪い','その他のお問い合わせ']);
   ```
6. 確認できたら、一時停止していた cron-job.org のジョブを再開する。

> **中継が外部ツールに受理されるか先に検証する**: L-Step などは Webhook の `x-line-signature`（チャネルシークレットによる署名）で検証するため、生ボディと署名をそのまま転送すれば通る想定。ただし送信元 IP 等を追加検証する実装だと、Supabase 経由の転送を弾く可能性がある。手順4のテストタップで **L-Step 側が確実に応答する**ことを必ず確認してから本番運用に移す。弾かれる場合は中継方式が使えないため、別途相談すること。

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
