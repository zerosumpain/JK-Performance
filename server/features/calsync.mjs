import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { clientFor, initials, ownRow, requireCoach, requireMember } from '../access.mjs';
import {
  busyIntervals, calendarPrefs, clashOf, freeCheck, hasTable, insertBooking, PREF_DEFAULTS, rulesOf, shortWhen, slotsFor,
} from '../bookings.mjs';
import { emit } from '../events.mjs';
import { day as dayArg, fail, instant, num, oneOf, str } from '../http.mjs';
import { sendMessage } from '../messages.mjs';
import { notifyCoach } from '../notifications.mjs';
import { notify } from '../push.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonClock, londonDay, londonToUtc, weekday } from '../time.mjs';

/**
 * Calendar connections, holds, conflicts, buffers and time off (F20), and the
 * slot finder, waitlist and reminders (F21). docs/design/desk-v2.md, WP7.
 *
 * The coach pastes the secret iCal address of their Google, Outlook or Apple
 * calendar; we fetch it through an SSRF-safe client, parse it with no
 * dependencies, and keep only busy blocks (titles only when the coach asks).
 * The address is encrypted at rest and never leaves the server again.
 */

const COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
const HOLD_KINDS = ['consult', 'trial', 'admin'];
const HOLD_TITLE = { consult: 'Consult', trial: 'Trial', admin: 'Admin' };
const MAX_SOURCES = 10;
const MAX_BLOCKS = 5000;
const SYNC_EVERY_MS = 15 * 60_000, BACKOFF_MS = 60 * 60_000;
const SIMPLIFIED = 'Some repeating events were simplified';
const MIN = 60_000, HOUR = 3_600_000, DAY_MS = 86_400_000;

// MARK: - Time zones

/** Outlook and Exchange write Windows zone names; Intl knows IANA ids (CLDR windowsZones, the common ones). */
export const WINDOWS_ZONES = {
  'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik', 'UTC': 'Etc/UTC', 'Coordinated Universal Time': 'Etc/UTC',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest', 'Russian Standard Time': 'Europe/Moscow', 'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem', 'Egypt Standard Time': 'Africa/Cairo', 'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos', 'Morocco Standard Time': 'Africa/Casablanca', 'Arabian Standard Time': 'Asia/Dubai',
  'Arab Standard Time': 'Asia/Riyadh', 'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Kolkata',
  'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai', 'Singapore Standard Time': 'Asia/Singapore',
  'Taipei Standard Time': 'Asia/Taipei', 'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul',
  'W. Australia Standard Time': 'Australia/Perth', 'Cen. Australia Standard Time': 'Australia/Adelaide', 'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney', 'New Zealand Standard Time': 'Pacific/Auckland', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage', 'Pacific Standard Time': 'America/Los_Angeles', 'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver', 'Central Standard Time': 'America/Chicago', 'Canada Central Standard Time': 'America/Regina',
  'Central Standard Time (Mexico)': 'America/Mexico_City', 'Eastern Standard Time': 'America/New_York', 'SA Pacific Standard Time': 'America/Bogota',
  'Atlantic Standard Time': 'America/Halifax', 'Newfoundland Standard Time': 'America/St_Johns', 'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Buenos_Aires',
};

const zoneFormats = new Map();
function zoneFormat(tz) {
  if (!zoneFormats.has(tz)) {
    zoneFormats.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  }
  return zoneFormats.get(tz);
}
const knownZone = tz => { try { zoneFormat(tz); return true; } catch { return false; } };

/** The UTC instant (ms) of a wall-clock time in an IANA zone, correct across DST changes. */
export function zonedToUtc({ y, mo, d, h = 0, mi = 0, s = 0 }, tz) {
  const wanted = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC' || tz === 'Etc/UTC') return wanted;
  const fmt = zoneFormat(tz);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const f = Object.fromEntries(fmt.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
    const shown = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
    guess += wanted - shown;
  }
  return guess;
}

// MARK: - iCalendar parsing

/** Unfold RFC 5545 continuation lines (CRLF or LF followed by a space or tab). */
export function unfold(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** "DTSTART;TZID=\"Europe/London\":20261103T070000" → {name, params, value}. */
function parseLine(line) {
  let i = 0, quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) ?? [head];
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

const unescapeText = v => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** Components as nested objects: {type, props: {NAME: [line...]}, children: [...]}. */
function components(lines) {
  const root = { type: 'ROOT', props: {}, children: [] };
  const stack = [root];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const line = parseLine(raw);
    if (line.name === 'BEGIN') {
      const c = { type: line.value.trim().toUpperCase(), props: {}, children: [] };
      stack.at(-1).children.push(c);
      stack.push(c);
    } else if (line.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      const top = stack.at(-1);
      (top.props[line.name] ??= []).push(line);
    }
  }
  return root;
}

const DT = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/;

/** A parsed date-time value: {y, mo, d, h, mi, s, utc, date (no time)}. */
function dtParts(value) {
  const m = DT.exec(String(value).trim());
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0), utc: !!m[7], date: m[4] === undefined };
}
const partsDay = p => `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const dayParts = dayStr => { const [y, mo, d] = dayStr.split('-').map(Number); return { y, mo, d }; };

/**
 * A zone resolver for one feed: IANA ids as is, Windows names through the
 * table, otherwise the feed's own VTIMEZONE offsets, and as a last resort
 * UTC with a warning. Returns {toUtc(parts) → ms, warn}.
 */
function zoneResolver(root, warnings) {
  const vtz = new Map();
  for (const c of root.children.flatMap(c => (c.type === 'VCALENDAR' ? c.children : [c]))) {
    if (c.type === 'VTIMEZONE') vtz.set(c.props.TZID?.[0]?.value?.trim(), c);
  }
  const cache = new Map();
  return tzid => {
    const id = String(tzid ?? '').trim().replace(/^"|"$/g, '');
    if (cache.has(id)) return cache.get(id);
    let fn;
    const iana = knownZone(id) ? id : WINDOWS_ZONES[id] ?? WINDOWS_ZONES[id.replace(/^\(UTC[^)]*\)\s*/, '')] ?? null;
    if (iana && knownZone(iana)) fn = p => zonedToUtc(p, iana);
    else if (vtz.has(id)) fn = vtimezoneOffsets(vtz.get(id));
    else {
      warnings.add(`Unknown time zone "${id.slice(0, 60)}"; times read as UTC`);
      fn = p => Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    }
    cache.set(id, fn);
    return fn;
  };
}

const offsetMs = v => {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(String(v ?? '').trim());
  return m ? (m[1] === '-' ? -1 : 1) * ((+m[2] * 60 + +m[3]) * MIN + +(m[4] ?? 0) * 1000) : 0;
};

/** The n-th (or -1 = last) given weekday (0 Sun … 6 Sat) of a month, as a day of the month. */
function nthWeekday(y, mo, wd, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, mo - 1, lastDay)).getUTCDay();
  return lastDay - ((last - wd + 7) % 7) + (n + 1) * 7;
}
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** A VTIMEZONE's STANDARD/DAYLIGHT blocks as a wall-clock → UTC function. */
function vtimezoneOffsets(vtz) {
  const blocks = vtz.children.filter(c => c.type === 'STANDARD' || c.type === 'DAYLIGHT').map(c => {
    const start = dtParts(c.props.DTSTART?.[0]?.value ?? '');
    const rule = Object.fromEntries(String(c.props.RRULE?.[0]?.value ?? '').split(';').filter(Boolean).map(x => x.split('=')));
    return { start, to: offsetMs(c.props.TZOFFSETTO?.[0]?.value), from: offsetMs(c.props.TZOFFSETFROM?.[0]?.value), rule };
  }).filter(b => b.start);
  // The wall-clock instants (as if UTC) at which each block takes effect in a year.
  const onsets = y => blocks.flatMap(b => {
    if (b.rule.FREQ !== 'YEARLY') return b.start.y === y ? [{ at: Date.UTC(b.start.y, b.start.mo - 1, b.start.d, b.start.h, b.start.mi), b }] : [];
    if (y < b.start.y) return [];
    const mo = +(b.rule.BYMONTH ?? b.start.mo);
    let d = b.start.d;
    const m = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(b.rule.BYDAY ?? '');
    if (m) d = nthWeekday(y, mo, WD[m[2]], +(m[1] ?? 1));
    return [{ at: Date.UTC(y, mo - 1, d, b.start.h, b.start.mi), b }];
  });
  return p => {
    const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const all = [...onsets(p.y - 1), ...onsets(p.y)].filter(o => o.at <= wall).sort((a, b) => a.at - b.at);
    const active = all.at(-1)?.b ?? blocks.find(b => b.rule.FREQ) ?? blocks[0];
    return wall - (active?.to ?? 0);
  };
}

/** "P1DT2H30M" or "-PT15M" → ms. */
export function durationMs(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 60 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0)) * MIN + +(m[6] ?? 0) * 1000;
  return m[1] === '-' ? -n : n;
}

/**
 * The value of a DTSTART/DTEND/EXDATE/RECURRENCE-ID line as {ms, parts, allDay, zone}.
 * All-day dates and floating times are London (the business's zone).
 */
function readTime(line, toUtcFor) {
  if (!line) return null;
  const p = dtParts(line.value.split(',')[0]);
  if (!p) return null;
  return timeOf(p, line.params, toUtcFor);
}
function timeOf(p, params, toUtcFor) {
  if (p.date || params?.VALUE === 'DATE') return { ms: londonToUtc(partsDay(p)).getTime(), parts: { ...p, h: 0, mi: 0, s: 0 }, allDay: true, zone: null };
  if (p.utc) return { ms: Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s), parts: p, allDay: false, zone: 'UTC' };
  const zone = params?.TZID ?? null;
  const ms = zone ? toUtcFor(zone)(p) : zonedToUtc(p, 'Europe/London');
  return { ms, parts: p, allDay: false, zone: zone ?? 'Europe/London' };
}

/** Wall-clock parts n days after `p` (same time of day). */
function shiftDays(p, n) {
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return { ...p, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate() };
}
const partsWeekday = p => new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();

const SUPPORTED_RULE = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'WKST', 'BYMONTH']);

/**
 * Occurrence start parts of a recurring event, in its own wall clock, from
 * DTSTART until `limitMs` (an instant), COUNT or UNTIL. Supported: DAILY,
 * WEEKLY (BYDAY), MONTHLY (BYMONTHDAY), YEARLY, with INTERVAL, COUNT, UNTIL.
 * Anything else adds the "simplified" warning and is read as plain FREQ.
 */
function expandRule(start, ruleText, toMs, limitMs, warnings) {
  const rule = Object.fromEntries(String(ruleText).split(';').filter(Boolean).map(x => { const [k, v] = x.split('='); return [k.toUpperCase(), v ?? '']; }));
  const freq = rule.FREQ;
  const interval = Math.max(1, Number(rule.INTERVAL) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : null;
  let until = null;
  if (rule.UNTIL) {
    const u = dtParts(rule.UNTIL);
    if (u) until = u.date ? londonToUtc(partsDay(u)).getTime() + DAY_MS - 1 : u.utc ? Date.UTC(u.y, u.mo - 1, u.d, u.h, u.mi, u.s) : toMs(u);
  }
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) { warnings.add(SIMPLIFIED); return [start.parts]; }
  if (Object.keys(rule).some(k => !SUPPORTED_RULE.has(k)) || (rule.BYDAY && freq !== 'WEEKLY') || (rule.BYMONTHDAY && freq !== 'MONTHLY')
    || (rule.BYMONTH && freq !== 'YEARLY')) warnings.add(SIMPLIFIED);
  const out = [];
  const p0 = start.parts;
  const push = p => {
    const at = toMs(p);
    if (at < start.ms) return true;
    if (until !== null && at > until) return false;
    if (count !== null && out.length >= count) return false;
    if (at > limitMs) return false;
    out.push(p);
    return true;
  };
  const MAX_STEPS = 20_000;
  if (freq === 'DAILY') {
    for (let i = 0; i < MAX_STEPS; i++) if (!push(shiftDays(p0, i * interval))) break;
  } else if (freq === 'WEEKLY') {
    const days = (rule.BYDAY ? rule.BYDAY.split(',').map(x => WD[x.replace(/^[+-]?\d+/, '')]).filter(x => x !== undefined) : [partsWeekday(p0)]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const monday = shiftDays(p0, -((partsWeekday(p0) + 6) % 7));
    outer: for (let w = 0; w < MAX_STEPS; w++) {
      for (const wd of days) if (!push(shiftDays(monday, w * 7 * interval + ((wd + 6) % 7)))) break outer;
    }
  } else if (freq === 'MONTHLY') {
    const dom = rule.BYMONTHDAY ? Number(rule.BYMONTHDAY.split(',')[0]) : p0.d;
    for (let i = 0; i < MAX_STEPS; i++) {
      const m0 = p0.mo - 1 + i * interval;
      const y = p0.y + Math.floor(m0 / 12), mo = (m0 % 12) + 1;
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const d = dom < 0 ? last + dom + 1 : dom;
      if (d < 1 || d > last) { if (toMs({ ...p0, y, mo, d: 1 }) > limitMs) break; continue; }
      if (!push({ ...p0, y, mo, d })) break;
    }
  } else {
    for (let i = 0; i < MAX_STEPS; i++) {
      const y = p0.y + i * interval;
      const last = new Date(Date.UTC(y, p0.mo, 0)).getUTCDate();
      if (p0.d > last) continue; // 29 February
      if (!push({ ...p0, y })) break;
    }
  }
  return out;
}

/**
 * Parse an iCalendar feed into busy blocks inside [fromMs, toMs):
 * `{blocks: [{uid, start, end, allDay, title}], warnings: [string]}`.
 * Handles folded lines, TZID (IANA, Windows names, VTIMEZONE), all-day dates,
 * DURATION, RRULE, EXDATE, RECURRENCE-ID overrides, and skips cancelled and
 * transparent (free) events. At most 5000 blocks.
 */
export function parseIcs(text, { fromMs, toMs, max = MAX_BLOCKS } = {}) {
  const warnings = new Set();
  const root = components(unfold(text));
  const toUtcFor = zoneResolver(root, warnings);
  const events = root.children.flatMap(c => (c.type === 'VCALENDAR' ? c.children : [c])).filter(c => c.type === 'VEVENT');
  const one = (e, name) => e.props[name]?.[0] ?? null;
  const overrides = new Map(); // uid -> Map(originalStartMs -> event)
  const masters = [];
  for (const e of events) {
    const rid = one(e, 'RECURRENCE-ID');
    if (rid) {
      const uid = one(e, 'UID')?.value ?? '';
      const at = readTime(rid, toUtcFor);
      if (at) (overrides.get(uid) ?? overrides.set(uid, new Map()).get(uid)).set(at.ms, e);
    } else masters.push(e);
  }
  const blocks = [];
  const skipped = e => (one(e, 'STATUS')?.value ?? '').trim().toUpperCase() === 'CANCELLED' || (one(e, 'TRANSP')?.value ?? '').trim().toUpperCase() === 'TRANSPARENT';
  const add = (e, startMs, endMs, allDay) => {
    if (blocks.length >= max) { warnings.add(`Only the first ${max} events were kept`); return; }
    if (endMs <= fromMs || startMs >= toMs || endMs <= startMs) return;
    const title = unescapeText(one(e, 'SUMMARY')?.value ?? '').trim().slice(0, 140) || null;
    blocks.push({ uid: one(e, 'UID')?.value ?? null, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), allDay, title });
  };
  const lengthOf = (e, start) => {
    const end = readTime(one(e, 'DTEND'), toUtcFor);
    if (end) {
      if (start.allDay) return { days: Math.max(1, daysBetween(partsDay(start.parts), partsDay(end.parts))) };
      return { ms: Math.max(0, end.ms - start.ms), wall: end };
    }
    const dur = durationMs(one(e, 'DURATION')?.value);
    if (dur !== null) return start.allDay ? { days: Math.max(1, Math.round(dur / DAY_MS)) } : { ms: Math.max(0, dur) };
    return start.allDay ? { days: 1 } : { ms: 0 };
  };
  const endOf = (start, len, toMs2) => {
    if (start.allDay) return londonToUtc(addDays(partsDay(start.parts), len.days)).getTime();
    return toMs2 + len.ms;
  };
  for (const e of masters) {
    if (skipped(e)) continue;
    const start = readTime(one(e, 'DTSTART'), toUtcFor);
    if (!start) continue;
    const len = lengthOf(e, start);
    const uid = one(e, 'UID')?.value ?? '';
    const rrule = one(e, 'RRULE');
    if (!rrule) {
      add(e, start.ms, endOf(start, len, start.ms), start.allDay);
      continue;
    }
    const toMsFor = start.allDay ? p => londonToUtc(partsDay(p)).getTime()
      : start.zone === 'UTC' ? p => Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
        : start.zone === 'Europe/London' && !one(e, 'DTSTART').params.TZID ? p => zonedToUtc(p, 'Europe/London') : toUtcFor(start.zone);
    const exdates = new Set();
    for (const line of e.props.EXDATE ?? []) {
      for (const v of line.value.split(',')) {
        const p = dtParts(v);
        if (!p) continue;
        const t = timeOf(p, line.params, toUtcFor);
        exdates.add(start.allDay ? partsDay(t.parts) : t.ms);
      }
    }
    const mine = overrides.get(uid);
    for (const p of expandRule(start, rrule.value, toMsFor, toMs, warnings)) {
      const at = toMsFor(p);
      if (exdates.has(start.allDay ? partsDay(p) : at)) continue;
      if (mine?.has(at)) continue; // drawn from its override below
      add(e, at, endOf({ ...start, parts: p }, len, at), start.allDay);
    }
  }
  for (const map of overrides.values()) {
    for (const e of map.values()) {
      if (skipped(e)) continue;
      const start = readTime(one(e, 'DTSTART'), toUtcFor);
      if (!start) continue;
      add(e, start.ms, endOf(start, lengthOf(e, start), start.ms), start.allDay);
    }
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  return { blocks, warnings: [...warnings] };
}

// MARK: - The SSRF-safe fetcher

const v4 = s => s.split('.').map(Number);
/** Private, loopback, link-local, CGNAT (Tailscale), multicast and reserved addresses, v4 and v6 (and v4-mapped v6). */
export function isPrivateAddress(address) {
  const a = String(address ?? '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const fam = isIP(a);
  if (fam === 4) {
    const [x, y] = v4(a);
    return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 192 && y === 0) || (x === 198 && (y === 18 || y === 19)) || x >= 224;
  }
  if (fam === 6) {
    if (a === '::' || a === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
    if (hex) { const n = (parseInt(hex[1], 16) << 16) + parseInt(hex[2], 16); return isPrivateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
    const first = parseInt(a.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || a.startsWith('64:ff9b:') || a.startsWith('2001:db8');
  }
  return true; // not an address at all: refuse
}

/**
 * A `lookup` for https.request that resolves every address of the host and
 * refuses the request if any is private. Node 22 calls it with {all: true}
 * (autoSelectFamily) and expects an array; other paths expect (err, address,
 * family). Both shapes are answered.
 */
export function safeLookup(resolve = dnsLookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = typeof options === 'number' ? { family: options } : (options ?? {});
    resolve(hostname, { all: true, family: opts.family ?? 0 }, (err, addresses) => {
      if (err) return callback(err);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }]).filter(x => x?.address);
      if (!list.length) return callback(Object.assign(new Error('That address does not resolve'), { code: 'ENOTFOUND' }));
      if (list.some(x => isPrivateAddress(x.address))) return callback(Object.assign(new Error('That address points inside a private network'), { code: 'EPRIVATE' }));
      if (opts.all) return callback(null, list.map(x => ({ address: x.address, family: x.family || isIP(x.address) })));
      return callback(null, list[0].address, list[0].family || isIP(list[0].address));
    });
  };
}

/** Check a pasted calendar address: webcal → https, https on 443 only, no credentials, no private literal. Returns a URL or throws 400. */
export function vetUrl(raw) {
  let text = String(raw ?? '').trim();
  if (/^webcals?:\/\//i.test(text)) text = text.replace(/^webcals?:\/\//i, 'https://');
  let url;
  try { url = new URL(text); } catch { fail(400, 'That is not a web address'); }
  if (url.protocol !== 'https:') fail(400, 'Only https:// (or webcal://) calendar addresses are allowed');
  if (url.port && url.port !== '443') fail(400, 'Only the standard https port (443) is allowed');
  if (url.username || url.password) fail(400, 'Calendar addresses with a user name or password are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) fail(400, 'That address points inside a private network');
  if (!host.includes('.') && !isIP(host)) fail(400, 'That address points inside a private network');
  return url;
}

/** 'calendar.google.com/…/basic.ics': the host and the last path part, safe to show. */
export const urlHint = url => `${url.hostname}/…/${(url.pathname.split('/').filter(Boolean).at(-1) ?? '').slice(-40)}`;

/**
 * Fetch an iCal feed: {status: 200|304, body, etag}. At most 3 redirects (each
 * re-vetted), 15 s, 5 MB. Tests (and the local preview) inject config.calFetch.
 */
export async function fetchIcs(config, rawUrl, { etag = null } = {}) {
  let url = vetUrl(rawUrl);
  if (config.calFetch) return config.calFetch(url.href, { etag });
  const deadline = Date.now() + 15_000;
  for (let hop = 0; hop <= 3; hop++) {
    const res = await getOnce(url, etag, deadline - Date.now(), config.calLookup);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (!res.location || hop === 3) throw new Error('Too many redirects');
      url = vetUrl(new URL(res.location, url).href);
      continue;
    }
    if (res.status === 304) return { status: 304, body: null, etag };
    if (res.status !== 200) throw new Error(`The calendar answered ${res.status}`);
    return { status: 200, body: res.body, etag: res.etag ?? null };
  }
  throw new Error('Too many redirects');
}

function getOnce(url, etag, timeoutMs, lookup) {
  return new Promise((resolve, reject) => {
    if (timeoutMs <= 0) return reject(new Error('The calendar took too long to answer'));
    const req = httpsRequest(url, {
      method: 'GET', lookup: lookup ?? safeLookup(), timeout: timeoutMs,
      headers: { accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1', 'user-agent': 'JK-Performance-Calendar/1.0', ...(etag ? { 'if-none-match': etag } : {}) },
    }, res => {
      const status = res.statusCode;
      if (status !== 200) { res.resume(); return resolve({ status, location: res.headers.location ?? null }); }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > 5 * 1024 * 1024) { req.destroy(new Error('The calendar is larger than 5 MB')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), etag: res.headers.etag ?? null }));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('The calendar took too long to answer')), timeoutMs);
    req.on('timeout', () => req.destroy(new Error('The calendar took too long to answer')));
    req.on('error', e => { clearTimeout(timer); reject(e.code === 'EPRIVATE' ? new Error('That address points inside a private network') : e); });
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

// MARK: - The address at rest (AES-256-GCM)

const keys = new Map(); // dataDir -> key
function calendarKey(config) {
  if (!config?.dataDir) throw new Error('No data directory for the calendar key');
  if (keys.has(config.dataDir)) return keys.get(config.dataDir);
  const dir = join(config.dataDir, 'secrets'), file = join(dir, 'calendar.key');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let key;
  try { key = readFileSync(file); } catch {
    try { writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    key = readFileSync(file);
  }
  if (key.length !== 32) throw new Error('The calendar key file is damaged');
  keys.set(config.dataDir, key);
  return key;
}

export function encryptUrl(config, url) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', calendarKey(config), iv);
  const ct = Buffer.concat([c.update(url, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map(b => b.toString('base64')).join('.');
}

export function decryptUrl(config, enc) {
  const [iv, tag, ct] = String(enc).split('.').map(s => Buffer.from(s, 'base64'));
  const d = createDecipheriv('aes-256-gcm', calendarKey(config), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// MARK: - Bank holidays (England and Wales), from fixed rules

/** Easter Sunday (Anonymous Gregorian computus) as 'YYYY-MM-DD'. */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), dayOf = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, '0')}-${String(dayOf).padStart(2, '0')}`;
}

/** England and Wales bank holidays for a year: [{day, name}], with weekend substitutes. */
export function bankHolidays(y) {
  const iso = (mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const wd = s => weekday(s); // 1 Mon … 7 Sun
  const firstMonday = mo => iso(mo, nthWeekday(y, mo, 1, 1));
  const lastMonday = mo => iso(mo, nthWeekday(y, mo, 1, -1));
  const out = [];
  let ny = iso(1, 1);
  if (wd(ny) === 6) ny = iso(1, 3); else if (wd(ny) === 7) ny = iso(1, 2);
  out.push({ day: ny, name: 'New Year’s Day' });
  const e = easter(y);
  out.push({ day: addDays(e, -2), name: 'Good Friday' }, { day: addDays(e, 1), name: 'Easter Monday' });
  out.push({ day: firstMonday(5), name: 'Early May bank holiday' }, { day: lastMonday(5), name: 'Spring bank holiday' }, { day: lastMonday(8), name: 'Summer bank holiday' });
  const xmas = iso(12, 25), xw = wd(xmas);
  // Christmas on a Saturday: Mon 27 and Tue 28; on a Sunday: Mon 26 (Boxing) and Tue 27; Boxing Day on a Saturday: Mon 28.
  if (xw === 6) out.push({ day: iso(12, 27), name: 'Christmas Day (substitute day)' }, { day: iso(12, 28), name: 'Boxing Day (substitute day)' });
  else if (xw === 7) out.push({ day: iso(12, 26), name: 'Boxing Day' }, { day: iso(12, 27), name: 'Christmas Day (substitute day)' });
  else if (xw === 5) out.push({ day: xmas, name: 'Christmas Day' }, { day: iso(12, 28), name: 'Boxing Day (substitute day)' });
  else out.push({ day: xmas, name: 'Christmas Day' }, { day: iso(12, 26), name: 'Boxing Day' });
  return out;
}

// MARK: - Shapes

const sourceOut = s => ({
  id: s.id, label: s.label, urlHint: s.url_hint, color: s.color, showTitles: !!s.show_titles, active: !!s.active,
  lastSyncedAt: s.last_synced_at, lastError: s.last_error, ok: !s.sync_failed, eventCount: s.event_count, nextSyncAt: s.next_sync_at ?? null,
});
const timeOffOut = t => ({
  id: t.id, start: t.start, end: t.end, allDay: !!t.all_day, reason: t.reason,
  startDay: londonDay(new Date(t.start)), endDay: londonDay(new Date(Date.parse(t.end) - (t.all_day ? 1 : 0))),
});
const holdOut = h => ({ id: h.id, kind: h.kind, title: h.title, start: h.start, end: h.end, leadId: h.lead_id ?? null, createdAt: h.created_at });
const waitOut = (w, name = null) => ({
  id: w.id, clientId: w.client_id, client: name ? { id: w.client_id, name, initials: initials(name) } : null, kind: w.kind, fromDay: w.from_day, toDay: w.to_day,
  prefer: w.prefer, note: w.note, status: w.status, offeredStart: w.offered_start, matchStart: w.match_start ?? null, createdAt: w.created_at, updatedAt: w.updated_at,
});

function daysRange(query, { max = 92, back = 0, ahead = 13 } = {}) {
  const today = londonDay();
  const from = dayArg(query.from, 'from', { optional: true }) ?? addDays(today, -back);
  const to = dayArg(query.to, 'to', { optional: true }) ?? addDays(from, ahead);
  if (to < from) fail(400, 'to is before from');
  if (daysBetween(from, to) > max) fail(400, `At most ${max} days at a time`);
  return { from, to, lo: londonToUtc(from).toISOString(), hi: londonToUtc(addDays(to, 1)).toISOString() };
}

const bool = (v, name) => { if (typeof v !== 'boolean') fail(400, `${name} must be true or false`); return v; };

// MARK: - Sources

function listSources(_req, ctx) {
  requireCoach(ctx);
  return { sources: ctx.db.prepare('SELECT * FROM calendar_sources WHERE coach_id=? ORDER BY created_at').all(ctx.user.id).map(sourceOut) };
}

/** Replace a source's blocks with a fresh parse, in one short transaction. */
function storeParse(db, source, parsed, { etag = null, now = new Date() } = {}) {
  const ins = db.prepare('INSERT INTO busy_blocks (id, source_id, coach_id, start, end, all_day, title, ext_key) VALUES (?,?,?,?,?,?,?,?)');
  tx(db, () => {
    db.prepare('DELETE FROM busy_blocks WHERE source_id=?').run(source.id);
    for (const b of parsed.blocks) ins.run(newId('bb'), source.id, source.coach_id, b.start, b.end, b.allDay ? 1 : 0, source.show_titles ? b.title : null, extKey(source.id, b));
    db.prepare('UPDATE calendar_sources SET last_synced_at=?, last_error=?, sync_failed=0, event_count=?, etag=?, next_sync_at=? WHERE id=?')
      .run(now.toISOString(), parsed.warnings.length ? parsed.warnings.join('; ').slice(0, 300) : null, parsed.blocks.length, etag, nextSync(source.id, now, false), source.id);
  });
}

/** A busy block's identity across syncs (its row id changes each time): the source, the event's UID and its start. */
const extKey = (sourceId, b) => `x${createHash('sha1').update(`${sourceId}|${b.uid ?? ''}|${b.start}`).digest('base64url').slice(0, 14)}`;

/** When to sync next: 15 minutes, staggered by source; an hour after an error. */
function nextSync(id, now, failed) {
  let spread = 0;
  for (const ch of id) spread = (spread * 31 + ch.charCodeAt(0)) % 120;
  return new Date(now.getTime() + (failed ? BACKOFF_MS : SYNC_EVERY_MS) + spread * 1000).toISOString();
}

const windowFor = now => ({ fromMs: londonToUtc(addDays(londonDay(now), -7)).getTime(), toMs: londonToUtc(addDays(londonDay(now), 121)).getTime() });

function readFeed(body) {
  if (!/BEGIN:VCALENDAR/i.test(body ?? '')) throw new Error('That address is not an iCal calendar');
}

async function addSource(_req, ctx) {
  requireCoach(ctx);
  if (ctx.user.is_demo) fail(403, 'The demo account can\'t connect calendars');
  const label = str(ctx.body.label, 'label', { max: 60 });
  const raw = str(ctx.body.url, 'url', { max: 2000 });
  const color = ctx.body.color === undefined ? 'chart-4' : oneOf(ctx.body.color, 'color', COLORS);
  const showTitles = ctx.body.showTitles === undefined ? false : bool(ctx.body.showTitles, 'showTitles');
  if (ctx.db.prepare('SELECT COUNT(*) n FROM calendar_sources WHERE coach_id=?').get(ctx.user.id).n >= MAX_SOURCES) fail(409, `At most ${MAX_SOURCES} calendars`);
  const url = vetUrl(raw);
  const now = new Date();
  let fetched, parsed;
  try {
    fetched = await fetchIcs(ctx.config, url.href);
    readFeed(fetched.body);
    parsed = parseIcs(fetched.body, windowFor(now));
  } catch (e) {
    fail(400, `Could not read that calendar: ${e.status ? e.message : (e.message || 'it did not answer')}`.slice(0, 200));
  }
  const id = newId('cs');
  ctx.db.prepare(`INSERT INTO calendar_sources (id, coach_id, label, url_enc, url_hint, color, show_titles, active, event_count, created_at)
    VALUES (?,?,?,?,?,?,?,1,0,?)`).run(id, ctx.user.id, label, encryptUrl(ctx.config, url.href), urlHint(url), color, showTitles ? 1 : 0, now.toISOString());
  const source = ctx.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(id);
  storeParse(ctx.db, source, parsed, { etag: fetched.etag, now });
  afterSync(ctx.db, ctx.config, ctx.user.id, now);
  return { source: sourceOut(ctx.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(id)) };
}

async function patchSource(_req, ctx) {
  requireCoach(ctx);
  const s = ownRow(ctx, 'calendar_sources', ctx.params.id);
  const b = ctx.body;
  const label = b.label === undefined ? s.label : str(b.label, 'label', { max: 60 });
  const color = b.color === undefined ? s.color : oneOf(b.color, 'color', COLORS);
  const showTitles = b.showTitles === undefined ? !!s.show_titles : bool(b.showTitles, 'showTitles');
  const active = b.active === undefined ? !!s.active : bool(b.active, 'active');
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE calendar_sources SET label=?, color=?, show_titles=?, active=? WHERE id=?').run(label, color, showTitles ? 1 : 0, active ? 1 : 0, s.id);
    // Titles off: forget the ones already stored, now.
    if (!showTitles) ctx.db.prepare('UPDATE busy_blocks SET title=NULL WHERE source_id=?').run(s.id);
  });
  // Titles on: they are only kept from the next fetch, so fetch now.
  if (showTitles && !s.show_titles && active) await syncSource(ctx.db, ctx.config, ctx.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(s.id), new Date(), { force: true });
  return { source: sourceOut(ctx.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(s.id)) };
}

function deleteSource(_req, ctx) {
  requireCoach(ctx);
  const s = ownRow(ctx, 'calendar_sources', ctx.params.id);
  ctx.db.prepare('DELETE FROM calendar_sources WHERE id=?').run(s.id);
  return { ok: true };
}

async function syncNow(_req, ctx) {
  requireCoach(ctx);
  const s = ownRow(ctx, 'calendar_sources', ctx.params.id);
  if (ctx.user.is_demo) fail(403, 'The demo account can\'t connect calendars');
  await syncSource(ctx.db, ctx.config, s, new Date(), { force: true });
  return { source: sourceOut(ctx.db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(s.id)) };
}

/**
 * Fetch and store one source. Network first, then one short write. Errors are
 * recorded on the source (never the address) and back off for an hour.
 */
export async function syncSource(db, config, source, now = new Date(), { force = false } = {}) {
  const coach = db.prepare('SELECT is_demo FROM users WHERE id=?').get(source.coach_id);
  if (!coach || coach.is_demo) return { skipped: 'demo' };
  try {
    const url = decryptUrl(config, source.url_enc);
    const res = await fetchIcs(config, url, { etag: force ? null : source.etag });
    if (!db.prepare('SELECT 1 FROM calendar_sources WHERE id=?').get(source.id)) return { skipped: 'removed' };
    if (res.status === 304) {
      db.prepare('UPDATE calendar_sources SET last_synced_at=?, sync_failed=0, next_sync_at=? WHERE id=?').run(now.toISOString(), nextSync(source.id, now, false), source.id);
    } else {
      readFeed(res.body);
      const fresh = db.prepare('SELECT * FROM calendar_sources WHERE id=?').get(source.id);
      storeParse(db, fresh, parseIcs(res.body, windowFor(now)), { etag: res.etag, now });
    }
    afterSync(db, config, source.coach_id, now);
    return { ok: true };
  } catch (e) {
    const message = String(e?.message ?? e).replace(/https?:\/\/\S+/g, '[address]').slice(0, 200);
    db.prepare('UPDATE calendar_sources SET last_error=?, sync_failed=1, next_sync_at=? WHERE id=?').run(message, nextSync(source.id, now, true), source.id);
    console.warn(`Calendar ${source.id} sync failed: ${message}`);
    return { error: message };
  }
}

/** The 60 s clock: sync up to three due sources, one at a time. */
async function syncDue(db, config, now) {
  const due = db.prepare(`SELECT s.* FROM calendar_sources s JOIN users u ON u.id=s.coach_id
    WHERE s.active=1 AND u.is_demo=0 AND (s.next_sync_at IS NULL OR s.next_sync_at<=?) ORDER BY COALESCE(s.next_sync_at, '') LIMIT 3`).all(now.toISOString());
  const out = [];
  for (const s of due) out.push(await syncSource(db, config, s, now));
  return out;
}

// MARK: - Busy, prefs, time off

function getBusy(_req, ctx) {
  requireCoach(ctx);
  const { lo, hi } = daysRange(ctx.query);
  const blocks = ctx.db.prepare(`SELECT k.*, s.color, s.label FROM busy_blocks k JOIN calendar_sources s ON s.id=k.source_id
    WHERE k.coach_id=? AND s.active=1 AND k.end>? AND k.start<? ORDER BY k.start`).all(ctx.user.id, lo, hi);
  return {
    blocks: blocks.map(k => ({ id: k.id, sourceId: k.source_id, start: k.start, end: k.end, allDay: !!k.all_day, title: k.title ?? null, color: k.color, label: k.label })),
    timeOff: ctx.db.prepare('SELECT * FROM time_off WHERE coach_id=? AND end>? AND start<? ORDER BY start').all(ctx.user.id, lo, hi).map(timeOffOut),
    holds: ctx.db.prepare('SELECT * FROM calendar_holds WHERE coach_id=? AND end>? AND start<? ORDER BY start').all(ctx.user.id, lo, hi).map(holdOut),
  };
}

function getPrefs(_req, ctx) {
  requireCoach(ctx);
  return { prefs: calendarPrefs(ctx.db, ctx.user.id), defaults: PREF_DEFAULTS };
}

function putPrefs(_req, ctx) {
  requireCoach(ctx);
  const cur = calendarPrefs(ctx.db, ctx.user.id);
  const b = ctx.body;
  const pick = (key, opts) => (b[key] === undefined ? cur[key] : num(b[key], key, { int: true, ...opts }));
  const maxPerDay = b.maxPerDay === undefined ? cur.maxPerDay : b.maxPerDay === null ? null : num(b.maxPerDay, 'maxPerDay', { min: 1, max: 20, int: true });
  const v = {
    bufferBefore: pick('bufferBefore', { min: 0, max: 60 }), bufferAfter: pick('bufferAfter', { min: 0, max: 60 }),
    minNoticeHours: pick('minNoticeHours', { min: 0, max: 168 }), travelGap: pick('travelGap', { min: 0, max: 120 }),
    cancelNoticeHours: pick('cancelNoticeHours', { min: 0, max: 168 }),
    cancelFeePence: pick('cancelFeePence', { min: 0, max: 100_000 }), noShowFeePence: pick('noShowFeePence', { min: 0, max: 100_000 }),
    cancelForfeitCredit: b.cancelForfeitCredit === undefined ? cur.cancelForfeitCredit : bool(b.cancelForfeitCredit, 'cancelForfeitCredit'),
  };
  ctx.db.prepare(`INSERT INTO calendar_prefs (coach_id, buffer_before, buffer_after, min_notice_hours, max_per_day, travel_gap, cancel_notice_hours, cancel_forfeit_credit, cancel_fee_pence, noshow_fee_pence, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(coach_id) DO UPDATE SET buffer_before=excluded.buffer_before, buffer_after=excluded.buffer_after,
    min_notice_hours=excluded.min_notice_hours, max_per_day=excluded.max_per_day, travel_gap=excluded.travel_gap, cancel_notice_hours=excluded.cancel_notice_hours,
    cancel_forfeit_credit=excluded.cancel_forfeit_credit, cancel_fee_pence=excluded.cancel_fee_pence, noshow_fee_pence=excluded.noshow_fee_pence, updated_at=excluded.updated_at`)
    .run(ctx.user.id, v.bufferBefore, v.bufferAfter, v.minNoticeHours, maxPerDay, v.travelGap, v.cancelNoticeHours, v.cancelForfeitCredit ? 1 : 0, v.cancelFeePence, v.noShowFeePence, nowIso());
  return { prefs: calendarPrefs(ctx.db, ctx.user.id) };
}

function listTimeOff(_req, ctx) {
  requireCoach(ctx);
  const since = londonToUtc(addDays(londonDay(), -30)).toISOString();
  return { items: ctx.db.prepare('SELECT * FROM time_off WHERE coach_id=? AND end>? ORDER BY start').all(ctx.user.id, since).map(timeOffOut) };
}

/** Bookings inside [lo, hi): what time off would clash with. */
function bookingsInside(db, coachId, lo, hi) {
  return db.prepare(`SELECT b.id, b.kind, b.start, b.end, b.title, u.name client_name FROM bookings b LEFT JOIN users u ON u.id=b.client_id
    WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.end>? AND b.start<? ORDER BY b.start`).all(coachId, lo, hi)
    .map(b => ({ bookingId: b.id, start: b.start, end: b.end, kind: b.kind, title: b.kind === 'group' ? b.title : `${b.client_name ?? 'Client'} ${b.kind === 'video' ? 'video' : '1:1'}` }));
}

function addTimeOff(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const allDay = b.allDay === undefined ? true : bool(b.allDay, 'allDay');
  let start, end;
  if (allDay) {
    const from = dayArg(b.start, 'start'), to = dayArg(b.end ?? b.start, 'end');
    if (to < from) fail(400, 'end is before start');
    if (daysBetween(from, to) > 366) fail(400, 'At most a year at a time');
    start = londonToUtc(from).toISOString(); end = londonToUtc(addDays(to, 1)).toISOString();
  } else {
    start = instant(b.start, 'start'); end = instant(b.end, 'end');
    if (end <= start) fail(400, 'end is before start');
    if (Date.parse(end) - Date.parse(start) > 366 * DAY_MS) fail(400, 'At most a year at a time');
  }
  const reason = b.reason === undefined || b.reason === null ? '' : str(b.reason, 'reason', { max: 80, min: 0 });
  const id = newId('to');
  ctx.db.prepare('INSERT INTO time_off (id, coach_id, start, end, reason, all_day, created_at) VALUES (?,?,?,?,?,?,?)').run(id, ctx.user.id, start, end, reason, allDay ? 1 : 0, nowIso());
  return { item: timeOffOut(ctx.db.prepare('SELECT * FROM time_off WHERE id=?').get(id)), conflicts: bookingsInside(ctx.db, ctx.user.id, start, end) };
}

function deleteTimeOff(_req, ctx) {
  requireCoach(ctx);
  const t = ownRow(ctx, 'time_off', ctx.params.id);
  ctx.db.prepare('DELETE FROM time_off WHERE id=?').run(t.id);
  return { ok: true };
}

function addBankHolidays(_req, ctx) {
  requireCoach(ctx);
  const years = ctx.body.years;
  if (!Array.isArray(years) || !years.length || years.length > 3) fail(400, 'years must be a list of up to 3 years');
  let added = 0;
  tx(ctx.db, () => {
    for (const [i, y] of years.entries()) {
      num(y, `years[${i}]`, { min: 2000, max: 2100, int: true });
      for (const hday of bankHolidays(y)) {
        const start = londonToUtc(hday.day).toISOString();
        if (ctx.db.prepare('SELECT 1 FROM time_off WHERE coach_id=? AND start=? AND all_day=1').get(ctx.user.id, start)) continue;
        ctx.db.prepare('INSERT INTO time_off (id, coach_id, start, end, reason, all_day, created_at) VALUES (?,?,?,?,?,1,?)')
          .run(newId('to'), ctx.user.id, start, londonToUtc(addDays(hday.day, 1)).toISOString(), hday.name, nowIso());
        added++;
      }
    }
  });
  return { added };
}

// MARK: - Conflicts

const SEVERITY_ORDER = { high: 0, medium: 1 };
const item = (type, i, extra = {}) => ({ type, id: i.id, ...(i.key ? { key: i.key } : {}), start: i.start, end: i.end, title: i.title, ...extra });
const fmtWhen = iso => shortWhen(iso).replace(/^(\w+) \d+ \w+ /, '$1 ');
/** "2026-11-24" → "24 Nov". */
const dayWords = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

/**
 * Every clash between `fromIso` and `toIso`: booking × booking (overlap or
 * buffer), booking × external busy, booking × time off, booking × hold,
 * hold × external busy, a day over the cap, and a missing travel gap.
 * Each has a stable `key` (kind + sorted ids) so it can be ignored.
 */
export function computeConflicts(db, coachId, fromIso, toIso) {
  const prefs = calendarPrefs(db, coachId);
  const all = busyIntervals(db, coachId, fromIso, toIso, { prefs }).filter(i => Date.parse(i.end) > Date.parse(fromIso) && Date.parse(i.start) < Date.parse(toIso));
  const bookings = all.filter(i => i.type === 'booking'), holds = all.filter(i => i.type === 'hold');
  const external = all.filter(i => i.type === 'external'), off = all.filter(i => i.type === 'timeOff');
  const out = [];
  const overlaps = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
  // Keys use stable ids: a busy block's row id changes with every sync, its ext key does not.
  const add = (kind, severity, a, b, text) => out.push({ key: `${kind}:${[a.key ?? a.id, b.key ?? b.id].sort().join('|')}`, kind, severity, a, b, text });
  const label = i => `${i.title} ${fmtWhen(i.start)}`;
  for (let x = 0; x < bookings.length; x++) {
    const a = bookings[x];
    for (let y = x + 1; y < bookings.length; y++) {
      const b = bookings[y];
      if (overlaps(a, b)) add('overlap', 'high', item('booking', a), item('booking', b), `${label(a)} overlaps ${label(b)}`);
      else if (a.from < Date.parse(b.end) && a.to > Date.parse(b.start) || b.from < Date.parse(a.end) && b.to > Date.parse(a.start)) {
        add('buffer', 'medium', item('booking', a), item('booking', b), `${label(a)} and ${label(b)} leave no buffer`);
      } else if (prefs.travelGap > 0) {
        const [first, second] = Date.parse(a.start) < Date.parse(b.start) ? [a, b] : [b, a];
        const gap = Date.parse(second.start) - Date.parse(first.end);
        if (first.kind === 'video' && second.kind === 'inperson' && gap >= 0 && gap < prefs.travelGap * MIN && londonDay(new Date(first.end)) === londonDay(new Date(second.start))) {
          add('travel', 'medium', item('booking', first), item('booking', second), `${label(second)} is in person ${Math.round(gap / MIN)} min after ${label(first)}: no travel gap`);
        }
      }
    }
    for (const e of external) if (overlaps(a, e)) add('external', e.allDay ? 'medium' : 'high', item('booking', a), item('external', e, { label: e.label, allDay: !!e.allDay }), `${label(a)} overlaps ${e.title}${e.label ? ` (${e.label})` : ''}`);
    for (const t of off) if (overlaps(a, t)) add('timeOff', 'high', item('booking', a), item('timeOff', t), `${label(a)} falls in time off${t.title && t.title !== 'Time off' ? `: ${t.title}` : ''}`);
    for (const hd of holds) if (overlaps(a, hd)) add('overlap', 'high', item('booking', a), item('hold', hd, { kind: hd.kind }), `${label(a)} overlaps the hold “${hd.title}”`);
  }
  for (const hd of holds) {
    for (const e of external) if (overlaps(hd, e)) add('external', e.allDay ? 'medium' : 'high', item('hold', hd, { kind: hd.kind }), item('external', e, { label: e.label, allDay: !!e.allDay }), `${hd.title} ${fmtWhen(hd.start)} overlaps ${e.title}${e.label ? ` (${e.label})` : ''}`);
    for (const t of off) if (overlaps(hd, t)) add('timeOff', 'medium', item('hold', hd, { kind: hd.kind }), item('timeOff', t), `${hd.title} ${fmtWhen(hd.start)} falls in time off`);
  }
  if (prefs.maxPerDay) {
    const perDay = new Map();
    for (const b of bookings) { const d = londonDay(new Date(b.start)); (perDay.get(d) ?? perDay.set(d, []).get(d)).push(b); }
    for (const [d, list] of perDay) {
      if (list.length <= prefs.maxPerDay) continue;
      const first = list[0], last = list.at(-1);
      out.push({ key: `capacity:${d}`, kind: 'capacity', severity: 'medium',
        a: { type: 'day', id: d, start: first.start, end: last.end, title: `${list.length} sessions` },
        b: { type: 'cap', id: `max${prefs.maxPerDay}`, start: first.start, end: last.end, title: `Max ${prefs.maxPerDay} a day` },
        text: `${shortWhen(first.start).replace(/ \d\d:\d\d$/, '')} has ${list.length} sessions, over your ${prefs.maxPerDay} a day` });
    }
  }
  return out.sort((p, q) => SEVERITY_ORDER[p.severity] - SEVERITY_ORDER[q.severity] || p.a.start.localeCompare(q.a.start));
}

const ignoredKeys = (db, coachId) => new Set(db.prepare('SELECT key FROM conflict_ignores WHERE coach_id=?').all(coachId).map(r => r.key));

function getConflicts(_req, ctx) {
  requireCoach(ctx);
  const { lo, hi } = daysRange(ctx.query, { ahead: 27 });
  const ignored = ignoredKeys(ctx.db, ctx.user.id);
  const all = computeConflicts(ctx.db, ctx.user.id, lo, hi);
  return { conflicts: all.filter(c => !ignored.has(c.key)), ignored: all.filter(c => ignored.has(c.key)).map(c => c.key) };
}

function ignoreConflict(_req, ctx) {
  requireCoach(ctx);
  const key = str(ctx.body.key, 'key', { max: 200 });
  if (!/^(overlap|buffer|external|timeOff|capacity|travel):[A-Za-z0-9_|:.-]+$/.test(key)) fail(400, 'key is not a conflict key');
  ctx.db.prepare('INSERT OR IGNORE INTO conflict_ignores (coach_id, key, at) VALUES (?,?,?)').run(ctx.user.id, key, nowIso());
  return { ok: true };
}

/** After a sync: notify (once per key) and emit calendar.conflict for new high-severity clashes in the next 14 days. */
export function afterSync(db, config, coachId, now = new Date()) {
  const lo = now.toISOString(), hi = new Date(now.getTime() + 14 * DAY_MS).toISOString();
  const ignored = ignoredKeys(db, coachId);
  let fresh = 0;
  for (const c of computeConflicts(db, coachId, lo, hi)) {
    if (c.severity !== 'high' || ignored.has(c.key)) continue;
    const isNew = tx(db, () => {
      if (db.prepare('SELECT 1 FROM calendar_conflicts_seen WHERE coach_id=? AND key=?').get(coachId, c.key)) return false;
      db.prepare('INSERT INTO calendar_conflicts_seen (coach_id, key, at) VALUES (?,?,?)').run(coachId, c.key, now.toISOString());
      const clientId = c.a.type === 'booking' ? db.prepare('SELECT client_id FROM bookings WHERE id=?').get(c.a.id)?.client_id ?? null : null;
      emit(db, 'calendar.conflict', { coachId, clientId, summary: c.text.slice(0, 120), key: c.key, kind: c.kind, severity: c.severity });
      notifyCoach(db, config, coachId, { clientId, kind: 'calendar.conflict', title: 'Calendar clash', body: c.text, path: '/schedule?panel=conflicts:open', icon: 'event_busy', tone: 'urgent', dedupe: `conflict:${c.key}`, now });
      return true;
    });
    if (isNew) fresh++;
  }
  db.prepare('DELETE FROM calendar_conflicts_seen WHERE coach_id=? AND at<?').run(coachId, new Date(now.getTime() - 30 * DAY_MS).toISOString());
  return fresh;
}

// MARK: - Holds

function listHolds(_req, ctx) {
  requireCoach(ctx);
  const { lo, hi } = daysRange(ctx.query, { ahead: 27 });
  return { holds: ctx.db.prepare('SELECT * FROM calendar_holds WHERE coach_id=? AND end>? AND start<? ORDER BY start').all(ctx.user.id, lo, hi).map(holdOut) };
}

function holdTimes(b, cur = null) {
  const start = b.start === undefined && cur ? cur.start : instant(b.start, 'start');
  const end = b.end === undefined && cur ? cur.end : instant(b.end, 'end');
  if (end <= start) fail(400, 'end is before start');
  if (Date.parse(end) - Date.parse(start) > 12 * HOUR) fail(400, 'A hold is at most 12 hours');
  return { start, end };
}

function assertNoBooking(db, coachId, start, end) {
  const clash = db.prepare(`SELECT b.start, b.title, u.name FROM bookings b LEFT JOIN users u ON u.id=b.client_id
    WHERE b.coach_id=? AND b.cancelled_at IS NULL AND b.end>? AND b.start<? LIMIT 1`).get(coachId, start, end);
  if (clash) fail(409, `That overlaps ${clash.name ? `${clash.name}'s session` : clash.title} at ${shortWhen(clash.start).slice(-5)}`);
}

function addHold(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const kind = oneOf(b.kind, 'kind', HOLD_KINDS);
  const title = b.title === undefined || b.title === null || b.title === '' ? HOLD_TITLE[kind] : str(b.title, 'title', { max: 80 });
  const { start, end } = holdTimes(b);
  const leadId = b.leadId === undefined || b.leadId === null ? null : str(b.leadId, 'leadId', { max: 64 });
  assertNoBooking(ctx.db, ctx.user.id, start, end);
  const id = newId('hd');
  tx(ctx.db, () => {
    ctx.db.prepare('INSERT INTO calendar_holds (id, coach_id, kind, title, start, end, lead_id, created_at) VALUES (?,?,?,?,?,?,?,?)').run(id, ctx.user.id, kind, title, start, end, leadId, nowIso());
    emit(ctx.db, 'hold.created', { coachId: ctx.user.id, summary: `${HOLD_TITLE[kind]} held · ${shortWhen(start)}`, holdId: id, kind, start, leadId });
  });
  return { hold: holdOut(ctx.db.prepare('SELECT * FROM calendar_holds WHERE id=?').get(id)) };
}

function patchHold(_req, ctx) {
  requireCoach(ctx);
  const h = ownRow(ctx, 'calendar_holds', ctx.params.id);
  const title = ctx.body.title === undefined ? h.title : str(ctx.body.title, 'title', { max: 80 });
  const { start, end } = holdTimes(ctx.body, h);
  if (start !== h.start || end !== h.end) assertNoBooking(ctx.db, ctx.user.id, start, end);
  ctx.db.prepare('UPDATE calendar_holds SET title=?, start=?, end=? WHERE id=?').run(title, start, end, h.id);
  return { hold: holdOut(ctx.db.prepare('SELECT * FROM calendar_holds WHERE id=?').get(h.id)) };
}

function deleteHold(_req, ctx) {
  requireCoach(ctx);
  const h = ownRow(ctx, 'calendar_holds', ctx.params.id);
  ctx.db.prepare('DELETE FROM calendar_holds WHERE id=?').run(h.id);
  return { ok: true };
}

/** A trial hold becomes a 1:1 for the (new) client at the same time; the hold goes. */
function convertHold(_req, ctx) {
  requireCoach(ctx);
  const h = ownRow(ctx, 'calendar_holds', ctx.params.id);
  if (h.kind !== 'trial') fail(400, 'Only a trial hold can become a booking');
  const client = clientFor(ctx, ctx.body.clientId);
  const kind = ctx.body.kind === undefined ? 'inperson' : oneOf(ctx.body.kind, 'kind', ['inperson', 'video']);
  assertNoBooking(ctx.db, ctx.user.id, h.start, h.end);
  const location = kind === 'video' ? 'Video call' : rulesOf(ctx.db, ctx.user.id).find(r => r.kind === 'inperson')?.location || 'Studio 2';
  const id = tx(ctx.db, () => {
    const bid = insertBooking(ctx.db, { coachId: ctx.user.id, client, kind, start: h.start, end: h.end, location, usesCredit: false, byRole: 'coach' });
    ctx.db.prepare('DELETE FROM calendar_holds WHERE id=?').run(h.id);
    return bid;
  });
  const b = ctx.db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  notify(ctx.db, ctx.config, client.id, { title: `${ctx.user.name} booked you in`, body: `Trial session · ${shortWhen(b.start)}`, kind: 'booking', id });
  return { booking: { id: b.id, kind: b.kind, start: b.start, end: b.end, location: b.location, title: b.title, client: { id: client.id, name: client.name } } };
}

// MARK: - Slot finder (F21)

const PERIODS = ['morning', 'midday', 'evening'];
/** Morning before 10:00, midday 10:00–14:59, evening from 15:00 (the same cut as the apps' onboarding question). */
const periodOf = clockStr => (clockStr < '10:00' ? 'morning' : clockStr < '15:00' ? 'midday' : 'evening');
const firstName = n => String(n ?? '').split(' ')[0];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Score every free slot for a client (or for a hold, with no client) and
 * return the best eight with reasons. Deterministic: ties go to the sooner slot.
 */
export function findSlots(db, coachId, { client = null, kind = null, minutes = null, from, to, prefer = 'any', now = new Date() }) {
  const prefs = calendarPrefs(db, coachId);
  const slots = slotsFor(db, coachId, from, to, kind, { now });
  const intervals = busyIntervals(db, coachId, londonToUtc(from).toISOString(), londonToUtc(addDays(to, 1)).toISOString(), { prefs });
  let usual = null;
  let likes = null;
  if (client) {
    const past = db.prepare(`SELECT start FROM bookings WHERE client_id=? AND coach_id=? AND cancelled_at IS NULL AND start<? ORDER BY start DESC LIMIT 12`).all(client.id, coachId, now.toISOString());
    const tally = new Map();
    for (const p of past) { const d = new Date(p.start); const k = `${weekday(londonDay(d))} ${londonClock(d).slice(0, 2)}`; tally.set(k, (tally.get(k) ?? 0) + 1); }
    const best = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best && best[1] >= 2) usual = best[0];
    try { likes = JSON.parse(client.profile ?? 'null')?.preferredTime ?? null; } catch { likes = null; }
    if (!PERIODS.includes(likes)) likes = null;
  }
  const lastOfDay = new Map();
  for (const s of slots) { const d = londonDay(new Date(s.start)); if (!lastOfDay.has(d) || s.start > lastOfDay.get(d)) lastOfDay.set(d, s.start); }
  const out = [];
  const who = client ? firstName(client.name) : null;
  for (const s of slots) {
    const startMs = Date.parse(s.start);
    if (startMs <= now.getTime()) continue;
    const endMs = minutes ? startMs + minutes * MIN : Date.parse(s.end);
    if (minutes ? clashOf(intervals, prefs, startMs, endMs, s.kind) : !s.open) continue;
    const at = new Date(startMs), d = londonDay(at), clk = londonClock(at);
    if (prefer !== 'any' && periodOf(clk) !== prefer) continue;
    let score = 0;
    const reasons = [];
    if (usual && usual === `${weekday(d)} ${clk.slice(0, 2)}`) { score += 3; reasons.push(`Matches ${who}'s usual ${DAY_NAMES[weekday(d) % 7]} ${clk}`); }
    if (likes && periodOf(clk) === likes) { score += 2; reasons.push(`${who} prefers ${likes === 'midday' ? 'middays' : `${likes}s`}`); }
    const next = intervals.find(i => i.type === 'booking' && Date.parse(i.start) >= endMs && Date.parse(i.start) - endMs <= (prefs.bufferAfter + 20) * MIN);
    const prev = intervals.find(i => i.type === 'booking' && Date.parse(i.end) <= startMs && startMs - Date.parse(i.end) <= (prefs.bufferAfter + 20) * MIN);
    if (next || prev) {
      score += 1;
      reasons.push(next ? `Free before your ${londonClock(new Date(next.start))}` : `Right after ${prev.title} at ${londonClock(new Date(prev.start))}`);
      if (prefs.bufferAfter || prefs.bufferBefore) reasons.push('No buffer clash');
    }
    if (lastOfDay.get(d) === s.start) { score -= 2; reasons.push('Last slot of the day'); }
    const ahead = Math.max(0, daysBetween(londonDay(now), d));
    score -= ahead;
    if (!reasons.length) reasons.push(ahead === 0 ? 'Free today' : ahead === 1 ? 'Free tomorrow' : 'Free');
    out.push({ start: s.start, end: new Date(endMs).toISOString(), kind: s.kind, location: s.location, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.start.localeCompare(b.start)).slice(0, 8);
}

function find(_req, ctx) {
  requireCoach(ctx);
  const q = ctx.query;
  const client = q.clientId ? clientFor(ctx, q.clientId) : null;
  const kind = q.kind ? oneOf(q.kind, 'kind', ['inperson', 'video']) : null;
  const minutes = q.minutes ? num(Number(q.minutes), 'minutes', { min: 15, max: 240, int: true }) : null;
  const prefer = q.prefer ? oneOf(q.prefer, 'prefer', ['any', ...PERIODS]) : 'any';
  const today = londonDay();
  const from = dayArg(q.from, 'from', { optional: true }) ?? today;
  const to = dayArg(q.to, 'to', { optional: true }) ?? addDays(from, 13);
  if (to < from) fail(400, 'to is before from');
  if (daysBetween(from, to) > 62) fail(400, 'At most 62 days at a time');
  return { suggestions: findSlots(ctx.db, ctx.user.id, { client, kind, minutes, from: from < today ? today : from, to, prefer }) };
}

// MARK: - Waitlist (F21)

const WAIT_KINDS = ['inperson', 'video', 'any'];

function listWaitlist(_req, ctx) {
  requireCoach(ctx);
  // The client's current coach sees their entries (a client moved to another coach takes the entry with them).
  const rows = ctx.db.prepare(`SELECT w.*, u.name FROM waitlist w JOIN users u ON u.id=w.client_id AND u.role='client' AND u.coach_id=?
    WHERE w.status IN ('waiting','offered') ORDER BY w.created_at`).all(ctx.user.id);
  return { items: rows.map(r => waitOut(r, r.name)) };
}

function joinWaitlist(_req, ctx) {
  requireMember(ctx);
  const client = clientFor(ctx, ctx.user.role === 'coach' ? ctx.body.clientId : undefined);
  if (!client.coach_id) fail(409, 'You do not have a coach yet');
  const b = ctx.body;
  const kind = oneOf(b.kind ?? 'any', 'kind', WAIT_KINDS);
  const fromDay = dayArg(b.fromDay, 'fromDay'), toDay = dayArg(b.toDay, 'toDay');
  if (toDay < fromDay) fail(400, 'toDay is before fromDay');
  if (daysBetween(fromDay, toDay) > 92) fail(400, 'At most 92 days at a time');
  if (toDay < londonDay()) fail(400, 'That window has passed');
  const prefer = oneOf(b.prefer ?? 'any', 'prefer', ['any', ...PERIODS]);
  const note = b.note === undefined || b.note === null ? '' : str(b.note, 'note', { max: 280, min: 0 });
  if (ctx.db.prepare("SELECT COUNT(*) n FROM waitlist WHERE client_id=? AND status IN ('waiting','offered')").get(client.id).n >= 5) fail(409, 'Already on the waitlist five times');
  const id = newId('wl');
  const at = nowIso();
  ctx.db.prepare('INSERT INTO waitlist (id, coach_id, client_id, kind, from_day, to_day, prefer, note, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, client.coach_id, client.id, kind, fromDay, toDay, prefer, note, at, at);
  return { item: waitOut(ctx.db.prepare('SELECT * FROM waitlist WHERE id=?').get(id), client.name) };
}

/** A waitlist row the caller may act on: the coach's (client still theirs), or the client's own. */
function waitRow(ctx) {
  const w = ctx.db.prepare('SELECT * FROM waitlist WHERE id=?').get(ctx.params.id);
  if (!w) fail(404, 'Not found');
  if (ctx.user.role === 'coach') {
    const ok = ctx.db.prepare("SELECT 1 FROM users WHERE id=? AND role='client' AND coach_id=?").get(w.client_id, ctx.user.id);
    if (!ok) fail(404, 'Not found');
  } else if (w.client_id !== ctx.user.id) fail(404, 'Not found');
  return w;
}

const KIND_NAME = { inperson: 'in-person 1:1', video: 'video call', any: 'session' };

function offerSlot(_req, ctx) {
  requireCoach(ctx);
  const w = waitRow(ctx);
  if (!['waiting', 'offered'].includes(w.status)) fail(409, 'That entry is closed');
  const start = instant(ctx.body.start, 'start');
  if (Date.parse(start) <= Date.now()) fail(400, 'That time has passed');
  const client = ctx.db.prepare('SELECT * FROM users WHERE id=?').get(w.client_id);
  const when = shortWhen(start);
  const text = ctx.body.text === undefined || ctx.body.text === null || ctx.body.text === ''
    ? `Hi ${firstName(client.name)}, a ${KIND_NAME[w.kind]} slot has opened on ${when.replace(/ (\d\d:\d\d)$/, ' at $1')}. Book it in the app if it suits you. First come, first served.`
    : str(ctx.body.text, 'text', { max: 2000 });
  const out = tx(ctx.db, () => {
    const sent = sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: w.client_id, text, via: 'coachAction' });
    ctx.db.prepare("UPDATE waitlist SET status='offered', offered_start=?, coach_id=?, updated_at=? WHERE id=?").run(start, ctx.user.id, nowIso(), w.id);
    return sent;
  });
  return { item: waitOut(ctx.db.prepare('SELECT * FROM waitlist WHERE id=?').get(w.id), client.name), messageId: out.message?.id ?? null };
}

function leaveWaitlist(_req, ctx) {
  requireMember(ctx);
  const w = waitRow(ctx);
  ctx.db.prepare('DELETE FROM waitlist WHERE id=?').run(w.id);
  return { ok: true };
}

/** Does a waitlist entry want this freed slot? */
function wants(w, start, kind) {
  const d = new Date(start), dy = londonDay(d);
  if (dy < w.from_day || dy > w.to_day) return false;
  if (w.kind !== 'any' && w.kind !== kind) return false;
  return w.prefer === 'any' || periodOf(londonClock(d)) === w.prefer;
}

/** booking.cancelled: a freed 1:1 slot is matched against the waitlist and the coach is told. */
function onCancelled(db, config, ev) {
  const p = ev.payload;
  if (!ev.coachId || !['inperson', 'video'].includes(p.kind) || !p.start || Date.parse(p.start) <= Date.now()) return;
  const rows = db.prepare(`SELECT w.*, u.name FROM waitlist w JOIN users u ON u.id=w.client_id AND u.coach_id=?
    WHERE w.status='waiting' AND w.client_id IS NOT ?`).all(ev.coachId, ev.clientId);
  const matched = rows.filter(w => wants(w, p.start, p.kind));
  if (!matched.length) return;
  for (const w of matched) {
    db.prepare('UPDATE waitlist SET match_start=?, match_kind=?, updated_at=? WHERE id=?').run(p.start, p.kind, nowIso(), w.id);
    emit(db, 'waitlist.matched', { coachId: ev.coachId, clientId: w.client_id, summary: `Slot free ${shortWhen(p.start)}`, waitlistId: w.id, start: p.start, kind: p.kind });
  }
  notifyCoach(db, config, ev.coachId, {
    kind: 'waitlist.matched', title: `Slot freed ${shortWhen(p.start)}: ${matched.length} on the waitlist`,
    body: matched.map(w => firstName(w.name)).join(', '), path: '/schedule/waitlist', icon: 'event_available', tone: 'attention', dedupe: `waitlist:${p.bookingId}`,
  });
}

/** lead.deleted: a hold keeps its time but loses the lead (and the lead's name in its title). */
function onLeadDeleted(db, _config, ev) {
  const leadId = ev.payload?.leadId;
  if (!leadId || !ev.coachId) return;
  for (const h of db.prepare('SELECT * FROM calendar_holds WHERE coach_id=? AND lead_id=?').all(ev.coachId, leadId)) {
    const title = h.title === HOLD_TITLE[h.kind] ? h.title : HOLD_TITLE[h.kind];
    db.prepare('UPDATE calendar_holds SET lead_id=NULL, title=? WHERE id=?').run(h.kind === 'admin' ? h.title : title, h.id);
  }
}

// MARK: - Reminders (F21)

/**
 * The 5 min clock: a push at 24 h and at 2 h before each upcoming session, to
 * each client on it, once (booking_reminders), skipping demo accounts and
 * people who turned notifications off. A threshold that had passed when the
 * session was booked is skipped.
 */
export function sendReminders(db, config, now = new Date()) {
  const hi = new Date(now.getTime() + 24 * HOUR).toISOString();
  const rows = db.prepare(`SELECT b.*, c.name coach_name FROM bookings b JOIN users c ON c.id=b.coach_id
    WHERE b.cancelled_at IS NULL AND b.start>? AND b.start<=? AND c.is_demo=0`).all(now.toISOString(), hi);
  let sent = 0;
  for (const b of rows) {
    const people = b.kind === 'group'
      ? db.prepare('SELECT u.id, u.notifications_on FROM class_attendees a JOIN users u ON u.id=a.user_id WHERE a.booking_id=? AND u.is_demo=0').all(b.id)
      : db.prepare('SELECT id, notifications_on FROM users WHERE id=? AND is_demo=0').all(b.client_id ?? '');
    const until = Date.parse(b.start) - now.getTime();
    for (const hours of [24, 2]) {
      if (until > hours * HOUR) continue;
      if (hours === 24 && until <= 2 * HOUR) continue; // the 2 h one covers it
      if (Date.parse(b.created_at) > Date.parse(b.start) - hours * HOUR) continue;
      for (const person of people) {
        const claimed = tx(db, () => {
          const n = db.prepare('INSERT OR IGNORE INTO booking_reminders (booking_id, client_id, hours, sent_at) VALUES (?,?,?,?)').run(b.id, person.id, hours, now.toISOString()).changes;
          if (n) emit(db, 'booking.upcoming', { coachId: b.coach_id, clientId: person.id, summary: `Reminder · ${hours} h before`, bookingId: b.id, hoursBefore: hours });
          return n > 0;
        });
        if (!claimed || person.notifications_on === 0) continue;
        const what = b.kind === 'group' ? b.title : `${b.kind === 'video' ? 'Video call' : '1:1'} with ${firstName(b.coach_name)}`;
        const t = londonClock(new Date(b.start));
        const lead = hours === 24 ? (londonDay(new Date(b.start)) === addDays(londonDay(now), 1) ? `Tomorrow ${t}` : `${shortWhen(b.start)}`) : `In 2 hours · ${t}`;
        notify(db, config, person.id, { title: 'Session reminder', body: `${lead} · ${what}`, kind: 'booking', id: b.id });
        sent++;
      }
    }
  }
  return sent;
}

// MARK: - Hooks: inbox, diary, badges, export

function inboxItems(db, coach) {
  const rows = db.prepare(`SELECT w.*, u.name FROM waitlist w JOIN users u ON u.id=w.client_id AND u.coach_id=?
    WHERE w.status='waiting' AND w.match_start>?`).all(coach.id, nowIso());
  const out = [];
  for (const w of rows) {
    const end = new Date(Date.parse(w.match_start) + 60 * MIN).toISOString();
    if (freeCheck(db, coach.id, w.match_start, end, w.match_kind ?? 'inperson')) continue; // taken again since
    out.push({
      key: `waitlist:${w.id}:${w.match_start}`, kind: 'waitlist', clientId: w.client_id,
      title: `${firstName(w.name)} is waiting for a slot`, preview: `Freed ${shortWhen(w.match_start)} matches their waitlist (${dayWords(w.from_day)} to ${dayWords(w.to_day)}, ${w.prefer === 'any' ? 'any time' : w.prefer}).`,
      at: w.updated_at, icon: 'event_available', tone: 'attention', path: '/schedule/waitlist',
      actions: [{ id: 'offer', label: 'Offer this slot', method: 'POST', url: `/api/waitlist/${w.id}/offer`, body: { start: w.match_start } }],
    });
  }
  return out;
}

function diaryItems(db, coach, dy) {
  const lo = londonToUtc(dy).toISOString(), hi = londonToUtc(addDays(dy, 1)).toISOString();
  const out = [];
  for (const h of db.prepare('SELECT * FROM calendar_holds WHERE coach_id=? AND end>? AND start<? ORDER BY start').all(coach.id, lo, hi)) {
    out.push({ at: h.start, end: h.end, day: dy, kind: 'hold', icon: 'front_hand', title: h.title, detail: `${HOLD_TITLE[h.kind]} hold · ${londonClock(new Date(h.start))}–${londonClock(new Date(h.end))}`, path: `/schedule?day=${dy}`, tone: 'data' });
  }
  for (const k of db.prepare(`SELECT k.*, s.label FROM busy_blocks k JOIN calendar_sources s ON s.id=k.source_id WHERE k.coach_id=? AND s.active=1 AND k.end>? AND k.start<? ORDER BY k.start`).all(coach.id, lo, hi)) {
    out.push({ at: k.all_day ? null : k.start, end: k.end, day: dy, kind: 'busy', icon: 'event_busy', title: k.title || 'Busy', detail: k.all_day ? `All day · ${k.label}` : `${londonClock(new Date(k.start))}–${londonClock(new Date(k.end))} · ${k.label}`, path: null, tone: 'data' });
  }
  for (const t of db.prepare('SELECT * FROM time_off WHERE coach_id=? AND end>? AND start<?').all(coach.id, lo, hi)) {
    out.push({ at: null, day: dy, kind: 'timeOff', icon: 'event_busy', title: t.reason || 'Time off', detail: t.all_day ? 'Time off · all day' : `Time off · ${londonClock(new Date(t.start))}–${londonClock(new Date(t.end))}`, path: '/account/calendars', tone: 'attention' });
  }
  return out;
}

function badgeCounts(db, coach) {
  const now = new Date();
  const ignored = ignoredKeys(db, coach.id);
  const n = computeConflicts(db, coach.id, now.toISOString(), new Date(now.getTime() + 14 * DAY_MS).toISOString()).filter(c => !ignored.has(c.key)).length;
  return n ? { schedule: n } : {};
}

function exportFor(db, user) {
  if (user.role === 'coach') {
    return {
      calendars: db.prepare('SELECT label, url_hint, color, show_titles, active, last_synced_at, event_count, created_at FROM calendar_sources WHERE coach_id=?').all(user.id),
      timeOff: db.prepare('SELECT start, end, reason, all_day, created_at FROM time_off WHERE coach_id=? ORDER BY start').all(user.id),
      holds: db.prepare('SELECT kind, title, start, end, created_at FROM calendar_holds WHERE coach_id=? ORDER BY start').all(user.id),
      calendarRules: calendarPrefs(db, user.id),
    };
  }
  return {
    waitlist: db.prepare('SELECT kind, from_day, to_day, prefer, note, status, offered_start, created_at FROM waitlist WHERE client_id=? ORDER BY created_at').all(user.id),
    sessionReminders: db.prepare('SELECT r.hours, r.sent_at, b.start FROM booking_reminders r JOIN bookings b ON b.id=r.booking_id WHERE r.client_id=? ORDER BY r.sent_at').all(user.id),
  };
}

// MARK: - Demo

/**
 * One fake calendar (never fetched) with a dentist, the school run and a
 * Friday family dinner; a week off three weeks out; buffers of 10 minutes;
 * three holds; two waitlist entries (one matched to a late cancel); reminder
 * rows for past sessions. One deliberate clash: the dentist sits on Sam's next
 * in-person session.
 */
const DEMO_COACH_TABLES = ['busy_blocks', 'calendar_sources', 'time_off', 'calendar_prefs', 'calendar_holds', 'conflict_ignores', 'calendar_conflicts_seen', 'waitlist'];

function buildDemo(db, { coach, clients, byName, today, config }) {
  // Some tests build the demo before createApp has run feature schemas: then there is nothing to build.
  if (!DEMO_COACH_TABLES.every(t => hasTable(db, t)) || !hasTable(db, 'booking_reminders')) return;
  // The wipe is ours (not demo.tables): demo.mjs's wipe would fail on a database without these tables yet.
  for (const t of DEMO_COACH_TABLES) db.prepare(`DELETE FROM ${t} WHERE coach_id=?`).run(coach.id);
  db.prepare('DELETE FROM booking_reminders WHERE client_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(clients.map(c => c.id)));
  const at = (d, t) => londonToUtc(d, t).toISOString();
  const now = new Date();
  const monday = addDays(today, 1 - weekday(today));
  db.prepare(`INSERT INTO calendar_prefs (coach_id, buffer_before, buffer_after, min_notice_hours, max_per_day, travel_gap, cancel_notice_hours, cancel_forfeit_credit, cancel_fee_pence, noshow_fee_pence, updated_at)
    VALUES (?,0,10,12,6,15,24,1,0,2500,?)`).run(coach.id, nowIso());

  // The week off: three weeks out. Sessions in it were moved (the demo simply has none there).
  const offFrom = addDays(monday, 21), offTo = addDays(monday, 25);
  db.prepare('INSERT INTO time_off (id, coach_id, start, end, reason, all_day, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(newId('to'), coach.id, at(offFrom, '00:00'), at(addDays(offTo, 1), '00:00'), 'Lisbon with the family', nowIso());
  db.prepare('DELETE FROM bookings WHERE coach_id=? AND start>=? AND start<?').run(coach.id, at(offFrom, '00:00'), at(addDays(offTo, 1), '00:00'));

  // The connected calendar: rows only, never fetched (demo coaches cannot sync).
  const src = newId('cs');
  let enc = 'demo';
  try { if (config?.dataDir) enc = encryptUrl(config, 'https://example.invalid/demo.ics'); } catch { enc = 'demo'; }
  const blocks = [];
  const sam = byName.Sam;
  const next = sam ? db.prepare("SELECT start FROM bookings WHERE client_id=? AND kind='inperson' AND cancelled_at IS NULL AND start>? ORDER BY start LIMIT 1").get(sam.id, now.toISOString()) : null;
  if (next) {
    const s = Date.parse(next.start);
    blocks.push({ start: new Date(s - 30 * MIN).toISOString(), end: new Date(s + 30 * MIN).toISOString(), title: 'Dentist' });
  }
  for (let i = -7; i <= 120; i++) {
    const d = addDays(today, i), w = weekday(d);
    if (d >= offFrom && d <= offTo) continue;
    if (w <= 5) blocks.push({ start: at(d, '15:00'), end: at(d, '15:40'), title: 'School run' });
    if (w === 5) blocks.push({ start: at(d, '19:00'), end: at(d, '21:30'), title: 'Family dinner' });
  }
  blocks.push({ start: at(addDays(today, 9), '12:30'), end: at(addDays(today, 9), '13:30'), title: 'Accountant' });
  db.prepare(`INSERT INTO calendar_sources (id, coach_id, label, url_enc, url_hint, color, show_titles, active, last_synced_at, last_error, sync_failed, event_count, next_sync_at, created_at)
    VALUES (?,?,?,?,?,?,1,1,?,NULL,0,?,NULL,?)`).run(src, coach.id, 'Personal', enc, 'calendar.google.com/…/basic.ics', 'chart-4',
    new Date(now.getTime() - 6 * MIN).toISOString(), blocks.length, at(addDays(today, -40), '10:00'));
  const ins = db.prepare('INSERT INTO busy_blocks (id, source_id, coach_id, start, end, all_day, title, ext_key) VALUES (?,?,?,?,?,0,?,?)');
  blocks.forEach((b, i) => ins.run(newId('bb'), src, coach.id, b.start, b.end, b.title, extKey(src, { uid: `demo-${i}`, start: b.start })));

  // Holds: a consult with a prospect, a trial, and programming time.
  const free = (d, t, mins) => !db.prepare('SELECT 1 FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND end>? AND start<?').get(coach.id, at(d, t), new Date(Date.parse(at(d, t)) + mins * MIN).toISOString());
  const hold = (kind, title, d, t, mins) => {
    if (!free(d, t, mins)) return;
    db.prepare('INSERT INTO calendar_holds (id, coach_id, kind, title, start, end, lead_id, created_at) VALUES (?,?,?,?,?,?,NULL,?)')
      .run(newId('hd'), coach.id, kind, title, at(d, t), new Date(Date.parse(at(d, t)) + mins * MIN).toISOString(), nowIso());
  };
  const weekdayAfter = (n, wd) => { for (let i = n; i < n + 8; i++) if (weekday(addDays(today, i)) === wd) return addDays(today, i); return addDays(today, n); };
  hold('admin', 'Write the spring block', today, '13:00', 60);
  hold('consult', 'Consult: Hannah Lewis', addDays(today, 1), '12:30', 30);
  hold('trial', 'Trial: Marcus Bell', weekdayAfter(2, 4), '17:00', 60);
  hold('admin', 'Programming time', weekdayAfter(0, 5), '13:00', 120);
  hold('admin', 'Programming time', weekdayAfter(7, 5), '13:00', 120);

  // A late cancel tomorrow evening frees a slot that matches Tom's waitlist entry.
  const alex = byName.Alex, tom = byName.Tom, leo = byName.Leo;
  const tomorrow = addDays(today, 1);
  let freed = null;
  if (alex && weekday(tomorrow) <= 5) {
    freed = at(tomorrow, '18:00');
    db.prepare("INSERT INTO bookings (id, coach_id, client_id, kind, start, end, location, title, uses_credit, cancelled_at, created_at) VALUES (?,?,?,'inperson',?,?,'Studio 2',?,1,?,?)")
      .run(newId('b'), coach.id, alex.id, freed, at(tomorrow, '19:00'), `1:1 with ${coach.name}`, new Date(now.getTime() - 3 * HOUR).toISOString(), at(addDays(today, -6), '09:00'));
  }
  const wait = (client, kind, fromDay, toDay, prefer, note, match) => client && db.prepare(`INSERT INTO waitlist (id, coach_id, client_id, kind, from_day, to_day, prefer, note, status, match_start, match_kind, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,'waiting',?,?,?,?)`).run(newId('wl'), coach.id, client.id, kind, fromDay, toDay, prefer, note, match, match ? 'inperson' : null,
    at(addDays(today, -3), '19:40'), match ? new Date(now.getTime() - 3 * HOUR).toISOString() : at(addDays(today, -3), '19:40'));
  wait(tom, 'inperson', today, addDays(today, 13), 'evening', 'After work, any weekday. Wants a second session a week.', freed);
  wait(leo, 'video', today, addDays(today, 20), 'morning', 'Back check-in before work if anything opens up.', null);

  // Reminders that went out for last week's sessions.
  const past = db.prepare('SELECT id, client_id FROM bookings WHERE coach_id=? AND client_id IS NOT NULL AND cancelled_at IS NULL AND start<? AND start>?')
    .all(coach.id, now.toISOString(), new Date(now.getTime() - 7 * DAY_MS).toISOString());
  for (const b of past) for (const hrs of [24, 2]) db.prepare('INSERT OR IGNORE INTO booking_reminders (booking_id, client_id, hours, sent_at) VALUES (?,?,?,?)').run(b.id, b.client_id, hrs, nowIso());
}

// MARK: - The feature

export const feature = {
  name: 'calsync',
  namespaces: ['calendar', 'waitlist', 'hold'],
  exact: ['booking.rescheduled', 'booking.upcoming', 'booking.series'],

  schema(db, { addColumn }) {
    db.exec(`CREATE TABLE IF NOT EXISTS calendar_sources (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label TEXT NOT NULL, url_enc TEXT NOT NULL, url_hint TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'chart-4' CHECK (color IN ('chart-1','chart-2','chart-3','chart-4','chart-5','chart-6')),
        show_titles INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
        last_synced_at TEXT, last_error TEXT, sync_failed INTEGER NOT NULL DEFAULT 0, next_sync_at TEXT,
        event_count INTEGER NOT NULL DEFAULT 0, etag TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS busy_blocks (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, title TEXT, ext_key TEXT);
      CREATE INDEX IF NOT EXISTS busy_blocks_coach ON busy_blocks(coach_id, start);
      CREATE INDEX IF NOT EXISTS busy_blocks_source ON busy_blocks(source_id);
      CREATE TABLE IF NOT EXISTS time_off (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start TEXT NOT NULL, end TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', all_day INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS time_off_coach ON time_off(coach_id, start);
      CREATE TABLE IF NOT EXISTS calendar_prefs (
        coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        buffer_before INTEGER NOT NULL DEFAULT 0, buffer_after INTEGER NOT NULL DEFAULT 10,
        min_notice_hours INTEGER NOT NULL DEFAULT 12, max_per_day INTEGER, travel_gap INTEGER NOT NULL DEFAULT 15,
        cancel_notice_hours INTEGER NOT NULL DEFAULT 24,
        cancel_forfeit_credit INTEGER NOT NULL DEFAULT 1, cancel_fee_pence INTEGER NOT NULL DEFAULT 0, noshow_fee_pence INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calendar_holds (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('consult','trial','admin')), title TEXT NOT NULL,
        start TEXT NOT NULL, end TEXT NOT NULL, lead_id TEXT,
        booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS calendar_holds_coach ON calendar_holds(coach_id, start);
      CREATE TABLE IF NOT EXISTS conflict_ignores (
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (coach_id, key));
      CREATE TABLE IF NOT EXISTS calendar_conflicts_seen (
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (coach_id, key));
      CREATE TABLE IF NOT EXISTS waitlist (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL,
        prefer TEXT NOT NULL DEFAULT 'any', note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','closed')),
        offered_start TEXT, match_start TEXT, match_kind TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS waitlist_coach ON waitlist(coach_id, status);
      CREATE TABLE IF NOT EXISTS booking_reminders (
        booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hours INTEGER NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (booking_id, client_id, hours));`);
    addColumn('bookings', 'series_id', 'TEXT');
    addColumn('busy_blocks', 'ext_key', 'TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS bookings_series ON bookings(series_id) WHERE series_id IS NOT NULL');
  },

  routes(r) {
    r.add('GET', '/api/calendar/sources', listSources);
    r.add('POST', '/api/calendar/sources', addSource);
    r.add('PATCH', '/api/calendar/sources/:id', patchSource);
    r.add('DELETE', '/api/calendar/sources/:id', deleteSource);
    r.add('POST', '/api/calendar/sources/:id/sync', syncNow);
    r.add('GET', '/api/calendar/busy', getBusy);
    r.add('GET', '/api/calendar/prefs', getPrefs);
    r.add('PUT', '/api/calendar/prefs', putPrefs);
    r.add('GET', '/api/calendar/time-off', listTimeOff);
    r.add('POST', '/api/calendar/time-off', addTimeOff);
    r.add('POST', '/api/calendar/time-off/bank-holidays', addBankHolidays);
    r.add('DELETE', '/api/calendar/time-off/:id', deleteTimeOff);
    r.add('GET', '/api/calendar/conflicts', getConflicts);
    r.add('POST', '/api/calendar/conflicts/ignore', ignoreConflict);
    r.add('GET', '/api/calendar/holds', listHolds);
    r.add('POST', '/api/calendar/holds', addHold);
    r.add('PATCH', '/api/calendar/holds/:id', patchHold);
    r.add('DELETE', '/api/calendar/holds/:id', deleteHold);
    r.add('POST', '/api/calendar/holds/:id/convert', convertHold);
    r.add('GET', '/api/calendar/find', find);
    r.add('GET', '/api/waitlist', listWaitlist);
    r.add('POST', '/api/waitlist', joinWaitlist);
    r.add('POST', '/api/waitlist/:id/offer', offerSlot);
    r.add('DELETE', '/api/waitlist/:id', leaveWaitlist);
  },

  clocks: [
    { id: 'calendar.sync', everyMs: 60_000, run: (db, config, now) => syncDue(db, config, now) },
    { id: 'calendar.reminders', everyMs: 5 * 60_000, run: (db, config, now) => sendReminders(db, config, now) },
  ],

  on: {
    'booking.cancelled': onCancelled,
    'lead.deleted': onLeadDeleted,
  },

  emits: {
    'calendar.conflict': { label: 'A calendar clash was found', payload: ['key', 'kind', 'severity'] },
    'hold.created': { label: 'Time was held (consult, trial or admin)', payload: ['holdId', 'kind', 'start', 'leadId'] },
    'waitlist.matched': { label: 'A freed slot matches a waitlist entry', payload: ['waitlistId', 'start', 'kind'] },
    'booking.series': { label: 'Standing sessions were booked', payload: ['seriesId', 'count'] },
    'booking.rescheduled': { label: 'A session was moved', payload: ['bookingId', 'from', 'to', 'byRole'] },
    'booking.upcoming': { label: 'A session is coming up (24 h or 2 h)', payload: ['bookingId', 'hoursBefore'] },
  },

  inbox: inboxItems,
  diary: diaryItems,
  badges: badgeCounts,
  exportFor,

  demo: { build: buildDemo },
};

