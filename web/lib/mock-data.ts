import type { Conversation, Message } from "@/lib/types";

// ─────────────────────────────────────────────
// ダミーデータ（植木・観葉植物ショップ想定）
// フェーズBで Supabase の messages から組み立てるデータに置き換える。
// ─────────────────────────────────────────────

let seq = 1;
function msg(
  userId: string,
  displayName: string,
  text: string,
  direction: Message["direction"],
  receivedAt: string,
  replied = false,
  operator?: string
): Message {
  return {
    id: seq,
    userId,
    displayName,
    messageId: `mock-${seq++}`,
    text,
    direction,
    receivedAt,
    replied,
    repliedAt: null,
    operator,
  };
}

export const conversations: Conversation[] = [
  {
    userId: "U001",
    displayName: "田中 みどり",
    avatarInitial: "田",
    avatarColor: "bg-emerald-500",
    unrepliedCount: 2,
    lastMessageAt: "2026-05-30T10:12:00+09:00",
    elapsedLabel: "約26時間未返信",
    summary: "先月購入したシマトネリコの葉が枯れてきており、枯れ保証の対象になるか確認したい。",
    urgency: "high",
    tags: [
      { label: "枯れ保証", confidence: 0.94 },
      { label: "シマトネリコ", confidence: 0.9 },
      { label: "枯れている", confidence: 0.88 },
      { label: "クレーム", confidence: 0.41 },
    ],
    suggestedReply:
      "田中様、お問い合わせありがとうございます。シマトネリコの葉が枯れてきているとのこと、ご心配のことと存じます。ご購入から1年以内であれば枯れ保証の対象となります。状態確認のため、お手数ですが株全体とご購入時のレシートのお写真をお送りいただけますでしょうか。確認のうえ、交換または返金のご案内をいたします。",
    messages: [
      msg("U001", "田中 みどり", "先月そちらで買ったシマトネリコなんですが、葉っぱが茶色く枯れてきました。", "inbound", "2026-05-30T10:05:00+09:00"),
      msg("U001", "田中 みどり", "これって枯れ保証で交換してもらえますか？", "inbound", "2026-05-30T10:12:00+09:00"),
    ],
  },
  {
    userId: "U002",
    displayName: "佐藤 健",
    avatarInitial: "佐",
    avatarColor: "bg-sky-500",
    unrepliedCount: 1,
    lastMessageAt: "2026-05-31T09:40:00+09:00",
    elapsedLabel: "約3時間未返信",
    summary: "オリーブの木の入荷時期を知りたい。希望は6月中の配送。",
    urgency: "medium",
    tags: [
      { label: "入荷時期", confidence: 0.92 },
      { label: "オリーブ", confidence: 0.87 },
      { label: "配送", confidence: 0.6 },
    ],
    suggestedReply:
      "佐藤様、お問い合わせありがとうございます。オリーブの木は次回入荷を6月中旬に予定しております。入荷後すぐの発送が可能ですので、ご希望の6月中の配送に間に合う見込みです。サイズ（樹高）のご希望があればお知らせください。入荷確定次第、優先してご案内いたします。",
    messages: [
      msg("U002", "佐藤 健", "オリーブの木を探しています。次の入荷はいつ頃になりますか？", "inbound", "2026-05-31T09:35:00+09:00"),
      msg("U002", "佐藤 健", "できれば6月中に届けてほしいです。", "inbound", "2026-05-31T09:40:00+09:00"),
    ],
  },
  {
    userId: "U003",
    displayName: "鈴木 さくら",
    avatarInitial: "鈴",
    avatarColor: "bg-rose-500",
    unrepliedCount: 1,
    lastMessageAt: "2026-05-31T08:20:00+09:00",
    elapsedLabel: "約4時間未返信",
    summary: "モンステラの水やり頻度についての質問。育て方サポートの範囲。",
    urgency: "low",
    tags: [
      { label: "育て方相談", confidence: 0.9 },
      { label: "モンステラ", confidence: 0.86 },
      { label: "水やり", confidence: 0.83 },
    ],
    suggestedReply:
      "鈴木様、お問い合わせありがとうございます。モンステラの水やりは、土の表面が乾いてからたっぷりと、が基本です。今の季節（春〜夏）は週に1〜2回が目安、受け皿の水は溜めっぱなしにしないようご注意ください。葉が垂れてきたら水切れのサインです。ほかにご不明点があればお気軽にどうぞ。",
    messages: [
      msg("U003", "鈴木 さくら", "先日買ったモンステラ、どのくらいの頻度で水やりすればいいですか？", "inbound", "2026-05-31T08:20:00+09:00"),
    ],
  },
  {
    userId: "U004",
    displayName: "山本 大樹",
    avatarInitial: "山",
    avatarColor: "bg-amber-500",
    unrepliedCount: 3,
    lastMessageAt: "2026-05-29T18:55:00+09:00",
    elapsedLabel: "約41時間未返信",
    handlingBy: "水口", // デモ用：この会話は既に水口が対応中（他の人が選ぶとエラー）
    summary: "届いたシンボルツリーの鉢が割れていた。交換と再配送を希望。",
    urgency: "high",
    tags: [
      { label: "配送トラブル", confidence: 0.93 },
      { label: "破損", confidence: 0.91 },
      { label: "交換希望", confidence: 0.84 },
      { label: "クレーム", confidence: 0.72 },
    ],
    suggestedReply:
      "山本様、このたびは商品の鉢が破損した状態でお届けしてしまい、誠に申し訳ございません。すぐに交換品を手配いたします。お手数ですが破損箇所のお写真を1枚お送りいただけますでしょうか。確認後、最短での再配送日を本日中にご連絡いたします。ご迷惑をおかけし重ねてお詫び申し上げます。",
    messages: [
      msg("U004", "山本 大樹", "今日届いたシンボルツリー、鉢がパックリ割れてました…", "inbound", "2026-05-29T18:40:00+09:00"),
      msg("U004", "山本 大樹", "写真撮ってあります。交換できますか？", "inbound", "2026-05-29T18:48:00+09:00"),
      msg("U004", "山本 大樹", "植え替えたかったので早めにお願いしたいです。", "inbound", "2026-05-29T18:55:00+09:00"),
    ],
  },
  {
    userId: "U005",
    displayName: "中村 あおい",
    avatarInitial: "中",
    avatarColor: "bg-violet-500",
    unrepliedCount: 0,
    lastMessageAt: "2026-05-31T11:00:00+09:00",
    elapsedLabel: "返信済み",
    summary: "営業時間の問い合わせ。対応済み。",
    urgency: "low",
    tags: [
      { label: "営業時間", confidence: 0.95 },
      { label: "店舗案内", confidence: 0.7 },
    ],
    suggestedReply:
      "中村様、お問い合わせありがとうございます。当店の営業時間は平日10:00〜18:00、土日祝は9:00〜19:00です。ご来店お待ちしております。",
    messages: [
      msg("U005", "中村 あおい", "週末の営業時間を教えてください。", "inbound", "2026-05-31T10:50:00+09:00", true),
      msg("U005", "中村 あおい", "土日は9時から19時まで営業しております！ご来店お待ちしています。", "outbound", "2026-05-31T11:00:00+09:00", true, "郡司"),
    ],
  },
];
