# フェーズC 設計プラン（AI生成・RAG）

> 状態: **設計確定・実装は API キー取得後に着手**
> 前提: フェーズB（Supabase 実接続）まで完了済み（`web/` + `sql/init.sql` + `sql/phaseB.sql` + Edge Functions）。

## ゴール

フェーズB でプレースホルダのままにした「AI 由来の機能」を実生成に差し替える。

- ③ AI分析パネル：要約・緊急度・ドメイン特化タグ（枯れ保証 / 入荷時期 等）
- ④ 返信ドラフト：顧客メッセージから返信案を自動生成
- RAG：承認/修正済みの過去返信（正解データ）を根拠として参照
- テンプレ提案：タグ別編集率からテンプレ改善を提案

## 確定した方針

| 項目 | 決定 |
|---|---|
| 生成タイミング | **オンデマンド**（会話を開いた時に生成 → DB キャッシュ。再オープンは再課金しない） |
| 生成モデル | 分析・タグ＝**Claude Haiku**（安価）／返信ドラフト＝**Claude Sonnet**（変更可） |
| 埋め込みモデル | **Voyage AI**（`voyage-3` 系。日本語対応。Claude に埋め込み API が無いため別選定） |
| アクセス方式 | フェーズB 同様すべて **Next.js サーバ（API Route）経由**。API キーはサーバのみ |
| フォールバック | すべて **env gated**。キー未設定なら現状のプレースホルダ動作のまま（既存を壊さない） |
| 業種コンテキスト | 植物・園芸の販売（枯れ保証・入荷時期・育て方相談 等のドメイン） |

## 必要な API キー（再開時に用意）

| キー | 取得先 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | Claude 生成（分析・ドラフト） |
| `VOYAGE_API_KEY` | https://www.voyageai.com | 埋め込み（RAG） |

いずれも `web/.env.local`（サーバ専用、`NEXT_PUBLIC_` を付けない）に設定する。

## アーキテクチャ

```
会話を開く
  └→ /api/analyze (server)
       ├─ conversation_analysis にキャッシュがあれば即返す
       └─ 無ければ生成:
            1. Voyage で inbound テキストを埋め込み
            2. match_replies() で類似の「正解返信」を上位K件取得（RAG根拠）
            3. Claude(Haiku) で要約・緊急度・タグ抽出
            4. Claude(Sonnet) で返信ドラフト生成（RAG根拠＋タグ紐づけテンプレを文脈に）
            5. 結果を conversation_analysis に保存して返す

返信を承認（学習ログ）
  └→ Voyage で正解文を埋め込み、reply_embeddings に投入（次回以降の RAG 教師データ）
```

## 実装ステップ（この順で着手）

1. **DB マイグレーション `sql/phaseC.sql`**
   - `CREATE EXTENSION IF NOT EXISTS vector;`
   - `reply_embeddings(id, feedback_id FK, tags TEXT[], reply TEXT, embedding vector(1024), created_at)`
     - Voyage の次元に合わせる（`voyage-3` は 1024）。ivfflat/hnsw インデックス。
   - `conversation_analysis(user_id PK, summary, urgency, tags JSONB, suggested_reply, last_inbound_message_id, model, generated_at)`
     - `last_inbound_message_id` で「新しい問い合わせが来たらキャッシュ無効化」。
   - `match_replies(query_embedding vector, match_count int)` RPC（コサイン近傍）。
   - Realtime 通知トリガー（`conversation_analysis` 変更でも `conversation-updates` へ broadcast）。

2. **プロバイダ層 `web/lib/ai/`**
   - `claude.ts`：`generateAnalysis()` / `generateDraft()`。`ANTHROPIC_API_KEY` 未設定なら `null`。
     - Anthropic SDK を使用。プロンプトキャッシュ（システム/ドメイン知識をキャッシュ）を有効化。
   - `voyage.ts`：`embed(text)`。`VOYAGE_API_KEY` 未設定なら `null`。
   - 失敗時は静かにフォールバック（プレースホルダ）し、UI にはAI接続状態を表示。

3. **API**
   - `GET/POST /api/analyze`：上記フロー。キャッシュ優先、`force` で再生成。
   - feedback 承認（`PATCH /api/feedback/[id]` で status=approved、または rejected+corrected）時に
     埋め込みを生成して `reply_embeddings` に upsert。

4. **UI 接続**
   - `lib/conversation.ts` の placeholder（summary/urgency/tags/suggestedReply）を `/api/analyze` 由来に。
   - ③ `analysis-panel.tsx`：「AI未接続（フェーズC）」表示を実値に。RAG 根拠（類似過去対応）を表示。
   - ④ `reply-draft.tsx`：「クリア」を実「再生成」に戻す（`/api/analyze?force=1`）。生成中ローディング。
   - キー未設定時は現行プレースホルダのまま（明示表示）。

5. **コスト/運用ガード**
   - 生成結果は DB キャッシュ。`last_inbound_message_id` 不一致時のみ再生成。
   - 分析=Haiku、ドラフト=Sonnet でコスト最適化。プロンプトキャッシュでドメイン知識を再利用。

## フェーズB レビューの積み残し（フェーズC と一緒に対応検討）

実害3件（#1〜#3）は対応済み。残りは効率・設計・整理で、フェーズC着手時にまとめて検討する。

- #4 Realtime トリガーが行単位 broadcast（一括 replied 更新で N+1 通知）→ statement-level 化
- #5 操作後の明示 refetch と Realtime refetch の二重実行
- #6 毎回 全件（最大2000行）再取得・JS再集計（broadcast の userId を使った差分取得へ）
- #7 anon broadcast のイベント到達確認（実プロジェクトで検証）
- #8 セッション失効なし（パスワード変更/ログアウトで無効化できない。署名にパスワードハッシュを含める等）
- #9 二重対応ガードはベストエフォート（共有パスワード＋自由入力の対応者名）
- #10 デッドコード整理（`mock-data.ts`, `initialFeedback`, `getAcceptedReplies`）と debounce 重複の共通化
