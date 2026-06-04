// ─────────────────────────────────────────────
// 返信ドラフト生成のプロンプト
//
// 方針（メモリ line-1dayrespons-backend-plan の決定7）:
//   - 店ペルソナはこの定数で持つ（v1。非エンジニア編集が要る段階でDB化）。
//   - 取得した Q&A（templates）と承認済み実例（examples）を「最優先の根拠」とし、
//     無い情報は創作させない／在庫・価格・納期・日程は断定させない。
//   - 運用後はマスターの承認編集差分・却下→正解返信の添削を examples に還元し、
//     ペルソナを育てていく（学習ループは次スライス）。
// ─────────────────────────────────────────────

export interface RetrievedTemplate {
  tag_label: string;
  title: string; // 想定質問（Q）
  body: string; // モデル返答（A）
}

export interface RetrievedExample {
  inbound_text: string | null; // 過去の顧客メッセージ
  sent: string; // マスターが実際に送った（承認済み）返信
}

// 店ペルソナ + 出力ガード（system プロンプト）
export const SHOP_PERSONA = `あなたは植木・観葉植物を扱うオンラインショップのLINE接客スタッフです。
お客様一人ひとりに、丁寧で温かく、簡潔な日本語の敬体（です・ます調）で返信します。

# 文体
- 冒頭は状況に応じた一言（お問い合わせのお礼やお詫び）から始める。
- 専門的になりすぎず、植物に詳しくない人にも分かる言葉を使う。
- 全体で2〜5文程度の読みやすい長さにまとめる。絵文字は使わない。

# 厳守するルール（接客で致命的なため必ず守る）
- 返信は「参考Q&A」と「承認済みの返信例」に書かれている内容だけを根拠にする。
- そこに無い情報（在庫の有無・価格・入荷時期・配送日程・保証可否の断定など）は、
  自分で創作したり断定したりしない。不確かな点は「確認のうえご案内します」と濁す。
- お客様に固有名詞・数値（金額・日付・在庫数）を答えるときは、根拠資料にある場合のみ。
- 参考資料が顧客の質問と噛み合わない場合は、無理に当てはめず、
  確認をお願いする無難な返信にとどめる。`;

/** 取得した根拠と顧客メッセージから、user プロンプトを組み立てる。 */
export function buildUserPrompt(params: {
  inboundText: string;
  tags: string[];
  templates: RetrievedTemplate[];
  examples: RetrievedExample[];
  displayName?: string;
}): string {
  const { inboundText, tags, templates, examples, displayName } = params;

  const parts: string[] = [];

  parts.push("# お客様からのメッセージ");
  if (displayName) parts.push(`（お客様: ${displayName} 様）`);
  parts.push(inboundText.trim() || "（本文なし）");
  parts.push("");

  parts.push(`# 想定タグ: ${tags.length ? tags.join(" / ") : "（なし）"}`);
  parts.push("");

  if (templates.length) {
    parts.push("# 参考Q&A（過去に整理した想定質問と返答。最優先の根拠）");
    templates.forEach((t, i) => {
      parts.push(`## ${i + 1}. [${t.tag_label}] ${t.title}`);
      parts.push(t.body.trim());
      parts.push("");
    });
  } else {
    parts.push("# 参考Q&A: 該当なし");
    parts.push("");
  }

  if (examples.length) {
    parts.push("# 承認済みの返信例（マスターが実際に送った返信。文体の手本）");
    examples.forEach((e, i) => {
      if (e.inbound_text) parts.push(`## 例${i + 1} 顧客: ${e.inbound_text.trim()}`);
      else parts.push(`## 例${i + 1}`);
      parts.push(`返信: ${e.sent.trim()}`);
      parts.push("");
    });
  }

  parts.push("# 指示");
  parts.push(
    "上記の根拠だけを使って、このお客様への返信ドラフトを1つ作成してください。" +
      "前置きや説明は不要で、送信できる返信本文のみを出力してください。"
  );

  return parts.join("\n");
}
