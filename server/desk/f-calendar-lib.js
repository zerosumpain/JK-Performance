/*
 * Calendar helpers shared by the schedule, the calendar feature screens and
 * the diary (WP7). London wall-clock maths, short formats, and one cached read
 * of the calendar picture (busy blocks, time off, holds, prefs, conflicts) so
 * the grid can check a drag locally before it asks the server.
 */
import { api, DAYS, DAYS_LONG, londonParts, MONTHS, MONTHS_LONG, parseDay, q } from './core.js';

/** A London wall-clock time on a London day, as a UTC ISO instant (handles BST). */
export function londonIso(day, time = '00:00') {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = londonParts(new Date(guess).toISOString());
    const [py, pm, pd] = p.day.split('-').map(Number);
    const [ph, pmin] = p.time.split(':').map(Number);
    guess += want - Date.UTC(py, pm - 1, pd, ph, pmin);
  }
  return new Date(guess).toISOString();
}

export const minutesOf = time => { const [hh, mm] = time.split(':').map(Number); return hh * 60 + mm; };
export const clockOf = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
/** "Tue 24 Nov" */
export const shortDay = s => { const d = parseDay(s); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
/** "Tuesday 24 November" */
export const longDay = s => { const d = parseDay(s); return `${DAYS_LONG[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`; };
/** "Tue 24 Nov · 07:00" */
export const whenOf = iso => { const p = londonParts(iso); return `${shortDay(p.day)} · ${p.time}`; };
export const spanOf = (a, b) => `${londonParts(a).time}–${londonParts(b).time}`;
export const KIND_WORD = { inperson: '1:1', video: 'Video', group: 'Class' };
export const HOLD_WORD = { consult: 'Consult', trial: 'Trial', admin: 'Admin' };
export const ATTENDANCE = [['attended', 'Attended', 'check_circle', 'ok'], ['late', 'Late', 'timer', 'attention'], ['noShow', 'No-show', 'event_busy', 'urgent'], ['lateCancel', 'Late cancel', 'block', 'attention']];
export const attendanceOf = id => ATTENDANCE.find(a => a[0] === id) ?? null;

/** Who a booking is, in one line: "Sam Carter" or the class title. */
export const whoOf = b => (b.kind === 'group' ? b.title || 'Group class' : b.client?.name || b.title || '1:1');

/** Everything on the calendar for [from, to] (London days): bookings, busy blocks, time off, holds, prefs and conflicts. */
export async function loadPicture(from, to) {
  const [bookings, busy, prefs, conflicts] = await Promise.all([
    api('GET', `/api/bookings?${q({ from, to })}`),
    api('GET', `/api/calendar/busy?${q({ from, to })}`).catch(err => (err.status === 404 ? { blocks: [], timeOff: [], holds: [] } : Promise.reject(err))),
    api('GET', '/api/calendar/prefs').catch(err => (err.status === 404 ? { prefs: null } : Promise.reject(err))),
    api('GET', `/api/calendar/conflicts?${q({ from, to })}`).catch(err => (err.status === 404 ? { conflicts: [], ignored: [] } : Promise.reject(err))),
  ]);
  return { bookings: bookings.bookings, blocks: busy.blocks, timeOff: busy.timeOff, holds: busy.holds ?? [], prefs: prefs.prefs, conflicts: conflicts.conflicts };
}

/**
 * The same check the server makes, on what is loaded: why [start, end) of
 * `kind` would clash, or null. Used while dragging; the server re-checks.
 */
export function localClash(pic, startMs, endMs, kind, ignoreId) {
  const p = pic.prefs ?? { bufferBefore: 0, bufferAfter: 0, travelGap: 0 };
  const before = p.bufferBefore * 60_000, after = p.bufferAfter * 60_000;
  const t = iso => Date.parse(iso);
  for (const o of pic.timeOff) if (t(o.start) < endMs && t(o.end) > startMs) return `time off${o.reason ? `: ${o.reason}` : ''}`;
  for (const b of pic.blocks) if (t(b.start) < endMs && t(b.end) > startMs) return `clash with ${b.title || 'Busy'} (${b.label})`;
  for (const b of pic.bookings) {
    if (b.id === ignoreId) continue;
    if (t(b.start) < endMs && t(b.end) > startMs) return `clash with ${whoOf(b)}`;
    if ((t(b.start) - before < endMs && t(b.end) + after > startMs) || (t(b.start) < endMs + after && t(b.end) > startMs - before)) return `too close to ${whoOf(b)} (buffer)`;
  }
  for (const hd of pic.holds) if (t(hd.start) < endMs + after && t(hd.end) > startMs - before) return `clash with the hold “${hd.title}”`;
  if (kind === 'inperson' && p.travelGap) {
    for (const b of pic.bookings) {
      if (b.id === ignoreId || b.kind !== 'video') continue;
      const gap = startMs - t(b.end);
      if (gap >= 0 && gap < p.travelGap * 60_000 && londonParts(b.end).day === londonParts(new Date(startMs).toISOString()).day) return `no travel gap after ${whoOf(b)}`;
    }
  }
  return null;
}

/** Conflicts touching one item (booking, hold) by id. */
export const conflictsOf = (pic, id) => pic.conflicts.filter(c => c.a.id === id || c.b.id === id);
