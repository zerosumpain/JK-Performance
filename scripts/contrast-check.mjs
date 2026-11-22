#!/usr/bin/env node
// Asserts the Atelier colour pairs (docs/design/atelier-spec.md, Tokens) meet
// WCAG 2.x contrast in both modes, using the WCAG relative-luminance formula,
// and that each platform's token file carries exactly these values.
//
//   node scripts/contrast-check.mjs            # every check; exit 1 on any failure
//
// Text pairs need 4.5:1; state-bearing graphics (input borders, the not-done
// dot outline, booking-kind dots) need 3:1 (WCAG 1.4.11). Translucent tokens
// are composited over the surface they sit on before measuring.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The spec's tokens. rgba values are [r, g, b, alpha]. */
export const TOKENS = {
  dark: {
    bg: '#0E0D0C', surface: '#171614', raised: '#211F1C', paper: '#1A1815', hairline: '#2E2B27',
    inputBorder: '#6B655C', track: [242, 238, 231, 0.10], trackStrong: [242, 238, 231, 0.40], scrim: [14, 13, 12, 0.60],
    text: '#F2EEE7', textSecondary: '#A39D94', textTertiary: '#8A847B',
    accent: '#C8A970', accentPressed: '#B08F52', accentWash: [200, 169, 112, 0.16], accentControl: '#F2EEE7',
    primaryFill: '#F2EEE7', primaryLabel: '#0E0D0C', primaryPressed: '#DCD6CC',
    onTrack: '#9FB39A', attention: '#D98E5B', data: '#8FA3B3', error: '#C9735F', urgent: '#E8816F',
    inPerson: '#8FA3B3', video: '#A898C4', group: '#9FB39A',
  },
  light: {
    bg: '#F5F0E8', surface: '#FBF8F3', raised: '#EDE6DA', paper: '#FBF6EC', hairline: '#DDD5C8',
    inputBorder: '#8F887E', track: [28, 26, 23, 0.08], trackStrong: '#86817A', scrim: [14, 13, 12, 0.60],
    text: '#1C1A17', textSecondary: '#5E5950', textTertiary: '#66615A',
    accent: '#7A5C2C', accentPressed: '#664C22', accentWash: [122, 92, 44, 0.10], accentControl: '#1C1A17',
    primaryFill: '#1C1A17', primaryLabel: '#FBF8F3', primaryPressed: '#3A3631',
    onTrack: '#4F6B4A', attention: '#9A5530', data: '#4A6072', error: '#9A4632', urgent: '#A8432F',
    inPerson: '#4A6072', video: '#6A5A8E', group: '#4F6B4A',
  },
};

const GROUNDS = ['bg', 'surface', 'raised', 'paper'];
const TEXT = 4.5;
const GRAPHIC = 3;

/** [foreground, background, minimum] per mode. textTertiary is never on raised (lint enforces the usage). */
export function pairs(mode) {
  const list = [];
  const on = (fg, grounds, min) => grounds.forEach((g) => list.push([fg, g, min]));
  on('text', GROUNDS, TEXT);
  on('textSecondary', GROUNDS, TEXT);
  on('textTertiary', ['bg', 'surface', 'paper'], TEXT);
  on('accent', GROUNDS, TEXT);
  list.push(['accent', 'accentWash', TEXT]);
  list.push(['primaryLabel', 'primaryFill', TEXT], ['primaryLabel', 'primaryPressed', TEXT]);
  on('inputBorder', ['bg', 'surface'], GRAPHIC);
  on('trackStrong', mode === 'dark' ? ['bg', 'surface'] : GROUNDS, GRAPHIC);
  for (const status of ['onTrack', 'attention', 'data', 'error', 'urgent']) on(status, mode === 'dark' ? ['bg', 'surface', 'raised'] : GROUNDS, TEXT);
  for (const kind of ['inPerson', 'video', 'group']) on(kind, ['bg', 'surface'], GRAPHIC);
  return list;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A token as opaque RGB, compositing a translucent one over `under`. */
function solid(value, under) {
  if (typeof value === 'string') return hex(value);
  const [r, g, b, a] = value;
  return [r, g, b].map((c, i) => Math.round(c * a + under[i] * (1 - a)));
}

function luminance([r, g, b]) {
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function checkPairs() {
  let failed = 0;
  for (const mode of Object.keys(TOKENS)) {
    const t = TOKENS[mode];
    const bg = hex(t.bg);
    for (const [fg, ground, min] of pairs(mode)) {
      // A translucent ground (accentWash) sits on bg; a translucent foreground sits on its ground.
      const under = solid(t[ground], bg);
      const over = solid(t[fg], under);
      const r = ratio(over, under);
      const ok = r >= min;
      if (!ok) failed++;
      if (!ok || process.env.VERBOSE) console.log(`${ok ? 'ok  ' : 'FAIL'} ${mode.padEnd(5)} ${fg} on ${ground}: ${r.toFixed(2)} (needs ${min})`);
    }
  }
  return failed;
}

/** Android: design/Tokens.kt JKPalette.Dark and .Light must hold the spec values. */
function checkAndroid() {
  const file = join(root, 'android/app/src/main/java/com/jkperformance/app/design/Tokens.kt');
  if (!existsSync(file)) return 0;
  const src = readFileSync(file, 'utf8');
  let failed = 0;
  for (const [mode, block] of [['dark', 'val Dark = JKPalette('], ['light', 'val Light = JKPalette(']]) {
    const start = src.indexOf(block);
    if (start < 0) { console.log(`FAIL android: no ${block}`); failed++; continue; }
    const body = src.slice(start, src.indexOf('\n        )', start));
    for (const [name, value] of Object.entries(TOKENS[mode])) {
      const m = body.match(new RegExp(`\\b${name} = Color\\(0x([0-9A-Fa-f]{8})\\)`));
      if (!m) { console.log(`FAIL android ${mode}.${name}: missing`); failed++; continue; }
      const argb = m[1].toUpperCase();
      const want = typeof value === 'string'
        ? `FF${value.slice(1).toUpperCase()}`
        : Math.round(value[3] * 255).toString(16).padStart(2, '0').toUpperCase() + value.slice(0, 3).map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
      if (argb !== want) { console.log(`FAIL android ${mode}.${name}: 0x${argb}, spec 0x${want}`); failed++; }
    }
  }
  return failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failed = checkPairs() + checkAndroid();
  const count = Object.keys(TOKENS).reduce((n, m) => n + pairs(m).length, 0);
  if (failed) { console.error(`contrast-check: ${failed} failure(s)`); process.exit(1); }
  console.log(`contrast-check: ${count} pairs pass in both modes; platform tokens match the spec`);
}
