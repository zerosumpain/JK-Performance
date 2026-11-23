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
// 3. --desk: measures the coach desk's own tokens, read from the :root blocks of
//    server/desk/app.css (dark and light), including the desk-v2 glass, tile,
//    badge and chart pairs (docs/design/desk-v2.md 2.2). Run alone; it exits.
//
// Usage: node scripts/contrast-check.mjs [ios|android]... [--verbose]
//        node scripts/contrast-check.mjs --desk [--verbose]
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

// MARK: - The desk (--desk): server/desk/app.css, both themes

/** {dark: {name: value}, light: {…}} from app.css: the dark :root block, the light one, and the shared one (var() aliases). */
function deskTokens(css) {
  const blocks = [...css.matchAll(/:root(\[data-theme="light"\])?\s*\{([^}]*)\}/g)].map((m) => ({ light: !!m[1], body: m[2] }));
  const read = (body) => Object.fromEntries([...body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);?/g)].map((m) => [m[1], m[2].trim()]));
  const shared = {}, dark = {}, light = {};
  blocks.forEach((b, i) => {
    const t = read(b.body);
    if (b.light) Object.assign(light, t);
    else if (i === 0) Object.assign(dark, t);
    else Object.assign(shared, t);
  });
  return { dark: { ...shared, ...dark }, light: { ...shared, ...dark, ...light } };
}
/** A token as [r, g, b, a], following var() aliases. */
function deskColour(tokens, name, seen = new Set()) {
  const v = tokens[name];
  if (v === undefined) throw new Error(`--${name} is not defined in app.css`);
  if (seen.has(name)) throw new Error(`--${name} refers to itself`);
  seen.add(name);
  const alias = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (alias) return deskColour(tokens, alias[1], seen);
  const hex = /^#([0-9A-Fa-f]{6})$/.exec(v);
  if (hex) return [...rgb(hex[1]), 1];
  const rgba = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(v);
  if (rgba) return rgba.slice(1).map(Number);
  throw new Error(`--${name}: cannot measure "${v}"`);
}
const over = ([r, g, b, a], under) => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));

function deskCheck() {
  const css = readFileSync(join(root, 'server/desk/app.css'), 'utf8');
  if (!/--accent:#C8A970;/.test(css)) failures.push('dark --accent is no longer #C8A970 (the colours do not change, D8)');
  const themes = deskTokens(css);
  const ALL = ['bg', 'surface', 'raised', 'paper', 'tile', 'tile-hover'];
  // [foreground, [backgrounds], minimum, note]; a background "a/b" is token a composited over token b.
  const DESK_PAIRS = [
    ['text', [...ALL, 'glass/bg', 'glass/surface', 'accent-wash/bg', 'accent-wash/surface'], TEXT],
    ['text-secondary', [...ALL, 'glass/bg', 'accent-wash/bg'], TEXT],
    ['text-tertiary', ['bg', 'surface', 'paper', 'tile', 'tile-hover', 'glass/bg'], TEXT, 'group labels, eyebrows (never on raised)'],
    ['accent', ['bg', 'surface', 'raised', 'tile', 'tile-hover', 'accent-wash/bg'], TEXT, 'the accent word, selected icons, links'],
    ['on-track', ['bg', 'surface', 'raised', 'tile'], TEXT],
    ['attention', ['bg', 'surface', 'raised', 'tile'], TEXT],
    ['data', ['bg', 'surface', 'raised', 'tile'], TEXT],
    ['error', ['bg', 'surface', 'raised', 'tile'], TEXT],
    ['urgent', ['bg', 'surface', 'raised', 'tile'], TEXT],
    ['bg', ['accent'], TEXT, 'badge numbers on the accent pill'],
    ['primary-label', ['primary-fill', 'primary-pressed'], TEXT, 'primary button'],
    ['accent', ['bg', 'surface', 'raised'], NON_TEXT, 'focus ring'],
    // On raised layers (sheets, slide-overs) fields are filled with surface, so the boundary is measured there, not on raised (2.85:1).
    ['input-border', ['bg', 'surface'], NON_TEXT, 'input boundary'],
    ...['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'].map((c) => [c, ['tile', 'surface', 'raised'], NON_TEXT, 'chart marks']),
    ['heat-4', ['tile'], NON_TEXT, 'the strongest heat cell'],
  ];
  for (const [mode, tokens] of Object.entries(themes)) {
    const ground = deskColour(tokens, 'bg').slice(0, 3);
    const solidOf = (spec) => {
      const [top, base] = spec.split('/');
      const under = base ? over(deskColour(tokens, base), ground) : ground;
      return over(deskColour(tokens, top), under);
    };
    for (const [fg, backs, min, note] of DESK_PAIRS) {
      for (const back of backs) {
        const b = solidOf(back);
        const f = over(deskColour(tokens, fg), b);
        const r = ratio(f, b);
        checked++;
        const line = `desk ${mode.padEnd(5)} ${fg} on ${back}: ${r.toFixed(2)}:1 (needs ${min})${note ? ` - ${note}` : ''}`;
        if (r + 1e-9 < min) failures.push(line);
        else if (verbose) console.log(`ok    ${line}`);
      }
    }
  }
}

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

if (process.argv.includes('--desk')) {
  deskCheck();
  for (const line of failures) console.error(`FAIL  ${line}`);
  if (failures.length) {
    console.error(`contrast-check --desk: ${failures.length} pair(s) below their minimum.`);
    process.exit(1);
  }
  console.log(`contrast-check --desk: ${checked} pairs pass (dark and light).`);
  process.exit(0);
}

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
