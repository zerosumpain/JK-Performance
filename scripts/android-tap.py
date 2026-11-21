#!/usr/bin/env python3
"""Tap the on-screen element whose text (or content description) matches, in
the jk-emu emulator: scripts/android-tap.py "I have a code". Exits 1 if absent."""
import re, subprocess, sys
def adb(*a): return subprocess.run(['docker', 'exec', '-e', 'ANDROID_SERIAL=emulator-5560', 'jk-emu', 'adb', *a], capture_output=True, text=True).stdout
adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml')
xml = adb('shell', 'cat', '/sdcard/ui.xml')
want = sys.argv[1]
for node in re.finditer(r'<node [^>]*>', xml):
    n = node.group(0)
    text = re.search(r' text="([^"]*)"', n).group(1); desc = re.search(r'content-desc="([^"]*)"', n).group(1)
    if want in (text, desc) or (len(sys.argv) > 2 and want in text + desc):
        x1, y1, x2, y2 = map(int, re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n).groups())
        adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2)); print('tapped', want); sys.exit(0)
print('not found:', want, '| on screen:', sorted({t for t in re.findall(r' text="([^"]+)"', xml)})[:40]); sys.exit(1)
