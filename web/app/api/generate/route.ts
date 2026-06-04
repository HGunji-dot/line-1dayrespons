// ─────────────────────────────────────────────
// POST /api/generate  — AI返信ドラフト生成（フェーズC v1）
//
// 契約:
//   入力  { inboundText: string, tags: string[], displayName?: string, n?, exN? }
//   出力  { draft, usedTemplates[], usedExamples[], model }
//
// 流れ（メモリ line-1dayrespons-backend-plan）:
//   タグは「人が確定した入力」前提（タグ推定はこの段では行わない）。
//   1. match_templates RPC … タグOR + title類似で templates 上位 n 件
//   2. match_examples  RPC … 承認済み reply_feedback 上位 exN 件（初期は0件）
//   3. provider アダプタ（Claude Haiku 4.5 既定）でリライト
//
// N（取得件数）は env 既定をリクエストで上書き可（最適解の模索のため）。
// ─────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getProvider } from "@/lib/llm/provider";
import {
  SHOP_PERSONA,
  buildUserPrompt,
  type RetrievedTemplate,
  type RetrievedExample,
} from "@/lib/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 取得件数の既定（env で調整可。最適解の模索用）
const DEFAULT_TEMPLATE_N = Number(process.env.GENERATE_TEMPLATE_N ?? 6);
const DEFAULT_EXAMPLE_N = Number(process.env.GENERATE_EXAMPLE_N ?? 4);

interface GenerateBody {
  inboundText?: string;
  tags?: string[];
  displayName?: string;
  n?: number; // templates 件数の上書き
  exN?: number; // examples 件数の上書き
}

export async function POST(req: Request) {
  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const inboundText = (body.inboundText ?? "").trim();
  const tags = (body.tags ?? []).filter((t) => typeof t === "string" && t.length > 0);
  const displayName = body.displayName?.trim() || undefined;
  const templateN = Number.isFinite(body.n) ? Number(body.n) : DEFAULT_TEMPLATE_N;
  const exampleN = Number.isFinite(body.exN) ? Number(body.exN) : DEFAULT_EXAMPLE_N;

  if (tags.length === 0) {
    return NextResponse.json(
      { error: "tags is required (タグ推定はこの段では行わない。人が確定したタグを渡すこと)" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  // 1 & 2. 取得（並列）
  const [tplRes, exRes] = await Promise.all([
    supabase.rpc("match_templates", {
      inbound: inboundText,
      tag_labels: tags,
      limit_n: templateN,
    }),
    supabase.rpc("match_examples", {
      inbound: inboundText,
      tag_labels: tags,
      limit_n: exampleN,
    }),
  ]);

  if (tplRes.error) {
    return NextResponse.json(
      { error: `match_templates failed: ${tplRes.error.message}` },
      { status: 500 }
    );
  }
  if (exRes.error) {
    return NextResponse.json(
      { error: `match_examples failed: ${exRes.error.message}` },
      { status: 500 }
    );
  }

  const templates = (tplRes.data ?? []) as Array<
    RetrievedTemplate & { id: string; similarity: number }
  >;
  const examples = (exRes.data ?? []) as Array<
    RetrievedExample & { id: number; tags: string[]; similarity: number }
  >;

  // 0件フォールバック（合意: 該当テンプレ0件なら生成せず人手へ）
  if (templates.length === 0 && examples.length === 0) {
    return NextResponse.json(
      {
        draft: null,
        fallback: "人手対応",
        reason: "該当するテンプレ・承認済み実例が0件のため、AI生成を見送りました。",
        usedTemplates: [],
        usedExamples: [],
      },
      { status: 200 }
    );
  }

  // 3. リライト
  const userPrompt = buildUserPrompt({
    inboundText,
    tags,
    templates: templates.map((t) => ({ tag_label: t.tag_label, title: t.title, body: t.body })),
    examples: examples.map((e) => ({ inbound_text: e.inbound_text, sent: e.sent })),
    displayName,
  });

  let draft: string;
  let model: string;
  try {
    const out = await getProvider().generate({
      systemPrompt: SHOP_PERSONA,
      userPrompt,
    });
    draft = out.text;
    model = out.model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `generation failed: ${msg}` }, { status: 502 });
  }

  return NextResponse.json({
    draft,
    model,
    usedTemplates: templates.map((t) => ({
      id: t.id,
      tagLabel: t.tag_label,
      title: t.title,
      similarity: t.similarity,
    })),
    usedExamples: examples.map((e) => ({
      id: e.id,
      inboundText: e.inbound_text,
      similarity: e.similarity,
    })),
  });
}
