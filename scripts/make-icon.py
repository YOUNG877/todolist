"""
生成应用图标（build/icon.ico + build/icon.png）。

与应用内的品牌标记保持一致：圆角蓝底 + 白色对勾。
用法：python scripts/make-icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 256
RADIUS = 58
BG = (79, 141, 253, 255)  # --c-primary #4F8DFD
FG = (255, 255, 255, 255)
STROKE = 26
CHECK = [(70, 133), (111, 174), (188, 86)]

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "build"
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角方块底
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=BG)

    # 对勾：joint="curve" 会让折角处呈圆角
    draw.line(CHECK, fill=FG, width=STROKE, joint="curve")
    # 两端补上圆头，避免看起来是被切断的
    half = STROKE / 2
    for x, y in (CHECK[0], CHECK[-1]):
        draw.ellipse([x - half, y - half, x + half, y + half], fill=FG)

    png_path = OUT_DIR / "icon.png"
    ico_path = OUT_DIR / "icon.ico"
    img.save(png_path)
    img.save(ico_path, sizes=ICO_SIZES)

    print(f"已生成 {png_path}")
    print(f"已生成 {ico_path}（含 {len(ICO_SIZES)} 种尺寸，最大 {SIZE}x{SIZE}）")


if __name__ == "__main__":
    main()
