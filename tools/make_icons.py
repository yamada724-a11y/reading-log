"""アプリアイコンの生成スクリプト（Googleアプリ風・半透明レイヤー）

ReadingLog のアイコンはこれで作った。別のアプリで同じ系統のアイコンを作るときは、
motif() の中身（モチーフの形と色）だけを差し替え、ほかの部品と書き出し処理はそのまま使う。

    python tools/make_icons.py                # icons/ に全サイズを書き出す
    python tools/make_icons.py --out DIR      # 書き出し先を変える
    python tools/make_icons.py --preview      # 確認用の一覧画像（preview.png）を作る

必要なもの: Pillow（pip install pillow）

デザインの決まりごと
- 色は Google のブランド4色から2〜3色だけ使う
- 背景は白一色。影や縁取りは付けない
- 奥の層を同じ色の半透明（22% / 50%）で少しずつずらして重ね、厚みを出す
- 折り目や重なりの手前に、黒の半透明グラデーション（最大18%）で陰影を入れる
- 線は使わず面だけで描き、角はわずかに丸める
- 2048px で描いてから縮小し、輪郭をなめらかにする
"""
import argparse
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

BLUE = (66, 133, 244)     # #4285F4
RED = (234, 67, 53)       # #EA4335
YELLOW = (251, 188, 4)    # #FBBC04
GREEN = (52, 168, 83)     # #34A853
WHITE = (255, 255, 255)

S = 2048                  # 描画用キャンバス（縮小前）
CORNER = int(S * 0.012)   # 図形の角の丸み

# 書き出すファイル: (ファイル名, px, 背景の角丸比率, maskable)
# iOS は自分で角を丸めるため apple-touch-icon は四角で渡す。
# maskable は Android が円などで切り抜くので、絵柄を中央78%に収める。
OUTPUTS = [
    ("icon-192.png", 192, 0.22, False),
    ("icon-512.png", 512, 0.22, False),
    ("icon-512-maskable.png", 512, 0.0, True),
    ("apple-touch-icon.png", 180, 0.0, False),
    ("favicon-32.png", 32, 0.18, False),
]


# ---------- 汎用の部品（どのモチーフでも使う） ----------

def qbez(p0, p1, p2, n=48):
    """2次ベジェ曲線を折れ線の点列にする。"""
    pts = []
    for i in range(n + 1):
        t = i / n
        a, b, c = (1 - t) ** 2, 2 * (1 - t) * t, t * t
        pts.append((a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]))
    return pts


def to_canvas(points):
    """0〜1 の座標をキャンバスのピクセル座標にする。"""
    return [(x * S, y * S) for x, y in points]


def shape_mask(poly, round_r=CORNER):
    """多角形の塗りマスク。ぼかして二値化し直すことで角を丸める。"""
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    if round_r:
        mask = mask.filter(ImageFilter.GaussianBlur(round_r)).point(lambda v: 255 if v >= 128 else 0)
    return mask


def layer(poly, color, alpha=1.0, round_r=CORNER):
    """単色の面を1枚。alpha で透明度を指定する。"""
    mask = shape_mask(poly, round_r)
    if alpha < 1:
        mask = mask.point(lambda v: int(v * alpha))
    lay = Image.new("RGBA", (S, S), color + (0,))
    lay.putalpha(mask)
    return lay


def fold_shade(poly, edge_x, direction, strength=0.18, reach=0.15, round_r=CORNER):
    """面の中に、edge_x（0〜1）から direction 方向へ薄れていく黒の陰影を入れる。"""
    grad = Image.new("L", (S, S), 0)
    draw = ImageDraw.Draw(grad)
    span = reach * S
    for i in range(int(span)):
        value = int(255 * strength * (1 - i / span) ** 1.6)
        x = edge_x * S + direction * i
        draw.line([(x, 0), (x, S)], fill=value)
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    lay.putalpha(ImageChops.multiply(shape_mask(poly, round_r), grad))
    return lay


# ---------- モチーフ（アプリごとに差し替える部分） ----------

def page(side, dx=0.0, dy=0.0, gap=0.010, width=0.66, height=0.42, curve=0.07):
    """開いた本の片側のページ。side=-1 で左、+1 で右。"""
    cx, cy = 0.5, 0.49
    sx = cx + side * gap
    ox = cx + side * width / 2
    top_out, top_in = cy - height / 2, cy - height / 2 + curve
    bot_out, bot_in = cy + height / 2 - curve * 0.35, cy + height / 2 + curve * 0.65
    top = qbez((ox, top_out), (cx + side * width * 0.18, top_out - curve * 0.35), (sx, top_in))
    bottom = qbez((sx, bot_in), (cx + side * width * 0.18, bot_out + curve * 0.3), (ox, bot_out))
    return to_canvas([(x + side * dx, y + dy) for x, y in top + bottom])


def ribbon(width=0.058, top=0.345, bottom=0.845, notch=0.042):
    """本の中央から垂れるしおり（下端はV字の切り込み）。"""
    w = width / 2
    return to_canvas([(0.5 - w, top), (0.5 + w, top), (0.5 + w, bottom), (0.5, bottom - notch), (0.5 - w, bottom)])


def motif():
    """ReadingLog: 青と黄のページの本に、緑のしおり。"""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 奥のページ: 同じ色を半透明にして、外側・下方向へずらして重ねる
    for offset, alpha in [(0.052, 0.22), (0.026, 0.50)]:
        img.alpha_composite(layer(page(-1, dx=offset * 0.5, dy=offset), BLUE, alpha))
        img.alpha_composite(layer(page(1, dx=offset * 0.5, dy=offset), YELLOW, alpha))

    # 手前のページ + ノド（中央の折り目）の陰影
    left, right = page(-1), page(1)
    img.alpha_composite(layer(left, BLUE))
    img.alpha_composite(layer(right, YELLOW))
    img.alpha_composite(fold_shade(left, 0.5, -1))
    img.alpha_composite(fold_shade(right, 0.5, 1))

    img.alpha_composite(layer(ribbon(), GREEN, round_r=CORNER // 2))
    return img


# ---------- 書き出し ----------

def render(size, radius_ratio=0.22, maskable=False, art=None):
    art = art or motif()
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    if radius_ratio:
        draw.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_ratio), fill=WHITE)
    else:
        draw.rectangle([0, 0, S, S], fill=WHITE)

    if maskable:
        inner = int(S * 0.78)
        small = art.resize((inner, inner), Image.LANCZOS)
        art = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        art.alpha_composite(small, ((S - inner) // 2, (S - inner) // 2))

    base.alpha_composite(art)
    return base.resize((size, size), Image.LANCZOS)


def preview(path):
    """大きい表示・ホーム画面相当の小さい表示・Androidの円形切り抜きを並べた確認用画像。"""
    art = motif()
    sheet = Image.new("RGBA", (300 * 3 + 40 * 4, 380), (232, 234, 237, 255))
    sheet.alpha_composite(render(300, art=art), (40, 40))
    sheet.alpha_composite(render(60, art=art), (40 * 2 + 300 + 120, 40 + 120))
    circle = Image.new("L", (300, 300), 0)
    ImageDraw.Draw(circle).ellipse([0, 0, 299, 299], fill=255)
    sheet.paste(render(300, 0.0, maskable=True, art=art), (40 * 3 + 600, 40), circle)
    sheet.save(path)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "icons")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()

    if args.preview:
        print(preview(Path.cwd() / "preview.png"))
        return

    args.out.mkdir(parents=True, exist_ok=True)
    art = motif()
    for name, size, radius, maskable in OUTPUTS:
        render(size, radius, maskable, art=art).save(args.out / name)
    print("written to", args.out)


if __name__ == "__main__":
    main()
