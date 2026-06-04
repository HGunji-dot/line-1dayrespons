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

// ─────────────────────────────────────────────
// タグ推定（フェーズ③）
//   固定タグマスタの中からのみ選ばせる（自由記述させない＝表揺れ防止）。
//   出力は JSON 配列に固定し、確信度つきで返させる。
// ─────────────────────────────────────────────

export const TAG_SYSTEM = `あなたは植木・観葉植物ショップのLINE問い合わせを分類する担当です。
お客様のメッセージを読み、あらかじめ定義された「タグ一覧」の中から該当するものを選びます。

# 厳守ルール
- タグは必ず与えられた一覧の中の文字列【そのまま】を使う。一覧に無い語は絶対に作らない。
- 本当に当てはまるものだけを選ぶ。無理に複数選ばない（0〜3個が目安）。
- 各タグに confidence（0.0〜1.0）を付ける。確信が低いものは入れない。
- 出力は JSON 配列のみ。説明文やコードフェンスは付けない。
  形式: [{"label":"（一覧の語）","confidence":0.0}]
- 該当が無ければ [] を返す。`;

/** タグ推定の user プロンプト。allowedTags はマスタの語のみ。 */
export function buildTagPrompt(params: { inboundText: string; allowedTags: string[] }): string {
  const { inboundText, allowedTags } = params;
  return [
    "# タグ一覧（この中の語だけを使う）",
    allowedTags.map((t) => `- ${t}`).join("\n"),
    "",
    "# お客様のメッセージ",
    inboundText.trim() || "（本文なし）",
    "",
    "# 出力",
    'JSON配列のみ。例: [{"label":"在庫確認・入荷連絡","confidence":0.82}]',
  ].join("\n");
}

/** LLM応答テキストからタグ配列を頑健に取り出す。allowed 外は捨てる。 */
export function parseTagsFromText(
  text: string,
  allowedTags: string[]
): Array<{ label: string; confidence: number }> {
  const allowed = new Set(allowedTags);
  let raw = text.trim();
  // コードフェンスや前後の説明が混じっても拾えるよう、最初の [ ... ] を抜き出す
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) raw = raw.slice(start, end + 1);

  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: Array<{ label: string; confidence: number }> = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const label = (item as { label?: unknown }).label;
    const conf = (item as { confidence?: unknown }).confidence;
    if (typeof label !== "string" || !allowed.has(label) || seen.has(label)) continue;
    const confidence = typeof conf === "number" && conf >= 0 && conf <= 1 ? conf : 0.5;
    out.push({ label, confidence });
    seen.add(label);
  }
  return out;
}
