import { conversations } from "@/lib/mock-data";

// ─────────────────────────────────────────────
// タグ → 返信例（テンプレート）。1タグに複数テンプレを持てる。
// フェーズCで、ここに溜めたテンプレが「AI生成の土台（RAGの種）」になる。
// 今はすべてダミー（メモリ上の状態）。
// ─────────────────────────────────────────────

export interface ReplyTemplate {
  id: string;
  tagLabel: string; // どのタグに紐づくか
  title: string; // バリエーション名（例: 丁寧 / 簡潔）
  body: string; // 返信例の本文
  updatedAt: string; // 最終更新（ISO）
}

export const initialTemplates: ReplyTemplate[] = [
  {
    id: "tpl-karehosho-teinei",
    tagLabel: "枯れ保証",
    title: "丁寧（状態確認をお願いする）",
    body: "お問い合わせありがとうございます。葉が枯れてきているとのこと、ご心配のことと存じます。ご購入から1年以内であれば枯れ保証の対象となります。状態確認のため、お手数ですが株全体とご購入時のレシートのお写真をお送りいただけますでしょうか。確認のうえ、交換または返金のご案内をいたします。",
    updatedAt: "2026-05-20T10:00:00+09:00",
  },
  {
    id: "tpl-karehosho-kanketsu",
    tagLabel: "枯れ保証",
    title: "簡潔（リピーター向け）",
    body: "枯れ保証の対象です。株全体とレシートのお写真をお送りください。確認後すぐに交換手配いたします。",
    updatedAt: "2026-05-22T14:30:00+09:00",
  },
  {
    id: "tpl-nyuka-teinei",
    tagLabel: "入荷時期",
    title: "丁寧（入荷予定を案内）",
    body: "お問い合わせありがとうございます。ご希望の商品は次回入荷を◯月中旬に予定しております。入荷後すぐの発送が可能です。サイズのご希望があればお知らせください。入荷確定次第、優先してご案内いたします。",
    updatedAt: "2026-05-18T09:15:00+09:00",
  },
  {
    id: "tpl-nyuka-zaiko",
    tagLabel: "入荷時期",
    title: "在庫切れ・再入荷未定",
    body: "お問い合わせありがとうございます。あいにく当該商品は現在品切れで、次回入荷は未定となっております。入荷が決まり次第こちらのLINEでご案内いたしますので、よろしければこのままご登録をお願いいたします。",
    updatedAt: "2026-05-19T11:00:00+09:00",
  },
  {
    id: "tpl-haiso-trouble",
    tagLabel: "配送トラブル",
    title: "破損・お詫びと交換手配",
    body: "このたびは商品が破損した状態でお届けしてしまい、誠に申し訳ございません。すぐに交換品を手配いたします。お手数ですが破損箇所のお写真を1枚お送りいただけますでしょうか。確認後、最短での再配送日を本日中にご連絡いたします。",
    updatedAt: "2026-05-25T16:40:00+09:00",
  },
  {
    id: "tpl-sodate-mizuyari",
    tagLabel: "育て方相談",
    title: "水やりの基本案内",
    body: "お問い合わせありがとうございます。水やりは土の表面が乾いてからたっぷりと、が基本です。春〜夏は週1〜2回が目安、受け皿の水は溜めっぱなしにしないようご注意ください。葉が垂れてきたら水切れのサインです。ほかにご不明点があればお気軽にどうぞ。",
    updatedAt: "2026-05-21T13:20:00+09:00",
  },
  {
    id: "tpl-eigyo-jikan",
    tagLabel: "営業時間",
    title: "営業時間の案内",
    body: "お問い合わせありがとうございます。当店の営業時間は平日10:00〜18:00、土日祝は9:00〜19:00です。ご来店お待ちしております。",
    updatedAt: "2026-05-15T08:00:00+09:00",
  },
];

/** 会話に出てくるタグ＋テンプレを持つタグを統合した、管理対象のタグ一覧（重複なし・出現順） */
export function getAllTagLabels(): string[] {
  const set = new Set<string>();
  conversations.forEach((c) => c.tags.forEach((t) => set.add(t.label)));
  initialTemplates.forEach((t) => set.add(t.tagLabel));
  return Array.from(set);
}
