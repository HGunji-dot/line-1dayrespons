// 送信時に記録する「学習フィードバック」。
// AI下書き(generated) と 実際に送った文(sent) のペア＋文脈を保存する。
// 人が「良い例」と承認(approved)したものだけが、フェーズCでRAGの正解例になる。

export type FeedbackStatus = "pending" | "approved" | "rejected";

export interface ReplyFeedback {
  id: string;
  userId: string;
  displayName: string;
  tags: string[]; // この返信に紐づくタグ
  inboundText: string; // きっかけになった顧客メッセージ
  generated: string; // AIの下書き
  sent: string; // 実際に送った文
  operator: string; // 返信を対応したスタッフ
  correctedReply?: string; // 却下時に人が入力した「正しい返信文」（正解として蓄積）
  createdAt: string; // ISO
  status: FeedbackStatus; // 承認状態（人が判断）
}

// 学習ログを最初から賑やかにするためのシード（編集率の大小をばらつかせている）
export const initialFeedback: ReplyFeedback[] = [
  {
    id: "fb-seed-1",
    userId: "U004",
    displayName: "山本 大樹",
    tags: ["配送トラブル", "破損", "交換希望"],
    inboundText: "今日届いたシンボルツリー、鉢がパックリ割れてました…",
    generated:
      "このたびは商品が破損した状態でお届けしてしまい、誠に申し訳ございません。すぐに交換品を手配いたします。お手数ですが破損箇所のお写真を1枚お送りいただけますでしょうか。",
    sent:
      "このたびは鉢が破損した状態でお届けしてしまい、誠に申し訳ございません。すぐに新しい鉢へ交換手配いたします。恐れ入りますが破損箇所のお写真を1枚お送りください。本日中に再配送日をご連絡します。",
    operator: "水口",
    createdAt: "2026-05-30T11:20:00+09:00",
    status: "pending",
  },
  {
    id: "fb-seed-2",
    userId: "U003",
    displayName: "鈴木 さくら",
    tags: ["育て方相談", "モンステラ", "水やり"],
    inboundText: "先日買ったモンステラ、どのくらいの頻度で水やりすればいいですか？",
    generated:
      "水やりは土の表面が乾いてからたっぷりと、が基本です。春〜夏は週1〜2回が目安、受け皿の水は溜めっぱなしにしないようご注意ください。",
    sent:
      "水やりは土の表面が乾いてからたっぷりと、が基本です。春〜夏は週1〜2回が目安、受け皿の水は溜めっぱなしにしないようご注意ください。",
    operator: "郡司",
    createdAt: "2026-05-31T09:05:00+09:00",
    status: "approved",
  },
  {
    id: "fb-seed-3",
    userId: "U002",
    displayName: "佐藤 健",
    tags: ["入荷時期", "オリーブ"],
    inboundText: "オリーブの木を探しています。次の入荷はいつ頃になりますか？",
    generated:
      "オリーブの木は次回入荷を6月中旬に予定しております。入荷後すぐの発送が可能です。サイズのご希望があればお知らせください。",
    sent:
      "オリーブの木は次回入荷を6月10日頃に予定しております。入荷後すぐ発送できます。樹高のご希望（80cm/120cm）があればお知らせください。先行のお取り置きも承ります。",
    operator: "酢崎",
    createdAt: "2026-05-31T10:10:00+09:00",
    status: "pending",
  },
];
