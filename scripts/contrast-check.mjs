#!/usr/bin/env node
// Contrast check for the Plan. Act. Review. tokens (docs/design/plan-act-review.md, "Look").
//
// 1. Asserts every pair the spec promises with the WCAG 2.x relative-luminance
//    formula: text pairs at 4.5:1, non-text (input borders, the strong track,
//    silver marks, booking-kind dots) at 3:1. Translucent tokens are composited
//    over the surface they sit on first. The palette is dark only (light mode is
//    out of scope), so only the dark values are measured and compared.
// 2. Checks each platform's token file still carries the spec's values, so a
//    hand edit cannot drift from what was measured. Platforms whose file does
//    not exist yet are skipped.
//
// Usage: node scripts/contrast-check.mjs [ios|android]... [--verbose]
//   With platform names, only those platforms' token files are compared (each
//   platform's CI checks its own file); with none, every platform is.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const platforms = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const wants = (name) => platforms.length === 0 || platforms.includes(name);

// The spec's tokens: [hex, alpha]. Alpha 1 unless stated. Dark only.
// Deviation from the spec table: trackStrong is #6B6B6B, not #5C5C5C, because
// #5C5C5C measures 2.80:1 on surface and it carries meaning (missed, not yet).
const TOKENS = {
  bg: { dark: ['0A0A0A'] },
  surface: { dark: ['121212'] },
  raised: { dark: ['1A1A1A'] },
  paper: { dark: ['121212'] },
  hairline: { dark: ['262626'] },
  inputBorder: { dark: ['6B6B6B'] },
  buttonBorder: { dark: ['3A3A3A'] },
  track: { dark: ['FFFFFF', 0.10] },
  trackStrong: { dark: ['6B6B6B'] },
  scrim: { dark: ['000000', 0.60] },
  text: { dark: ['F2F2F2'] },
  textSecondary: { dark: ['A3A3A3'] },
  textTertiary: { dark: ['8A8A8A'] },
  silver: { dark: ['D9D9D9'] },
  chromeTop: { dark: ['FAFAFA'] },
  chromeMid: { dark: ['BEBEBE'] },
  chromeBottom: { dark: ['E8E8E8'] },
  onChrome: { dark: ['0A0A0A'] },
  accent: { dark: ['D9D9D9'] },
  accentPressed: { dark: ['BEBEBE'] },
  accentWash: { dark: ['D9D9D9', 0.12] },
  accentControl: { dark: ['F2F2F2'] },
  primaryFill: { dark: ['E8E8E8'] },
  primaryPressed: { dark: ['BEBEBE'] },
  onPrimary: { dark: ['0A0A0A'] },
  onTrack: { dark: ['9FB39A'] },
  attention: { dark: ['D98E5B'] },
  data: { dark: ['B0B0B0'] },
  error: { dark: ['C9735F'] },
  urgent: { dark: ['E8816F'] },
  kindInPerson: { dark: ['D9D9D9'] },
  kindVideo: { dark: ['A3A3A3'] },
  kindGroup: { dark: ['8C8C8C'] },
};
const MODES = ['dark'];

const TEXT = 4.5;
const NON_TEXT = 3;
const ALL_SURFACES = ['bg', 'surface', 'raised', 'paper'];
const STATUS_SURFACES = ['bg', 'surface', 'raised'];

// [foreground, backgrounds, minimum, note]
const PAIRS = [
  ['text', ALL_SURFACES, TEXT],
  ['textSecondary', ALL_SURFACES, TEXT],
  // Never below 4.5:1, raised included (5.0:1).
  ['textTertiary', ALL_SURFACES, TEXT],
  ['silver', ALL_SURFACES, TEXT],
  ['accent', ALL_SURFACES, TEXT],
  ['accent', ['accentWash'], TEXT, 'the goal target band'],
  ['onChrome', ['chromeTop', 'chromeMid', 'chromeBottom'], TEXT, 'primary button label on the chrome'],
  ['onPrimary', ['primaryFill', 'primaryPressed'], TEXT, 'selected chip and send button'],
  ['onTrack', STATUS_SURFACES, TEXT],
  ['attention', STATUS_SURFACES, TEXT],
  ['data', STATUS_SURFACES, TEXT],
  ['error', STATUS_SURFACES, TEXT],
  ['urgent', STATUS_SURFACES, TEXT],
  ['inputBorder', ['bg', 'surface'], NON_TEXT, 'input boundary'],
  ['trackStrong', ['bg', 'surface'], NON_TEXT, 'missed ring, not-done week dot'],
  ['kindInPerson', ['bg', 'surface'], NON_TEXT, 'booking dot'],
  ['kindVideo', ['bg', 'surface'], NON_TEXT, 'booking dot'],
  ['kindGroup', ['bg', 'surface'], NON_TEXT, 'booking dot'],
];

const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A token as opaque RGB, composited over `under` (RGB) when translucent. */
function solid(name, mode, under) {
  const [hex, alpha = 1] = TOKENS[name][mode];
  const fg = rgb(hex);
  if (alpha >= 1) return fg;
  if (!under) throw new Error(`${name} is translucent in ${mode}; it needs a background`);
  return fg.map((c, i) => c * alpha + under[i] * (1 - alpha));
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const failures = [];
let checked = 0;

for (const mode of MODES) {
  const ground = solid('bg', mode);
  for (const [fg, backgrounds, min, note] of PAIRS) {
    for (const bgName of backgrounds) {
      // Translucent backgrounds (accentWash) sit on the page ground.
      const back = solid(bgName, mode, ground);
      const front = solid(fg, mode, back);
      const r = ratio(front, back);
      checked++;
      const line = `${mode.padEnd(5)} ${fg} on ${bgName}: ${r.toFixed(2)}:1 (needs ${min})${note ? ` - ${note}` : ''}`;
      if (r + 1e-9 < min) failures.push(line);
      else if (verbose) console.log(`ok    ${line}`);
    }
  }
}

// Platform token files must carry the spec's values.
const drift = [];
function checkPlatform(label, path, parse) {
  if (!wants(label.toLowerCase())) {
    if (verbose) console.log(`skip  ${label}: not asked for`);
    return;
  }
  const file = join(root, path);
  if (!existsSync(file)) {
    if (verbose) console.log(`skip  ${label}: ${path} not found`);
    return;
  }
  const found = parse(readFileSync(file, 'utf8'));
  for (const [name, modes] of Object.entries(TOKENS)) {
    const got = found[name];
    if (!got) {
      drift.push(`${label}: ${name} is missing from ${path}`);
      continue;
    }
    for (const mode of MODES) {
      const [hex, alpha = 1] = modes[mode];
      const [gotHex, gotAlpha = 1] = got[mode];
      if (gotHex.toUpperCase() !== hex || Math.abs(gotAlpha - alpha) > 1e-6) {
        drift.push(`${label}: ${name} ${mode} is #${gotHex}${gotAlpha < 1 ? `@${gotAlpha}` : ''}, spec #${hex}${alpha < 1 ? `@${alpha}` : ''}`);
      }
    }
  }
}

// iOS: `static let name = pair(0xDARK, 0xLIGHT, darkAlpha: a, lightAlpha: b)` in Design/Tokens.swift.
checkPlatform('iOS', 'ios/JKPerformance/Design/Tokens.swift', (src) => {
  const out = {};
  const re = /static let (\w+) = pair\(0x([0-9A-Fa-f]{6}), 0x([0-9A-Fa-f]{6})(?:, darkAlpha: ([\d.]+))?(?:, lightAlpha: ([\d.]+))?\)/g;
  for (const m of src.matchAll(re)) {
    out[m[1]] = {
      dark: [m[2], m[4] ? Number(m[4]) : 1],
      light: [m[3], m[5] ? Number(m[5]) : 1],
    };
  }
  return out;
});

// Android: `name = Color(0xAARRGGBB)` inside `val Dark = JKPalette(` and `val Light = JKPalette(` in
// design/Tokens.kt. A few tokens carry Compose-flavoured names there.
const ANDROID_NAMES = { onPrimary: 'primaryLabel', kindInPerson: 'inPerson', kindVideo: 'video', kindGroup: 'group' };
checkPlatform('Android', 'android/app/src/main/java/com/jkperformance/app/design/Tokens.kt', (src) => {
  const out = {};
  for (const [mode, marker] of [['dark', 'val Dark = JKPalette('], ['light', 'val Light = JKPalette(']]) {
    const start = src.indexOf(marker);
    if (start < 0) continue;
    const body = src.slice(start, src.indexOf('\n        )', start));
    for (const name of Object.keys(TOKENS)) {
      const m = body.match(new RegExp(`\\b${ANDROID_NAMES[name] ?? name} = Color\\(0x([0-9A-Fa-f]{2})([0-9A-Fa-f]{6})\\)`));
      if (!m) continue;
      const alpha = parseInt(m[1], 16) / 255;
      (out[name] ??= {})[mode] = [m[2], alpha > 0.999 ? 1 : Math.round(alpha * 100) / 100];
    }
  }
  for (const name of Object.keys(out)) if (!out[name].dark || !out[name].light) delete out[name];
  return out;
});

for (const line of failures) console.error(`FAIL  ${line}`);
for (const line of drift) console.error(`DRIFT ${line}`);
if (failures.length || drift.length) {
  console.error(`contrast-check: ${failures.length} pair(s) below their minimum, ${drift.length} token(s) drifted from the spec.`);
  process.exit(1);
}
console.log(`contrast-check: ${checked} pairs pass (dark); ${platforms.length ? platforms.join(', ') : 'all platform'} tokens match the spec.`);
