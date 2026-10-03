"""YOMOO のバックアップ（ZIP内の Yomoo.db）を、このアプリで読み戻せるJSONに変換する。

    python tools/yomoo_to_json.py <yomoo_backup_*.zip> [-o 出力先.json]

出力は「設定 → ファイルから読み戻す」で取り込める形式。IDは `yomoo-<元のid>` にするため、
同じ本を何度読み戻しても二重にならず、YOMOO側で更新した本だけが上書きされる。

変換の決まり（2026-09-12にユーザーと確認した内容）
- 読書状態: read → 読んだ / それ以外 → 読みたい
- 評価: YOMOOは0〜100点で50が初期値。50は未評価（★0）、ほかは20点刻みで★1〜5
- 読了日: YOMOOには読了日がないので、YOMOOに登録した日（日本時間）を入れる
- 表紙: 楽天の画像は600pxに拡大。openBD の画像は消えていることがあるので捨てる
- 著者: 「/」「、」「,」で区切り、全角スペースは半角にそろえる
"""
import argparse
import collections
import json
import re
import sqlite3
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

JST = timezone(timedelta(hours=9))


def js_iso(dt):
    """JavaScript の toISOString() と同じ書式（ミリ秒3桁＋Z）にそろえる。"""
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse(ts):
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def to_isbn13(isbn10):
    core = "978" + isbn10[:9]
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(core))
    return core + str((10 - total % 10) % 10)


def authors_of(text):
    parts = re.split(r"[/、,]", text or "")
    return [re.sub(r"\s+", " ", part).strip() for part in parts if part.strip()]


def stars(score):
    if score is None or score == 50 or score <= 0:  # 50 は YOMOO の初期値（未評価）
        return 0
    return max(1, min(5, int(score / 20 + 0.5)))


def cover_of(url):
    if not url or "cover.openbd.jp" in url:
        return ""
    return re.sub(r"_ex=\d+x\d+", "_ex=600x600", url)


def convert(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    books = []
    for row in conn.execute("select * from Book order by createdAt"):
        created = parse(row["createdAt"])
        status = "read" if row["readingStatus"] == "read" else "want"
        books.append({
            "id": f"yomoo-{row['id']}",
            "status": status,
            "title": (row["title"] or "").strip(),
            "authors": authors_of(row["author"]),
            "publisher": (row["publisher"] or "").strip(),
            "pubdate": "",
            "isbn13": to_isbn13(row["asin"]) if row["asin"] else "",
            "isbn10": row["asin"] or "",
            "coverUrl": cover_of(row["cover"]),
            "note": row["memo"] or "",
            "rating": stars(row["score"]),
            "startedAt": "",
            "finishedAt": created.astimezone(JST).strftime("%Y-%m-%d") if status == "read" else "",
            "addedAt": js_iso(created),
            "updatedAt": js_iso(parse(row["updatedAt"])),
        })
    conn.close()  # Windowsでは閉じないと一時フォルダを片づけられない
    return books


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("zip_path", type=Path)
    parser.add_argument("-o", "--out", type=Path, default=Path.home() / "Downloads" / "読書記録-YOMOO移行.json")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as work:
        with zipfile.ZipFile(args.zip_path) as archive:
            name = next(n for n in archive.namelist() if n.endswith(".db"))
            db_path = Path(archive.extract(name, work))
        books = convert(db_path)

    payload = {
        "schema": "readinglog.v1",
        "exportedAt": js_iso(datetime.now(timezone.utc)),
        "books": books,
    }
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = collections.Counter(b["status"] for b in books)
    print(f"{args.out}  {args.out.stat().st_size:,} bytes")
    print(f"{len(books)}冊（読んだ {counts['read']} / 読みたい {counts['want']}）"
          f" 感想あり {sum(1 for b in books if b['note'].strip())}"
          f" 表紙なし {sum(1 for b in books if not b['coverUrl'])}")


if __name__ == "__main__":
    main()
