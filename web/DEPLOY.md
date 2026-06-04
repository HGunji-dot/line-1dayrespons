# デプロイ手順（Vercel・並行世界 web）

この `web/`（Next.js）を Vercel に載せ、共有パスワードで保護した状態で公開する手順。
**実LINEには影響しません**（送信はモック／表示はシャドウ `shadow_messages` のみ）。

## 前提
- GitHub リポジトリ：`HGunji-dot/line-1dayrespons`
- デプロイ対象ブランチ：`feat/ai-generate`（または main にマージ後 main）
- 本番 Supabase に `shadow_messages` と `match_templates`/`match_examples` が作成済みであること
  （`sql/shadow.sql` と `sql/match_functions.sql` を SQL Editor で実行）

## 1. Vercel プロジェクト作成
1. https://vercel.com にログイン → **Add New… → Project**
2. `HGunji-dot/line-1dayrespons` を Import
3. **Root Directory** を `web` に設定（重要：リポジトリ直下ではなく web/）
4. Framework は **Next.js** が自動検出される
5. Production Branch を `feat/ai-generate`（または main）に設定

## 2. 環境変数（Settings → Environment Variables）
すべて **Server 用**（`NEXT_PUBLIC_` は付けない）。`web/.env.example` と同じキー。

| キー | 値 | 備考 |
|---|---|---|
| `SUPABASE_URL` | `https://tqrrleghrlxattqnskxs.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー | RLSバイパス。秘匿 |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | 生成用 |
| `APP_PASSWORD` | チームで決める共有パスワード | ログインで入力する値 |
| `AUTH_SECRET` | ランダムな長い文字列 | cookie用。推測不能に |
| `ANTHROPIC_MODEL` | （任意）`claude-haiku-4-5-20251001` | 既定変更時のみ |
| `GENERATE_TEMPLATE_N` / `GENERATE_EXAMPLE_N` | （任意）`6` / `4` | 取得件数の既定 |

> `AUTH_SECRET` は例えば `openssl rand -hex 32` 相当のランダム値を推奨。

## 3. デプロイ
- **Deploy** を押す。ビルド完了後、発行URL（例 `https://....vercel.app`）にアクセス。
- 共有パスワード（`APP_PASSWORD`）でログイン → 会話一覧が表示されれば成功。

## 4. 確認チェックリスト
- [ ] `/login` でパスワードを入れるとトップに入れる
- [ ] 会話一覧にシャドウの実会話が出る（`/api/conversations` 200）
- [ ] 送信ボタンは「送信（モック）」のまま＝実LINEに飛ばない

## メモ
- 認証は共有パスワード1枚（middleware）。個人アカウントが要る段階で Supabase Auth に差し替え。
- データ更新は `shadow.sql` の再実行で追加取込（冪等）。継続同期はしない方針。
