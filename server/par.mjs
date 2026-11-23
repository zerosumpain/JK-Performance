import { clientFor, requireCoach } from './access.mjs';
import { dayStates, habitDay, habitsOf } from './daily.mjs';
import { activeGoalRow } from './goals.mjs';
import { healthDay } from './health.mjs';
import { day, fail, num, oneOf, str } from './http.mjs';
import { notify } from './push.mjs';
import { deliverDue, feedbackWeek } from './reports.mjs';
import { featuresOf } from './settings.mjs';
import { firstSentence, newId, nowIso, tx } from './store.mjs';
import { addDays, daysBetween, londonClock, londonDay, londonToUtc, mondayOf, weekday } from './time.mjs';
import { coachLineOf } from './today.mjs';

/**
 * Plan. Act. Review. (docs/design/plan-act-review.md): the client app's three
 * tabs, each one payload with every word worked out here so iOS and Android
 * say the same thing.
 *
 *   GET  /api/week                 Act: the week line, today's work, the next planning and review sessions
 *   GET  /api/direction            Plan: the season's aim, priorities, the next planning session and its prep
 *   PUT  /api/direction/prep       the client's honest thoughts before planning (autosaved; `share` hands them over)
 *   GET  /api/review               Review: how the week felt, the commitments kept, JK's notes and what was agreed
 *   POST /api/review/reflection    autosaves the look back; `share` files it as the week's check-in
 *   POST /api/review/accept        "I'm in": accepts the week's agreed commitments
 *
 * Coach side: GET /api/coach/clients/:id/par and PUT .../aim, .../priorities,
 * .../commitments. A client whose plan lacks the feature gets 200
 * `{ locked: true, feature }`, never a 403.
 */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const DAY_MS = 86_400_000;

export const FEELING_WORDS = ['Flat', 'Stretched', 'Steady', 'Good', 'Strong'];
export const feelingWord = f => (f >= 1 && f <= 5 ? FEELING_WORDS[f - 1] : null);
/** The dial before a planning session: 0-100 in five bands. */
export const prepWord = v => (v === null || v === undefined ? null : v < 20 ? 'Hard going' : v < 40 ? 'Up and down' : v < 60 ? 'Okay' : v < 80 ? 'Mostly good' : 'Flowing');
export const PRIORITY_STATUSES = ['notyet', 'settling', 'building', 'strong'];
const STATUS = { notyet: ['Not yet', 0], settling: ['Settling in', 0.33], building: ['Building', 0.66], strong: ['Strong', 1] };
const OUTCOMES = ['kept', 'mostly', 'missed'];
const MAX_THREE = 3;

const dayNameOf = date => DAY_NAMES[weekday(date) - 1];
const dayMonth = date => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const shortDayMonth = date => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)}`;
const round2 = v => Math.round(v * 100) / 100;
const clamp01 = v => Math.max(0, Math.min(1, v));
const dayOf = iso => londonDay(new Date(iso));

/** "7:30am", "6pm", "12pm" in London time. */
export function clock12(iso) {
  const [h, m] = londonClock(new Date(iso)).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`;
}

/** "Today", "Thursday" (within the week ahead or just past), else "Thursday 3 December". */
function dayWord(date, today) {
  const n = daysBetween(today, date);
  if (n === 0) return 'Today';
  if (n > -7 && n < 7) return dayNameOf(date);
  return `${dayNameOf(date)} ${dayMonth(date)}`;
}
const whenOf = (iso, today) => `${dayWord(dayOf(iso), today)}, ${clock12(iso)}`;

/** "Lower Body Strength" → "Lower body strength" (words in capitals, like "PPL", stay). */
const sentenceCase = text => (text ?? '').trim().split(/\s+/).map((w, i) => (i > 0 && /^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(' ');

// MARK: - Sessions with a purpose

const nextWithPurpose = (db, clientId, purpose, now, days = 14) => db.prepare(`SELECT * FROM bookings WHERE client_id=? AND purpose=? AND cancelled_at IS NULL
  AND end>? AND start<? ORDER BY start LIMIT 1`).get(clientId, purpose, now.toISOString(), new Date(now.getTime() + days * DAY_MS).toISOString()) ?? null;
const lastWithPurpose = (db, clientId, purpose, now) => db.prepare(`SELECT * FROM bookings WHERE client_id=? AND purpose=? AND cancelled_at IS NULL
  AND start<=? ORDER BY start DESC LIMIT 1`).get(clientId, purpose, now.toISOString()) ?? null;

/** The titles the server gives a 1:1 itself; anything else the coach wrote. */
const AUTO_TITLE = /^(1:1|Video call) with /;
function sessionTitle(b) {
  if (b.title && !AUTO_TITLE.test(b.title)) return b.title;
  if (b.purpose === 'review') return 'Accountability with JK';
  // A planning session plans the month ahead: one late in November plans December.
  const ahead = addDays(dayOf(b.start), 14);
  return `Plan ${MONTHS[Number(ahead.slice(5, 7)) - 1]} with JK`;
}

function weekSession(b, today, monday) {
  if (!b) return null;
  const d = dayOf(b.start);
  return { bookingId: b.id, title: sessionTitle(b), when: whenOf(b.start, today), start: b.start, dayIndex: d >= monday && d <= addDays(monday, 6) ? weekday(d) - 1 : null };
}

const onWord = (b, today) => {
  const d = dayOf(b.start);
  const n = daysBetween(today, d);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 7 ? `on ${dayNameOf(d)}` : `on ${dayMonth(d)}`;
};

// MARK: - Act: GET /api/week

/** A block's short label under the session strip: "Warm", "Squat", "Hinge", "Carry", "Ease". */
const SHORT_NAMES = { 'Warm-up': 'Warm', 'Ease-out': 'Ease', 'Cool-down': 'Cool' };
const SHORT_PATTERNS = new Set(['Squat', 'Hinge', 'Lunge', 'Carry']);
export const blockLabel = (name, pattern) => SHORT_NAMES[name] ?? (SHORT_PATTERNS.has(pattern) ? pattern : name.trim().split(/\s+/).at(-1));

function todayWorkout(db, clientId, today) {
  const w = db.prepare('SELECT * FROM workouts WHERE client_id=? AND published=1 AND date=? ORDER BY completed_at IS NOT NULL, starts_at LIMIT 1').get(clientId, today);
  if (!w) return null;
  const items = db.prepare(`SELECT i.id, i.sets, e.name, e.pattern, (SELECT COUNT(*) FROM set_logs s WHERE s.item_id=i.id) logged
    FROM workout_items i JOIN exercises e ON e.id=i.exercise_id WHERE i.workout_id=? ORDER BY i.position`).all(w.id);
  const sets = items.reduce((a, i) => a + i.sets, 0);
  const logged = items.reduce((a, i) => a + Math.min(i.logged, i.sets), 0);
  // No stored duration: about three minutes a set plus ten to warm up, to the nearest five.
  const minutes = Math.max(20, Math.min(120, Math.round((10 + 3 * sets) / 5) * 5));
  return {
    out: {
      id: w.id, title: w.title, minutes, completed: !!w.completed_at,
      blocks: items.map(i => ({ itemId: i.id, label: blockLabel(i.name, i.pattern), done: i.logged >= i.sets })),
    },
    share: w.completed_at ? 1 : sets ? logged / sets : 0,
  };
}

const introducedDay = h => londonDay(new Date(h.introduced_at ?? h.created_at));

function weekHabits(db, client, monday, today) {
  const habits = habitsOf(db, client.id);
  const healthCache = new Map();
  const healthOn = date => {
    if (!habits.some(h => h.health_kind)) return null;
    if (!healthCache.has(date)) healthCache.set(date, healthDay(db, client.id, date));
    return healthCache.get(date);
  };
  return habits.map(h => {
    const now = habitDay(db, h, today, healthOn(today));
    const week = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      if (date > today || date < introducedDay(h)) week.push(null);
      else if (date === today) week.push(now.done ? true : null);
      else week.push(habitDay(db, h, date, healthOn(date)).done);
    }
    const past = week.slice(0, weekday(today) - 1).filter(v => v !== null);
    const progress = now.done ? 1
      : h.kind === 'count' && now.value > 0 && h.target > 0 ? Math.min(0.99, now.value / h.target)
        : past.length ? past.filter(Boolean).length / past.length : 0;
    return {
      id: h.id, name: h.name, iconKey: h.icon_key ?? 'custom', kind: h.kind, doneToday: now.done, progress: round2(progress),
      target: h.target, value: now.value ?? 0, unit: h.unit, week,
    };
  });
}

export function weekFor(db, config, client, now = new Date()) {
  const today = londonDay(now);
  const monday = mondayOf(today);
  deliverDue(db, config, { clientId: client.id });
  const f = featuresOf(db, client);
  const hour = Number(londonClock(now).slice(0, 2));
  const plan = nextWithPurpose(db, client.id, 'planning', now);
  const review = nextWithPurpose(db, client.id, 'review', now);

  // The week line: today, then planning and review sessions on their days.
  const marked = db.prepare(`SELECT start, purpose FROM bookings WHERE client_id=? AND purpose IS NOT NULL AND cancelled_at IS NULL AND start>=? AND start<?`)
    .all(client.id, londonToUtc(monday).toISOString(), londonToUtc(addDays(monday, 7)).toISOString());
  const states = f.habits ? dayStates(db, client, monday, addDays(monday, 6), { today }) : [];
  const trained = new Set(f.programme ? db.prepare('SELECT date FROM workouts WHERE client_id=? AND completed_at IS NOT NULL AND date>=? AND date<=?')
    .all(client.id, monday, addDays(monday, 6)).map(r => r.date) : []);
  const days = LETTERS.map((letter, i) => {
    const date = addDays(monday, i);
    const here = marked.filter(b => dayOf(b.start) === date);
    const mark = date === today ? 'today' : here.some(b => b.purpose === 'planning') ? 'plan' : here.some(b => b.purpose === 'review') ? 'review' : null;
    return { date, letter, today: date === today, mark, done: !!states[i]?.done || trained.has(date) };
  });

  const workout = f.programme ? todayWorkout(db, client.id, today) : null;
  const habits = f.habits ? weekHabits(db, client, monday, today) : [];
  const habitShare = habits.length ? habits.filter(h => h.doneToday).length / habits.length : null;
  const parts = [workout ? workout.share : null, habitShare].filter(v => v !== null);
  const n = habits.length;
  const lead = workout ? sentenceCase(workout.out.title) : 'Rest';
  const habitWords = `${NUMBER_WORDS[n] ?? n} habit${n === 1 ? '' : 's'}`;
  const restDay = !workout;
  const line = restDay ? coachLineOf(db, client, f, today) : null;

  return {
    date: today, dateLabel: `${dayNameOf(today)} ${dayMonth(today)}`, dayName: dayNameOf(today),
    greeting: hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening',
    firstName: client.name.split(' ')[0],
    days,
    today: {
      title: n ? `${lead}, and ${habitWords}.` : `${lead}.`,
      progress: round2(parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0),
      workout: workout?.out ?? null,
      habits, restDay, coachLine: line?.text ?? null,
    },
    plan: weekSession(plan, today, monday),
    review: weekSession(review, today, monday),
    footer: plan ? `Planning with JK ${onWord(plan, today)}` : review ? `Reviewing with JK ${onWord(review, today)}` : null,
    unread: f.messaging ? db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND from_role='coach' AND read_at IS NULL").get(client.id).n : 0,
  };
}

// MARK: - Plan: GET /api/direction, PUT /api/direction/prep

const priorityOut = p => ({ id: p.id, title: p.title, status: p.status, statusWord: STATUS[p.status][0], progress: STATUS[p.status][1] });
const prioritiesOf = (db, clientId) => db.prepare('SELECT * FROM priorities WHERE client_id=? ORDER BY position, created_at').all(clientId).map(priorityOut);

const prepOut = p => (p ? { id: p.id, feeling: p.feeling, feelingWord: prepWord(p.feeling), easier: p.easier, inTheWay: p.in_the_way, sharedAt: p.shared_at } : null);

/**
 * The prep for the next planning session: the one tied to that booking, else
 * one started before it was booked (nothing tied, begun after the last
 * planning session). Read-only; `adoptPrep` ties a loose one on write.
 */
function prepRow(db, clientId, planning, now) {
  if (planning) {
    const own = db.prepare('SELECT * FROM preps WHERE client_id=? AND booking_id=? ORDER BY created_at DESC LIMIT 1').get(clientId, planning.id);
    if (own) return own;
  }
  const last = lastWithPurpose(db, clientId, 'planning', now);
  return db.prepare('SELECT * FROM preps WHERE client_id=? AND booking_id IS NULL AND created_at>? ORDER BY created_at DESC LIMIT 1').get(clientId, last?.start ?? '') ?? null;
}

/** The season line from the active goal: planned (or started) to target, with today and the next planning session on it. */
function seasonOf(g, today, planning) {
  const start = g?.planned_on ?? g?.start_date ?? null, end = g?.target_date ?? null;
  if (!start || !end || end <= start) return null;
  const progress = round2(clamp01(daysBetween(start, today) / daysBetween(start, end)));
  const next = planning ? dayOf(planning.start) : null;
  return {
    start, end, today, next,
    labels: { start: shortDayMonth(start), next: next ? shortDayMonth(next) : null, end: MONTHS[Number(end.slice(5, 7)) - 1].slice(0, 3) },
    progress, phaseWord: progress < 0.34 ? 'early days, building' : progress < 0.67 ? 'finding the rhythm' : 'the home stretch',
  };
}

const planningOut = (b, today) => (b ? { bookingId: b.id, when: whenOf(b.start, today), whenShort: dayWord(dayOf(b.start), today), start: b.start } : null);

export function directionFor(db, client, now = new Date()) {
  const f = featuresOf(db, client);
  if (!f.progress) return { locked: true, feature: 'progress' };
  const today = londonDay(now);
  const g = activeGoalRow(db, client.id);
  const planning = nextWithPurpose(db, client.id, 'planning', now, 92);
  const aim = g ? (g.aim || g.title) : null;
  return {
    locked: false,
    aim, plannedOn: g?.planned_on ?? null,
    plannedLabel: g?.planned_on ? `Planned together with JK, ${dayMonth(g.planned_on)}` : null,
    season: seasonOf(g, today, planning),
    priorities: prioritiesOf(db, client.id),
    planning: planningOut(planning, today),
    prep: prepOut(prepRow(db, client.id, planning, now)),
  };
}

const clientsOnly = ctx => { if (ctx.user.role !== 'client') fail(403, 'Clients only'); };
const text = (v, name, max) => (v === null ? '' : str(v, name, { max, min: 0 }));

function savePrep(_req, ctx) {
  clientsOnly(ctx);
  const { db, user } = ctx;
  if (!featuresOf(db, user).progress) return { locked: true, feature: 'progress' };
  const b = ctx.body;
  const feeling = b.feeling === undefined ? undefined : num(b.feeling, 'feeling', { min: 0, max: 100, int: true, optional: true });
  const easier = b.easier === undefined ? undefined : text(b.easier, 'easier', 2000);
  const inTheWay = b.inTheWay === undefined ? undefined : text(b.inTheWay, 'inTheWay', 2000);
  if (b.share !== undefined && typeof b.share !== 'boolean') fail(400, 'share must be true or false');
  const now = new Date();
  const planning = nextWithPurpose(db, user.id, 'planning', now, 92);
  const id = tx(db, () => {
    let p = prepRow(db, user.id, planning, now);
    const at = nowIso();
    if (!p) {
      const pid = newId('pr');
      db.prepare('INSERT INTO preps (id, client_id, booking_id, created_at, updated_at) VALUES (?,?,?,?,?)').run(pid, user.id, planning?.id ?? null, at, at);
      p = db.prepare('SELECT * FROM preps WHERE id=?').get(pid);
    } else if (planning && !p.booking_id) {
      db.prepare('UPDATE preps SET booking_id=? WHERE id=?').run(planning.id, p.id);
    }
    db.prepare('UPDATE preps SET feeling=?, easier=?, in_the_way=?, updated_at=? WHERE id=?').run(
      feeling === undefined ? p.feeling : feeling, easier ?? p.easier, inTheWay ?? p.in_the_way, at, p.id);
    // Sharing again after an edit puts it back in front of JK.
    if (b.share === true) db.prepare('UPDATE preps SET shared_at=?, seen_at=NULL WHERE id=?').run(at, p.id);
    return p.id;
  });
  return prepOut(db.prepare('SELECT * FROM preps WHERE id=?').get(id));
}

// MARK: - Review: GET /api/review, POST /api/review/reflection, POST /api/review/accept

const commitmentsOf = (db, clientId, week) => db.prepare('SELECT * FROM commitments WHERE client_id=? AND week=? ORDER BY position, created_at').all(clientId, week);
const commitmentOut = c => ({ id: c.id, week: c.week, text: c.text, outcome: c.outcome, acceptedAt: c.accepted_at });

/** The week's look back: the unshared draft over the filed check-in. Old check-ins read energy as the feeling and the note as what they noticed. */
function reflectionOf(db, clientId, week) {
  const draft = db.prepare('SELECT * FROM reflection_drafts WHERE client_id=? AND week=?').get(clientId, week);
  const c = db.prepare('SELECT * FROM checkins WHERE client_id=? AND week=?').get(clientId, week);
  if (!draft && !c) return null;
  const feeling = draft?.feeling ?? c?.feeling ?? c?.energy ?? null;
  const noticed = draft?.noticed ?? (c ? c.noticed ?? c.note ?? '' : '');
  return { feeling, feelingWord: feelingWord(feeling), noticed, sharedAt: c?.submitted_at ?? null };
}

/** JK's notes from the latest letter: the headline, then the summary (or keep and adjust when the summary only repeats it). */
function notesOf(r) {
  const headline = (r.headline || firstSentence(r.summary) || '').trim();
  const summary = (r.summary || '').trim();
  const parts = [];
  if (summary && summary !== headline) parts.push(summary.startsWith(headline) ? summary : `${headline} ${summary}`.trim());
  else parts.push(headline, r.keep ?? '', r.adjust ?? '');
  return parts.map(p => p.trim()).filter(Boolean).join(' ');
}

/** Up to the last four weeks with a feeling, oldest first, and which way the latest went against the ones before. */
function shapeOf(db, clientId) {
  const rows = db.prepare('SELECT week, feeling, energy FROM checkins WHERE client_id=? AND submitted_at IS NOT NULL ORDER BY week DESC LIMIT 4').all(clientId).reverse();
  const weeks = rows.map(r => ({ week: r.week, feeling: r.feeling ?? r.energy })).filter(w => w.feeling >= 1 && w.feeling <= 5).map(w => ({ ...w, word: feelingWord(w.feeling) }));
  let trend = null;
  if (weeks.length >= 2) {
    const latest = weeks.at(-1).feeling;
    const before = weeks.slice(0, -1).reduce((a, w) => a + w.feeling, 0) / (weeks.length - 1);
    trend = latest > before + 0.25 ? 'trending steadier' : latest < before - 0.25 ? 'a harder stretch' : 'holding steady';
  }
  return { weeks, trend };
}

function sessionOf(db, clientId, week, now) {
  const at = now.toISOString();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const lastReview = lastWithPurpose(db, clientId, 'review', now);
  // Since the last review session; a long-gone one (or none) means the last seven days.
  const since = lastReview && lastReview.start > new Date(now.getTime() - 14 * DAY_MS).toISOString() ? lastReview.start : weekAgo;
  const letter = db.prepare(`SELECT * FROM reports WHERE client_id=? AND published_at IS NOT NULL AND COALESCE(deliver_at, published_at)<=?
    ORDER BY COALESCE(deliver_at, published_at) DESC LIMIT 1`).get(clientId, at);
  const agreedWeek = addDays(week, 7);
  const agreed = commitmentsOf(db, clientId, agreedWeek);
  const pending = agreed.some(c => !c.accepted_at);
  const letterNew = letter && (letter.deliver_at ?? letter.published_at) >= since;
  if (!letterNew && !pending && !agreed.some(c => c.created_at >= since)) return null;
  const today = londonDay(now);
  return {
    pending,
    with: lastReview ? `With JK · ${dayWord(dayOf(lastReview.start), today)}, ${clock12(lastReview.start)}` : 'With JK',
    notes: letter ? notesOf(letter) : '', letterId: letter?.id ?? null,
    shape: shapeOf(db, clientId),
    agreed: agreed.map(c => ({ id: c.id, text: c.text })), agreedWeek,
    acceptedAt: agreed.length && !pending ? agreed.map(c => c.accepted_at).sort().at(-1) : null,
  };
}

export function reviewFor(db, config, client, now = new Date()) {
  const f = featuresOf(db, client);
  if (!f.checkin) return { locked: true, feature: 'checkin' };
  deliverDue(db, config, { clientId: client.id });
  const today = londonDay(now);
  const week = feedbackWeek(today);
  const upcoming = nextWithPurpose(db, client.id, 'review', now);
  return {
    locked: false, week,
    label: upcoming ? 'REVIEW · BEFORE YOUR SESSION' : 'REVIEW · THIS WEEK',
    booking: upcoming ? { bookingId: upcoming.id, when: whenOf(upcoming.start, today), start: upcoming.start } : null,
    reflection: reflectionOf(db, client.id, week),
    commitments: commitmentsOf(db, client.id, week).map(c => ({ id: c.id, text: c.text, outcome: c.outcome })),
    session: sessionOf(db, client.id, week, now),
  };
}

function saveReflection(_req, ctx) {
  clientsOnly(ctx);
  const { db, user, config } = ctx;
  if (!featuresOf(db, user).checkin) return { locked: true, feature: 'checkin' };
  const b = ctx.body;
  const feeling = b.feeling === undefined ? undefined : num(b.feeling, 'feeling', { min: 1, max: 5, int: true, optional: true });
  const noticed = b.noticed === undefined ? undefined : text(b.noticed, 'noticed', 1000);
  if (b.share !== undefined && typeof b.share !== 'boolean') fail(400, 'share must be true or false');
  if (b.outcomes !== undefined && (typeof b.outcomes !== 'object' || b.outcomes === null || Array.isArray(b.outcomes))) fail(400, 'outcomes must be an object of commitment ids');
  const outcomes = Object.entries(b.outcomes ?? {}).map(([id, v]) => {
    const c = db.prepare('SELECT id FROM commitments WHERE id=? AND client_id=?').get(id, user.id);
    if (!c) fail(404, 'Not found');
    return [id, v === null ? null : oneOf(v, `outcomes.${id}`, OUTCOMES)];
  });
  const week = feedbackWeek(londonDay());
  let first = false;
  tx(db, () => {
    const at = nowIso();
    for (const [id, v] of outcomes) db.prepare('UPDATE commitments SET outcome=?, updated_at=? WHERE id=?').run(v, at, id);
    if (feeling !== undefined || noticed !== undefined) {
      const d = db.prepare('SELECT * FROM reflection_drafts WHERE client_id=? AND week=?').get(user.id, week);
      db.prepare(`INSERT INTO reflection_drafts (client_id, week, feeling, noticed, updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(client_id, week) DO UPDATE SET feeling=excluded.feeling, noticed=excluded.noticed, updated_at=excluded.updated_at`)
        .run(user.id, week, feeling === undefined ? d?.feeling ?? null : feeling, noticed === undefined ? d?.noticed ?? null : noticed, at);
    }
    if (b.share !== true) return;
    // Sharing files the look back as the week's check-in, so every coach view keeps working.
    const r = reflectionOf(db, user.id, week);
    if (!r?.feeling) fail(400, 'Choose how the week felt first');
    const c = db.prepare('SELECT * FROM checkins WHERE client_id=? AND week=?').get(user.id, week);
    first = !c;
    if (c) {
      db.prepare('UPDATE checkins SET feeling=?, noticed=?, energy=?, sleep=?, note=CASE WHEN ?<>\'\' THEN ? ELSE note END, submitted_at=? WHERE id=?')
        .run(r.feeling, r.noticed, r.feeling, r.feeling, r.noticed, r.noticed, at, c.id);
    } else {
      db.prepare(`INSERT INTO checkins (id, client_id, week, energy, sleep, pain, note, submitted_at, feeling, noticed, photo_ids) VALUES (?,?,?,?,?,'[]',?,?,?,?,'[]')`)
        .run(newId('c'), user.id, week, r.feeling, r.feeling, r.noticed, at, r.feeling, r.noticed);
    }
    db.prepare('DELETE FROM reflection_drafts WHERE client_id=? AND week=?').run(user.id, week);
  });
  if (b.share === true) {
    notify(db, config, user.coach_id, { title: user.name, body: first ? 'Sent their weekly check-in.' : 'Updated their weekly check-in.', kind: 'checkin', clientId: user.id });
  }
  return reviewFor(db, config, user);
}

const mondayParam = (v, name) => {
  const d = day(v, name);
  if (mondayOf(d) !== d) fail(400, `${name} must be a Monday`);
  return d;
};

function accept(_req, ctx) {
  clientsOnly(ctx);
  const { db, user, config } = ctx;
  if (!featuresOf(db, user).checkin) return { locked: true, feature: 'checkin' };
  const week = mondayParam(ctx.body.week, 'week');
  const at = nowIso();
  db.prepare('UPDATE commitments SET accepted_at=COALESCE(accepted_at, ?), updated_at=? WHERE client_id=? AND week=?').run(at, at, user.id, week);
  return reviewFor(db, config, user);
}

// MARK: - Coach

function coachPar(_req, ctx) {
  requireCoach(ctx);
  const { db } = ctx;
  const client = clientFor(ctx, ctx.params.id);
  const now = new Date();
  const today = londonDay(now);
  const week = feedbackWeek(today);
  const g = activeGoalRow(db, client.id);
  const planning = nextWithPurpose(db, client.id, 'planning', now, 92);
  const review = nextWithPurpose(db, client.id, 'review', now, 92);
  const prep = db.prepare('SELECT * FROM preps WHERE client_id=? ORDER BY updated_at DESC LIMIT 1').get(client.id) ?? null;
  // Reading it here is JK seeing it: it leaves Needs you.
  db.prepare('UPDATE preps SET seen_at=? WHERE client_id=? AND shared_at IS NOT NULL AND seen_at IS NULL').run(nowIso(), client.id);
  const c = db.prepare('SELECT * FROM checkins WHERE client_id=? AND submitted_at IS NOT NULL ORDER BY week DESC LIMIT 1').get(client.id);
  const feeling = c ? c.feeling ?? c.energy : null;
  return {
    clientId: client.id, goalId: g?.id ?? null,
    aim: g ? g.aim ?? null : null, aimFallback: g?.title ?? null, plannedOn: g?.planned_on ?? null,
    season: seasonOf(g, today, planning),
    priorities: prioritiesOf(db, client.id),
    prep: prep ? { ...prepOut(prep), bookingId: prep.booking_id, updatedAt: prep.updated_at } : null,
    reflection: c ? { week: c.week, feeling, feelingWord: feelingWord(feeling), noticed: c.noticed ?? c.note ?? '', sharedAt: c.submitted_at } : null,
    commitments: {
      currentWeek: week, nextWeek: addDays(week, 7),
      current: commitmentsOf(db, client.id, week).map(commitmentOut),
      next: commitmentsOf(db, client.id, addDays(week, 7)).map(commitmentOut),
    },
    planning: planningOut(planning, today),
    review: planningOut(review, today),
  };
}

function setAim(_req, ctx) {
  requireCoach(ctx);
  const { db } = ctx;
  const client = clientFor(ctx, ctx.params.id);
  const g = activeGoalRow(db, client.id);
  if (!g) fail(404, 'No active goal yet: set the goal first, then its aim');
  const b = ctx.body;
  const aim = b.aim === undefined ? g.aim : str(b.aim || null, 'aim', { max: 140, optional: true });
  const plannedOn = b.plannedOn === undefined ? g.planned_on : day(b.plannedOn, 'plannedOn', { optional: true });
  db.prepare('UPDATE goals SET aim=?, planned_on=?, updated_at=? WHERE id=?').run(aim, plannedOn, nowIso(), g.id);
  return coachPar(_req, ctx);
}

function setPriorities(_req, ctx) {
  requireCoach(ctx);
  const { db } = ctx;
  const client = clientFor(ctx, ctx.params.id);
  const list = ctx.body.priorities;
  if (!Array.isArray(list) || list.length > MAX_THREE) fail(400, 'priorities must be a list of up to 3');
  const clean = list.map((p, i) => ({
    title: str(p?.title, `priorities[${i}].title`, { max: 40 }),
    status: oneOf(p?.status ?? 'notyet', `priorities[${i}].status`, PRIORITY_STATUSES),
  }));
  tx(db, () => {
    const at = nowIso();
    const old = db.prepare('SELECT * FROM priorities WHERE client_id=?').all(client.id);
    db.prepare('DELETE FROM priorities WHERE client_id=?').run(client.id);
    clean.forEach((p, i) => {
      // A priority keeping its title keeps its id, so the apps can animate a status change.
      const same = old.find(o => o.title === p.title);
      db.prepare('INSERT INTO priorities (id, client_id, position, title, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(same?.id ?? newId('pri'), client.id, i, p.title, p.status, same?.created_at ?? at, at);
    });
  });
  return coachPar(_req, ctx);
}

function setCommitments(_req, ctx) {
  requireCoach(ctx);
  const { db } = ctx;
  const client = clientFor(ctx, ctx.params.id);
  const week = mondayParam(ctx.body.week, 'week');
  const items = ctx.body.items;
  if (!Array.isArray(items) || items.length > MAX_THREE) fail(400, 'items must be a list of up to 3');
  const texts = items.map((t, i) => str(t, `items[${i}]`, { max: 120 }));
  tx(db, () => {
    const at = nowIso();
    const old = commitmentsOf(db, client.id, week);
    const kept = new Set();
    texts.forEach((t, i) => {
      // An unchanged commitment keeps its outcome and acceptance.
      const same = old.find(o => o.text === t && !kept.has(o.id));
      if (same) {
        kept.add(same.id);
        db.prepare('UPDATE commitments SET position=?, updated_at=? WHERE id=?').run(i, at, same.id);
      } else {
        db.prepare('INSERT INTO commitments (id, client_id, week, position, text, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(newId('cm'), client.id, week, i, t, ctx.user.id, at, at);
      }
    });
    for (const o of old) if (!kept.has(o.id)) db.prepare('DELETE FROM commitments WHERE id=?').run(o.id);
  });
  return coachPar(_req, ctx);
}

// MARK: - Routes

/** A client acts on themselves; a coach may preview one of their own clients with ?clientId. */
const subject = ctx => (ctx.user.role === 'client' ? ctx.user : clientFor(ctx, ctx.query.clientId));

export function parRoutes(r) {
  r.add('GET', '/api/week', (_req, ctx) => weekFor(ctx.db, ctx.config, subject(ctx)));
  r.add('GET', '/api/direction', (_req, ctx) => directionFor(ctx.db, subject(ctx)));
  r.add('PUT', '/api/direction/prep', savePrep);
  r.add('GET', '/api/review', (_req, ctx) => reviewFor(ctx.db, ctx.config, subject(ctx)));
  r.add('POST', '/api/review/reflection', saveReflection);
  r.add('POST', '/api/review/accept', accept);
  r.add('GET', '/api/coach/clients/:id/par', coachPar);
  r.add('PUT', '/api/coach/clients/:id/aim', setAim);
  r.add('PUT', '/api/coach/clients/:id/priorities', setPriorities);
  r.add('PUT', '/api/coach/clients/:id/commitments', setCommitments);
}
