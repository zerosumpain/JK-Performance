import { clientFor, initials, requestNow, requireCoach } from '../access.mjs';
import { dayStates, minimumStreak } from '../daily.mjs';
import { emit } from '../events.mjs';
import { attendedSessions, clientFacts, runAction } from '../facts.mjs';
import { fail, num, oneOf, str } from '../http.mjs';
import { planOf } from '../plans.mjs';
import { allActions, allFacts, hooks } from '../registry.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonDay, londonToUtc, mondayOf } from '../time.mjs';

/**
 * WP2: Client 360 and the health score (F5), lifecycle stages (F7), and the
 * retention radar, renewals, pause, End coaching and win-back (F8)
 * (docs/design/desk-v2.md section 4). Tags and segments are foundation
 * tables (3.4); this feature only uses them.
 *
 * Health is computed for every client when the coach's day starts
 * (`day.started`) and on demand for one client, and stored per day. The
 * lifecycle runs straight after it. Rules may only *suggest* Churned (D18):
 * ending coaching happens through POST …/end, which records the stage and
 * emits `client.offboarded`; billing, campaigns and automations do their own
 * part from that event. This file never writes another feature's tables.
 */

const STAGES = ['onboarding', 'active', 'atRisk', 'paused', 'churned', 'alumni'];
const STAGE_LABEL = { onboarding: 'Onboarding', active: 'Active', atRisk: 'At risk', paused: 'Paused', churned: 'Churned', alumni: 'Alumni' };
const ENDED = ['churned', 'alumni'];
const EXIT_REASONS = ['cost', 'time', 'injury', 'results', 'moved', 'coachFit', 'goalReached', 'other'];
const EXIT_LABEL = { cost: 'Cost', time: 'Time', injury: 'Injury', results: 'Results', moved: 'Moved away', coachFit: 'Coach fit', goalReached: 'Goal reached', other: 'Other' };
const BAND_LABEL = { thriving: 'Thriving', steady: 'Steady', watch: 'Watch', atRisk: 'At risk' };
const SCORE_KEEP_DAYS = 400;
const ONBOARDING_WINDOW = 60; // days after joining that a checklist keeps someone in Onboarding
const CHURN_QUIET = 30;
const CHURN_NO_PLAN = 14;
const IDS = 'SELECT value FROM json_each(?)';

const dayOf = iso => (iso ? londonDay(new Date(iso)) : null);
/** The instant a fact or hook should treat as "now" for a London day (the wall clock when it is today). */
const nowFor = today => (today === londonDay() ? new Date() : londonToUtc(today, '12:00'));
const first = name => String(name ?? '').trim().split(/\s+/)[0] || 'them';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ref = c => ({ id: c.id, name: c.name, initials: initials(c.name), plan: c.plan });

// MARK: - Health score (F5)

/** The band word for a score: ≥75 thriving · 50–74 steady · 30–49 watch · <30 atRisk. */
export function bandOf(score) {
  if (score === null || score === undefined) return null;
  return score >= 75 ? 'thriving' : score >= 50 ? 'steady' : score >= 30 ? 'watch' : 'atRisk';
}

/**
 * The F5 formula from its inputs. Returns {health, band, factors}; factors
 * carry each part's points and the notes, weakest part first.
 *   engagement  (30) = min(1, (messages + check-ins×3 + habit days met/2 + sessions attended×3) / 12)   (14 days)
 *   adherence   (30) = adherence28 / 100   (null → 0.5)
 *   consistency (20) = min(1, minimum-day streak / 14)
 *   wellbeing   (20) = 1 − 0.5×pain14 − 0.25×(missed / max(1, set) commitments, 4 weeks)
 * Voice sentiment is AI-derived, so it is shown as a note but never scored:
 * the score feeds crm.band, crm.stage and their events, which automations and
 * broadcast audiences may use to message clients (D5, 6.3). The spec's
 * "−0.25×(voice sentiment < −0.3)" term is left out on purpose.
 */
export function scoreFrom(x) {
  const engagement = Math.min(1, ((x.messages14 ?? 0) + (x.checkins14 ?? 0) * 3 + (x.habitDays14 ?? 0) / 2 + (x.sessions14 ?? 0) * 3) / 12);
  const adherence = x.adherence28 === null || x.adherence28 === undefined ? 0.5 : Math.max(0, Math.min(1, x.adherence28 / 100));
  const consistency = Math.min(1, (x.streak ?? 0) / 14);
  const missedShare = (x.commitmentsMissed ?? 0) / Math.max(1, x.commitmentsSet ?? 0);
  const lowMood = typeof x.sentiment14 === 'number' && x.sentiment14 < -0.3;
  const wellbeing = Math.max(0, 1 - 0.5 * (x.pain14 ? 1 : 0) - 0.25 * missedShare);
  const health = Math.round(100 * (0.3 * engagement + 0.3 * adherence + 0.2 * consistency + 0.2 * wellbeing));
  const parts = [
    { key: 'engagement', points: Math.round(engagement * 30), max: 30 },
    { key: 'adherence', points: Math.round(adherence * 30), max: 30 },
    { key: 'consistency', points: Math.round(consistency * 20), max: 20 },
    { key: 'wellbeing', points: Math.round(wellbeing * 20), max: 20 },
  ];
  const text = {
    engagement: () => {
      const bits = [];
      if (x.sessions14) bits.push(`${plural(x.sessions14, 'session')} attended`);
      if (x.messages14) bits.push(plural(x.messages14, 'message'));
      if (x.checkins14) bits.push(plural(x.checkins14, 'check-in'));
      if (x.habitDays14) bits.push(`${x.habitDays14} habit days met`);
      return bits.length ? `${bits.slice(0, 2).join(', ')} in 14 days` : 'No messages, check-ins or sessions in 14 days';
    },
    adherence: () => (x.adherence28 === null || x.adherence28 === undefined ? 'No workouts due lately' : `Adherence ${x.adherence28}%`),
    consistency: () => (x.streak ? `Streak ${plural(x.streak, 'day')}` : 'No streak running'),
    wellbeing: () => {
      const bits = [];
      if (x.pain14) bits.push('Pain flagged');
      if (x.commitmentsSet) bits.push(`Kept ${x.commitmentsSet - (x.commitmentsMissed ?? 0)}/${x.commitmentsSet} commitments`);
      if (lowMood) bits.push('Low mood in voice notes (AI, not scored)');
      return bits.join(' · ') || 'No pain flags';
    },
  };
  const order = [...parts].sort((a, b) => (a.points / a.max) - (b.points / b.max));
  const notes = order.map(p => text[p.key]());
  if (x.daysQuiet !== null && x.daysQuiet !== undefined) notes.splice(1, 0, x.daysQuiet === 0 ? 'Active today' : `Quiet ${plural(x.daysQuiet, 'day')}`);
  return {
    health, band: bandOf(health),
    factors: { engagement: parts[0].points, adherence: parts[1].points, consistency: parts[2].points, wellbeing: parts[3].points, notes },
  };
}

/** The inputs to the formula for a batch of a coach's clients (rows), on `today`. Map<clientId, inputs>. */
function scoreInputs(db, coachId, clients, today, now) {
  const out = new Map();
  if (!clients.length) return out;
  const ids = clients.map(c => c.id);
  const json = JSON.stringify(ids);
  const hasSentiment = allFacts().some(f => f.id === 'voice.sentiment14');
  const facts = clientFacts(db, coachId, ids, { only: ['core.adherence28', 'core.pain14', 'core.sessionsAttended14', 'core.daysQuiet', ...(hasSentiment ? ['voice.sentiment14'] : [])], today, now });
  const from14 = londonToUtc(addDays(today, -13)).toISOString();
  const end = londonToUtc(addDays(today, 1)).toISOString();
  const group = (sql, ...args) => new Map(db.prepare(sql).all(...args).map(r => [r.k, r.v]));
  const messages = group(`SELECT client_id k, COUNT(*) v FROM messages WHERE from_role='client' AND client_id IN (${IDS}) AND at>=? AND at<? GROUP BY client_id`, json, from14, end);
  const checkins = group(`SELECT client_id k, COUNT(*) v FROM checkins WHERE client_id IN (${IDS}) AND submitted_at>=? AND submitted_at<? GROUP BY client_id`, json, from14, end);
  const weekFrom = addDays(mondayOf(today), -28);
  const set = group(`SELECT client_id k, COUNT(*) v FROM commitments WHERE client_id IN (${IDS}) AND week>=? AND week<=? GROUP BY client_id`, json, weekFrom, today);
  const missed = group(`SELECT client_id k, COUNT(*) v FROM commitments WHERE client_id IN (${IDS}) AND week>=? AND week<=? AND outcome='missed' GROUP BY client_id`, json, weekFrom, today);
  for (const c of clients) {
    const f = facts.get(c.id) ?? {};
    const useHealth = !!c.health_share;
    const habitDays14 = dayStates(db, c, addDays(today, -13), today, { useHealth, today }).filter(s => s.done).length;
    out.set(c.id, {
      messages14: messages.get(c.id) ?? 0, checkins14: checkins.get(c.id) ?? 0, habitDays14, sessions14: f['core.sessionsAttended14'] ?? 0,
      adherence28: f['core.adherence28'] ?? null, streak: minimumStreak(db, c, today, { useHealth }), pain14: !!f['core.pain14'],
      commitmentsSet: set.get(c.id) ?? 0, commitmentsMissed: missed.get(c.id) ?? 0, sentiment14: hasSentiment ? f['voice.sentiment14'] ?? null : null,
      daysQuiet: f['core.daysQuiet'] ?? null,
    });
  }
  return out;
}

/** Live scores for a batch of clients (rows): Map<clientId, {health, band, factors}>. Nothing is stored. */
function computeScores(db, coachId, clients, today, now = nowFor(today)) {
  const inputs = scoreInputs(db, coachId, clients, today, now);
  return new Map([...inputs].map(([id, x]) => [id, scoreFrom(x)]));
}

function storeScore(db, coachId, clientId, today, s) {
  db.prepare(`INSERT INTO client_scores (client_id, coach_id, day, health, band, factors) VALUES (?,?,?,?,?,?)
    ON CONFLICT(client_id, day) DO UPDATE SET coach_id=excluded.coach_id, health=excluded.health, band=excluded.band, factors=excluded.factors`)
    .run(clientId, coachId, today, s.health, s.band, JSON.stringify(s.factors));
}

/** The latest stored score per client on or before `today` (within 3 days): Map<clientId, row>. */
function latestScores(db, ids, today) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT s.* FROM client_scores s WHERE s.client_id IN (${IDS}) AND s.day<=? AND s.day>=?
    AND s.day = (SELECT MAX(day) FROM client_scores x WHERE x.client_id=s.client_id AND x.day<=?)`).all(JSON.stringify(ids), today, addDays(today, -3), today);
  return new Map(rows.map(r => [r.client_id, { health: r.health, band: r.band, factors: JSON.parse(r.factors), day: r.day }]));
}

/** Score 14 days before `day` (or the closest stored within the 3 days before that): Map<clientId, health>. */
function scoresBefore(db, ids, day) {
  if (!ids.length) return new Map();
  const target = addDays(day, -14);
  const rows = db.prepare(`SELECT s.client_id, s.health FROM client_scores s WHERE s.client_id IN (${IDS}) AND s.day<=? AND s.day>=?
    AND s.day = (SELECT MAX(day) FROM client_scores x WHERE x.client_id=s.client_id AND x.day<=? AND x.day>=?)`).all(JSON.stringify(ids), target, addDays(target, -3), target, addDays(target, -3));
  return new Map(rows.map(r => [r.client_id, r.health]));
}

/**
 * Scores now for a batch: stored where there is one for the last 3 days,
 * otherwise live. Map<clientId, {health, band, factors, trend}>.
 */
function currentScores(db, coachId, clients, today) {
  if (!clients.length) return new Map();
  // Ended clients have no current score; a paused one keeps the last score from before the pause.
  const held = new Map(db.prepare(`SELECT client_id, stage FROM client_lifecycle WHERE client_id IN (${IDS}) AND stage IN ('paused','churned','alumni')`)
    .all(JSON.stringify(clients.map(c => c.id))).map(r => [r.client_id, r.stage]));
  clients = clients.filter(c => !['churned', 'alumni'].includes(held.get(c.id)));
  const paused = clients.filter(c => held.get(c.id) === 'paused');
  const ids = clients.map(c => c.id);
  const stored = latestScores(db, ids, today);
  for (const c of paused) {
    if (stored.has(c.id)) continue;
    const r = db.prepare('SELECT * FROM client_scores WHERE client_id=? AND day<=? ORDER BY day DESC LIMIT 1').get(c.id, today);
    if (r) stored.set(c.id, { health: r.health, band: r.band, factors: JSON.parse(r.factors), day: r.day, held: true });
  }
  const missing = clients.filter(c => !stored.has(c.id) && held.get(c.id) !== 'paused');
  const live = missing.length ? computeScores(db, coachId, missing, today) : new Map();
  const before = scoresBefore(db, ids, today);
  const out = new Map();
  for (const c of clients) {
    const s = stored.get(c.id) ?? live.get(c.id);
    if (!s) continue;
    out.set(c.id, { ...s, trend: !s.held && before.has(c.id) ? s.health - before.get(c.id) : null });
  }
  return out;
}

// MARK: - Lifecycle (F7)

const clientsOf = (db, coachId) => db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=? ORDER BY name").all(coachId);
const lifecycleRow = (db, clientId) => db.prepare('SELECT * FROM client_lifecycle WHERE client_id=?').get(clientId);

/**
 * What the rules say a client's stage is (ignoring manual overrides and the
 * End coaching stages, which callers keep). Returns {stage, reason}.
 */
function ruleStage(client, { row, facts, score, today }) {
  if (row?.paused_until && row.paused_until > today) return { stage: 'paused', reason: `Paused until ${row.paused_until}` };
  const pct = facts['onboarding.pct'];
  const joined = facts['core.daysSinceJoined'] ?? daysBetween(dayOf(client.created_at), today);
  if (pct !== null && pct !== undefined && pct < 100 && joined < ONBOARDING_WINDOW) return { stage: 'onboarding', reason: `Onboarding ${pct}% done` };
  const quiet = facts['core.daysQuiet'];
  if (score && score.health < 35) return { stage: 'atRisk', reason: `Health ${score.health}` };
  if (quiet !== null && quiet !== undefined && quiet >= 10) return { stage: 'atRisk', reason: `Quiet ${quiet} days` };
  if (score && score.trend !== null && score.trend !== undefined && score.trend <= -20) return { stage: 'atRisk', reason: `Health down ${-score.trend} in 14 days` };
  return { stage: 'active', reason: 'Rules: active' };
}

const LIFECYCLE_FACTS = () => ['core.daysQuiet', 'core.daysSinceJoined', ...(allFacts().some(f => f.id === 'onboarding.pct') ? ['onboarding.pct'] : [])];

/** The stage now for a batch, persisted or not: Map<clientId, {stage, row}>. */
function stagesOf(db, coachId, clients, today) {
  if (!clients.length) return new Map();
  const rows = new Map(db.prepare(`SELECT * FROM client_lifecycle WHERE client_id IN (${IDS})`).all(JSON.stringify(clients.map(c => c.id))).map(r => [r.client_id, r]));
  const loose = clients.filter(c => !rows.has(c.id));
  const facts = loose.length ? clientFacts(db, coachId, loose.map(c => c.id), { only: LIFECYCLE_FACTS(), today, now: nowFor(today) }) : new Map();
  const scores = loose.length ? currentScores(db, coachId, loose, today) : new Map();
  const out = new Map();
  for (const c of clients) {
    const row = rows.get(c.id);
    out.set(c.id, { stage: row ? row.stage : ruleStage(c, { row: null, facts: facts.get(c.id) ?? {}, score: scores.get(c.id), today }).stage, row: row ?? null });
  }
  return out;
}

/**
 * Record a stage. Appends history (once per change) and emits
 * client.stageChanged {from, to, manual}, except for a client's first row
 * (the initial classification after deploy never triggers automations).
 */
function setStage(db, coachId, client, to, { manual = false, reason = '', now = new Date(), extra = {} } = {}) {
  const row = lifecycleRow(db, client.id);
  const at = now.toISOString();
  const from = row?.stage ?? null;
  if (!row) {
    db.prepare(`INSERT INTO client_lifecycle (client_id, coach_id, stage, since, manual, updated_at) VALUES (?,?,?,?,?,?)`)
      .run(client.id, coachId, to, at, manual ? 1 : 0, at);
  } else if (from !== to || !!row.manual !== !!manual) {
    db.prepare('UPDATE client_lifecycle SET stage=?, since=CASE WHEN stage=? THEN since ELSE ? END, manual=?, coach_id=?, updated_at=? WHERE client_id=?')
      .run(to, to, at, manual ? 1 : 0, coachId, at, client.id);
  }
  const fields = Object.entries(extra);
  if (fields.length) db.prepare(`UPDATE client_lifecycle SET ${fields.map(([k]) => `${k}=?`).join(', ')}, updated_at=? WHERE client_id=?`).run(...fields.map(([, v]) => v), at, client.id);
  if (from === to) return false;
  db.prepare('INSERT INTO lifecycle_history (client_id, coach_id, stage, at, reason) VALUES (?,?,?,?,?)').run(client.id, coachId, to, at, String(reason).slice(0, 200));
  if (from) emit(db, 'client.stageChanged', { coachId, clientId: client.id, summary: `Stage: ${STAGE_LABEL[to]}`, from, to, manual: !!manual });
  return true;
}

/**
 * Run the lifecycle rules for a batch of clients (rows): manual overrides and
 * ended stages stay, everything else follows ruleStage. `scores` may carry
 * today's fresh scores. Returns how many changed.
 */
function syncLifecycle(db, coachId, clients, { today, now = nowFor(today), scores = null } = {}) {
  if (!clients.length) return 0;
  const facts = clientFacts(db, coachId, clients.map(c => c.id), { only: LIFECYCLE_FACTS(), today, now });
  const current = scores ?? currentScores(db, coachId, clients, today);
  let n = 0;
  for (const c of clients) {
    const row = lifecycleRow(db, c.id);
    if (row && ENDED.includes(row.stage)) {
      // Churned with "goal reached" for 90 days becomes Alumni; nothing else moves an ended client.
      if (row.stage === 'churned' && row.exit_reason === 'goalReached' && row.ended_at && daysBetween(dayOf(row.ended_at), today) >= 90) {
        n += setStage(db, coachId, c, 'alumni', { reason: '90 days after a goal reached', now }) ? 1 : 0;
      }
      continue;
    }
    if (row?.manual && !(row.paused_until && row.paused_until > today && row.stage !== 'paused')) continue;
    const { stage, reason } = ruleStage(c, { row, facts: facts.get(c.id) ?? {}, score: current.get(c.id), today });
    if (row?.stage === 'paused' && stage !== 'paused') continue; // a pause ends through resume(), which emits client.resumed
    n += setStage(db, coachId, c, stage, { reason, now }) ? 1 : 0;
  }
  return n;
}

// MARK: - Pause, resume, end (F8)

function doPause(db, coachId, client, { weeks, reason, now }) {
  const row = lifecycleRow(db, client.id);
  if (row && ENDED.includes(row.stage)) fail(409, 'Coaching has ended for this client');
  const today = londonDay(now);
  const until = addDays(today, weeks * 7);
  const days = weeks * 7;
  setStage(db, coachId, client, 'paused', { reason: reason ? `Paused: ${reason}` : 'Paused', now, extra: {
    paused_until: until, pause_reason: reason || null, paused_at: row?.stage === 'paused' && row.paused_at ? row.paused_at : now.toISOString(), manual: 0, churn_suggested_at: null,
  } });
  emit(db, 'client.paused', { coachId, clientId: client.id, summary: `Paused until ${until}`, until, reason: reason || '', days });
  return until;
}

function doResume(db, coachId, client, { now, automatic = false }) {
  const row = lifecycleRow(db, client.id);
  if (!row || row.stage !== 'paused') fail(409, 'This client is not paused');
  const today = londonDay(now);
  const pausedDays = Math.max(0, daysBetween(dayOf(row.paused_at) ?? today, today));
  db.prepare('UPDATE client_lifecycle SET paused_until=NULL, pause_reason=NULL, paused_at=NULL, manual=0 WHERE client_id=?').run(client.id);
  const facts = clientFacts(db, coachId, [client.id], { only: LIFECYCLE_FACTS(), today, now }).get(client.id) ?? {};
  const score = currentScores(db, coachId, [client], today).get(client.id);
  const { stage } = ruleStage(client, { row: null, facts, score, today });
  setStage(db, coachId, client, stage, { reason: automatic ? 'Pause ended' : 'Resumed by coach', now });
  emit(db, 'client.resumed', { coachId, clientId: client.id, summary: `Back from a ${plural(pausedDays, 'day')} pause`, pausedDays });
}

/** Resume every pause whose day has come (the crm.resume clock and the nightly run). */
function resumeDue(db, now) {
  const today = londonDay(now);
  const due = db.prepare(`SELECT l.client_id, u.coach_id FROM client_lifecycle l JOIN users u ON u.id=l.client_id AND u.role='client'
    WHERE l.stage='paused' AND l.paused_until<=? AND u.coach_id IS NOT NULL`).all(today);
  let n = 0;
  for (const d of due) {
    tx(db, () => {
      const client = db.prepare('SELECT * FROM users WHERE id=?').get(d.client_id);
      const row = lifecycleRow(db, d.client_id);
      if (!client || row?.stage !== 'paused' || !(row.paused_until <= today)) return;
      doResume(db, d.coach_id, client, { now, automatic: true });
      n++;
    });
  }
  return n;
}

const EXIT_SURVEY = {
  name: 'Before you go',
  intro: 'Thank you for training with JK. Two minutes of honest answers helps make coaching better for the next person.',
  questions: [
    { id: 'better', kind: 'text', prompt: 'What could JK have done better?' },
    { id: 'best', kind: 'text', prompt: 'What was the most useful part of coaching?' },
    { id: 'again', kind: 'choice', prompt: 'Would you come back one day?', options: ['Yes', 'Maybe', 'No'] },
  ],
};

/** The coach's exit-survey form (made once, as an ordinary form they can edit). */
function exitSurveyForm(db, coachId) {
  const found = db.prepare('SELECT id FROM forms WHERE coach_id=? AND name=?').get(coachId, EXIT_SURVEY.name);
  if (found) return found.id;
  const id = newId('f');
  db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, coachId, EXIT_SURVEY.name, EXIT_SURVEY.intro, JSON.stringify(EXIT_SURVEY.questions), nowIso(), nowIso());
  return id;
}

// MARK: - Churn suggestions and needs-you (F7, F8)

/** Clients with plan 'none' for 14+ days after having a plan: Map<clientId, days>. */
function lapsedPlans(db, clients, today) {
  const out = new Map();
  for (const c of clients.filter(x => x.plan === 'none')) {
    const events = db.prepare('SELECT plan, at FROM membership_events WHERE user_id=? ORDER BY at, id').all(c.id);
    if (!events.some(e => e.plan !== 'none')) continue;
    const last = events.at(-1);
    if (last?.plan !== 'none') continue;
    const days = daysBetween(dayOf(last.at), today);
    if (days >= CHURN_NO_PLAN) out.set(c.id, days);
  }
  return out;
}

/** Set or clear churn suggestions (never changes a stage). Returns how many are set. */
function suggestChurn(db, coachId, clients, { today, now }) {
  const facts = clientFacts(db, coachId, clients.map(c => c.id), { only: ['core.daysQuiet'], today, now });
  const lapsed = lapsedPlans(db, clients, today);
  let n = 0;
  for (const c of clients) {
    const row = lifecycleRow(db, c.id);
    if (!row) continue;
    const eligible = !['paused', ...ENDED].includes(row.stage);
    const quiet = facts.get(c.id)?.['core.daysQuiet'] ?? 0;
    const suggest = eligible && (quiet >= CHURN_QUIET || lapsed.has(c.id));
    if (suggest && !row.churn_suggested_at) db.prepare('UPDATE client_lifecycle SET churn_suggested_at=? WHERE client_id=?').run(now.toISOString(), c.id);
    if (!suggest && row.churn_suggested_at) db.prepare('UPDATE client_lifecycle SET churn_suggested_at=NULL WHERE client_id=?').run(c.id);
    if (suggest) n++;
  }
  return n;
}

/** Why the rules suggest churn, in words. */
function churnWhy(db, coachId, client, today) {
  const quiet = clientFacts(db, coachId, [client.id], { only: ['core.daysQuiet'], today, now: nowFor(today) }).get(client.id)?.['core.daysQuiet'] ?? 0;
  if (quiet >= CHURN_QUIET) return `quiet ${quiet} days`;
  const lapsed = lapsedPlans(db, [client], today).get(client.id);
  return lapsed ? `no plan for ${lapsed} days` : 'gone quiet';
}

/** The day a client's band moved into At risk, if it did in the last 7 days (and is still there). */
function intoAtRisk(db, clientId, today) {
  const rows = db.prepare('SELECT day, health, band FROM client_scores WHERE client_id=? AND day<=? AND day>=? ORDER BY day DESC').all(clientId, today, addDays(today, -21));
  if (!rows.length || rows[0].band !== 'atRisk' || rows[0].day < addDays(today, -1)) return null;
  const before = rows.findIndex(r => r.band !== 'atRisk');
  if (before <= 0) return null;
  const since = rows[before - 1];
  return since.day >= addDays(today, -7) ? { day: since.day, health: rows[0].health } : null;
}

// MARK: - The nightly run

/**
 * `day.started` for one coach: score every client for the day (stored),
 * emit crm.bandChanged where the band moved since yesterday, run the
 * lifecycle rules, resume pauses that are due, refresh churn suggestions and
 * prune scores older than 400 days.
 */
function nightly(db, coachId, today) {
  const now = nowFor(today);
  const clients = clientsOf(db, coachId);
  if (!clients.length) return;
  resumeDue(db, now);
  const stages = stagesOf(db, coachId, clients, today);
  // Paused and ended clients are not scored: a pause would read as a collapse, and nobody scores someone who has left.
  const scored = clients.filter(c => !['paused', ...ENDED].includes(stages.get(c.id)?.stage));
  const fresh = computeScores(db, coachId, scored, today, now);
  const ids = scored.map(c => c.id);
  const yesterday = new Map(db.prepare(`SELECT client_id, band FROM client_scores WHERE client_id IN (${IDS}) AND day=?`).all(JSON.stringify(ids), addDays(today, -1)).map(r => [r.client_id, r.band]));
  const before = scoresBefore(db, ids, today);
  const already = new Map(db.prepare(`SELECT client_id, band FROM client_scores WHERE client_id IN (${IDS}) AND day=?`).all(JSON.stringify(ids), today).map(r => [r.client_id, r.band]));
  for (const c of scored) {
    const s = fresh.get(c.id);
    storeScore(db, coachId, c.id, today, s);
    const was = yesterday.get(c.id);
    // Once per move: a second run on the same day (or an on-demand score earlier today) does not emit again.
    if (was && was !== s.band && already.get(c.id) !== s.band) {
      emit(db, 'crm.bandChanged', { coachId, clientId: c.id, summary: `Health ${BAND_LABEL[was]} → ${BAND_LABEL[s.band]} (${s.health})`, from: was, to: s.band, health: s.health });
    }
  }
  const scores = new Map([...fresh].map(([id, s]) => [id, { ...s, trend: before.has(id) ? s.health - before.get(id) : null }]));
  syncLifecycle(db, coachId, scored, { today, now, scores });
  const endedSoon = clients.filter(c => stages.get(c.id)?.stage === 'churned');
  if (endedSoon.length) syncLifecycle(db, coachId, endedSoon, { today, now }); // churned + goal reached for 90 days → alumni
  suggestChurn(db, coachId, clients, { today, now });
  db.prepare(`DELETE FROM client_scores WHERE coach_id=? AND day<?`).run(coachId, addDays(today, -SCORE_KEEP_DAYS));
}

// MARK: - Output shapes

function lifecycleOut(db, coachId, client, today = londonDay()) {
  const row = lifecycleRow(db, client.id);
  const computed = !row ? stagesOf(db, coachId, [client], today).get(client.id).stage : null;
  return {
    stage: row?.stage ?? computed, since: row?.since ?? client.created_at, manual: !!row?.manual, computed: !row,
    pausedUntil: row?.paused_until ?? null, pauseReason: row?.pause_reason ?? null, pausedAt: row?.paused_at ?? null,
    exitReason: row?.exit_reason ?? null, exitNote: row?.exit_note ?? null, endedAt: row?.ended_at ?? null,
    birthday: row?.birthday ?? null, churnSuggestedAt: row?.churn_suggested_at ?? null,
    history: db.prepare('SELECT stage, at, reason FROM lifecycle_history WHERE client_id=? ORDER BY at DESC, rowid DESC LIMIT 50').all(client.id),
  };
}

const noteOut = n => ({ id: n.id, body: n.body, pinned: !!n.pinned, createdAt: n.created_at, updatedAt: n.updated_at });

/** "Fri 12 Dec" for the next birthday on or after today. */
function nextBirthday(mmdd, today) {
  if (!mmdd) return null;
  const year = Number(today.slice(0, 4));
  const on = y => {
    if (mmdd !== '02-29') return `${y}-${mmdd}`;
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-02-${leap ? '29' : '28'}`;
  };
  let d = on(year);
  if (d < today) d = on(year + 1);
  return d;
}
const fmtDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');

// MARK: - Timeline (F5)

const COVERED = ['message.sent', 'message.received', 'checkin.submitted', 'form.sent', 'form.submitted', 'booking.created', 'booking.cancelled',
  'workout.completed', 'membership.changed', 'letter.published', 'letter.delivered', 'commitment.reviewed', 'client.stageChanged', 'client.paused',
  'client.resumed', 'client.offboarded', 'day.started', 'client.joined'];
const EVENT_KIND = { client: 'tag', crm: 'stage', onboarding: 'onboarding', invoice: 'billing', payment: 'billing', package: 'billing', billing: 'billing',
  refund: 'billing', campaign: 'campaign', voice: 'voice', ai: 'voice', task: 'task', booking: 'session', session: 'session', guide: 'guide' };
const EVENT_ICON = { tag: 'label', stage: 'monitor_heart', onboarding: 'checklist', billing: 'receipt_long', campaign: 'rocket_launch', voice: 'graphic_eq',
  task: 'task_alt', session: 'event_available', guide: 'menu_book', other: 'bolt' };
const STAGE_ICON = { onboarding: 'checklist', active: 'verified', atRisk: 'warning', paused: 'pause_circle', churned: 'logout', alumni: 'workspace_premium' };
const STAGE_TONE = { onboarding: 'data', active: 'ok', atRisk: 'urgent', paused: 'attention', churned: 'attention', alumni: 'ok' };
export const TIMELINE_KINDS = ['message', 'session', 'workout', 'checkin', 'letter', 'form', 'plan', 'stage', 'note', 'tag', 'onboarding', 'billing', 'campaign', 'voice', 'task', 'guide', 'other'];

const excerpt = (t, n = 110) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/**
 * A client's history, newest first: the domain tables for the core kinds (so
 * history before the event bus and the demo world both show), the events log
 * for everything else, lifecycle history, pinned notes and every feature's
 * timeline hook. Returns {items, next}.
 */
function timelineOf(db, coach, client, { before, limit, kinds, now = new Date() }) {
  const want = k => !kinds || kinds.has(k);
  const cut = before || '9999';
  const n = limit + 1;
  const items = [];
  const enc = encodeURIComponent;
  const cid = enc(client.id);
  const who = first(client.name);
  if (want('message')) {
    for (const m of db.prepare('SELECT id, from_role, kind, text, at FROM messages WHERE client_id=? AND at<? ORDER BY at DESC LIMIT ?').all(client.id, cut, n)) {
      const voice = m.kind === 'voice' || m.kind === 'audio';
      items.push({ at: m.at, kind: 'message', icon: voice ? 'graphic_eq' : m.from_role === 'client' ? 'forum' : 'reply',
        tone: m.from_role === 'client' ? 'data' : null, title: m.from_role === 'client' ? `${who} wrote` : 'You wrote',
        detail: voice ? 'Voice note' : excerpt(m.text), path: `/messages/${cid}` });
    }
  }
  if (want('workout')) {
    for (const w of db.prepare('SELECT title, completed_at, feel FROM workouts WHERE client_id=? AND completed_at IS NOT NULL AND completed_at<? ORDER BY completed_at DESC LIMIT ?').all(client.id, cut, n)) {
      items.push({ at: w.completed_at, kind: 'workout', icon: 'local_fire_department', tone: 'ok', title: `Finished ${w.title}`, detail: w.feel ? `Felt ${w.feel}/5` : '', path: `/clients/${cid}/plan` });
    }
  }
  if (want('checkin')) {
    for (const c of db.prepare('SELECT week, energy, sleep, pain, submitted_at FROM checkins WHERE client_id=? AND submitted_at<? ORDER BY submitted_at DESC LIMIT ?').all(client.id, cut, n)) {
      const pain = JSON.parse(c.pain || '[]');
      items.push({ at: c.submitted_at, kind: 'checkin', icon: 'monitor_heart', tone: pain.length ? 'urgent' : 'data', title: 'Weekly check-in',
        detail: [`Energy ${c.energy}/5`, `sleep ${c.sleep}/5`, pain.length ? `${pain.join(', ').toLowerCase()} sore` : null].filter(Boolean).join(' · '), path: `/clients/${cid}/letters` });
    }
  }
  if (want('session')) {
    const nowIsoStr = now.toISOString();
    const upto = cut < nowIsoStr ? cut : nowIsoStr;
    for (const b of db.prepare(`SELECT * FROM (SELECT id, title, kind, start, cancelled_at FROM bookings WHERE client_id=? AND start<?
        UNION ALL SELECT b.id, b.title, b.kind, b.start, b.cancelled_at FROM class_attendees a JOIN bookings b ON b.id=a.booking_id WHERE a.user_id=? AND b.start<?)
        ORDER BY start DESC LIMIT ?`).all(client.id, upto, client.id, upto, n)) {
      items.push({ at: b.start, kind: 'session', icon: b.cancelled_at ? 'event_busy' : 'event_available', tone: b.cancelled_at ? 'attention' : null,
        title: b.cancelled_at ? `Cancelled: ${b.title}` : b.title, detail: b.kind === 'video' ? 'Video' : b.kind === 'group' ? 'Group class' : 'In person', path: `/clients/${cid}/sessions` });
    }
  }
  if (want('letter')) {
    for (const r of db.prepare('SELECT kind, headline, summary, published_at FROM reports WHERE client_id=? AND published_at IS NOT NULL AND published_at<? ORDER BY published_at DESC LIMIT ?').all(client.id, cut, n)) {
      items.push({ at: r.published_at, kind: 'letter', icon: 'edit_note', tone: null, title: r.kind === 'milestone' ? 'Milestone letter' : 'Weekly letter',
        detail: excerpt(r.headline || r.summary, 90), path: `/clients/${cid}/letters` });
    }
  }
  if (want('form')) {
    for (const f of db.prepare('SELECT name, sent_at, submitted_at FROM form_requests WHERE client_id=? AND COALESCE(submitted_at, sent_at)<? ORDER BY COALESCE(submitted_at, sent_at) DESC LIMIT ?').all(client.id, cut, n)) {
      items.push(f.submitted_at
        ? { at: f.submitted_at, kind: 'form', icon: 'description', tone: 'data', title: `Answered ${f.name}`, detail: '', path: `/clients/${cid}/forms` }
        : { at: f.sent_at, kind: 'form', icon: 'description', tone: null, title: `Sent ${f.name}`, detail: 'Waiting for answers', path: `/clients/${cid}/forms` });
    }
  }
  if (want('plan')) {
    for (const m of db.prepare('SELECT plan, at FROM membership_events WHERE user_id=? AND at<? ORDER BY at DESC LIMIT ?').all(client.id, cut, n)) {
      items.push({ at: m.at, kind: 'plan', icon: 'workspace_premium', tone: null, title: m.plan === 'none' ? 'Left their plan' : `Plan: ${m.plan[0].toUpperCase()}${m.plan.slice(1)}`, detail: '', path: null });
    }
  }
  if (want('stage')) {
    for (const s of db.prepare('SELECT stage, at, reason FROM lifecycle_history WHERE client_id=? AND at<? ORDER BY at DESC LIMIT ?').all(client.id, cut, n)) {
      items.push({ at: s.at, kind: 'stage', icon: STAGE_ICON[s.stage] ?? 'monitor_heart', tone: STAGE_TONE[s.stage] ?? null, title: `Stage: ${STAGE_LABEL[s.stage] ?? s.stage}`, detail: s.reason, path: null });
    }
  }
  if (want('note')) {
    for (const nb of db.prepare('SELECT * FROM client_notes WHERE client_id=? AND pinned=1 AND created_at<? ORDER BY created_at DESC LIMIT ?').all(client.id, cut, n)) {
      items.push({ at: nb.created_at, kind: 'note', icon: 'sticky_note_2', tone: null, title: 'Pinned note', detail: excerpt(nb.body, 160), path: `/clients/${cid}/notes`, pinned: true, id: nb.id });
    }
  }
  const evRows = db.prepare(`SELECT type, summary, at FROM events WHERE client_id=? AND at<? AND type NOT IN (${COVERED.map(() => '?').join(',')}) ORDER BY at DESC, seq DESC LIMIT ?`)
    .all(client.id, cut, ...COVERED, n * 2);
  for (const e of evRows) {
    const kind = EVENT_KIND[e.type.split('.')[0]] ?? 'other';
    if (!want(kind)) continue;
    items.push({ at: e.at, kind, icon: EVENT_ICON[kind] ?? 'bolt', tone: e.type === 'crm.bandChanged' ? 'attention' : null, title: e.summary || e.type, detail: '', path: null });
  }
  for (const [f, fn] of hooks('timeline')) {
    try {
      for (const it of fn(db, coach, client, before || null, n) ?? []) {
        if (!it?.at || typeof it.title !== 'string' || !(it.at < cut)) continue;
        const kind = typeof it.kind === 'string' ? it.kind : f.name;
        if (!want(kind)) continue;
        items.push({ at: it.at, kind, icon: it.icon || 'bolt', tone: it.tone ?? null, title: it.title, detail: it.detail ?? '', path: it.path ?? null });
      }
    } catch (e) { console.error(`timeline hook of ${f.name} failed`, e); }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  const page = items.slice(0, limit);
  return { items: page, next: items.length > limit ? page.at(-1).at : null };
}

// MARK: - Retention (F8)

/** Last contact from the coach: a message, a reviewed check-in or a published letter. */
function lastContacts(db, ids) {
  if (!ids.length) return new Map();
  const json = JSON.stringify(ids);
  const rows = db.prepare(`SELECT k, MAX(v) v FROM (
      SELECT client_id k, MAX(at) v FROM messages WHERE from_role='coach' AND client_id IN (${IDS}) GROUP BY client_id
      UNION ALL SELECT client_id, MAX(reviewed_at) FROM checkins WHERE client_id IN (${IDS}) GROUP BY client_id
      UNION ALL SELECT client_id, MAX(published_at) FROM reports WHERE client_id IN (${IDS}) GROUP BY client_id) GROUP BY k`).all(json, json, json);
  return new Map(rows.map(r => [r.k, r.v]));
}

/** The last time each client did anything: a message, a set, a workout, a check-in, a habit tick or an attended session. */
function lastActive(db, coachId, clients, now) {
  if (!clients.length) return new Map();
  const json = JSON.stringify(clients.map(c => c.id));
  const rows = db.prepare(`SELECT k, MAX(v) v FROM (
      SELECT client_id k, MAX(at) v FROM messages WHERE from_role='client' AND client_id IN (${IDS}) GROUP BY client_id
      UNION ALL SELECT client_id, MAX(completed_at) FROM workouts WHERE client_id IN (${IDS}) GROUP BY client_id
      UNION ALL SELECT w.client_id, MAX(s.at) FROM set_logs s JOIN workout_items i ON i.id=s.item_id JOIN workouts w ON w.id=i.workout_id WHERE w.client_id IN (${IDS}) GROUP BY w.client_id
      UNION ALL SELECT client_id, MAX(submitted_at) FROM checkins WHERE client_id IN (${IDS}) GROUP BY client_id) GROUP BY k`).all(json, json, json, json);
  const out = new Map(rows.map(r => [r.k, r.v]));
  // Habit ticks count as activity too (a day, read as noon London).
  for (const r of db.prepare(`SELECT h.client_id k, MAX(d.date) v FROM habit_days d JOIN habits h ON h.id=d.habit_id
      WHERE h.client_id IN (${IDS}) AND (d.done=1 OR d.value>0) AND d.date<=? GROUP BY h.client_id`).all(json, londonDay(now))) {
    const at = londonToUtc(r.v, '12:00').toISOString();
    const when = at > now.toISOString() ? now.toISOString() : at;
    if (!out.get(r.k) || when > out.get(r.k)) out.set(r.k, when);
  }
  const sessions = attendedSessions(db, coachId, clients.map(c => c.id), new Date(now.getTime() - 400 * 86_400_000).toISOString(), now.toISOString(), now);
  for (const [id, list] of sessions) {
    const s = list.at(-1)?.start;
    if (s && (!out.get(id) || s > out.get(id))) out.set(id, s);
  }
  return out;
}

function nextSessions(db, ids, now) {
  if (!ids.length) return new Map();
  const json = JSON.stringify(ids);
  const at = now.toISOString();
  return new Map(db.prepare(`SELECT k, MIN(v) v FROM (
      SELECT client_id k, start v FROM bookings WHERE client_id IN (${IDS}) AND cancelled_at IS NULL AND start>?
      UNION ALL SELECT a.user_id, b.start FROM class_attendees a JOIN bookings b ON b.id=a.booking_id WHERE a.user_id IN (${IDS}) AND b.cancelled_at IS NULL AND b.start>?)
    GROUP BY k`).all(json, at, json, at).map(r => [r.k, r.v]));
}

/** The 30-day series per client: Map<clientId, [{day, health}]>. */
function seriesOf(db, ids, today, days = 30) {
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  for (const r of db.prepare(`SELECT client_id, day, health FROM client_scores WHERE client_id IN (${IDS}) AND day>? AND day<=? ORDER BY day`).all(JSON.stringify(ids), addDays(today, -days), today)) {
    out.get(r.client_id)?.push({ day: r.day, health: r.health });
  }
  return out;
}

const PLAYS = { checkIn: 'Check in', offer: 'Offer', pause: 'Pause', end: 'End coaching' };
function playFor(card, { hasOffer }) {
  if (card.suggested) return { kind: 'end', label: PLAYS.end };
  if (card.reasons.some(r => /pain|injur/i.test(r))) return { kind: 'pause', label: PLAYS.pause };
  if (hasOffer && (card.trend ?? 0) <= -10) return { kind: 'offer', label: PLAYS.offer };
  return { kind: 'checkIn', label: PLAYS.checkIn };
}

function retention(db, coach, today) {
  const now = nowFor(today);
  const clients = clientsOf(db, coach.id);
  const stages = stagesOf(db, coach.id, clients, today);
  const live = clients.filter(c => !['paused', ...ENDED].includes(stages.get(c.id).stage));
  const scores = currentScores(db, coach.id, live, today);
  const ids = live.map(c => c.id);
  const facts = clientFacts(db, coach.id, ids, { only: ['core.daysQuiet'], today, now });
  const contacts = lastContacts(db, ids);
  const series = seriesOf(db, ids, today);
  const hasOffer = allActions().some(a => a.id === 'offer.issue'); // the Offer play needs WP3's action
  const watch = [], atRisk = [], suggested = [];
  for (const c of live) {
    const s = scores.get(c.id);
    const st = stages.get(c.id);
    const card = {
      client: ref(c), stage: st.stage, health: s?.health ?? null, band: s?.band ?? null, trend: s?.trend ?? null,
      series: (series.get(c.id) ?? []).map(p => p.health), reasons: (s?.factors?.notes ?? []).slice(0, 2),
      daysQuiet: facts.get(c.id)?.['core.daysQuiet'] ?? null, lastContactAt: contacts.get(c.id) ?? null,
      suggested: !!st.row?.churn_suggested_at, suggestedAt: st.row?.churn_suggested_at ?? null,
    };
    if (card.suggested) card.why = churnWhy(db, coach.id, c, today);
    card.play = playFor(card, { hasOffer });
    // Columns by band first; the At risk stage (quiet, or a sharp fall) lifts a healthier band into At risk.
    if (card.suggested) suggested.push(card);
    else if (card.band === 'atRisk' || card.stage === 'atRisk') atRisk.push(card);
    else if (card.band === 'watch') watch.push(card);
  }
  const byHealth = (a, b) => (a.health ?? 101) - (b.health ?? 101);
  return { watch: watch.sort(byHealth), atRisk: atRisk.sort(byHealth), suggested: suggested.sort(byHealth), stats: retentionStats(db, coach, today) };
}

function retentionStats(db, coach, today) {
  const ninety = londonToUtc(addDays(today, -90)).toISOString();
  // A save: at risk, then active again within 30 days (in the last 90).
  const hist = db.prepare(`SELECT h.client_id, h.stage, h.at FROM lifecycle_history h JOIN users u ON u.id=h.client_id AND u.coach_id=?
    WHERE h.at>=? ORDER BY h.client_id, h.at`).all(coach.id, londonToUtc(addDays(today, -120)).toISOString());
  let saves90 = 0;
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1], b = hist[i];
    if (a.client_id === b.client_id && a.stage === 'atRisk' && b.stage === 'active' && b.at >= ninety && Date.parse(b.at) - Date.parse(a.at) <= 30 * 86_400_000) saves90++;
  }
  const ended = db.prepare(`SELECT l.ended_at, l.exit_reason FROM client_lifecycle l JOIN users u ON u.id=l.client_id AND u.coach_id=?
    WHERE l.ended_at IS NOT NULL AND l.stage IN ('churned','alumni') AND l.ended_at>=?`).all(coach.id, londonToUtc(addDays(today, -365)).toISOString());
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const churn = months.map(m => ({ month: m, n: ended.filter(e => dayOf(e.ended_at).slice(0, 7) === m).length }));
  const reasons = EXIT_REASONS.map(r => ({ reason: r, label: EXIT_LABEL[r], n: ended.filter(e => e.exit_reason === r).length })).filter(r => r.n);
  return { saves90, churn, reasons, ended12: ended.length };
}

function renewals(db, coach, days, today) {
  const items = [];
  for (const [f, fn] of hooks('renewals')) {
    try {
      for (const it of fn(db, coach, days) ?? []) {
        if (!it?.client?.id || typeof it.label !== 'string') continue;
        items.push({ client: it.client, kind: it.kind ?? f.name, label: it.label, on: it.on ?? null, detail: it.detail ?? '', path: it.path ?? null, feature: f.name });
      }
    } catch (e) { console.error(`renewals hook of ${f.name} failed`, e); }
  }
  const clients = clientsOf(db, coach.id);
  const stages = stagesOf(db, coach.id, clients, today);
  const live = clients.filter(c => !['paused', ...ENDED].includes(stages.get(c.id).stage));
  const mine = new Set(clients.map(c => c.id));
  // Packages from the billing facts, when billing has no renewals hook of its own.
  const factIds = new Set(allFacts().map(f => f.id));
  if (!hooks('renewals').some(([f]) => f.name === 'billing') && factIds.has('billing.credits')) {
    const facts = clientFacts(db, coach.id, live.map(c => c.id), { only: ['billing.credits', ...(factIds.has('billing.packageExpiresDays') ? ['billing.packageExpiresDays'] : [])], today, now: nowFor(today) });
    for (const c of live) {
      const f = facts.get(c.id) ?? {};
      const credits = f['billing.credits'], expires = f['billing.packageExpiresDays'];
      if ((credits !== null && credits !== undefined && credits <= 1) || (expires !== null && expires !== undefined && expires <= Math.min(21, days))) {
        items.push({ client: ref(c), kind: 'package', label: credits <= 1 ? `${plural(credits ?? 0, 'credit')} left` : 'Package ending',
          on: expires !== null && expires !== undefined ? addDays(today, expires) : null, detail: expires !== null && expires !== undefined ? `Expires in ${plural(expires, 'day')}` : '', path: `/clients/${encodeURIComponent(c.id)}` });
      }
    }
  }
  // Upgrade candidates (the F7 starter segment): Foundation → Performance, Performance → Elite.
  const facts = clientFacts(db, coach.id, live.map(c => c.id), { only: ['core.adherence28'], today, now: nowFor(today) });
  const scores = currentScores(db, coach.id, live, today);
  for (const c of live) {
    const adh = facts.get(c.id)?.['core.adherence28'];
    const health = scores.get(c.id)?.health;
    const next = c.plan === 'foundation' ? 'Performance' : c.plan === 'performance' ? 'Elite' : null;
    if (next && adh !== null && adh !== undefined && adh >= 80 && health >= 75) {
      items.push({ client: ref(c), kind: 'upgrade', label: `Ready for ${next}`, on: null, detail: `Adherence ${adh}% · health ${health}`, path: `/clients/${encodeURIComponent(c.id)}` });
    }
  }
  const kept = items.filter(i => mine.has(i.client.id));
  kept.sort((a, b) => (a.on ?? '9999').localeCompare(b.on ?? '9999') || a.client.name?.localeCompare?.(b.client.name ?? '') || 0);
  return kept;
}

// MARK: - Routes

const ownClient = ctx => { requireCoach(ctx); return clientFor(ctx, ctx.params.id); };
const todayOf = ctx => londonDay(requestNow(ctx));

function getScore(_req, ctx) {
  const client = ownClient(ctx);
  const now = requestNow(ctx);
  const today = londonDay(now);
  const s = computeScores(ctx.db, ctx.user.id, [client], today, now).get(client.id);
  // On demand for one client, stored per day; paused and ended clients are shown but never stored (see nightly).
  if (!['paused', ...ENDED].includes(lifecycleRow(ctx.db, client.id)?.stage)) storeScore(ctx.db, ctx.user.id, client.id, today, s);
  const before = scoresBefore(ctx.db, [client.id], today).get(client.id);
  const series = ctx.db.prepare('SELECT day, health FROM client_scores WHERE client_id=? AND day>? AND day<=? ORDER BY day').all(client.id, addDays(today, -90), today);
  return { health: s.health, score: s.health, band: s.band, trend: before === undefined ? null : s.health - before, factors: s.factors, series };
}

function getTimeline(_req, ctx) {
  const client = ownClient(ctx);
  const before = ctx.query.before ? String(ctx.query.before) : null;
  if (before && Number.isNaN(Date.parse(before))) fail(400, 'before must be an ISO time');
  const limit = Math.max(1, Math.min(100, Number(ctx.query.limit) || 50));
  const kinds = ctx.query.kinds ? new Set(String(ctx.query.kinds).split(',').map(k => k.trim()).filter(Boolean)) : null;
  return timelineOf(ctx.db, ctx.user, client, { before, limit, kinds, now: requestNow(ctx) });
}

function listNotes(_req, ctx) {
  const client = ownClient(ctx);
  return { notes: ctx.db.prepare('SELECT * FROM client_notes WHERE client_id=? ORDER BY pinned DESC, created_at DESC').all(client.id).map(noteOut) };
}

function addNote(_req, ctx) {
  const client = ownClient(ctx);
  const body = str(ctx.body.body, 'body', { max: 4000 });
  const id = newId('nb');
  const at = nowIso();
  ctx.db.prepare('INSERT INTO client_notes (id, coach_id, client_id, body, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, client.id, body, ctx.body.pinned ? 1 : 0, at, at);
  return { note: noteOut(ctx.db.prepare('SELECT * FROM client_notes WHERE id=?').get(id)) };
}

function ownNote(ctx) {
  const client = ownClient(ctx);
  const n = ctx.db.prepare('SELECT * FROM client_notes WHERE id=? AND client_id=?').get(ctx.params.noteId, client.id);
  if (!n) fail(404, 'Not found');
  return n;
}

function editNote(_req, ctx) {
  const n = ownNote(ctx);
  const body = ctx.body.body === undefined ? n.body : str(ctx.body.body, 'body', { max: 4000 });
  if (ctx.body.pinned !== undefined && typeof ctx.body.pinned !== 'boolean') fail(400, 'pinned must be true or false');
  const pinned = ctx.body.pinned === undefined ? n.pinned : ctx.body.pinned ? 1 : 0;
  ctx.db.prepare('UPDATE client_notes SET body=?, pinned=?, updated_at=? WHERE id=?').run(body, pinned, nowIso(), n.id);
  return { note: noteOut(ctx.db.prepare('SELECT * FROM client_notes WHERE id=?').get(n.id)) };
}

function deleteNote(_req, ctx) {
  const n = ownNote(ctx);
  ctx.db.prepare('DELETE FROM client_notes WHERE id=?').run(n.id);
  return { ok: true };
}

function crmClients(_req, ctx) {
  requireCoach(ctx);
  const now = requestNow(ctx);
  const today = londonDay(now);
  const clients = clientsOf(ctx.db, ctx.user.id);
  const ids = clients.map(c => c.id);
  const stages = stagesOf(ctx.db, ctx.user.id, clients, today);
  const scores = currentScores(ctx.db, ctx.user.id, clients, today);
  const active = lastActive(ctx.db, ctx.user.id, clients, now);
  const next = nextSessions(ctx.db, ids, now);
  const tags = new Map();
  for (const r of ctx.db.prepare(`SELECT ct.client_id, t.id, t.name, t.color FROM client_tags ct JOIN tags t ON t.id=ct.tag_id AND t.coach_id=? WHERE ct.client_id IN (${IDS}) ORDER BY t.name`).all(ctx.user.id, JSON.stringify(ids))) {
    tags.set(r.client_id, [...(tags.get(r.client_id) ?? []), { id: r.id, name: r.name, color: r.color }]);
  }
  const factIds = new Set(allFacts().map(f => f.id));
  const extra = ['onboarding.pct', 'billing.balance', 'core.daysQuiet', 'core.unread'].filter(id => factIds.has(id));
  const facts = clientFacts(ctx.db, ctx.user.id, ids, { only: extra, today, now });
  return {
    clients: clients.map(c => {
      const s = scores.get(c.id);
      const st = stages.get(c.id);
      const f = facts.get(c.id) ?? {};
      return {
        id: c.id, name: c.name, initials: initials(c.name), plan: c.plan, planName: planOf(ctx.db, c)?.name ?? c.plan,
        stage: st.stage, manual: !!st.row?.manual, pausedUntil: st.row?.paused_until ?? null, churnSuggested: !!st.row?.churn_suggested_at,
        health: s?.health ?? null, band: s?.band ?? null, trend: s?.trend ?? null,
        lastActiveAt: active.get(c.id) ?? null, nextSessionAt: next.get(c.id) ?? null, tags: tags.get(c.id) ?? [],
        onboardingPct: f['onboarding.pct'] ?? null, balancePence: factIds.has('billing.balance') ? f['billing.balance'] ?? null : undefined,
        daysQuiet: f['core.daysQuiet'] ?? null, unread: f['core.unread'] ?? 0, since: c.created_at,
      };
    }),
  };
}

function stageCounts(_req, ctx) {
  requireCoach(ctx);
  const clients = clientsOf(ctx.db, ctx.user.id);
  const stages = stagesOf(ctx.db, ctx.user.id, clients, todayOf(ctx));
  const counts = Object.fromEntries(STAGES.map(s => [s, 0]));
  for (const { stage } of stages.values()) counts[stage]++;
  return { counts };
}

function getLifecycle(_req, ctx) {
  const client = ownClient(ctx);
  return lifecycleOut(ctx.db, ctx.user.id, client, todayOf(ctx));
}

const BIRTHDAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function putLifecycle(_req, ctx) {
  const client = ownClient(ctx);
  const b = ctx.body;
  const now = requestNow(ctx);
  const today = londonDay(now);
  if (b.stage !== undefined) {
    oneOf(b.stage, 'stage', STAGES);
    if (b.stage === 'churned') fail(400, 'Use End coaching to end someone\'s coaching');
    if (b.stage === 'paused') fail(400, 'Use Pause to pause a membership');
  }
  if (b.manual !== undefined && typeof b.manual !== 'boolean') fail(400, 'manual must be true or false');
  if (b.exitReason !== undefined && b.exitReason !== null) oneOf(b.exitReason, 'exitReason', EXIT_REASONS);
  const exitNote = b.exitNote === undefined ? undefined : b.exitNote === null ? null : str(b.exitNote, 'exitNote', { max: 1000, min: 0 });
  if (b.birthday !== undefined && b.birthday !== null && (typeof b.birthday !== 'string' || !BIRTHDAY.test(b.birthday))) fail(400, 'birthday must be MM-DD');
  tx(ctx.db, () => {
    let row = lifecycleRow(ctx.db, client.id);
    if (!row) {
      // The first write for a client records what the rules say today.
      const st = stagesOf(ctx.db, ctx.user.id, [client], today).get(client.id).stage;
      setStage(ctx.db, ctx.user.id, client, st, { reason: 'First recorded', now });
      row = lifecycleRow(ctx.db, client.id);
    }
    if (b.stage !== undefined) {
      if (row.stage === 'paused') ctx.db.prepare('UPDATE client_lifecycle SET paused_until=NULL, pause_reason=NULL, paused_at=NULL WHERE client_id=?').run(client.id);
      const restart = ENDED.includes(row.stage) && !ENDED.includes(b.stage);
      setStage(ctx.db, ctx.user.id, client, b.stage, { manual: b.manual !== false, reason: restart ? 'Coaching restarted' : 'Set by coach', now,
        extra: b.stage === 'alumni' && !row.ended_at ? { ended_at: now.toISOString() } : {} });
    } else if (b.manual === false && row.manual) {
      ctx.db.prepare('UPDATE client_lifecycle SET manual=0 WHERE client_id=?').run(client.id);
      if (!ENDED.includes(row.stage) && row.stage !== 'paused') syncLifecycle(ctx.db, ctx.user.id, [client], { today, now });
    }
    const extra = {};
    if (b.exitReason !== undefined) extra.exit_reason = b.exitReason;
    if (exitNote !== undefined) extra.exit_note = exitNote;
    if (b.birthday !== undefined) extra.birthday = b.birthday;
    const fields = Object.entries(extra);
    if (fields.length) ctx.db.prepare(`UPDATE client_lifecycle SET ${fields.map(([k]) => `${k}=?`).join(', ')}, updated_at=? WHERE client_id=?`).run(...fields.map(([, v]) => v), now.toISOString(), client.id);
  });
  return lifecycleOut(ctx.db, ctx.user.id, client, today);
}

function pauseRoute(_req, ctx) {
  const client = ownClient(ctx);
  const weeks = num(ctx.body.weeks, 'weeks', { min: 2, max: 12, int: true });
  const reason = ctx.body.reason === undefined || ctx.body.reason === null ? '' : str(ctx.body.reason, 'reason', { max: 200, min: 0 });
  const now = requestNow(ctx);
  tx(ctx.db, () => doPause(ctx.db, ctx.user.id, client, { weeks, reason, now }));
  return { lifecycle: lifecycleOut(ctx.db, ctx.user.id, client, londonDay(now)) };
}

function resumeRoute(_req, ctx) {
  const client = ownClient(ctx);
  const now = requestNow(ctx);
  tx(ctx.db, () => doResume(ctx.db, ctx.user.id, client, { now }));
  return { lifecycle: lifecycleOut(ctx.db, ctx.user.id, client, londonDay(now)) };
}

/** What other features still have going for a client (hooks('offboarding')), merged. */
function offboardingOf(db, coach, client, today) {
  const out = {};
  if (allFacts().some(f => f.id === 'billing.balance')) {
    out.balancePence = clientFacts(db, coach.id, [client.id], { only: ['billing.balance'], today, now: nowFor(today) }).get(client.id)?.['billing.balance'] ?? null;
  }
  for (const [f, fn] of hooks('offboarding')) {
    try {
      const part = fn(db, coach, client) ?? {};
      for (const [k, v] of Object.entries(part)) {
        if (Array.isArray(v) && Array.isArray(out[k])) out[k] = [...out[k], ...v];
        else out[k] = v;
      }
    } catch (e) { console.error(`offboarding hook of ${f.name} failed`, e); }
  }
  return out;
}

function getOffboarding(_req, ctx) {
  const client = ownClient(ctx);
  return offboardingOf(ctx.db, ctx.user, client, todayOf(ctx));
}

function endRoute(_req, ctx) {
  const client = ownClient(ctx);
  const b = ctx.body;
  if (!b.exitReason) fail(400, 'exitReason is required');
  const exitReason = oneOf(b.exitReason, 'exitReason', EXIT_REASONS);
  const exitNote = b.exitNote === undefined || b.exitNote === null ? '' : str(b.exitNote, 'exitNote', { max: 1000, min: 0 });
  const money = oneOf(b.money ?? 'leave', 'money', ['invoice', 'writeOff', 'leave']);
  const packages = oneOf(b.packages ?? 'expire', 'packages', ['expire', 'refund']);
  if (b.keepChasing !== undefined && typeof b.keepChasing !== 'boolean') fail(400, 'keepChasing must be true or false');
  if (b.survey !== undefined && typeof b.survey !== 'boolean') fail(400, 'survey must be true or false');
  const keepChasing = money === 'leave' && !!b.keepChasing;
  const now = requestNow(ctx);
  const at = now.toISOString();
  const row = lifecycleRow(ctx.db, client.id);
  if (row && ENDED.includes(row.stage)) fail(409, 'Coaching has already ended for this client');
  let survey = null;
  tx(ctx.db, () => {
    const to = exitReason === 'goalReached' ? 'alumni' : 'churned';
    setStage(ctx.db, ctx.user.id, client, to, { manual: true, reason: `Ended: ${EXIT_LABEL[exitReason]}`, now, extra: {
      ended_at: at, exit_reason: exitReason, exit_note: exitNote, paused_until: null, pause_reason: null, paused_at: null, churn_suggested_at: null,
    } });
    emit(ctx.db, 'client.offboarded', { coachId: ctx.user.id, clientId: client.id, summary: `Coaching ended · ${EXIT_LABEL[exitReason]}`,
      exitReason, money, keepChasing, packages, at });
    if (b.survey) {
      const formId = exitSurveyForm(ctx.db, ctx.user.id);
      survey = runAction(ctx.db, ctx.config, 'form.send', { coachId: ctx.user.id, client, params: { formId }, now, via: 'coachAction' });
    }
  });
  return { lifecycle: lifecycleOut(ctx.db, ctx.user.id, client, londonDay(now)), survey };
}

function retentionRoute(_req, ctx) {
  requireCoach(ctx);
  return retention(ctx.db, ctx.user, todayOf(ctx));
}

function renewalsRoute(_req, ctx) {
  requireCoach(ctx);
  const days = Math.max(1, Math.min(90, Number(ctx.query.days) || 30));
  return { items: renewals(ctx.db, ctx.user, days, todayOf(ctx)) };
}

function endedRoute(_req, ctx) {
  requireCoach(ctx);
  const months = Math.max(1, Math.min(36, Number(ctx.query.months) || 12));
  const since = londonToUtc(addDays(todayOf(ctx), -Math.round(months * 30.44))).toISOString();
  const rows = ctx.db.prepare(`SELECT u.*, l.ended_at, l.exit_reason, l.exit_note, l.stage FROM client_lifecycle l JOIN users u ON u.id=l.client_id AND u.coach_id=? AND u.role='client'
    WHERE l.stage IN ('churned','alumni') AND l.ended_at IS NOT NULL AND l.ended_at>=? ORDER BY l.ended_at DESC`).all(ctx.user.id, since);
  return { clients: rows.map(r => ({ client: ref(r), endedAt: r.ended_at, exitReason: r.exit_reason, exitLabel: EXIT_LABEL[r.exit_reason] ?? r.exit_reason, exitNote: r.exit_note ?? '', stage: r.stage })) };
}

// MARK: - Demo world (3.10)

const DEMO_EXTRA = [
  { sub: 'demo-crm-hannah', name: 'Hannah Price', plan: 'performance', joinedAgo: 230, endedAgo: 20, endScore: 84, reason: 'goalReached', note: 'Ran her first marathon in 3:58. Wants to go it alone for a while.' },
  { sub: 'demo-crm-marcus', name: 'Marcus Webb', plan: 'foundation', joinedAgo: 150, endedAgo: 45, endScore: 31, reason: 'cost', note: 'New mortgage. Said he would be back in spring.' },
  { sub: 'demo-crm-dan', name: 'Dan Okafor', plan: 'performance', joinedAgo: 125, quietAgo: 34 },
  { sub: 'demo-crm-ellie', name: 'Ellie Brooks', plan: 'foundation', joinedAgo: 160 },
];

const DEMO_NOTES = {
  Sam: [['Left knee: old football injury. Keep split squats under 25 kg until the 1:1 check.', true, 3], ['Works away Tue–Wed most weeks. Never book those mornings.', false, 40], ['Wants to try a powerlifting meet in the spring.', false, 12]],
  Priya: [['Race is in five weeks. Taper from week 4; no new lifts after that.', true, 2], ['Prefers voice notes over text on long runs.', false, 30]],
  Alex: [['Wedding on the 14th, honeymoon after. Paused six weeks; back on the push-pull-legs split.', true, 21], ['Mentioned shoulder clicks on dips. Swap for close-grip bench.', false, 50]],
  Leo: [['Desk job, back flares when he skips mobility. Daily 10 minutes beats a long Sunday session.', true, 6], ['Responds well to a quick call more than messages.', false, 25], ['Missed two check-ins in a row. Ask about work.', false, 9]],
  Rory: [['Half marathon in March. Target 1:38.', true, 15], ['Calf tightness after intervals: foam roll and drop one rep.', false, 5]],
  Tom: [['Started for fat loss after a health scare. Be gentle on scale talk.', true, 18], ['Has not opened the waiver yet. Nudge on Friday.', false, 7]],
  Dan: [['Went quiet after the job change. Last said he was "slammed until Christmas".', true, 30], ['Strong deadlift, poor sleep. Was building nicely before the move.', false, 70]],
  Ellie: [['Shift work: nights every other week. Plan around the off weeks.', true, 33], ['Loves the 20-minute sessions. Build on those.', false, 18]],
  Hannah: [['Marathon done in 3:58. Asked about a maintenance plan she can run herself.', true, 21]],
  Marcus: [['Cost was the reason. Offer a Foundation restart in March.', true, 46]],
};

/** One client's 90 days of scores, shaped by a story and ending at `end` (today's real score). */
function demoSeries(rng, end, story, days = 90) {
  const start = story === 'rising' ? end - 20 : story === 'falling' ? Math.min(92, end + 26) : story === 'dropping' ? Math.min(88, end + 34) : story === 'recovering' ? end : end;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const t = 1 - i / (days - 1);
    let v;
    if (story === 'recovering') v = end - 18 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.25) / 0.45)));
    else if (story === 'dropping') v = t < 0.8 ? start - 4 * t : start - 3.2 - (start - 3.2 - end) * ((t - 0.8) / 0.2);
    else v = start + (end - start) * t;
    v += i === 0 ? 0 : (rng() - 0.5) * 7;
    out.push(Math.max(4, Math.min(98, Math.round(v))));
  }
  return out;
}

function demoBuild(db, ctx) {
  feature.schema(db, {});
  const { coach, today, rng } = ctx;
  const atDay = (d, t = '09:00') => londonToUtc(d, t).toISOString();
  // Wipe this feature's rows for every demo client (the base six and the extras), then the extras themselves:
  // deleting them cascades whatever any feature wrote for them, so nothing of theirs survives a rebuild twice.
  db.prepare(`DELETE FROM client_notes WHERE coach_id=?`).run(coach.id);
  for (const t of ['client_scores', 'client_lifecycle', 'lifecycle_history']) db.prepare(`DELETE FROM ${t} WHERE coach_id=? OR client_id IN (SELECT id FROM users WHERE coach_id=?)`).run(coach.id, coach.id);
  db.prepare("DELETE FROM users WHERE apple_sub LIKE 'demo-crm-%' AND is_demo=1 AND coach_id=?").run(coach.id);
  const extras = {};
  for (const p of DEMO_EXTRA) {
    const id = newId('u');
    db.prepare("INSERT INTO users (id, apple_sub, email, name, role, coach_id, plan, plan_since, is_demo, created_at, onboarded_at) VALUES (?,?,NULL,?,'client',?,?,?,1,?,?)")
      .run(id, p.sub, p.name, coach.id, p.plan, atDay(addDays(today, -p.joinedAgo)), atDay(addDays(today, -p.joinedAgo)), atDay(addDays(today, -p.joinedAgo)));
    db.prepare('INSERT INTO membership_events (user_id, plan, at) VALUES (?,?,?)').run(id, p.plan, atDay(addDays(today, -p.joinedAgo)));
    extras[p.name.split(' ')[0]] = { ...db.prepare('SELECT * FROM users WHERE id=?').get(id), spec: p };
  }
  // A few words from each extra, so their history and quiet days read true.
  const say = (u, from, text, ago, t = '18:20') => db.prepare("INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, via) VALUES (?,?,?,?,?,?,?,?)")
    .run(newId('m'), u.id, from === 'coach' ? coach.id : u.id, from, text, atDay(addDays(today, -ago), t), atDay(addDays(today, -ago), t), from === 'coach' ? 'desk' : 'app');
  say(extras.Dan, 'client', 'Sorry, new job is mental. Will get back on it next week.', 34);
  say(extras.Dan, 'coach', 'No stress Dan. Want me to strip the plan back to two sessions while it settles?', 33, '07:40');
  say(extras.Dan, 'client', 'Deadlift 160 for 3! Best week in ages.', 70);
  say(extras.Ellie, 'client', 'Bit of a rubbish week, will try and get the sessions in at the weekend.', 6);
  say(extras.Ellie, 'coach', 'Two short ones beat one long one, Ellie. Even 20 minutes counts.', 6, '19:40');
  say(extras.Ellie, 'client', 'Did the 20 minute one twice. Felt good!', 19);
  say(extras.Hannah, 'client', '3:58!!! Could not have done it without you.', 24);
  say(extras.Hannah, 'coach', 'All you, Hannah. Proudest Sunday of my year.', 24, '19:02');
  say(extras.Marcus, 'client', 'Going to have to stop for now, money is tight with the move.', 47);
  say(extras.Marcus, 'coach', 'Completely understand. Door is always open.', 46, '08:15');

  const all = [...ctx.clients, ...Object.values(extras)];
  const byFirst = Object.fromEntries(all.map(c => [c.name.split(' ')[0], c]));
  const real = computeScores(db, coach.id, all, today, nowFor(today));
  const STORY = { Sam: 'rising', Priya: 'recovering', Alex: 'steady', Leo: 'dropping', Rory: 'rising', Tom: 'falling', Dan: 'dropping', Ellie: 'falling', Hannah: 'steady', Marcus: 'falling' };
  const insert = db.prepare('INSERT INTO client_scores (client_id, coach_id, day, health, band, factors) VALUES (?,?,?,?,?,?)');
  for (const c of all) {
    const key = c.name.split(' ')[0];
    const live = real.get(c.id);
    const spec = extras[key]?.spec ?? {};
    // An ended client's scores stop the day they left, at the level they left on; a paused one's when the pause began.
    const endedAgo = spec.endedAgo ?? (key === 'Alex' ? 21 : 0);
    const values = demoSeries(rng, spec.endScore ?? live.health, STORY[key] ?? 'steady', 90 - endedAgo);
    values.forEach((v, i) => {
      const d = addDays(today, -(values.length - 1 - i) - endedAgo);
      insert.run(c.id, coach.id, d, v, bandOf(v), JSON.stringify(live.factors));
    });
  }
  // Lifecycle: every client gets a stage that matches its story, with 60 days of history.
  const life = db.prepare(`INSERT INTO client_lifecycle (client_id, coach_id, stage, since, manual, paused_until, pause_reason, paused_at, exit_reason, exit_note, ended_at, birthday, churn_suggested_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const hist = db.prepare('INSERT INTO lifecycle_history (client_id, coach_id, stage, at, reason) VALUES (?,?,?,?,?)');
  const story = (name, steps, row = {}) => {
    const c = byFirst[name];
    if (!c) return;
    for (const [stage, ago, reason] of steps) hist.run(c.id, coach.id, stage, atDay(addDays(today, -ago), '05:10'), reason);
    const [stage, ago] = steps.at(-1);
    life.run(c.id, coach.id, stage, atDay(addDays(today, -ago), '05:10'), row.manual ? 1 : 0, row.pausedUntil ?? null, row.pauseReason ?? null, row.pausedAt ?? null,
      row.exitReason ?? null, row.exitNote ?? null, row.endedAt ?? null, row.birthday ?? null, row.churnAt ?? null, atDay(today, '05:10'));
  };
  const mmdd = ago => addDays(today, ago).slice(5);
  story('Sam', [['onboarding', 112, 'Joined'], ['active', 98, 'Onboarding complete']], { birthday: mmdd(19) });
  story('Priya', [['active', 84, 'Onboarding complete'], ['atRisk', 52, 'Quiet 11 days'], ['active', 38, 'Back training: race block']], { birthday: mmdd(3) });
  story('Alex', [['active', 70, 'Onboarding complete'], ['paused', 21, 'Paused: wedding and honeymoon']],
    { pausedUntil: addDays(today, 21), pauseReason: 'Wedding and honeymoon', pausedAt: atDay(addDays(today, -21), '10:30'), birthday: mmdd(64) });
  story('Leo', [['active', 50, 'Onboarding complete'], ['atRisk', 9, 'Health 28']]);
  story('Rory', [['onboarding', 42, 'Joined']], { birthday: mmdd(41) });
  story('Tom', [['onboarding', 21, 'Joined']]);
  story('Dan', [['active', 110, 'Onboarding complete'], ['atRisk', 24, 'Quiet 10 days']], { churnAt: atDay(addDays(today, -4), '05:10') });
  story('Ellie', [['active', 150, 'Onboarding complete']], { birthday: mmdd(0) });
  story('Hannah', [['active', 200, 'Onboarding complete'], ['alumni', 20, 'Ended: Goal reached']],
    { manual: true, exitReason: 'goalReached', exitNote: 'Marathon done. Maintenance plan sent.', endedAt: atDay(addDays(today, -20), '16:00') });
  story('Marcus', [['active', 130, 'Onboarding complete'], ['atRisk', 60, 'Quiet 12 days'], ['churned', 45, 'Ended: Cost']],
    { manual: true, exitReason: 'cost', exitNote: 'Mortgage. Offer a Foundation restart in March.', endedAt: atDay(addDays(today, -45), '11:00') });
  // Notes: two or three per client.
  const note = db.prepare('INSERT INTO client_notes (id, coach_id, client_id, body, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?)');
  for (const [name, list] of Object.entries(DEMO_NOTES)) {
    const c = byFirst[name];
    if (!c) continue;
    for (const [body, pinned, ago] of list) note.run(newId('nb'), coach.id, c.id, body, pinned ? 1 : 0, atDay(addDays(today, -ago), '20:15'), atDay(addDays(today, -ago), '20:15'));
  }
  // Tags and segments (foundation tables; the demo wipe empties them first).
  const tag = (name, color) => {
    const id = newId('tg');
    db.prepare('INSERT INTO tags (id, coach_id, name, color, created_at) VALUES (?,?,?,?,?)').run(id, coach.id, name, color, atDay(addDays(today, -90)));
    return id;
  };
  const tagged = (tagId, names) => { for (const n of names) if (byFirst[n]) db.prepare('INSERT OR IGNORE INTO client_tags (client_id, tag_id, added_at, added_by) VALUES (?,?,?,?)').run(byFirst[n].id, tagId, atDay(addDays(today, -60)), 'coach'); };
  tagged(tag('Morning crew', 'chart-1'), ['Sam', 'Priya', 'Rory']);
  tagged(tag('Marathon 2027', 'chart-3'), ['Priya', 'Rory', 'Hannah']);
  tagged(tag('Returning from injury', 'chart-5'), ['Leo', 'Tom']);
  tagged(tag('VIP', 'chart-4'), ['Sam', 'Priya']);
  const segment = (name, description, rules, pinned) => db.prepare('INSERT INTO segments (id, coach_id, name, description, rules, pinned, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(newId('sg'), coach.id, name, description, JSON.stringify(rules), pinned ? 1 : 0, atDay(addDays(today, -40)), atDay(addDays(today, -5)));
  segment('Quiet 5+ days', 'Anyone who has gone quiet for five days or more.', { match: 'all', rules: [{ fact: 'core.daysQuiet', op: 'gte', value: 5 }] }, true);
  segment('Performance & Elite', 'Everyone on the two top plans.', { match: 'all', rules: [{ fact: 'core.plan', op: 'in', value: ['performance', 'elite'] }] }, false);
  segment('Upgrade candidates', 'Foundation or Performance clients with adherence 80%+ and health 75+.', { match: 'all', rules: [
    { fact: 'core.plan', op: 'in', value: ['foundation', 'performance'] }, { fact: 'core.adherence28', op: 'gte', value: 80 }, { fact: 'crm.health', op: 'gte', value: 75 }] }, false);
}

// MARK: - The feature

export const feature = {
  name: 'crm',
  namespaces: ['crm', 'lifecycle'],
  exact: ['client.stageChanged', 'client.paused', 'client.resumed', 'client.offboarded'],

  schema(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS client_scores (
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL, health INTEGER NOT NULL, band TEXT NOT NULL, factors TEXT NOT NULL,
        PRIMARY KEY (client_id, day));
      CREATE INDEX IF NOT EXISTS client_scores_coach_day ON client_scores(coach_id, day);
      CREATE TABLE IF NOT EXISTS client_notes (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS client_notes_client ON client_notes(client_id, created_at);
      CREATE TABLE IF NOT EXISTS client_lifecycle (
        client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stage TEXT NOT NULL CHECK (stage IN ('onboarding','active','atRisk','paused','churned','alumni')),
        since TEXT NOT NULL, manual INTEGER NOT NULL DEFAULT 0,
        paused_until TEXT, pause_reason TEXT, paused_at TEXT,
        exit_reason TEXT, exit_note TEXT, ended_at TEXT,
        birthday TEXT, churn_suggested_at TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lifecycle_history (
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stage TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS lifecycle_history_coach ON lifecycle_history(coach_id, at);
      CREATE INDEX IF NOT EXISTS lifecycle_history_client ON lifecycle_history(client_id, at);`);
  },

  routes(r) {
    r.add('GET', '/api/crm/clients', crmClients);
    r.add('GET', '/api/crm/stages', stageCounts);
    r.add('GET', '/api/coach/clients/:id/score', getScore);
    r.add('GET', '/api/coach/clients/:id/timeline', getTimeline);
    r.add('GET', '/api/coach/clients/:id/notes', listNotes);
    r.add('POST', '/api/coach/clients/:id/notes', addNote);
    r.add('PATCH', '/api/coach/clients/:id/notes/:noteId', editNote);
    r.add('DELETE', '/api/coach/clients/:id/notes/:noteId', deleteNote);
    r.add('GET', '/api/coach/clients/:id/lifecycle', getLifecycle);
    r.add('PUT', '/api/coach/clients/:id/lifecycle', putLifecycle);
    r.add('POST', '/api/coach/clients/:id/pause', pauseRoute);
    r.add('POST', '/api/coach/clients/:id/resume', resumeRoute);
    r.add('GET', '/api/coach/clients/:id/offboarding', getOffboarding);
    r.add('POST', '/api/coach/clients/:id/end', endRoute);
    r.add('GET', '/api/retention', retentionRoute);
    r.add('GET', '/api/retention/renewals', renewalsRoute);
    r.add('GET', '/api/retention/ended', endedRoute);
  },

  clocks: [{ id: 'crm.resume', everyMs: 10 * 60_000, run: (db, _config, now) => resumeDue(db, now) }],

  on: {
    'day.started': (db, _config, e) => { if (e.coachId) nightly(db, e.coachId, e.payload.day ?? londonDay(new Date(e.at))); },
    // Completing the checklist moves Onboarding → Active at once (F7, F27).
    'onboarding.completed': (db, _config, e) => {
      const client = e.clientId && db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.clientId, e.coachId);
      if (!client) return;
      const row = lifecycleRow(db, client.id);
      if (row && (row.manual || row.stage !== 'onboarding')) return;
      syncLifecycle(db, e.coachId, [client], { today: londonDay(new Date(e.at)), now: new Date(e.at) });
    },
  },

  emits: {
    'crm.bandChanged': { label: 'Health band changed', payload: ['from', 'to', 'health'] },
    'client.stageChanged': { label: 'Lifecycle stage changed', payload: ['from', 'to', 'manual'] },
    'client.paused': { label: 'Membership paused', payload: ['until', 'reason', 'days'] },
    'client.resumed': { label: 'Membership resumed', payload: ['pausedDays'] },
    'client.offboarded': { label: 'Coaching ended', payload: ['exitReason', 'money', 'keepChasing', 'packages', 'at'] },
  },

  actions: {
    'lifecycle.set': {
      label: 'Set the lifecycle stage', clientFacing: false,
      params: [{ key: 'stage', label: 'Stage', type: 'enum', required: true, options: ['onboarding', 'active', 'atRisk', 'alumni'].map(s => ({ value: s, label: STAGE_LABEL[s] })) }],
      run(db, _config, ctx) {
        const stage = ctx.params.stage;
        if (stage === 'churned') fail(400, 'Use End coaching to end someone\'s coaching');
        if (!['onboarding', 'active', 'atRisk', 'alumni'].includes(stage)) fail(400, 'stage is not one an automation may set');
        const row = lifecycleRow(db, ctx.client.id);
        if (row && ENDED.includes(row.stage)) return 'Skipped: coaching has ended';
        if (row?.stage === 'paused') return 'Skipped: paused';
        return setStage(db, ctx.coachId, ctx.client, stage, { manual: true, reason: 'Set by an automation', now: ctx.now }) ? `Stage: ${STAGE_LABEL[stage]}` : 'Already there';
      },
    },
    'lifecycle.pause': {
      label: 'Pause the membership', clientFacing: false,
      params: [{ key: 'weeks', label: 'Weeks (2–12)', type: 'number', required: true, default: 4 }, { key: 'reason', label: 'Reason', type: 'text' }],
      run(db, _config, ctx) {
        const weeks = Math.round(Number(ctx.params.weeks));
        if (!(weeks >= 2 && weeks <= 12)) fail(400, 'weeks must be 2 to 12');
        const row = lifecycleRow(db, ctx.client.id);
        if (row && ENDED.includes(row.stage)) return 'Skipped: coaching has ended';
        const until = doPause(db, ctx.coachId, ctx.client, { weeks, reason: ctx.params.reason ?? '', now: ctx.now });
        return `Paused until ${until}`;
      },
    },
  },

  facts: {
    'crm.health': { label: 'Health score', type: 'number', compute: (db, coachId, ids, today) => factScores(db, coachId, ids, today, s => s.health) },
    'crm.band': {
      label: 'Health band', type: 'enum', options: Object.entries(BAND_LABEL).map(([value, label]) => ({ value, label })),
      compute: (db, coachId, ids, today) => factScores(db, coachId, ids, today, s => s.band),
    },
    'crm.trend': { label: 'Health trend (14 days)', type: 'number', compute: (db, coachId, ids, today) => factScores(db, coachId, ids, today, s => s.trend) },
    'crm.stage': {
      label: 'Lifecycle stage', type: 'enum', options: STAGES.map(s => ({ value: s, label: STAGE_LABEL[s] })),
      compute(db, coachId, ids, today) {
        const clients = rowsOf(db, coachId, ids);
        return new Map([...stagesOf(db, coachId, clients, today)].map(([id, s]) => [id, s.stage]));
      },
    },
    'crm.daysInStage': {
      label: 'Days in stage', type: 'days',
      compute(db, coachId, ids, today) {
        const out = new Map();
        for (const c of rowsOf(db, coachId, ids)) {
          const row = lifecycleRow(db, c.id);
          out.set(c.id, Math.max(0, daysBetween(dayOf(row?.since ?? c.created_at), today)));
        }
        return out;
      },
    },
    'crm.birthdayInDays': {
      label: 'Days to birthday', type: 'days',
      compute(db, coachId, ids, today) {
        const out = new Map();
        for (const c of rowsOf(db, coachId, ids)) {
          const b = lifecycleRow(db, c.id)?.birthday;
          out.set(c.id, b ? daysBetween(today, nextBirthday(b, today)) : null);
        }
        return out;
      },
    },
    'crm.daysSinceEnded': {
      label: 'Days since coaching ended', type: 'days',
      compute(db, coachId, ids, today) {
        const out = new Map();
        for (const c of rowsOf(db, coachId, ids)) {
          const row = lifecycleRow(db, c.id);
          out.set(c.id, row?.ended_at && ENDED.includes(row.stage) ? Math.max(0, daysBetween(dayOf(row.ended_at), today)) : null);
        }
        return out;
      },
    },
  },

  variables: {
    birthdayDay: {
      label: 'Next birthday ("Fri 12 Dec")',
      value(db, _coachId, client) {
        const b = lifecycleRow(db, client.id)?.birthday;
        return b ? fmtDay(nextBirthday(b, londonDay())) : null;
      },
    },
  },

  needs(db, coach, clients, today) {
    const out = [];
    const rows = new Map(db.prepare(`SELECT * FROM client_lifecycle WHERE client_id IN (${IDS})`).all(JSON.stringify(clients.map(c => c.id))).map(r => [r.client_id, r]));
    for (const c of clients) {
      const row = rows.get(c.id);
      if (row && ['paused', ...ENDED].includes(row.stage)) continue;
      const cid = encodeURIComponent(c.id);
      if (row?.churn_suggested_at) {
        out.push({ clientId: c.id, kind: 'churnSuggested', rank: 6, iconKey: 'heart_broken', at: row.churn_suggested_at,
          text: `Looks like ${first(c.name)} has stopped: ${churnWhy(db, coach.id, c, today)}. End coaching or check in?`,
          action: { label: 'Review', path: '/retention' } });
        continue;
      }
      const drop = intoAtRisk(db, c.id, today);
      if (drop) out.push({ clientId: c.id, kind: 'atRisk', rank: 6, iconKey: 'monitor_heart', at: londonToUtc(drop.day, '05:00').toISOString(),
        text: `Health dropped to ${drop.health} (At risk)`, action: { label: 'Check in', path: `/messages/${cid}` } });
    }
    return out;
  },

  diary(db, coach, day) {
    const out = [];
    const clients = clientsOf(db, coach.id);
    const rows = new Map(db.prepare(`SELECT client_id, birthday, stage FROM client_lifecycle WHERE coach_id=? OR client_id IN (${IDS})`).all(coach.id, JSON.stringify(clients.map(c => c.id))).map(r => [r.client_id, r]));
    for (const c of clients) {
      const row = rows.get(c.id);
      if (row && ENDED.includes(row.stage)) continue;
      const cid = encodeURIComponent(c.id);
      if (row?.birthday && nextBirthday(row.birthday, day) === day) {
        out.push({ at: null, day, kind: 'birthday', icon: 'cake', title: `${first(c.name)}'s birthday`, detail: 'Send a note', path: `/messages/${cid}`, tone: 'ok' });
      }
      const joined = dayOf(c.created_at);
      if (joined && joined.slice(5) === day.slice(5) && joined < day) {
        const years = Number(day.slice(0, 4)) - Number(joined.slice(0, 4));
        out.push({ at: null, day, kind: 'anniversary', icon: 'celebration', title: `${plural(years, 'year')} with ${first(c.name)}`, detail: 'Coaching anniversary', path: `/clients/${cid}`, tone: 'ok' });
      }
    }
    return out;
  },

  badges(db, coach) {
    const n = db.prepare(`SELECT COUNT(*) n FROM client_lifecycle l JOIN users u ON u.id=l.client_id AND u.coach_id=? WHERE l.churn_suggested_at IS NOT NULL AND l.stage NOT IN ('paused','churned','alumni')`).get(coach.id).n;
    return n ? { retention: n } : {};
  },

  exportFor(db, user) {
    if (user.role !== 'client') return {};
    const row = lifecycleRow(db, user.id);
    return {
      notes: db.prepare('SELECT * FROM client_notes WHERE client_id=? ORDER BY created_at').all(user.id).map(noteOut),
      scores: db.prepare('SELECT day, health, band FROM client_scores WHERE client_id=? ORDER BY day').all(user.id),
      lifecycle: row ? { stage: row.stage, since: row.since, pausedUntil: row.paused_until, pauseReason: row.pause_reason, exitReason: row.exit_reason,
        exitNote: row.exit_note, endedAt: row.ended_at, birthday: row.birthday } : null,
      lifecycleHistory: db.prepare('SELECT stage, at, reason FROM lifecycle_history WHERE client_id=? ORDER BY at').all(user.id),
    };
  },

  demo: { build: demoBuild },
};

const rowsOf = (db, coachId, ids) => (ids.length ? db.prepare(`SELECT * FROM users WHERE role='client' AND coach_id=? AND id IN (${IDS})`).all(coachId, JSON.stringify(ids)) : []);

function factScores(db, coachId, ids, today, pick) {
  const scores = currentScores(db, coachId, rowsOf(db, coachId, ids), today);
  return new Map([...scores].map(([id, s]) => [id, pick(s)]));
}

/** Exposed for tests only (never import a feature file from another feature). */
export const _test = { nightly, resumeDue, computeScores, syncLifecycle, retention, renewals };
