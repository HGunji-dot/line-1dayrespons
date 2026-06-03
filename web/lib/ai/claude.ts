import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisTag, Urgency } from "@/lib/types";

// ─────────────────────────────────────────────
// Claude（Anthropic）プロバイダ層。サーバ専用。
//   - 分析（要約・緊急度・タグ）= Haiku（安価・高速）
//   - 返信ドラフト              = Sonnet（品質）
//   ANTHROPIC_API_KEY 未設定なら全関数 null を返し、呼び出し側がプレースホルダに
//   フォールバックする（キーが無くても既存機能を壊さない）。
// ─────────────────────────────────────────────

const ANALYSIS_MODEL = "claude-haiku-4-5";
const DRAFT_MODEL = "claude-sonnet-4-6";

let cached: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cached) cached = new Anthropic(); // ANTHROPIC_API_KEY を自動参照
  return cached;
}

/** AI 生成が有効か（キーがあるか）。UI のバッジ表示にも使う。 */
export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ドメイン知識（業種コンテキスト）。プロンプトキャッシュ対象にして再利用する。
const DOMAIN_CONTEXT = `あなたは観葉植物・園芸用品を扱うオンラインショップの、LINEカスタマーサポート担当です。
取り扱い領域と典型的な問い合わせ:
- 枯れ保証（到着後一定期間の枯れに対する交換・返金対応）
- 入荷時期・在庫確認（季節商品や人気品種の再入荷）
- 育て方相談（水やり・置き場所・日当たり・植え替え・病害虫）
- 配送・送料・日時指定、梱包に関する不安
- 返品・交換・初期不良、サイズ/イメージ違い
丁寧でフレンドリーな日本語。専門用語は噛み砕く。絵文字は控えめ（多くても1つ）。
断定できない在庫・納期は確認のうえ折り返す旨を添える。`;

function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export interface AnalysisResult {
  summary: string;
  urgency: Urgency;
  tags: AnalysisTag[];
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

function parseAnalysis(raw: string): AnalysisResult | null {
  try {
    const obj = JSON.parse(stripFences(raw));
    const urgency: Urgency = ["high", "medium", "low"].includes(obj.urgency) ? obj.urgency : "low";
    const tags: AnalysisTag[] = Array.isArray(obj.tags)
      ? obj.tags
          .filter((t: unknown): t is { label: string; confidence?: number } =>
            !!t && typeof (t as { label?: unknown }).label === "string"
          )
          .slice(0, 5)
          .map((t: { label: string; confidence?: number }) => ({
            label: String(t.label).slice(0, 20),
            confidence: Math.max(0, Math.min(1, Number(t.confidence ?? 0.7))),
          }))
      : [];
    return { summary: String(obj.summary ?? "").slice(0, 400), urgency, tags };
  } catch {
    return null;
  }
}

/** 会話から要約・緊急度・ドメインタグを抽出する。 */
export async function generateAnalysis(conversationText: string): Promise<AnalysisResult | null> {
  const c = getClient();
  if (!c) return null;

  const schemaHint = `次のJSON形式のみで出力してください。前置き・説明・コードフェンスは不要です。
{"summary":"顧客の用件を1〜2文で要約","urgency":"high|medium|low","tags":[{"label":"枯れ保証","confidence":0.0〜1.0}]}
urgency基準: クレーム/枯れ/初期不良/緊急トラブル=high、購入検討/在庫・入荷・配送の質問=medium、お礼/雑談=low。
tagsは1〜5個。labelは短い名詞（例: 枯れ保証 / 入荷時期 / 育て方 / 配送 / 返品 / 在庫確認 / 商品名）。`;

  const res = await c.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 1024,
    system: [
      { type: "text", text: DOMAIN_CONTEXT, cache_control: { type: "ephemeral" } },
      { type: "text", text: "顧客の問い合わせを分析し、要約・緊急度・タグを抽出するアシスタントです。" },
    ],
    messages: [{ role: "user", content: `${schemaHint}\n\n=== 会話 ===\n${conversationText}` }],
  });

  return parseAnalysis(textOf(res));
}

/** 過去の正解返信（タグ一致）を参考に、最新の問い合わせへの返信ドラフトを生成する。 */
export async function generateDraft(
  conversationText: string,
  examples: { inbound: string; reply: string }[]
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;

  const exampleText = examples.length
    ? "=== 過去の正解返信（参考。文体・対応方針を踏襲してください）===\n" +
      examples
        .map((e, i) => `【例${i + 1}】お客様: ${e.inbound}\n返信: ${e.reply}`)
        .join("\n\n") +
      "\n\n"
    : "";

  const res = await c.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 1024,
    system: [
      { type: "text", text: DOMAIN_CONTEXT, cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: "顧客への返信ドラフトを作成します。送信はスタッフが手動で行うため、そのまま送れる完成形の本文のみを出力してください。前置き・説明・署名・引用符は不要です。",
      },
    ],
    messages: [
      {
        role: "user",
        content: `${exampleText}=== 今回の会話 ===\n${conversationText}\n\n上記の最新のお客様メッセージに対する、返信本文のみを出力してください。`,
      },
    ],
  });

  return textOf(res);
}
