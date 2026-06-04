"""
返信テンプレート取り込みスクリプト

既存の Q&A ナレッジ Excel（例: toiawaseqa.xlsx）を読み、
Supabase の tags / templates テーブルへ冪等に投入する。

設計（メモリ line-1dayrespons-backend-plan の合意）:
- 各シート名 = 固定タグ（tags.label）
- 各行 Q列 = templates.title（問い合わせ） / A列 = templates.body（返信文）
- id = sha1(f"{tag}|{title}") の先頭16桁 → 再実行で重複せず更新（冪等）

使い方:
  # 直接 Supabase へ投入（SUPABASE_URL / SUPABASE_KEY=service_role が必要）
  python scripts/import_templates.py --file toiawaseqa.xlsx

  # creds を手元に置かず、Supabase SQL Editor で流す SQL を書き出す
  python scripts/import_templates.py --file toiawaseqa.xlsx --emit-sql seed_templates.sql
"""

import argparse
import hashlib
import os
import sys

import openpyxl

# upsert を分割する1バッチあたりの行数（ペイロード肥大を避ける）
BATCH_SIZE = 500


def template_id(tag: str, title: str) -> str:
    """tag + title から決定的な ID を作る（再インポートで重複しないため）。"""
    digest = hashlib.sha1(f"{tag}|{title}".encode("utf-8")).hexdigest()
    return digest[:16]


def detect_header_row(rows: list[tuple]) -> int | None:
    """先頭セルが 'Q' のヘッダー行のインデックスを返す（シートにより1〜2行目で揺れる）。"""
    for idx, row in enumerate(rows):
        if row and row[0] is not None and str(row[0]).strip() == "Q":
            return idx
    return None


def parse_workbook(path: str) -> tuple[list[str], list[dict]]:
    """
    Excel を読み、(タグ一覧[出現順], テンプレ行一覧) を返す。
    - 空シート / ヘッダーが見つからないシートはスキップ
    - Q（title）が空の行はスキップ（title は検索キー兼 PK の素材のため）
    """
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    tags: list[str] = []
    templates: list[dict] = []
    skipped_empty_q = 0

    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        header_idx = detect_header_row(rows)
        if header_idx is None:
            print(f"  [スキップ] シート「{ws.title}」: Q/A ヘッダーが見つかりません")
            continue

        tag = ws.title.strip()
        count_before = len(templates)
        for row in rows[header_idx + 1:]:
            if not row:
                continue
            title = str(row[0]).strip() if row[0] is not None else ""
            body = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
            if not title:
                if body:
                    skipped_empty_q += 1
                continue
            templates.append(
                {
                    "id": template_id(tag, title),
                    "tag_label": tag,
                    "title": title,
                    "body": body,
                    "source": os.path.basename(path),
                }
            )

        added = len(templates) - count_before
        if added > 0:
            tags.append(tag)
            print(f"  シート「{tag}」: {added} 件")
        else:
            print(f"  [スキップ] シート「{tag}」: 有効な行がありません")

    if skipped_empty_q:
        print(f"  （Q列が空のため除外: {skipped_empty_q} 行）")

    # id 重複（同一タグ内で title が完全一致）を後勝ちで解消
    by_id: dict[str, dict] = {}
    for t in templates:
        by_id[t["id"]] = t
    deduped = list(by_id.values())
    if len(deduped) != len(templates):
        print(f"  （title 重複を統合: {len(templates) - len(deduped)} 行）")

    return tags, deduped


def import_to_supabase(tags: list[str], templates: list[dict]) -> None:
    """tags → templates の順で upsert する。"""
    from supabase import create_client, Client

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit(
            "環境変数 SUPABASE_URL / SUPABASE_KEY（service_role）が未設定です。"
            "creds が無い場合は --emit-sql で SQL を書き出してください。"
        )

    supabase: Client = create_client(url, key)

    tag_rows = [{"label": t, "sort_order": i} for i, t in enumerate(tags)]
    supabase.table("tags").upsert(tag_rows, on_conflict="label").execute()
    print(f"tags upsert 完了: {len(tag_rows)} 件")

    for start in range(0, len(templates), BATCH_SIZE):
        batch = templates[start:start + BATCH_SIZE]
        supabase.table("templates").upsert(batch, on_conflict="id").execute()
        print(f"  templates upsert: {start + len(batch)}/{len(templates)}")
    print(f"templates upsert 完了: {len(templates)} 件")


def sql_escape(value: str) -> str:
    """単純なシングルクォートのエスケープ（PostgreSQL は文字列中の改行を許容する）。"""
    return value.replace("'", "''")


def emit_sql(tags: list[str], templates: list[dict], out_path: str) -> None:
    """直接投入の代わりに、SQL Editor で流せる冪等な seed SQL を書き出す。"""
    lines: list[str] = ["-- 自動生成: 返信テンプレート seed（冪等）", ""]

    for i, tag in enumerate(tags):
        lines.append(
            f"INSERT INTO tags (label, sort_order) VALUES ('{sql_escape(tag)}', {i}) "
            f"ON CONFLICT (label) DO UPDATE SET sort_order = EXCLUDED.sort_order;"
        )
    lines.append("")

    for t in templates:
        lines.append(
            "INSERT INTO templates (id, tag_label, title, body, source, updated_at) VALUES ("
            f"'{t['id']}', "
            f"'{sql_escape(t['tag_label'])}', "
            f"'{sql_escape(t['title'])}', "
            f"'{sql_escape(t['body'])}', "
            f"'{sql_escape(t['source'])}', NOW()) "
            "ON CONFLICT (id) DO UPDATE SET "
            "tag_label = EXCLUDED.tag_label, title = EXCLUDED.title, "
            "body = EXCLUDED.body, source = EXCLUDED.source, updated_at = NOW();"
        )

    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"SQL を書き出しました: {out_path}（tags {len(tags)} / templates {len(templates)}）")


def main() -> None:
    parser = argparse.ArgumentParser(description="返信テンプレート（Q&A Excel）を Supabase へ取り込む")
    parser.add_argument("--file", default="toiawaseqa.xlsx", help="入力 Excel パス")
    parser.add_argument("--emit-sql", dest="emit_sql", default=None,
                        help="直接投入せず、指定パスへ seed SQL を書き出す")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        raise SystemExit(f"ファイルが見つかりません: {args.file}")

    print(f"読み込み: {args.file}")
    tags, templates = parse_workbook(args.file)
    print(f"\n合計: タグ {len(tags)} 件 / テンプレ {len(templates)} 件")

    if not templates:
        raise SystemExit("取り込める行がありませんでした。")

    if args.emit_sql:
        emit_sql(tags, templates, args.emit_sql)
    else:
        import_to_supabase(tags, templates)
    print("完了。")


if __name__ == "__main__":
    main()
