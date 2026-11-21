#!/usr/bin/env python3
"""Render the app icon: the "JK" badge from the top-right corner of the app,
scaled up. A bold white "JK" inside a thin rounded square (60% white) on black,
in the badge's own proportions (30 pt square, 7 pt corners, 1 pt line, 12 pt
bold type).

Needs Pillow and a bold sans font close to SF Pro (Inter Bold is the usual
open stand-in). porkserv has no imaging library, so run it in a container:

    docker run --rm -v "$PWD:/w" -v "$FONT_DIR:/font:ro" -w /w python:3.12-slim \
      sh -c "pip install -q pillow && python scripts/app-icon.py /font/inter-700.woff"

RGB with no alpha channel, because App Store Connect refuses an icon that has one.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "ios/JKPerformance/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

# The badge in points, and how many pixels a point becomes.
BADGE, CORNER, LINE, TYPE = 30, 7, 1, 12
SCALE = 20  # a 600 px badge in the 1024 px icon


def main(font_path):
    # Draw at 4x and scale down for smooth edges.
    k = 4
    img = Image.new("RGB", (SIZE * k, SIZE * k), (0, 0, 0))
    d = ImageDraw.Draw(img)
    side = BADGE * SCALE * k
    lo = (SIZE * k - side) // 2
    line = LINE * SCALE * k
    d.rounded_rectangle([lo, lo, lo + side, lo + side], radius=CORNER * SCALE * k, outline=(153, 153, 153), width=line)

    font = ImageFont.truetype(font_path, TYPE * SCALE * k)
    # Centre on the letters' ink, not the font's line box, as SwiftUI's frame does visually.
    left, top, right, bottom = d.textbbox((0, 0), "JK", font=font)
    x = (SIZE * k - (right - left)) / 2 - left
    y = (SIZE * k - (bottom - top)) / 2 - top
    d.text((x, y), "JK", font=font, fill=(255, 255, 255))

    img.resize((SIZE, SIZE), Image.LANCZOS).save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: app-icon.py <bold-font.ttf|.otf|.woff>")
    main(sys.argv[1])
