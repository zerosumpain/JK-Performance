import { initials, requireCoach } from './access.mjs';
import { bookingOut } from './bookings.mjs';
import { flaggedAnswers } from './forms.mjs';
import { milestoneSuggestions } from './milestones.mjs';
import { planOf } from './plans.mjs';
import { feedbackWeek } from './reports.mjs';
import { hasFeature, rhythmOf } from './settings.mjs';
import { addDays, daysBetween, londonDay, londonToUtc, weekday } from './time.mjs';

/**
 * GET /api/coach/needs-you: the coach's Today. One ranked list, each client
 * once, with every reason that applies (combined glyphs) and one action.
 * Severity (rank 1 is most urgent):
 *   1 pain flagged (a message mentioning pain, a check-in with pain, a health "yes" on a form)
 *   2 unread message from a client on a plan with 'priority'
 *   3 other unread message
 *   4 check-in in, letter due
 *   5 form answers to read; thoughts shared before a planning session
 *   6 gone quiet 4+ days (no message, set, workout or check-in from the client)
 *   7 no training 7+ days
 *   8 milestone reached, letter suggested
 * Within a rank, whoever has waited longest comes first. "Letters due" heads
 * the list: clients on plans with 'checkin' whose letter for the week is not
 * written yet, at each client's rhythm.
 */

const URGENT_WORDS = /\b(pain|painful|injur\w*|hurt\w*|sharp|swollen|swelling|numb\w*|dizz\w*|faint\w*|sick|unwell)\b/i;
const QUIET_DAYS = 4;
const NO_TRAINING_DAYS = 7;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const REASON_RANK = { pain: 1, priorityUnread: 2, unread: 3, checkinLetterDue: 4, formAnswers: 5, prepShared: 5, quiet: 6, noTraining: 7, milestone: 8 };
const ICON = { pain: 'pain', priorityUnread: 'priority', unread: 'unread', checkinLetterDue: 'checkIn', formAnswers: 'form', prepShared: 'form', quiet: 'quiet', noTraining: 'noTraining', milestone: 'milestone' };
const ACTIONS = { reply: 'Reply', writeLetter: 'Write letter', nudge: 'Nudge', readAnswers: 'Read answers', readThoughts: 'Read thoughts' };

/** Is this client's letter for the week still to write, at their rhythm? Returns the rhythm when due, else null. */
export function letterDue(db, client, week = feedbackWeek()) {
  const rhythm = rhythmOf(db, client);
  if (!rhythm.days) return null;
  if (db.prepare("SELECT 1 FROM reports WHERE client_id=? AND kind='weekly' AND week=? AND published_at IS NOT NULL").get(client.id, week)) return null;
  if (rhythm.every === 'fortnightly') {
    const last = db.prepare("SELECT MAX(week) w FROM reports WHERE client_id=? AND kind='weekly' AND published_at IS NOT NULL").get(client.id).w;
    if (last && last > addDays(week, -14)) return null;
  }
  return rhythm;
}

function reasonsFor(db, c, today) {
  const reasons = [];
  const add = (kind, text, at, extra = {}) => reasons.push({ kind, text, at: at ?? null, rank: REASON_RANK[kind], iconKey: ICON[kind], ...extra });
  const plan = planOf(db, c);
  const priority = plan.features.includes('priority');

  const unread = db.prepare("SELECT text, at FROM messages WHERE client_id=? AND from_role='client' AND read_at IS NULL ORDER BY at").all(c.id);
  const painMsg = unread.find(m => URGENT_WORDS.test(m.text));
  if (painMsg) add('pain', `Mentions ${painMsg.text.match(URGENT_WORDS)[0].toLowerCase()} in a message`, painMsg.at, { source: 'message' });
  const checkin = db.prepare('SELECT * FROM checkins WHERE client_id=? AND reviewed_at IS NULL ORDER BY week DESC LIMIT 1').get(c.id);
  const pain = checkin ? JSON.parse(checkin.pain) : [];
  const checkedIn = checkin ? `Checked in ${DAY_NAMES[weekday(londonDay(new Date(checkin.submitted_at))) - 1]}` : null;
  if (checkin && pain.length) add('pain', `${checkedIn} · ${pain.join(', ').toLowerCase()} sore`, checkin.submitted_at, { source: 'checkin' });
  const forms = db.prepare('SELECT * FROM form_requests WHERE client_id=? AND submitted_at IS NOT NULL AND reviewed_at IS NULL ORDER BY submitted_at').all(c.id);
  const flagged = forms.find(f => flaggedAnswers(f).length);
  if (flagged) add('pain', `Answered yes on ${flagged.name}`, flagged.submitted_at, { source: 'form', formRequestId: flagged.id });

  if (unread.length) {
    const text = priority ? `${plan.name} · same-day reply` : unread.length === 1 ? 'Sent you a message' : `Sent you ${unread.length} messages`;
    add(priority ? 'priorityUnread' : 'unread', text, unread[0].at, { count: unread.length });
  }
  const answered = checkin && db.prepare("SELECT 1 FROM reports WHERE client_id=? AND kind='weekly' AND week=? AND published_at IS NOT NULL").get(c.id, checkin.week);
  if (checkin && !pain.length && hasFeature(db, c, 'checkin') && !answered) {
    add('checkinLetterDue', `${checkedIn} · letter due`, checkin.submitted_at, { week: checkin.week });
  }
  const unflagged = forms.filter(f => f !== flagged);
  // Thoughts shared before a planning session, since the last one, that JK hasn't opened yet (a shared reflection is a check-in, above).
  const prep = db.prepare('SELECT * FROM preps WHERE client_id=? AND shared_at IS NOT NULL AND seen_at IS NULL ORDER BY shared_at DESC LIMIT 1').get(c.id);
  const lastPlanning = db.prepare("SELECT MAX(start) s FROM bookings WHERE client_id=? AND purpose='planning' AND cancelled_at IS NULL AND start<=?").get(c.id, new Date().toISOString()).s;
  if (prep && (!lastPlanning || prep.shared_at > lastPlanning)) add('prepShared', 'Shared thoughts for planning', prep.shared_at);
  if (unflagged.length) add('formAnswers', unflagged.length === 1 ? `Filled in ${unflagged[0].name}` : `Filled in ${unflagged.length} forms`, unflagged[0].submitted_at, { formRequestId: unflagged[0].id });

  const lastActive = db.prepare(`SELECT MAX(at) at FROM (
      SELECT MAX(at) at FROM messages WHERE client_id=? AND from_role='client'
      UNION ALL SELECT MAX(completed_at) FROM workouts WHERE client_id=?
      UNION ALL SELECT MAX(s.at) FROM set_logs s JOIN workout_items i ON i.id=s.item_id JOIN workouts w ON w.id=i.workout_id WHERE w.client_id=?
      UNION ALL SELECT MAX(submitted_at) FROM checkins WHERE client_id=?)`).get(c.id, c.id, c.id, c.id).at;
  const quietDays = daysBetween(londonDay(new Date(lastActive ?? c.created_at)), today);
  if (quietDays >= QUIET_DAYS && c.plan !== 'none') add('quiet', `Quiet for ${quietDays} days`, lastActive, { days: quietDays });

  const planned = db.prepare('SELECT 1 FROM workouts WHERE client_id=? AND published=1 AND date<=? LIMIT 1').get(c.id, today);
  const lastDone = db.prepare('SELECT MAX(completed_at) at FROM workouts WHERE client_id=?').get(c.id).at;
  const idle = lastDone ? daysBetween(londonDay(new Date(lastDone)), today) : null;
  if (planned && (idle === null || idle >= NO_TRAINING_DAYS)) add('noTraining', idle === null ? 'No training logged yet' : `No training in ${idle} days`, lastDone, { days: idle });

  for (const m of milestoneSuggestions(db, c, today)) add('milestone', m.reason, null, { milestoneKey: m.key, suggestedHeadline: m.suggestedHeadline });
  return { reasons: reasons.sort((a, b) => a.rank - b.rank), priority };
}

function actionFor(top, c, db) {
  if (top.kind === 'pain') return top.source === 'checkin' && hasFeature(db, c, 'checkin') ? 'writeLetter' : top.source === 'form' ? 'readAnswers' : 'reply';
  if (top.kind === 'priorityUnread' || top.kind === 'unread') return 'reply';
  if (top.kind === 'checkinLetterDue' || top.kind === 'milestone') return 'writeLetter';
  if (top.kind === 'formAnswers') return 'readAnswers';
  if (top.kind === 'prepShared') return 'readThoughts';
  return 'nudge';
}

export function needsYou(db, coach, now = new Date()) {
  const today = londonDay(now);
  const week = feedbackWeek(today);
  const clients = db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? ORDER BY name").all(coach.id);
  const items = [];
  const due = [];
  for (const c of clients) {
    const plan = planOf(db, c);
    const rhythm = letterDue(db, c, week);
    if (rhythm) due.push({ id: c.id, name: c.name, initials: initials(c.name), media: rhythm.media, every: rhythm.every });
    const { reasons, priority } = reasonsFor(db, c, today);
    if (!reasons.length) continue;
    const top = reasons[0];
    const action = actionFor(top, c, db);
    items.push({
      client: { id: c.id, name: c.name, firstName: c.name.split(' ')[0], initials: initials(c.name), plan: plan.id, planName: plan.name },
      rank: top.rank, priority, reasons,
      reasonLine: reasons.slice(0, 2).map(r => r.text).join(' · '),
      primaryAction: { kind: action, label: ACTIONS[action] },
    });
  }
  items.sort((a, b) => a.rank - b.rank || (a.reasons[0].at ?? '9').localeCompare(b.reasons[0].at ?? '9') || a.client.name.localeCompare(b.client.name));
  const sessions = db.prepare('SELECT * FROM bookings WHERE coach_id=? AND cancelled_at IS NULL AND start>=? AND start<? ORDER BY start')
    .all(coach.id, londonToUtc(today).toISOString(), londonToUtc(addDays(today, 1)).toISOString());
  const next = sessions.find(b => Date.parse(b.end) > now.getTime());
  const minutes = due.reduce((t, d) => t + (d.media ? 8 : 6), 0);
  return {
    date: today,
    sessionsToday: { total: sessions.length, done: sessions.filter(b => Date.parse(b.end) <= now.getTime()).length, next: next ? bookingOut(db, next, coach) : null },
    lettersDue: { week, count: due.length, estMinutes: Math.round(minutes / 5) * 5, clients: due },
    items, allCaughtUp: items.length === 0,
  };
}

function route(_req, ctx) {
  requireCoach(ctx);
  return needsYou(ctx.db, ctx.user);
}

export function needsRoutes(r) {
  r.add('GET', '/api/coach/needs-you', route);
}
