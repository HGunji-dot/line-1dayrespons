// 既存 Supabase の messages テーブルに対応した型（フェーズBでそのまま接続できる形）
export type Direction = "inbound" | "outbound";

export interface Message {
  id: number;
  userId: string; // messages.user_id
  displayName: string; // messages.display_name
  messageId: string; // messages.message_id
  text: string; // messages.text
  direction: Direction; // messages.direction
  receivedAt: string; // messages.received_at (ISO)
  replied: boolean; // messages.replied
  repliedAt: string | null; // messages.replied_at
  operator?: string; // outbound を送った対応者（スタッフ名）
}

export type Urgency = "high" | "medium" | "low";

/** AI が付ける分析タグ（確信度つき）。フェーズCでAI生成に差し替え */
export interface AnalysisTag {
  label: string; // 例: 枯れ保証 / 入荷時期 / シマトネリコ
  confidence: number; // 0..1
}

/** RAG の根拠（タグ一致でヒットした過去の正解返信） */
export interface SimilarReply {
  tags: string[];
  inbound: string;
  reply: string;
}

/** フェーズC: /api/analyze が返す AI 生成結果（会話単位） */
export interface ConversationAnalysis {
  summary: string;
  urgency: Urgency;
  tags: AnalysisTag[];
  suggestedReply: string;
  similarReplies: SimilarReply[];
  aiConnected: boolean; // 実生成かフォールバックか
  model: string;
  generatedAt: string;
}

/** 1人の顧客との会話。messages を user_id でまとめたビュー */
export interface Conversation {
  userId: string;
  displayName: string;
  avatarInitial: string; // アバターに出す頭文字
  avatarColor: string; // アバター背景色 (tailwind class)
  messages: Message[];
  unrepliedCount: number; // 未返信の inbound 件数
  lastMessageAt: string; // 最新メッセージの時刻 (ISO)
  elapsedLabel: string; // 一覧に出す経過表記（例: 約26時間）
  handlingBy?: string | null; // 現在この会話を対応中のスタッフ（二重対応防止用のクレーム）
  archived?: boolean; // 処理済みでアーカイブ（一覧から非表示）
  // --- 以下は本来 AI が生成する。今はダミー ---
  summary: string; // 顧客メッセージの要約
  urgency: Urgency; // 緊急度
  tags: AnalysisTag[]; // ドメイン特化タグ
  suggestedReply: string; // 返信ドラフトの初期値
}
