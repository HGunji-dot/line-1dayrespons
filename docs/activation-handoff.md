# 活用フェーズ 引き継ぎメモ（担当者付き返信の実運用＋AI学習DB）

このブランチ `feat/activation-auth-reply` で実装したコア活用フェーズの状態・設計判断・残作業をまとめる。
**別環境でクローンした後はこのファイルを最初に読めば作業を再開できる。**

最終更新: 2026-06-03

---

## 1. ゴール（2点）

1. **担当者付きで返信し、実運用（活用段階）に入る。**
2. **将来のAI学習に備え、拡張性のあるDBにする。**（送られた「顧客の問い合わせ→スタッフ返信」ペアを初日から教師データとして蓄積）

加えて育成機能（マスター評価）を後続フェーズで予定（後述 Phase 7）。

---

## 2. 設計判断（grill で合意済み）

- **担当者特定** = Supabase Auth で各自ログイン → operator = ログイン本人（`staff.display_name`）。手動選択の自己申告は不採用。
- **アカウント発行** = 招待制（一般サインアップ無効）＋ `staff` テーブルで表示名・権限(role)・退職(active)を管理。
- **アーキテクチャ** = サーバー仲介＋数秒ポーリング。`service_role` は Next.js サーバー側のみ。Auth はログインゲート。**RLS は書かない**（サーバーが信頼境界）。`messages` 直読みを正、`get-unreplied` は通知専用に役割分離。
- **二重対応防止** = ソフト表示「対応中: ○○」（`conversation_state`＋ハートビート、数分でTTL失効）＋**送信時ガード**（開いてから返信済みになっていたら 409）。ハードロックはしない。
- **AI学習データ** = 活用初日から `reply_events` に記録。コアは正規化カラム、AIメタは `ai_meta(jsonb)` で拡張。`ai_draft`/`edit_rate` は AI 実装後に投入。
- **初回スコープ** = 返信ループのコアだけ先行本番化。`/templates`・`/learning`・AI分析タグ・下書き提案は後追い。
- **デモ** = 本番1本に絞り全面ログインゲート化。公開モックデモは廃止（env 無し時はゲート無効でモック動作＝ローカル/プレビュー用に温存）。
- **通知経路** = `check-unreplied-notify`（Edge Function / cron-job.org・日曜/祝日スキップ実装済）に一本化。GitHub Actions(python) は停止。
- **認証実装** = 認証/セッション層だけ `@supabase/ssr`。データ読み取りは素の fetch＋service_role を維持。

---

## 3. 実装済み（Phase 0–5）— 型チェック・`next build`・プレビュー(モックモード)で検証済

| Phase | 内容 | 主なファイル |
|------|------|------------|
| 0 | 二重通知停止／admin_notes 追補 | `.github/workflows/check-unreplied.yml`(schedule コメントアウト), `sql/2026-06-03_admin_notes.sql`, `docs/production-state.md` |
| 1 | 活用スキーマ SQL | `sql/2026-06-03_activation_schema.sql`（staff / reply_events / conversation_state / master_reviews）|
| 2 | 認証(@supabase/ssr) | `web/lib/supabase/{server,client,middleware}.ts`, `web/middleware.ts`, `web/app/login/page.tsx`, `web/lib/auth.ts`(`getCurrentStaff`), `web/.env.example` |
| 3 | 担当者＝本人＋reply_events記録＋送信ガード409 | `web/app/api/send-reply/route.ts`, `web/lib/backend.ts`(`getUnrepliedInbound`/`recordReplyEvent`), `web/components/app-header.tsx`, `web/app/page.tsx` |
| 4 | 対応中ソフト表示（ハートビート＋ポーリング）| `web/app/api/handling/route.ts`, `web/lib/backend.ts`(`upsertHandling`/`getActiveHandling`), `web/components/reply-console.tsx` |
| 5 | スコープ整理（ナビを「会話」＋master「育成評価」に）| `web/components/app-header.tsx` |

### モード切替の仕組み（重要）
- **env 無し** → モックモード。ログインゲート無効・モックデータ・手動の対応者セレクタ＋「モック」バッジ。ローカル/プレビューはこれで動く。
- **env あり** → 実モード。全ページログイン必須。対応者＝ログイン本人に固定。送信は `/api/send-reply` 経由で実 LINE Push＋`reply_events` 記録。

### 既知の警告
- `next build` で middleware の `@supabase/ssr`→`supabase-js` が `process.version`(Edge Runtime 非対応) 警告を出すが、Supabase 公式の middleware パターンで既知・実害なし。

---

## 4. 実モードを有効化する手順（本人作業・未実施）

1. **SQL適用**（Supabase SQL Editor、本番 project `tqrrleghrlxattqnskxs`）:
   - `sql/2026-06-03_admin_notes.sql`
   - `sql/2026-06-03_activation_schema.sql`
2. **Vercel(web) の環境変数**:
   - `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（クライアント認証用・公開可）
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（サーバー専用）/ `ADMIN_SECRET`
3. **Supabase 認証設定**:
   - Authentication → 一般サインアップ無効化（招待のみ）
   - スタッフをメール招待
   - `staff` テーブルに各スタッフ行を作成（`auth_user_id` を招待ユーザーの uuid に紐付け、`display_name` を酢崎/水口/小沼/郡司 等に）
   - 1人を `role = 'master'`
4. **E2E確認**: ログイン → 会話表示 → 担当者付き送信 → `messages`/`reply_events` 記録 → 「対応中」表示 → 409 ガード → 通知が二重に来ないこと。

> ⚠️ 実 env を入れると実 LINE 送信が可能になる。必ずログインゲートが効く本番でのみ有効化すること。

---

## 5. 残作業

### Phase 7: マスター育成評価ページ `/coaching`（未着手・データ蓄積後）
設計合意済み。`reply_events` に実データが溜まってから着手する独立フェーズ。
- **マスター限定**（`getCurrentStaff().role === 'master'` でサーバーゲート、非マスターは 403）。
- 送信済み一覧（`reply_events`、非masterのみ、スタッフ別フィルタ）→ 1件「却下」→ 再構築文を編集保存 → `master_reviews` に INSERT＋`editRatePct` で `edit_rate` 算出。**却下のみ記録**（承認は記録しない）。再構築文は顧客に送らない（育成用の理想解）。
- ダッシュボード（同ページ・タブ）: スタッフ別「却下件数／平均編集率／却下率(却下数÷`reply_events`総送信数)／推移（月次＋直近週）」。個票は `web/lib/diff.ts` の `diffChars` で差分表示。
- 既存 `web/lib/diff.ts`（`editRatePct`/`diffChars`）を再利用。
- `master_reviews.rebuilt_text` はマスターの理想解＝将来 RAG の最良の教師データ。

### その他のフォローアップ
- `/learning`・`/templates` の実接続（AI フェーズ）。`reply_feedback`（AI下書き vs 送信文の精度評価）テーブルもその時に新設。
- AI 分析タグ・下書き提案ペインの実生成（フェーズC）。
- 会話の自動更新は現状 8 秒ポーリング（Realtime は未導入）。

---

## 6. 開発メモ（環境）

- 実体: `C:\Users\green\OneDrive\ドキュメント\GitHub\line-1dayrespons`（日本語パス）。Node は winget の v24（`C:\Program Files\nodejs`、PATH 未登録なので明示参照）。
- プレビュー: ASCII ジャンクション `C:\Users\green\line-reply-web` 経由で `npm run dev`（日本語パス回避）。連続編集後は HMR が壊れるので dev サーバを再起動して検証する。
- 運用フロー: ブランチ → プレビュー確認 → main マージ（Vercel 自動デプロイ）。
- 本番構成の詳細は `docs/production-state.md` を参照。
