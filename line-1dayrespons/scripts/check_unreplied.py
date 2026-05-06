"""
LINE未返信チェックスクリプト

毎時GitHub Actionsから実行される。
- 今日が日曜日または日本の祝日なら何もしない
- Supabase RPC で DB 側集計した未返信ユーザー一覧を取得する
  （初回通知 or 前回通知から RE_NOTIFY_HOURS 時間経過したユーザーのみ）
- 経過時間の長い順に並べ、Messaging API（Push / Multicast）で管理者に送信する
  （LINE Notify は 2025/3/31 終了のため未使用）
- 送信後に notification_log へ記録（次回の重複通知を防ぐ）
- 1通あたりの文字数上限を超える場合は複数回に分けて送信する
"""

import os
import sys
from datetime import datetime, timedelta, timezone

import jpholiday
import requests
from supabase import create_client, Client

# --- 定数 ---
JST = timezone(timedelta(hours=9))
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
LINE_CHANNEL_ACCESS_TOKEN = os.environ["LINE_CHANNEL_ACCESS_TOKEN"]
UNREPLIED_HOURS = int(os.getenv("UNREPLIED_HOURS", "24"))
# 同じユーザーへの再通知間隔（デフォルト24時間）
RE_NOTIFY_HOURS = int(os.getenv("RE_NOTIFY_HOURS", "24"))

LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"
LINE_MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast"
# Messaging API テキストメッセージ上限 5000 文字（マージンを取る）
LINE_TEXT_MAX_CHARS = 4500


def is_skip_day(now: datetime) -> bool:
    """日曜日または日本の祝日なら True を返す"""
    if now.weekday() == 6:
        return True
    if jpholiday.is_holiday(now.date()):
        return True
    return False


def fetch_unreplied(supabase: Client, threshold: datetime) -> list[dict]:
    """
    DB 側の RPC 関数 get_unreplied_users を呼び出す。
    - threshold_time より古い inbound で replied=false のユーザー
    - かつ「初回通知」または「前回通知から RE_NOTIFY_HOURS 時間以上経過」のユーザー
    のみを返す（既に通知済みのユーザーは除外）。
    """
    threshold_iso = threshold.astimezone(timezone.utc).isoformat()
    response = supabase.rpc(
        "get_unreplied_users",
        {
            "threshold_time": threshold_iso,
            "re_notify_hours": RE_NOTIFY_HOURS,
        },
    ).execute()
    return response.data or []


def record_notifications(supabase: Client, users: list[dict]) -> None:
    """通知したユーザー全員の notification_log を更新する"""
    for user in users:
        error = supabase.rpc(
            "record_notification", {"target_user_id": user["user_id"]}
        ).execute()
        if hasattr(error, "error") and error.error:
            print(f"[警告] notification_log 更新失敗: {user['user_id']}")


def format_elapsed(received_at_str: str, now: datetime) -> str:
    """received_at から経過時間を '○時間○分' 形式で返す"""
    received_at = datetime.fromisoformat(received_at_str.replace("Z", "+00:00"))
    delta = now.astimezone(timezone.utc) - received_at.astimezone(timezone.utc)
    total_minutes = int(delta.total_seconds() // 60)
    hours, minutes = divmod(total_minutes, 60)
    if hours >= 48:
        days, remaining_hours = divmod(hours, 24)
        return f"{days}日{remaining_hours}時間（要注意）"
    return f"{hours}時間{minutes}分"


def build_header(user_count: int, now: datetime) -> str:
    return (
        f"\n【未返信アラート】{now.strftime('%Y/%m/%d %H:%M')} 現在\n"
        f"{UNREPLIED_HOURS}時間以上返信がないお客様: {user_count} 件\n"
        + "─" * 18
    )


def build_user_block(index: int, user: dict, now: datetime) -> str:
    elapsed = format_elapsed(user["oldest_received_at"], now)
    snippet = (user["oldest_text"] or "（内容なし）")[:30]
    if len(user["oldest_text"] or "") > 30:
        snippet += "…"
    # 再通知の場合はラベルを付ける
    label = "" if user.get("is_first_notify") else "【再通知】"
    return (
        f"\n{index}. {label}{user['display_name'] or user['user_id']}\n"
        f"   経過: {elapsed} / {user['unreplied_count']}件\n"
        f"   「{snippet}」"
    )


def split_into_messages(users: list[dict], now: datetime) -> list[str]:
    """Messaging API のテキスト1通あたりの上限に収まるよう分割する。"""
    header = build_header(len(users), now)
    messages: list[str] = []
    current = header

    for i, user in enumerate(users, start=1):
        block = build_user_block(i, user, now)
        if len(current) + len(block) > LINE_TEXT_MAX_CHARS:
            messages.append(current)
            current = header + f"\n（続き {len(messages) + 1}）" + block
        else:
            current += block

    if current:
        messages.append(current)

    return messages


def parse_admin_notify_user_ids() -> list[str]:
    """カンマ区切りの LINE ユーザーID（U で始まる）一覧を返す。"""
    raw = os.environ.get("ADMIN_NOTIFY_USER_IDS", "").strip()
    if not raw:
        raise SystemExit(
            "環境変数 ADMIN_NOTIFY_USER_IDS が未設定です。"
            "管理者の LINE ユーザーIDをカンマ区切りで設定してください（例: Uxxx,Uyyy）。"
        )
    ids = [x.strip() for x in raw.split(",") if x.strip()]
    if not ids:
        raise SystemExit("ADMIN_NOTIFY_USER_IDS に有効なユーザーIDがありません。")
    return ids


def send_line_push_multicast(recipient_ids: list[str], text: str) -> None:
    """Messaging API で管理者へテキストを送る（1人なら push、複数なら multicast）。"""
    headers = {
        "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    payload: dict
    url: str
    if len(recipient_ids) == 1:
        url = LINE_PUSH_URL
        payload = {
            "to": recipient_ids[0],
            "messages": [{"type": "text", "text": text}],
        }
    else:
        url = LINE_MULTICAST_URL
        payload = {
            "to": recipient_ids,
            "messages": [{"type": "text", "text": text}],
        }
    res = requests.post(url, headers=headers, json=payload, timeout=15)
    res.raise_for_status()


def main() -> None:
    now = datetime.now(JST)

    if is_skip_day(now):
        print(f"本日({now.strftime('%Y/%m/%d')})は日曜日または祝日のためスキップします。")
        sys.exit(0)

    threshold = now - timedelta(hours=UNREPLIED_HOURS)
    print(
        f"チェック実行: {now.strftime('%Y/%m/%d %H:%M')} JST "
        f"/ 閾値: {threshold.strftime('%Y/%m/%d %H:%M')} JST"
        f"/ 再通知間隔: {RE_NOTIFY_HOURS}時間"
    )

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    users = fetch_unreplied(supabase, threshold)

    if not users:
        print("通知対象のお客様はいません（未返信なし、または通知済み）。")
        sys.exit(0)

    print(f"通知対象ユーザー: {len(users)}件")
    admin_ids = parse_admin_notify_user_ids()
    messages = split_into_messages(users, now)

    for i, msg in enumerate(messages, start=1):
        send_line_push_multicast(admin_ids, msg)
        print(f"LINE Push 送信完了 ({i}/{len(messages)})。")

    # 通知後に notification_log を更新（次回の重複通知を抑制）
    record_notifications(supabase, users)
    print("通知ログ記録完了。")


if __name__ == "__main__":
    main()
