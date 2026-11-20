/**
 * Dates and the coach's clock. The business runs on Europe/London: availability
 * rules and "today" are London wall-clock; the database stores UTC instants.
 * No library — Intl gives the offset for any instant.
 */
export const ZONE = 'Europe/London';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** London wall-clock fields for a Date. */
function fields(date) {
  const out = {};
  for (const p of parts.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** The London calendar day ("YYYY-MM-DD") an instant falls on. */
export function londonDay(date = new Date()) {
  const f = fields(date);
  return `${f.year}-${f.month}-${f.day}`;
}

/** London "HH:MM" for an instant. */
export function londonClock(date) {
  const f = fields(date);
  return `${f.hour}:${f.minute}`;
}

/** The UTC instant of a London wall-clock day + "HH:MM". Correct across BST changes. */
export function londonToUtc(dayString, clockString = '00:00') {
  const [y, m, d] = dayString.split('-').map(Number);
  const [hh, mm] = clockString.split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const f = fields(new Date(guess));
    const shown = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

export function addDays(dayString, n) {
  const d = new Date(dayString + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday, for a calendar day. */
export function weekday(dayString) {
  const w = new Date(dayString + 'T12:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
}

/** The Monday of the ISO week a day is in. */
export const mondayOf = dayString => addDays(dayString, 1 - weekday(dayString));

export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);

/** First day of the month a day is in, and of the next. */
export function monthBounds(dayString) {
  const [y, m] = dayString.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { first, next };
}
