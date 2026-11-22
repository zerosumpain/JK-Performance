#!/usr/bin/env node
// Exports the Material Symbols Rounded glyphs the Android app uses as vector
// drawables, in FILL 0 and FILL 1 variants (docs/design/atelier-spec.md,
// Iconography). Weight 300, grade -25 (the app is dark), optical size 24.
// Glyphs are Apache 2.0 (google/material-design-icons).
//
//   node scripts/export-symbols.mjs           # (re)write every glyph below
//   node scripts/export-symbols.mjs --check   # exit 1 if a drawable is missing or stale
//
// Output: android/app/src/main/res/drawable/ms_<name>_fill0.xml and _fill1.xml.
// android/.../design/Icons.kt maps each IconKey to these names, so adding a key
// means adding its glyph here first. Keep the list sorted.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GLYPHS = [
  'account_circle', 'add', 'alarm_on', 'arrow_circle_up', 'arrow_downward', 'arrow_upward',
  'auto_stories', 'bed', 'bedtime', 'bedtime_off', 'bolt', 'calendar_month', 'chat_bubble',
  'check', 'check_box', 'check_box_outline_blank', 'check_circle', 'checklist', 'chevron_left',
  'chevron_right', 'close', 'cloud_off', 'cloud_upload', 'content_copy', 'credit_card',
  'delete', 'description', 'desktop_windows', 'directions_run', 'directions_walk', 'download',
  'drafts', 'east', 'edit', 'edit_calendar', 'emoji_events', 'error', 'event_available',
  'event_repeat', 'expand_less', 'expand_more', 'fast_forward', 'favorite', 'fitness_center',
  'flag', 'forum', 'graphic_eq', 'group', 'groups', 'healing', 'heart_broken', 'hourglass_empty',
  'inbox', 'ios_share', 'layers', 'lightbulb', 'local_fire_department', 'lock', 'man',
  'menu_book', 'military_tech', 'monitor_heart', 'monitor_weight', 'more_horiz', 'north_east',
  'notifications', 'pan_tool', 'pause', 'pedal_bike', 'person', 'person_add', 'photo_camera',
  'photo_library', 'pill', 'play_arrow', 'play_circle', 'pool', 'radio_button_checked',
  'remove', 'reply', 'restaurant', 'rowing', 'schedule', 'search', 'self_improvement', 'send',
  'settings', 'shuffle',
  'south_east', 'spa', 'sports_gymnastics', 'sports_mma', 'sports_score',
  'stop_circle', 'straighten', 'sunny', 'swap_horiz', 'trending_up', 'undo', 'unfold_more',
  'verified', 'video_call', 'videocam', 'warning', 'watch', 'water_drop', 'wb_twilight',
];

const STYLE = 'materialsymbolsrounded';
const AXES = 'wght300gradN25';
const SOURCE = 'https://raw.githubusercontent.com/google/material-design-icons/master/symbols/web';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'android/app/src/main/res/drawable');

/** One SVG (viewBox 0 -960 960 960, a single path) to VectorDrawable XML. */
export function toVector(svg, name) {
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!/viewBox="0 -960 960 960"/.test(svg) || paths.length === 0) throw new Error(`${name}: unexpected SVG shape`);
  const body = paths.map((d) => `        <path android:fillColor="#FFFFFFFF" android:pathData="${d}" />`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Material Symbols Rounded "${name}" (Apache 2.0), exported by scripts/export-symbols.mjs. Do not edit. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="960" android:viewportHeight="960"
    android:autoMirrored="false">
    <group android:translateY="960">
${body}
    </group>
</vector>
`;
}

async function fetchSvg(name, fill) {
  const url = `${SOURCE}/${name}/${STYLE}/${name}_${AXES}${fill ? 'fill1' : ''}_24px.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const check = process.argv.includes('--check');
  await mkdir(out, { recursive: true });
  let stale = 0;
  const queue = GLYPHS.flatMap((name) => [[name, 0], [name, 1]]);
  const work = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [name, fill] = job;
      const xml = toVector(await fetchSvg(name, fill), name);
      const file = join(out, `ms_${name}_fill${fill}.xml`);
      const current = await readFile(file, 'utf8').catch(() => null);
      if (current === xml) continue;
      if (check) { stale++; console.error(`stale: ${file}`); } else await writeFile(file, xml);
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  if (check && stale) process.exit(1);
  console.log(`${GLYPHS.length} glyphs, ${GLYPHS.length * 2} drawables ${check ? 'checked' : 'written'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
