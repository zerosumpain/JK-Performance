#!/usr/bin/env python3
"""Render the app icon: a silver "JK" in a rounded square on black, the mark
from the welcome screen. Standard library only (porkserv has no imaging
library). RGB with no alpha channel, because App Store Connect refuses an icon
that has one.

    python3 scripts/app-icon.py
"""
import json
import math
import struct
import zlib
from pathlib import Path

SIZE = 1024
OUT = Path(__file__).resolve().parent.parent / "ios/JKPerformance/Assets.xcassets/AppIcon.appiconset"

# Strokes as (polyline, half-width), in 1024-space.
def arc(cx, cy, r, a0, a1, n=24):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

LETTER = 30
J = [(372, 392), (482, 392)], [(452, 392), (452, 560)] , [(452, 560)] + arc(402, 560, 50, 0, 180) + [(352, 536)]
K = [(552, 392), (552, 632)], [(552, 532), (672, 392)], [(590, 490), (680, 632)]
STROKES = [(p, LETTER) for p in (*J, *K)]

BOX = (232, 792, 96)  # lo, hi, corner radius
BOX_HALF = 7


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def box_dist(px, py):
    lo, hi, r = BOX
    c = (lo + hi) / 2
    h = (hi - lo) / 2 - r
    qx, qy = abs(px - c) - h, abs(py - c) - h
    outside = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r
    return abs(outside)


SEGS = [(p[i], p[i + 1], w) for p, w in STROKES for i in range(len(p) - 1)]


def coverage(d, half):
    return max(0.0, min(1.0, half + 0.5 - d))


def silver(y):
    t = (y - 360) / 300
    return 0.97 - 0.32 * max(0.0, min(1.0, t)) + 0.2 * max(0.0, t - 0.7)


def main():
    rows = []
    for y in range(SIZE):
        row = bytearray([0])
        for x in range(SIZE):
            # Ground: near-black, a touch lighter at the top.
            g = 0.02 + 0.06 * (1 - y / SIZE) * max(0.0, 1 - math.hypot(x - 512, y - 300) / 700)
            a = coverage(box_dist(x, y), BOX_HALF) * 0.75
            if 340 <= x <= 720 and 360 <= y <= 670:
                for (ax, ay), (bx, by), w in SEGS:
                    a = max(a, coverage(seg_dist(x, y, ax, ay, bx, by), w))
                    if a >= 1:
                        break
            v = g + (silver(y) - g) * a
            c = int(max(0, min(255, round(v * 255))))
            row += bytes((c, c, c))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "AppIcon.png").write_bytes(png)
    (OUT / "Contents.json").write_text(json.dumps({
        "images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
        "info": {"author": "xcode", "version": 1},
    }, indent=2) + "\n")
    print("wrote", OUT / "AppIcon.png")


if __name__ == "__main__":
    main()
