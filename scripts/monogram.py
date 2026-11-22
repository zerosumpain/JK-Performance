#!/usr/bin/env python3
"""The interim JK monogram: one vector, drawn as a ligature.

The J's stem is also the K's stem: a hairline top serif, the J descending
below the baseline into a ball terminal, the K's hairline arm and heavy leg
springing from the stem. Thick and thin strokes, like a Didone capital.

Every part is a closed clockwise outline (screen coordinates, y down), so the
union fills with the non-zero rule on every renderer. Writes
docs/design/brand/jk-monogram.svg; the same path string is pasted into
ios/JKPerformance/Design/Components/Monogram.swift (MonogramShape.pathData) and
read by scripts/app-icon.py. Android carries it in android/app/src/main/res/drawable/
(jk_monogram, ic_notification, ic_launcher_foreground, ic_launcher_monochrome).
No dependencies.

    python3 scripts/monogram.py            # rewrite the SVG and print the path
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs/design/brand/jk-monogram.svg"
CHAMPAGNE = "#C8A970"

# Drawn on a 100-unit square; normalised to sit centred afterwards.
PARTS = [
    # J: stem, descender and ball terminal.
    [("M", 41, 16), ("L", 51, 16), ("L", 51, 64),
     ("C", 51, 79, 44, 88, 32, 88),
     ("C", 25, 88, 20, 84, 20, 79),
     ("C", 20, 75, 23, 72, 27, 72),
     ("C", 31, 72, 34, 75, 34, 79),
     ("C", 38, 78, 41, 73, 41, 64), ("Z",)],
    # Shared hairline top serif with small brackets into the stem.
    [("M", 31, 13), ("L", 61, 13), ("L", 61, 16), ("C", 55, 16, 52, 17, 51, 19),
     ("L", 41, 19), ("C", 40, 17, 37, 16, 31, 16), ("Z",)],
    # K arm: a hairline from the stem up to the cap line.
    [("M", 51, 50), ("L", 77.5, 16), ("L", 82, 16), ("L", 51, 56), ("Z",)],
    # Arm serif.
    [("M", 72, 13), ("L", 89, 13), ("L", 89, 16), ("L", 72, 16), ("Z",)],
    # K leg: the heavy diagonal down to the baseline.
    [("M", 58, 42.5), ("L", 64, 35), ("L", 90, 70), ("L", 79, 70), ("Z",)],
    # Leg foot serif.
    [("M", 74, 67), ("L", 94, 67), ("L", 94, 70), ("L", 74, 70), ("Z",)],
]


def points(part, steps=16):
    """Flatten one outline to a polygon."""
    out, cur = [], None
    for cmd in part:
        if cmd[0] in "ML":
            cur = (cmd[1], cmd[2])
            out.append(cur)
        elif cmd[0] == "C":
            x0, y0 = cur
            x1, y1, x2, y2, x3, y3 = cmd[1:]
            for i in range(1, steps + 1):
                t = i / steps
                a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                out.append((a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3))
            cur = (x3, y3)
    return out


def signed_area(poly):
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1])) / 2


def normalised():
    """Centre the drawing in the 100-unit square, keeping its size."""
    polys = [points(p) for p in PARTS]
    xs = [x for poly in polys for x, _ in poly]
    ys = [y for poly in polys for _, y in poly]
    dx = 50 - (min(xs) + max(xs)) / 2
    dy = 50 - (min(ys) + max(ys)) / 2
    parts = []
    for part, poly in zip(PARTS, polys):
        # Clockwise on screen (y down) is a positive shoelace area.
        assert signed_area(poly) > 0, f"part starting {part[0]} is anticlockwise"
        moved = []
        for cmd in part:
            if cmd[0] == "Z":
                moved.append(cmd)
            else:
                nums = [v + (dx if i % 2 == 0 else dy) for i, v in enumerate(cmd[1:])]
                moved.append((cmd[0], *nums))
        parts.append(moved)
    return parts


def fmt(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def path_data(parts=None):
    parts = parts or normalised()
    return " ".join(" ".join([cmd[0]] + [fmt(v) for v in cmd[1:]]) for part in parts for cmd in part)


def polygons():
    """Flattened outlines in 0..100 units, for rasterising (app-icon.py)."""
    return [points(p, steps=48) for p in normalised()]


if __name__ == "__main__":
    d = path_data()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="JK">\n'
        "  <title>JK monogram (interim)</title>\n"
        f'  <path fill="{CHAMPAGNE}" fill-rule="nonzero" d="{d}"/>\n'
        "</svg>\n")
    print(d)
