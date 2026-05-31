# LINE返信管理 UI（フェーズA：ダミーデータ版）

LINEメッセージを分析し、返信ドラフトを生成する **4ペイン管理画面** のモックです。
まだDBやAIには繋いでいません（すべてダミーデータ）。見た目と操作感を確認する段階です。

## 4ペイン構成

| ペイン | 内容 |
|--------|------|
| ① 会話一覧 | 顧客リスト。未返信が上、緊急度ドット・経過時間・未返信件数を表示 |
| ② トーク履歴 | LINE風の左右吹き出し（顧客=左/灰、自社=右/緑） |
| ③ AI分析 | 要約・緊急度・ドメイン特化タグ（枯れ保証 / 入荷時期 等、確信度つき） |
| ④ 返信ドラフト | AI生成文（ダミー）を編集して送信。**送信は人が最終承認** |

各ペインの境界はドラッグで幅を変更でき、変更した幅はブラウザに保存されます（`autoSaveId`）。

## 画面（ルート）

| パス | 画面 | 内容 |
|------|------|------|
| `/` | 会話 | 上記の4ペイン。送信は人が最終承認 |
| `/templates` | テンプレート管理 | タグ → 返信例（テンプレ）を**複数**登録・編集・削除。③のタグから `?tag=` でディープリンク |
| `/learning` | 学習ログ | **AI下書きと送信文の差分**を記録。文字単位diffで色分け表示、タグ別の編集率を集計し高いタグに「改善提案」、各件を**人が承認**すると学習（RAGの正解例）に追加 |

ヘッダーのナビで3画面を行き来できます。送信すると差分が自動で `/learning` に記録されます
（SPA遷移の間は保持／フルリロードでシードに戻るモック挙動。本番は Supabase が真実の情報源）。

## 動かし方

> 前提：Node.js 18 以上（推奨 20+）をインストールしておく。

```bash
cd web
npm install
npm run dev
```

ブラウザで http://localhost:3000 を開く。

## 技術スタック

- Next.js 14（App Router）
- Tailwind CSS v3 + shadcn/ui 方式のコンポーネント（`components/ui/`）
- react-resizable-panels（4ペインのリサイズ）
- lucide-react（アイコン）

## ファイル構成

```
web/
├─ app/
│  ├─ layout.tsx          ルートレイアウト
│  ├─ page.tsx            会話：4ペインを束ねる本体（状態管理）
│  ├─ templates/page.tsx  テンプレート管理
│  ├─ learning/page.tsx   学習ログ（差分・編集率・承認）
│  └─ globals.css         Tailwind + テーマ変数
├─ components/
│  ├─ app-header.tsx         共通ヘッダー（ナビ）
│  ├─ conversation-list.tsx  ① 会話一覧
│  ├─ chat-thread.tsx        ② トーク履歴
│  ├─ analysis-panel.tsx     ③ AI分析（タグ→テンプレへリンク）
│  ├─ reply-draft.tsx        ④ 返信ドラフト（テンプレ挿入・送信）
│  ├─ diff-view.tsx          下書き↔送信文の差分ハイライト
│  └─ ui/                    shadcn方式の汎用部品
├─ lib/
│  ├─ types.ts            型定義（Supabase messages に対応）
│  ├─ mock-data.ts        ダミーの会話データ
│  ├─ template-data.ts    タグ→返信例テンプレ（シード）
│  ├─ feedback-data.ts    学習フィードバックの型・シード
│  ├─ feedback-store.ts   ルート間で共有する軽量ストア
│  ├─ diff.ts             文字単位diff・編集率の計算
│  └─ utils.ts            cn() / 時刻フォーマット
└─ components.json        shadcn CLI 設定
```

## 次のステップ（フェーズB / C）

- **フェーズB**：`lib/mock-data.ts` を Supabase の `messages` から取得する処理に置き換え、`@supabase/ssr` で接続。新着は Supabase Realtime で反映。テンプレ（`template-data.ts`）と学習フィードバック（`feedback-store.ts`）も Supabase の `templates` / `reply_feedback` テーブルに置き換え、**真実の情報源を一本化**（現在は画面ごとにモック状態を持つ）。
- **フェーズC**：③のタグと④の返信文をAI生成に差し替え。学習ログで**承認済み**の「送信文」を正解例として pgvector に保存し、次回の生成時に類似検索（RAG）で参照。タグ別編集率が高いタグはテンプレ改善の対象。送信は既存 `send-reply` Edge Function を呼ぶ。

shadcn の公式部品に差し替えたい場合：

```bash
npx shadcn@latest add button card badge textarea avatar scroll-area separator resizable
```
（`components.json` を用意済みなので、上書きインストールできます）
