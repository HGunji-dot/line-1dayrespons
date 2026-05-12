/**
 * check-unreplied-notify Edge Function
 *
 * cron-job.org などの外部スケジューラーから HTTP POST で呼び出す。
 * check_unreplied.py と同等の処理を Deno で実装。
 *
 * 認証: Authorization: Bearer <NOTIFY_SECRET>
 *   NOTIFY_SECRET は Supabase の Edge Function シークレットに設定する。
 *   cron-job.org のリクエストヘッダーに同じ値を設定すること。
 *
 * 環境変数（Supabase Secrets）:
 *   NOTIFY_SECRET             ... この Function を呼ぶための秘密鍵
 *   SUPABASE_URL              ... 自動設定
 *   SUPABASE_SERVICE_ROLE_KEY ... 自動設定
 *   LINE_CHANNEL_ACCESS_TOKEN ... LINE Messaging API トークン
 *   ADMIN_NOTIFY_USER_IDS     ... 通知先 LINE ユーザーID（カンマ区切り）
 *   UNREPLIED_HOURS           ... 未返信とみなす時間数（デフォルト: 24）
 *   RE_NOTIFY_HOURS           ... 再通知間隔（時間）（デフォルト: 24）
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── 定数 ───────────────────────────────────────────────────────────────────
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast";
const LINE_TEXT_MAX_CHARS = 4500;

// ─── 型 ─────────────────────────────────────────────────────────────────────
interface UnrepliedUser {
  user_id: string;
  display_name: string | null;
  unreplied_count: number;
  oldest_received_at: string;
  oldest_text: string | null;
  is_first_notify: boolean;
}

// ─── ユーティリティ ──────────────────────────────────────────────────────────
function nowJst(): Date {
  return new Date(Date.now() + JST_OFFSET_MS);
}

function formatJst(isoStr: string): string {
  const d = new Date(new Date(isoStr).getTime() + JST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatNowJst(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** 日本の祝日判定（内閣府の祝日データを使う簡易実装）
 *  完全な実装は syukujitsu API を呼ぶか、固定リストを使う。
 *  ここでは内閣府 CSV の公開 API を使用する。
 */
async function isJapaneseHoliday(dateStr: string): Promise<boolean> {
  try {
    const res = await fetch(
      "https://holidays-jp.github.io/api/v1/date.json",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return false;
    const holidays: Record<string, string> = await res.json();
    return dateStr in holidays;
  } catch {
    // API が落ちていても処理を止めない（通知は送る）
    console.warn("祝日 API へのアクセスに失敗しました。祝日スキップをスキップします。");
    return false;
  }
}

function isSkipDay(now: Date): boolean {
  // now は JST 時刻として扱う（UTC にオフセット済みの Date）
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
  return dayOfWeek === 0; // 日曜のみここで判定、祝日は非同期で別途確認
}

function buildHeader(userCount: number, now: Date, forceTest: boolean): string {
  const tag = forceTest ? "【テスト送信】" : "";
  return (
    `\n${tag}【未返信アラート】${formatNowJst(now)} JST\n` +
    `${UNREPLIED_HOURS}時間以上返信がないお客様: ${userCount} 件\n` +
    `（最古の未返信メッセージの受信日時・表示名）\n` +
    "─".repeat(24)
  );
}

function buildReportLine(index: number, user: UnrepliedUser): string {
  const received = formatJst(user.oldest_received_at);
  const name = user.display_name || user.user_id;
  return `\n${index}. ${received}  ${name}`;
}

function splitIntoMessages(
  users: UnrepliedUser[],
  now: Date,
  forceTest: boolean
): string[] {
  const header = buildHeader(users.length, now, forceTest);
  const messages: string[] = [];
  let current = header;

  for (let i = 0; i < users.length; i++) {
    const block = buildReportLine(i + 1, users[i]);
    if (current.length + block.length > LINE_TEXT_MAX_CHARS) {
      messages.push(current);
      current = header + `\n（続き ${messages.length + 1}）` + block;
    } else {
      current += block;
    }
  }
  if (current) messages.push(current);
  return messages;
}

async function sendLineMessage(
  recipientIds: string[],
  text: string,
  token: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const url = recipientIds.length === 1 ? LINE_PUSH_URL : LINE_MULTICAST_URL;
  const payload =
    recipientIds.length === 1
      ? { to: recipientIds[0], messages: [{ type: "text", text }] }
      : { to: recipientIds, messages: [{ type: "text", text }] };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE API error ${res.status}: ${body}`);
  }
}

// ─── 環境変数 ────────────────────────────────────────────────────────────────
const NOTIFY_SECRET = Deno.env.get("NOTIFY_SECRET") ?? "";
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const ADMIN_IDS_RAW = Deno.env.get("ADMIN_NOTIFY_USER_IDS") ?? "";
const UNREPLIED_HOURS = parseInt(Deno.env.get("UNREPLIED_HOURS") ?? "24", 10);
const RE_NOTIFY_HOURS = parseInt(Deno.env.get("RE_NOTIFY_HOURS") ?? "24", 10);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ─── メインハンドラー ─────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Bearer 認証
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!NOTIFY_SECRET || authHeader !== `Bearer ${NOTIFY_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  // force_test フラグ（ボディから取得）
  let forceTest = false;
  try {
    const body = await req.json().catch(() => ({}));
    forceTest = !!body.force_test;
  } catch { /* ignore */ }

  const now = nowJst();
  console.log(`実行開始: ${formatNowJst(now)} JST / force_test=${forceTest}`);

  // 日曜スキップ
  if (!forceTest && isSkipDay(now)) {
    console.log("日曜日のためスキップします。");
    return json({ skipped: true, reason: "sunday" });
  }

  // 祝日スキップ
  if (!forceTest) {
    const ymd = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const isHoliday = await isJapaneseHoliday(ymd);
    if (isHoliday) {
      console.log(`祝日（${ymd}）のためスキップします。`);
      return json({ skipped: true, reason: "holiday", date: ymd });
    }
  }

  // 環境変数チェック
  if (!LINE_TOKEN) return json({ error: "LINE_CHANNEL_ACCESS_TOKEN が未設定です" }, 500);
  const adminIds = ADMIN_IDS_RAW.split(",").map(s => s.trim()).filter(Boolean);
  if (adminIds.length === 0) return json({ error: "ADMIN_NOTIFY_USER_IDS が未設定です" }, 500);

  // 閾値: 今から UNREPLIED_HOURS 時間前
  const thresholdMs = Date.now() - UNREPLIED_HOURS * 60 * 60 * 1000;
  const thresholdIso = new Date(thresholdMs).toISOString();
  console.log(`閾値: ${thresholdIso} / 再通知間隔: ${RE_NOTIFY_HOURS}時間`);

  // 未返信ユーザー取得
  const { data: users, error: rpcError } = await supabase.rpc(
    "get_unreplied_users",
    { threshold_time: thresholdIso, re_notify_hours: RE_NOTIFY_HOURS }
  );

  if (rpcError) {
    console.error("get_unreplied_users エラー:", rpcError);
    return json({ error: "DB query failed", detail: rpcError.message }, 500);
  }

  const unrepliedUsers: UnrepliedUser[] = users ?? [];

  if (unrepliedUsers.length === 0) {
    console.log("通知対象のお客様はいません。");
    if (forceTest) {
      // テスト時は0件でも送信
      const msg =
        buildHeader(0, now, true) +
        "\n\n（テスト送信です。条件を満たす未返信ユーザーはありません。）";
      await sendLineMessage(adminIds, msg, LINE_TOKEN);
      console.log("テスト用 LINE Push 送信完了（0件）。");
    }
    return json({ notified: 0, skipped: false });
  }

  console.log(`通知対象ユーザー: ${unrepliedUsers.length}件`);
  const messages = splitIntoMessages(unrepliedUsers, now, forceTest);

  for (let i = 0; i < messages.length; i++) {
    await sendLineMessage(adminIds, messages[i], LINE_TOKEN);
    console.log(`LINE Push 送信完了 (${i + 1}/${messages.length})`);
  }

  // 通知ログ記録（テスト時は記録しない）
  if (!forceTest) {
    for (const user of unrepliedUsers) {
      const { error } = await supabase.rpc("record_notification", {
        target_user_id: user.user_id,
      });
      if (error) console.warn(`notification_log 更新失敗: ${user.user_id}`, error);
    }
    console.log("通知ログ記録完了。");
  }

  return json({ notified: unrepliedUsers.length, skipped: false });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
