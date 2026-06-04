# 並行世界（シャドウ環境）— 引き継ぎ / 次回再開ガイド

最終更新: 2026-06-04 / ブランチ: `feat/ai-generate`

LINE接客支援ツールの「並行世界」= 本番の実会話を1回スナップショットした **shadow_ テーブル**上で、
実LINEに一切影響させずに **タグ推定・返信生成・採点・学習** を回し、品質を磨く環境。

## いまどこまで出来たか（すべて稼働確認済み・実LINE無影響）
会話表示（ノイズ除外）→ AI分析（要約＋タグ）→ 人がタグ確定 → AI生成（templates＋承認例）
→ モック送信 → 採点/承認/却下＋正解返信 → `match_examples` 還流（磨くほど良くなる）

- 公開URL（プレビュー・要ログイン）:
  `https://line-1dayrespons-git-feat-ai-generate-hgunji-dots-projects.vercel.app`
- Vercel: 既存プロジェクト line-1dayrespons / Root Directory=`web` / env5つ登録済（下記）

## 設計の要点（詳細は git log と各ファイル冒頭コメント）
- 取得: `pg_trgm` の `match_templates`（タグOR＋title類似・N可変）/ `match_examples`（shadow_feedback の承認例）
- 生成: Claude Haiku 4.5 既定（`web/lib/llm/provider.ts`・差替可・maskPIIの口）。店ペルソナ＋創作禁止/断定回避（`web/lib/prompt.ts`）
- タグ: 固定マスタ `tags` からのみ選ぶ（自由記述禁止）。AI推定→人が確定→`shadow_analysis`
- 学習: `shadow_feedback`（approved→sent / rejected→corrected_reply が正解例）→ match_examples 還流
- 認証: middleware の共有パスワード（`APP_PASSWORD` / cookie は `AUTH_SECRET`）

## 次回クローン後に再開する手順
1. このブランチを取得: `git fetch && git switch feat/ai-generate`
2. `cd web && npm install`
3. `web/.env.local` を作成（gitignore。値は本番Supabase/Anthropic/任意のパスワード）:
   ```
   SUPABASE_URL=https://tqrrleghrlxattqnskxs.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=（service_roleキー）
   ANTHROPIC_API_KEY=（sk-ant-...）
   APP_PASSWORD=dev1234
   AUTH_SECRET=（ランダムな長い文字列）
   ```
4. `npm run dev` → http://localhost:3000 → APP_PASSWORD でログイン
5. SQL は本番 Supabase に **適用済み**（再実行不要・冪等）。再構築が要るなら順に流す:
   `sql/init.sql`（§1-11）→ `sql/match_functions.sql` → `sql/shadow.sql`
   - shadow_messages は `INSERT...SELECT` の1回スナップショット（messagesから複製）

## 重要な未決事項（次回ここから）
- **2系統の統合**: `main` には別系統の web 実装あり＝**本番接続版（実send-reply=実LINE送信あり / lib/backend.ts・reply-console.tsx）**。
  当ブランチは**並行世界版（shadow・モック送信・安全）**。page.tsx 等で確実にコンフリクト。
  どちらをベースに一本化するか要・設計判断（グリル推奨）。
- PR 未作成（feat/ai-generate）。PR前にコードレビュー＋セキュリティ監査をエージェントで。
- 残: タグ正解率の可視化（estimated_tags vs 確定tags）/ N最適化（per-tag枠）/ messages等のRLS未設定 / ノイズ判定の精緻化（現状スタッフ名の部分一致）。

## 安全制約（厳守）
- 実LINEに影響させない（dev/並行世界では send-reply を実送信で叩かない。送信はモック）
- LINEデータ取込は1回スナップショットのみ（継続同期しない）
