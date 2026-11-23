#!/usr/bin/env node
// Exports the Material Symbols Rounded glyphs the Android app uses as vector
// drawables, in FILL 0 and FILL 1 variants (docs/design/atelier-spec.md,
// Iconography). Weight 300, grade -25 (the app is dark), optical size 24.
// Glyphs are Apache 2.0 (google/material-design-icons).
//
//   node scripts/export-symbols.mjs           # (re)write every glyph below
//   node scripts/export-symbols.mjs --check   # exit 1 if a drawable is missing or stale
//   node scripts/export-symbols.mjs --desk    # (re)write server/desk/symbols.js from DESK_GLYPHS
//   node scripts/export-symbols.mjs --desk --check   # exit 1 if symbols.js is stale
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

/**
 * The coach desk's glyphs (server/desk/symbols.js): weight 300, grade 0, outline plus filled
 * (filled stored only where it differs). Desk-v2 packages use these raw Material names in
 * icon() and never edit symbols.js; a missing glyph is an integration request. Keep sorted.
 */
export const DESK_GLYPHS = [...new Set(`
  account_balance_wallet account_circle add alarm approval archive arrow_circle_up arrow_downward arrow_upward
  auto_awesome auto_stories bar_chart bedtime bedtime_off block bolt cake calendar_month campaign card_giftcard
  celebration chat_bubble check check_box check_box_outline_blank check_circle checklist chevron_left chevron_right
  close content_copy contrast dark_mode delete description desktop_windows directions_walk donut_large done_all
  download drafts drag_indicator east edit edit_calendar edit_note error event_available event_busy event_repeat
  expand_less expand_more favorite filter_alt fitness_center flag format_list_bulleted format_quote forum
  front_hand gpp_maybe graphic_eq grid_view group groups handshake healing heart_broken help hourglass_empty
  how_to_reg hub image inbox indeterminate_check_box inventory_2 key keyboard keyboard_command_key label
  left_panel_close left_panel_open light_mode lightbulb link link_off local_fire_department lock logout loyalty mail
  map menu_book mic military_tech monitor_heart monitoring more_horiz north_east notifications notifications_active
  open_in_new pause pause_circle payments percent person person_add person_search photo_camera photo_library
  pill play_arrow play_circle print psychology receipt_long redeem redo reply request_quote restaurant rocket_launch
  route savings schedule schedule_send science search self_improvement sell send sentiment_dissatisfied
  sentiment_neutral sentiment_satisfied settings shield shopping_bag show_chart snooze south_east space_dashboard
  spa sports_score star sticky_note_2 stop stop_circle storefront straighten summarize sunny sync task_alt
  timeline timer translate travel_explore trending_down trending_up tune undo unfold_more upload verified
  video_call videocam view_kanban visibility visibility_off warning water_drop wb_twilight workspace_premium
`.trim().split(/\s+/))].sort();

/** Names the spec uses that Google's repository now files under another name (same glyph). */
const DESK_SOURCE = { card_giftcard: 'redeem' };

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

const DESK_OUT = join(root, 'server/desk/symbols.js');
/** {d, box}: the joined path data (several paths each start with M) and the viewBox when it is not the usual 960 one. */
const firstPath = (svg, name) => {
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) throw new Error(`${name}: unexpected SVG shape`);
  const box = /viewBox="0 -960 960 960"/.test(svg) ? null : /viewBox="([^"]+)"/.exec(svg)?.[1] ?? `0 0 ${/width="(\d+)"/.exec(svg)?.[1] ?? 24} ${/height="(\d+)"/.exec(svg)?.[1] ?? 24}`;
  return { d: paths.join(''), box };
};
const deskSvg = async (name, fill) => {
  name = DESK_SOURCE[name] ?? name;
  const url = `${SOURCE}/${name}/${STYLE}/${name}_wght300${fill ? 'fill1' : ''}_24px.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`);
  return firstPath(await res.text(), name);
};

/** server/desk/symbols.js: one `name: [outline, filled?]` line per DESK_GLYPHS entry. */
async function desk(check) {
  const entries = new Map();
  const queue = [...DESK_GLYPHS];
  const work = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const [outline, filled] = await Promise.all([deskSvg(name, 0), deskSvg(name, 1)]);
      if (outline.box !== filled.box) throw new Error(`${name}: outline and filled differ in viewBox`);
      // [outline, filled|null, viewBox] only when the source is not on the 960 grid (a few older glyphs).
      const entry = [outline.d];
      if (filled.d !== outline.d || outline.box) entry.push(filled.d === outline.d ? null : filled.d);
      if (outline.box) entry.push(outline.box);
      entries.set(name, entry);
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  const body = DESK_GLYPHS.map((n) => `  ${n}: ${JSON.stringify(entries.get(n))},`).join('\n');
  const js = `/*
 * Material Symbols Rounded (Apache License 2.0, Google), weight 300, as inline
 * SVG paths on a 960 viewBox: [outline, filled] (filled only where it differs;
 * a third item is the viewBox for the few glyphs not drawn on that grid).
 * Generated by scripts/export-symbols.mjs --desk from google/material-design-icons
 * symbols/web/<name>/materialsymbolsrounded. Do not edit: add names to DESK_GLYPHS.
 * The desk draws icons through core.js icon(), which maps IconKeys to these names.
 */
export const SYMBOLS = {
${body}
};
`;
  const current = await readFile(DESK_OUT, 'utf8').catch(() => null);
  if (check) {
    if (current !== js) { console.error(`stale: ${DESK_OUT}`); process.exit(1); }
  } else if (current !== js) await writeFile(DESK_OUT, js);
  console.log(`${DESK_GLYPHS.length} desk glyphs ${check ? 'checked' : 'written'}`);
}

async function main() {
  const check = process.argv.includes('--check');
  if (process.argv.includes('--desk')) { await desk(check); return; }
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
