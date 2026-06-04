// ─────────────────────────────────────────────
// LLM provider アダプタ
//
// 方針（メモリ line-1dayrespons-backend-plan の決定5/6）:
//   LLM は Claude Haiku 4.5 を既定とし、provider アダプタの裏に隔離する。
//   モデル差し替え・将来のエージェント対応に備え、呼び出し側は
//   この generate(input) -> { text } の契約だけに依存する。
//
//   マスキング（プライバシー）の「口」は、ここ（プロバイダ入力の直前）に
//   1箇所だけ置く。lib/mask.ts 参照。
// ─────────────────────────────────────────────

import { maskPII } from "@/lib/mask";

export interface GenerateInput {
  systemPrompt: string;
  userPrompt: string;
  /** 既定モデルを上書きしたい場合のみ */
  model?: string;
  maxTokens?: number;
}

export interface GenerateOutput {
  text: string;
  model: string;
}

export interface LlmProvider {
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

// 既定モデル（差し替えは ANTHROPIC_MODEL env でも可）
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 1024;

class AnthropicProvider implements LlmProvider {
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }

    // 動的 import（サーバー専用。クライアントバンドルに混ざらないように）
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });

    const model = input.model || DEFAULT_MODEL;

    // ★ マスキングの口：プロバイダに渡す直前で必ず通す（v1は素通し）
    const userContent = maskPII(input.userPrompt);

    const res = await client.messages.create({
      model,
      max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: input.systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });

    const text = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return { text, model };
  }
}

let _provider: LlmProvider | null = null;

/** 既定の LLM プロバイダを返す（今は Anthropic 固定。将来ここで切替）。 */
export function getProvider(): LlmProvider {
  if (!_provider) {
    _provider = new AnthropicProvider();
  }
  return _provider;
}
