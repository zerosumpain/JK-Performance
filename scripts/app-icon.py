#!/usr/bin/env python3
"""Render the app icon: the champagne JK monogram (scripts/monogram.py) on the
warm off-black ground, with a fine bone ring echoing the weight plate of the
opening animation. Atelier tokens: bg #0E0D0C, accent #C8A970, text #F2EEE7.

Needs Pillow. porkserv has no imaging library, so run it in a container:

    docker run --rm -v "$PWD:/w" -w /w python:3.12-slim \
      sh -c "pip install -q pillow && python scripts/app-icon.py"

Pass an output path to render a preview elsewhere. RGB with no alpha channel,
because App Store Connect refuses an icon that has one.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from monogram import polygons  # noqa: E402

SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "ios/JKPerformance/Assets.xcassets/AppIcon.appiconset/AppIcon.png"

BG = (0x0E, 0x0D, 0x0C)
ACCENT = (0xC8, 0xA9, 0x70)
# Bone at about 18% over the ground: present, never louder than the monogram.
RING = (0x37, 0x35, 0x33)

MONOGRAM = 0.62  # the monogram's 100-unit square as a share of the icon
RING_RADIUS = 0.40  # of the icon side
RING_WIDTH = 6  # px at 1024


def main(out):
    k = 4  # draw at 4x and scale down for smooth edges
    big = SIZE * k
    img = Image.new("RGB", (big, big), BG)
    d = ImageDraw.Draw(img)

    r = RING_RADIUS * big
    c = big / 2
    d.ellipse([c - r, c - r, c + r, c + r], outline=RING, width=RING_WIDTH * k)

    unit = MONOGRAM * big / 100
    lo = (big - 100 * unit) / 2
    for poly in polygons():
        d.polygon([(lo + x * unit, lo + y * unit) for x, y in poly], fill=ACCENT)

    img.resize((SIZE, SIZE), Image.LANCZOS).save(out, "PNG", optimize=True)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
