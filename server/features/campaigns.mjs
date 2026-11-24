import { createHash, timingSafeEqual } from 'node:crypto';
import { clientFor, initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { ownClients, resolveAudience } from '../facts.mjs';
import { clock, day as dayParam, fail, num, oneOf, raw, str } from '../http.mjs';
import { attachableMedia } from '../media.mjs';
import { sendMessage } from '../messages.mjs';
import { limit } from '../ratelimit.mjs';
import { likeAny, matchScore } from '../search.mjs';
import { newId, nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonClock, londonDay } from '../time.mjs';
import { layProgram } from '../training.mjs';
// Same package (WP4): the spec has campaigns use guidebook's validateBlocks; the plan page shares its renderer and link key.
import {
  blockMediaIds, blocksHtml, buildDemoGuides, esc, guideMedia, markOpened, planCsrf, publishedGuide, signPlan, streamMedia, validateBlocks, verifyPlan,
} from './guidebook.mjs';

/**
 * F13 Bespoke campaigns (docs/design/desk-v2.md, WP4): time-bound programmes
 * with phases, dated activities, guides, a kit list with expected spend and an
 * optional fee. Clients are INVITED (they see dates, fee and spend first) and
 * accept in the app or on the public plan page; only acceptance emits
 * campaign.enrolled (billing raises the fee invoice from it). A 5-minute clock
 * sends one governed nudge a day, expires invitations, completes or drops
 * enrolments at the end, and flags clients falling behind.
 *
 * Isolation: every read of client-linked rows joins the client's CURRENT
 * coach (users.coach_id = campaigns.coach_id), so a reassigned client leaves
 * the old coach's boards, nudges and lists.
 */

export const KINDS = ['task', 'workout', 'habit', 'checkin', 'read', 'purchase', 'session', 'measure', 'custom'];
const COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
const STATUSES = ['draft', 'live', 'ended', 'archived'];
const OPEN = ['invited', 'waitlisted', 'active', 'paused'];
const PLACE_TAKERS = ['active', 'paused', 'completed'];
const DEFAULT_SETTINGS = { dailyNudge: true, nudgeAt: '07:00', showRank: false };
const RESPOND_DAYS = 14;
const GRACE_DAYS = 7;
const BEHIND = 0.7;

const configs = new WeakMap(); // db -> config: the {planLink} variable has no config argument
const remember = (db, config) => { if (config) configs.set(db, config); };

const json = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };
const settingsOf = c => ({ ...DEFAULT_SETTINGS, ...json(c.settings, {}) });
const first = name => String(name ?? '').trim().split(/\s+/)[0] || 'there';
const who = u => ({ id: u.id, name: u.name, initials: initials(u.name) });
const fmtDay = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
const money = p => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const baseUrl = config => String(config?.publicUrl || '').replace(/\/+$/, '');

/** The public plan page link for one enrolment (a fresh 45-day token). */
export const planLink = (config, enrolmentId, now = new Date()) => `${baseUrl(config)}/plan/${signPlan(config, enrolmentId, now)}`;

// MARK: - Reading

const campaignRow = (db, id) => db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
const phasesOf = (db, cid) => db.prepare('SELECT * FROM campaign_phases WHERE campaign_id=? ORDER BY start_day, position').all(cid);
const activitiesOf = (db, cid, { archived = false } = {}) => db.prepare(`SELECT * FROM campaign_activities WHERE campaign_id=? ${archived ? '' : 'AND archived=0'} ORDER BY day, position`).all(cid);
const kitOf = (db, cid, { archived = false } = {}) => db.prepare(`SELECT * FROM campaign_kit WHERE campaign_id=? ${archived ? '' : 'AND archived=0'} ORDER BY position`).all(cid);
const progressOf = (db, eid) => new Map(db.prepare('SELECT * FROM campaign_progress WHERE enrolment_id=?').all(eid).map(p => [p.item_id, p]));

/** Enrolments of a campaign whose client is still this campaign's coach's client. */
const enrolmentsOf = (db, c, statuses = null) => db.prepare(`SELECT e.* FROM campaign_enrolments e JOIN users u ON u.id=e.client_id AND u.coach_id=?
  WHERE e.campaign_id=? ${statuses ? `AND e.status IN (${statuses.map(() => '?').join(',')})` : ''} ORDER BY e.invited_at`).all(c.coach_id, c.id, ...(statuses ?? []));

const takenPlaces = (db, c) => db.prepare(`SELECT COUNT(*) n FROM campaign_enrolments WHERE campaign_id=? AND status IN ('active','paused','completed')`).get(c.id).n;
const placesLeft = (db, c) => (c.capacity ? Math.max(0, c.capacity - takenPlaces(db, c)) : null);

function kitTotals(kit) {
  const requiredPence = kit.filter(k => k.required).reduce((s, k) => s + k.est_pence, 0);
  const optionalPence = kit.filter(k => !k.required).reduce((s, k) => s + k.est_pence, 0);
  return { requiredPence, optionalPence };
}
/** Expected spend for one client: required kit plus purchase activities (a purchase that buys a kit item is counted once). */
function expectedSpend(kit, acts) {
  const kitIds = new Set(kit.map(k => k.id));
  return kitTotals(kit).requiredPence + acts.filter(a => a.kind === 'purchase' && !(a.link_ref && kitIds.has(a.link_ref))).reduce((s, a) => s + a.spend_pence, 0);
}

/** The last day of an enrolment (inclusive), paused days added. */
const lastDay = (e, c) => (e.start_on ? addDays(e.start_on, c.length_days - 1 + e.paused_days) : null);
/** The fixed campaign's own end day. */
const campaignEnd = c => (c.starts_on ? addDays(c.starts_on, c.length_days - 1) : null);
/** Day index (0-based) an enrolment is on; frozen while paused. */
function dayIndex(e, c, today) {
  if (!e.start_on) return -1;
  if (e.status === 'completed') return c.length_days - 1;
  const eff = e.status === 'paused' && e.paused_at ? londonDay(new Date(e.paused_at)) : today;
  return Math.min(daysBetween(e.start_on, eff) - e.paused_days, c.length_days + GRACE_DAYS);
}
const activityDate = (e, a) => (e.start_on ? addDays(e.start_on, a.day + e.paused_days) : null);
/** A late joiner of a fixed campaign is not held to the days before they joined. */
const joinOffset = (e, c) => (c.start_mode === 'fixed' && e.enrolled_at && e.start_on ? Math.max(0, daysBetween(e.start_on, londonDay(new Date(e.enrolled_at)))) : 0);

/** Progress numbers for one enrolment. */
function statsOf(e, c, acts, done, today, phases = []) {
  const idx = dayIndex(e, c, today);
  const from = joinOffset(e, c);
  const due = acts.filter(a => a.required && a.day <= idx && a.day >= from);
  const dueDone = due.filter(a => done.has(a.id)).length;
  const pace = due.length ? dueDone / due.length : 1;
  const finished = acts.filter(a => done.has(a.id)).length;
  const points = e.points ?? 0; // recomputed on every tick and untick (recomputePoints)
  const cells = phases.map(ph => {
    const inPhase = acts.filter(a => a.phase_id === ph.id);
    const dueIn = inPhase.filter(a => a.day <= idx);
    return { phaseId: ph.id, pct: pct(inPhase.filter(a => done.has(a.id)).length, inPhase.length), duePct: pct(dueIn.filter(a => done.has(a.id)).length, dueIn.length), due: dueIn.length };
  });
  return {
    idx, day: Math.max(0, Math.min(idx + 1, c.length_days)), pct: pct(finished, acts.length), pace: Math.round(pace * 100),
    behind: e.status === 'active' && due.length >= 2 && pace < BEHIND, points, due: due.length, dueDone, cells,
  };
}

function respondBy(e, c) {
  const invited = londonDay(new Date(e.invited_at));
  const by = addDays(invited, RESPOND_DAYS);
  if (c.start_mode === 'fixed' && c.starts_on && c.starts_on > invited && c.starts_on < by) return c.starts_on;
  return by;
}

// MARK: - Output shapes

const mediaUrl = id => (id ? `/api/media/${id}` : null);

export function campaignOut(c) {
  return {
    id: c.id, name: c.name, tagline: c.tagline, description: c.description, coverMediaId: c.cover_media_id, coverUrl: mediaUrl(c.cover_media_id),
    status: c.status, startMode: c.start_mode, startsOn: c.starts_on, endsOn: c.start_mode === 'fixed' ? campaignEnd(c) : null, lengthDays: c.length_days,
    feePence: c.fee_pence, capacity: c.capacity, waitlist: !!c.waitlist, public: !!c.public, challengeId: c.challenge_id, settings: settingsOf(c),
    welcomeText: c.welcome_text, completionText: c.completion_text, createdAt: c.created_at, updatedAt: c.updated_at,
  };
}
const phaseOut = p => ({ id: p.id, name: p.name, startDay: p.start_day, endDay: p.end_day, color: p.color, guideId: p.guide_id, summary: p.summary, position: p.position });
const activityOut = a => ({
  id: a.id, phaseId: a.phase_id, day: a.day, title: a.title, kind: a.kind, detail: a.detail, guideId: a.guide_id, blocks: a.blocks ? json(a.blocks, null) : null,
  linkRef: a.link_ref, points: a.points, required: !!a.required, spendPence: a.spend_pence, position: a.position,
});
const kitOut = k => ({ id: k.id, name: k.name, estPence: k.est_pence, required: !!k.required, url: k.url, note: k.note, position: k.position });

function designOut(db, c) {
  return { campaign: campaignOut(c), phases: phasesOf(db, c.id).map(phaseOut), activities: activitiesOf(db, c.id).map(activityOut), kit: kitOf(db, c.id).map(kitOut) };
}

/** A coach-facing enrolment row with progress and spend. */
function enrolmentOut(db, e, c, today, { acts = activitiesOf(db, c.id), kit = kitOf(db, c.id), phases = [] } = {}) {
  const done = progressOf(db, e.id);
  const s = statsOf(e, c, acts, done, today, phases);
  const spent = [...done.values()].reduce((t, p) => t + (p.spent_pence ?? 0), 0);
  return {
    id: e.id, campaignId: c.id, clientId: e.client_id, status: e.status, startOn: e.start_on, endsOn: lastDay(e, c), day: s.day, lengthDays: c.length_days,
    pct: s.pct, pace: s.pace, behind: s.behind, behindSince: e.behind_since, points: s.points, cells: s.cells,
    feePence: e.fee_pence, discountCode: e.discount_code, discountPence: e.discount_pence, invoiceWanted: !!e.invoice_wanted, acceptedVia: e.accepted_via,
    invitedAt: e.invited_at, respondBy: ['invited', 'waitlisted'].includes(e.status) ? respondBy(e, c) : null, respondedAt: e.responded_at,
    enrolledAt: e.enrolled_at, completedAt: e.completed_at, droppedAt: e.dropped_at, pausedDays: e.paused_days, note: e.note,
    spentPence: spent, expectedSpendPence: expectedSpend(kit, acts),
  };
}

/** What a client sees of an activity. */
function clientActivity(db, coachId, e, a, done) {
  let guide = null;
  if (a.guide_id) {
    const g = publishedGuide(db, coachId, a.guide_id);
    if (g) guide = { id: g.id, title: g.title };
  } else if (a.blocks) {
    const blocks = json(a.blocks, []);
    if (blocks.length) guide = { blocks: blocks.map(b => (b.mediaId ? { ...b, url: mediaUrl(b.mediaId) } : b)) };
  }
  const p = done.get(a.id);
  return {
    id: a.id, day: a.day, date: activityDate(e, a), title: a.title, kind: a.kind, detail: a.detail, points: a.points, required: !!a.required,
    spendPence: a.spend_pence, guide, done: !!p, doneAt: p?.done_at ?? null, ...(p?.spent_pence !== null && p?.spent_pence !== undefined ? { spentPence: p.spent_pence } : {}),
  };
}

/** invitationOut (docs/api/wp4-campaigns.md). */
function invitationOut(db, e, c) {
  const kit = kitOf(db, c.id);
  const t = kitTotals(kit);
  const acts = activitiesOf(db, c.id);
  return {
    enrolmentId: e.id, status: e.status,
    campaign: { id: c.id, name: c.name, tagline: c.tagline, description: c.description, coverUrl: mediaUrl(c.cover_media_id), startMode: c.start_mode,
      startsOn: c.start_mode === 'fixed' ? c.starts_on : e.start_on, endsOn: c.start_mode === 'fixed' ? campaignEnd(c) : (e.start_on ? addDays(e.start_on, c.length_days - 1) : null), lengthDays: c.length_days },
    feePence: e.fee_pence, discountPence: e.discount_pence, discountCode: e.discount_code,
    kit: { required: kit.filter(k => k.required).map(k => ({ name: k.name, estPence: k.est_pence })), optional: kit.filter(k => !k.required).map(k => ({ name: k.name, estPence: k.est_pence })),
      requiredPence: t.requiredPence, optionalPence: t.optionalPence },
    expectedSpendPence: expectedSpend(kit, acts), placesLeft: placesLeft(db, c), respondBy: respondBy(e, c), welcomeText: c.welcome_text,
  };
}

function rankOf(db, c, e, today) {
  const others = enrolmentsOf(db, c, PLACE_TAKERS);
  const acts = activitiesOf(db, c.id);
  const scores = others.map(o => ({ id: o.id, points: statsOf(o, c, acts, progressOf(db, o.id), today).points })).sort((a, b) => b.points - a.points);
  const i = scores.findIndex(s => s.id === e.id);
  return i < 0 ? null : { position: i + 1, of: scores.length };
}

/** The client's own view of one enrolment (list entry). */
function clientEnrolmentOut(db, config, e, c, today, now) {
  const acts = activitiesOf(db, c.id);
  const done = progressOf(db, e.id);
  const s = statsOf(e, c, acts, done, today);
  return {
    id: e.id, status: e.status, campaign: { id: c.id, name: c.name, tagline: c.tagline, coverUrl: mediaUrl(c.cover_media_id) },
    day: s.day, lengthDays: c.length_days, startOn: e.start_on, endsOn: lastDay(e, c), pct: s.pct, points: s.points,
    today: acts.filter(a => a.day === s.idx).map(a => clientActivity(db, c.coach_id, e, a, done)),
    next: acts.filter(a => a.day > s.idx).slice(0, 3).map(a => clientActivity(db, c.coach_id, e, a, done)),
    ...(settingsOf(c).showRank ? { rank: rankOf(db, c, e, today) } : {}),
    planUrl: planLink(config, e.id, now),
  };
}

// MARK: - Messages

/** The invitation: dates, fee after any discount, required kit with spend, optional kit total, the plan link. */
export function invitationText(db, config, c, e, client, now = new Date()) {
  const kit = kitOf(db, c.id);
  const t = kitTotals(kit);
  const acts = activitiesOf(db, c.id);
  const weeks = c.length_days % 7 === 0 ? `${c.length_days / 7} weeks` : `${c.length_days} days`;
  const dates = c.start_mode === 'fixed' && c.starts_on
    ? `${fmtDay(c.starts_on)} to ${fmtDay(campaignEnd(c))} (${weeks})`
    : e.start_on ? `${fmtDay(e.start_on)} to ${fmtDay(addDays(e.start_on, c.length_days - 1))} (${weeks})` : `${weeks}, starting the day you accept`;
  const net = Math.max(0, e.fee_pence - (e.discount_pence ?? 0));
  const fee = !e.fee_pence ? 'Fee: none' : e.discount_pence ? `Fee: ${money(net)} (${money(e.fee_pence)} less ${e.discount_code || 'your discount'})`
    : `Fee: ${money(e.fee_pence)}${e.discount_code ? ` (code ${e.discount_code} applied on the invoice)` : ''}`;
  const req = kit.filter(k => k.required);
  const purchases = acts.filter(a => a.kind === 'purchase' && a.spend_pence && !kit.some(k => k.id === a.link_ref));
  const lines = [
    `${first(client.name)}, you're invited to ${c.name}${c.tagline ? `: ${c.tagline}` : ''}.`,
    `Dates: ${dates}.`,
    `${fee}.`,
    // Kit and spend lines only when there is kit or something to buy.
    req.length ? `Required kit: ${req.map(k => `${k.name} ${money(k.est_pence)}`).join(', ')} (${money(t.requiredPence)}).` : kit.length ? 'Required kit: none.' : null,
    t.optionalPence ? `Optional kit: ${money(t.optionalPence)} in total.` : null,
    expectedSpend(kit, acts) ? `Expected spend: ${money(expectedSpend(kit, acts))}${purchases.length ? ' including planned purchases' : ''}${e.fee_pence ? ', plus the fee' : ''}.` : null,
  ].filter(Boolean);
  const left = placesLeft(db, c);
  if (left !== null) {
    const pending = db.prepare("SELECT COUNT(*) n FROM campaign_enrolments WHERE campaign_id=? AND status='invited'").get(c.id).n;
    if (pending > left || left <= 3) lines.push(`Places are limited${left ? ` (${left} left)` : ''}.`);
  }
  lines.push(`Accept or decline in the app, or here: ${planLink(config, e.id, now)}`);
  return lines.join('\n');
}

/** Send (or resend) one invitation as a coach action. Returns the sendMessage result. */
function sendInvitation(db, config, c, e, now, via = 'coachAction') {
  const client = db.prepare('SELECT * FROM users WHERE id=?').get(e.client_id);
  return sendMessage(db, config, { coachId: c.coach_id, clientId: e.client_id, text: invitationText(db, config, c, e, client, now), via, now });
}

// MARK: - State changes (each inside the caller's tx)

const evt = (db, type, c, e, summary, extra = {}) => emit(db, type, { coachId: c.coach_id, clientId: e.client_id, summary: summary.slice(0, 200), enrolmentId: e.id, campaignId: c.id, ...extra });
const reload = (db, id) => db.prepare('SELECT * FROM campaign_enrolments WHERE id=?').get(id);

/** Lay the linked programs of workout activities (unpublished drafts) from the enrolment's start. */
function layLinkedPrograms(db, c, e) {
  const seen = new Set();
  let n = 0;
  for (const a of activitiesOf(db, c.id).filter(x => x.kind === 'workout' && x.link_ref)) {
    if (seen.has(a.link_ref)) continue;
    seen.add(a.link_ref);
    const program = db.prepare('SELECT * FROM programs WHERE id=? AND coach_id=?').get(a.link_ref, c.coach_id);
    if (program) n += layProgram(db, program, e.client_id, activityDate(e, a), c.coach_id, { publish: false });
  }
  return n;
}

/**
 * Accept an invitation (app, plan page, or the coach's "Agreed in person").
 * Capacity is re-checked here, inside the transaction: a full campaign
 * waitlists (waitlist on) or answers 409. Only acceptance emits
 * campaign.enrolled, with the fee: billing raises the invoice from it.
 */
export function acceptEnrolment(db, config, c, e, { via, startOn = null, now = new Date() }) {
  return tx(db, () => {
    e = reload(db, e.id);
    if (!['invited', 'waitlisted'].includes(e.status)) fail(409, 'This invitation has already been answered');
    if (c.status !== 'live') fail(409, 'This campaign is not running');
    const today = londonDay(now);
    if (c.capacity && takenPlaces(db, c) >= c.capacity) {
      if (!c.waitlist) fail(409, 'This campaign is full');
      if (e.status !== 'waitlisted') {
        db.prepare("UPDATE campaign_enrolments SET status='waitlisted', responded_at=? WHERE id=?").run(now.toISOString(), e.id);
        evt(db, 'campaign.waitlisted', c, e, `Waitlisted for ${c.name}`);
      }
      return reload(db, e.id);
    }
    const start = c.start_mode === 'fixed' ? c.starts_on : (startOn ?? e.start_on ?? today);
    db.prepare("UPDATE campaign_enrolments SET status='active', start_on=?, enrolled_at=?, responded_at=?, accepted_via=? WHERE id=?")
      .run(start, now.toISOString(), now.toISOString(), via, e.id);
    const row = reload(db, e.id);
    if (row.lay_program) layLinkedPrograms(db, c, row);
    const invoice = row.fee_pence > 0 && !!row.invoice_wanted;
    evt(db, 'campaign.enrolled', c, row, `Joined ${c.name}`, { feePence: row.fee_pence, invoice, campaignName: c.name, startOn: start, via,
      ...(row.discount_code ? { discountCode: row.discount_code } : {}), ...(row.discount_pence ? { discountPence: row.discount_pence } : {}) });
    return row;
  });
}

export function declineEnrolment(db, c, e, { now = new Date(), note = null, config = null } = {}) {
  return tx(db, () => {
    e = reload(db, e.id);
    if (!['invited', 'waitlisted'].includes(e.status)) fail(409, 'This invitation has already been answered');
    db.prepare("UPDATE campaign_enrolments SET status='declined', responded_at=?, note=COALESCE(?, note) WHERE id=?").run(now.toISOString(), note, e.id);
    evt(db, 'campaign.declined', c, e, `Declined ${c.name}`, note ? { reason: note } : {});
    // A freed place someone turned down goes to the next on the waitlist.
    if (config && e.status === 'invited') offerFreedPlace(db, config, c, now);
    return reload(db, e.id);
  });
}

/** A place came free: the oldest waitlisted client is offered it by a new invitation. */
function offerFreedPlace(db, config, c, now) {
  if (!c.capacity || !c.waitlist || c.status !== 'live') return null;
  const free = c.capacity - takenPlaces(db, c);
  if (free <= 0) return null;
  // One outstanding offer per free place: a decline or expiry re-offers it, never doubles it.
  if (db.prepare("SELECT COUNT(*) n FROM campaign_enrolments WHERE campaign_id=? AND status='invited' AND note='A place came free'").get(c.id).n >= free) return null;
  const next = enrolmentsOf(db, c, ['waitlisted']).sort((a, b) => (a.responded_at ?? a.invited_at).localeCompare(b.responded_at ?? b.invited_at))[0];
  if (!next) return null;
  db.prepare("UPDATE campaign_enrolments SET status='invited', invited_at=?, responded_at=NULL, note='A place came free' WHERE id=?").run(now.toISOString(), next.id);
  const row = reload(db, next.id);
  try { sendInvitation(db, config, c, row, now); } catch (err) { if (err.status !== 404) throw err; }
  evt(db, 'campaign.invited', c, row, `Offered a freed place in ${c.name}`, { fromWaitlist: true });
  return row;
}

/** Drop an enrolment (withdrawn by the coach, end of coaching, or the grace ran out). */
function dropEnrolment(db, config, c, e, { now = new Date(), note = null } = {}) {
  const wasPlace = PLACE_TAKERS.includes(e.status);
  db.prepare("UPDATE campaign_enrolments SET status='dropped', dropped_at=?, note=COALESCE(?, note) WHERE id=?").run(now.toISOString(), note, e.id);
  evt(db, 'campaign.dropped', c, e, `Left ${c.name}`, note ? { reason: note } : {});
  if (wasPlace) offerFreedPlace(db, config, c, now);
}

function complete(db, config, c, e, now) {
  db.prepare("UPDATE campaign_enrolments SET status='completed', completed_at=?, behind_since=NULL WHERE id=? AND status='active'").run(now.toISOString(), e.id);
  evt(db, 'campaign.completed', c, e, `Completed ${c.name}`);
  if (c.completion_text.trim()) {
    try { sendMessage(db, config, { coachId: c.coach_id, clientId: e.client_id, text: c.completion_text, via: 'campaign', now }); } catch (err) { if (err.status !== 404) throw err; }
  }
}

/** Points are recomputed on each tick or untick. */
function recomputePoints(db, eid) {
  const points = db.prepare(`SELECT COALESCE(SUM(a.points), 0) n FROM campaign_progress p JOIN campaign_activities a ON a.id=p.item_id WHERE p.enrolment_id=?`).get(eid).n;
  db.prepare('UPDATE campaign_enrolments SET points=? WHERE id=?').run(points, eid);
  return points;
}

// MARK: - The clock: expiries, completion, behind, daily nudges

/**
 * One sweep for every coach (or one coach). Idempotent: status moves are
 * guarded by their WHERE clauses, nudges by the campaign_nudges key (a
 * deferred or skipped nudge is still recorded, so it is never sent twice).
 */
export function sweep(db, config, now = new Date(), { coachId = null } = {}) {
  remember(db, config);
  const today = londonDay(now);
  const out = { expired: 0, completed: 0, dropped: 0, behind: 0, nudged: 0 };
  const campaigns = db.prepare(`SELECT * FROM campaigns WHERE status IN ('live','ended') ${coachId ? 'AND coach_id=?' : ''}`).all(...(coachId ? [coachId] : []));
  for (const c of campaigns) {
    try {
      tx(db, () => {
        const acts = activitiesOf(db, c.id);
        for (const e of enrolmentsOf(db, c, ['invited'])) {
          if (respondBy(e, c) < today) {
            db.prepare("UPDATE campaign_enrolments SET status='declined', responded_at=?, note='Invitation expired' WHERE id=? AND status='invited'").run(now.toISOString(), e.id);
            evt(db, 'campaign.declined', c, e, `Invitation to ${c.name} expired`, { reason: 'expired' });
            out.expired++;
            offerFreedPlace(db, config, c, now);
          }
        }
        for (const e of enrolmentsOf(db, c, ['active'])) {
          const done = progressOf(db, e.id);
          const end = addDays(e.start_on, c.length_days + e.paused_days); // the day after the last day
          if (today >= end) {
            const allDone = acts.filter(a => a.required && a.day >= joinOffset(e, c)).every(a => done.has(a.id));
            if (allDone) { complete(db, config, c, e, now); out.completed++; continue; }
            if (today >= addDays(end, GRACE_DAYS)) { dropEnrolment(db, config, c, e, { now, note: 'Grace period ended' }); out.dropped++; continue; }
          }
          const s = statsOf(e, c, acts, done, today);
          if (s.behind && !e.behind_since) {
            db.prepare('UPDATE campaign_enrolments SET behind_since=? WHERE id=?').run(today, e.id);
            evt(db, 'campaign.behind', c, e, `Behind on ${c.name} (pace ${s.pace}%)`, { pace: s.pace });
            out.behind++;
          } else if (!s.behind && e.behind_since) db.prepare('UPDATE campaign_enrolments SET behind_since=NULL WHERE id=?').run(e.id);
        }
      });
    } catch (err) { console.error(`Campaign sweep ${c.id} failed`, err); }
    if (c.status === 'live' && settingsOf(c).dailyNudge && londonClock(now) >= settingsOf(c).nudgeAt) out.nudged += nudgeCampaign(db, config, c, now);
  }
  return out;
}

/** Today's nudge for each active enrolment with something due today: once per day, through the outreach governor. */
function nudgeCampaign(db, config, c, now) {
  const today = londonDay(now);
  const acts = activitiesOf(db, c.id);
  let n = 0;
  for (const e of enrolmentsOf(db, c, ['active'])) {
    const idx = dayIndex(e, c, today);
    if (idx < 0 || idx >= c.length_days) continue;
    const todays = acts.filter(a => a.day === idx);
    if (!todays.length) continue;
    try {
      tx(db, () => {
        if (!db.prepare('INSERT OR IGNORE INTO campaign_nudges (enrolment_id, day) VALUES (?, ?)').run(e.id, today).changes) return;
        const text = `Day ${idx + 1} of ${c.name}: ${todays.map(a => a.title).join(', ')}. Today's plan: ${planLink(config, e.id, now)}`;
        let r;
        try { r = sendMessage(db, config, { coachId: c.coach_id, clientId: e.client_id, text, via: 'campaign', now }); } catch (err) { if (err.status !== 404) throw err; r = { skipped: 'client moved' }; }
        if (r.message) db.prepare('UPDATE campaign_nudges SET message_id=? WHERE enrolment_id=? AND day=?').run(r.message.id, e.id, today);
        evt(db, 'campaign.activityDue', c, e, `Day ${idx + 1} of ${c.name}`, { day: idx + 1, count: todays.length, ...(r.deferredUntil ? { deferredUntil: r.deferredUntil } : {}), ...(r.skipped ? { skipped: r.skipped } : {}) });
        n++;
      });
    } catch (err) { console.error(`Campaign nudge ${e.id} failed`, err); }
  }
  return n;
}

// MARK: - Event handlers (client.paused / resumed / offboarded come from crm, WP2)

function openEnrolmentsOfClient(db, coachId, clientId, statuses) {
  return db.prepare(`SELECT e.* FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id WHERE e.client_id=? AND c.coach_id=? AND e.status IN (${statuses.map(() => '?').join(',')})`)
    .all(clientId, coachId, ...statuses);
}

function onPaused(db, _config, ev) {
  if (!ev.clientId || !ev.coachId) return;
  for (const e of openEnrolmentsOfClient(db, ev.coachId, ev.clientId, ['active'])) {
    db.prepare("UPDATE campaign_enrolments SET status='paused', paused_at=?, behind_since=NULL WHERE id=? AND status='active'").run(ev.at, e.id);
  }
}

function onResumed(db, _config, ev) {
  if (!ev.clientId || !ev.coachId) return;
  for (const e of openEnrolmentsOfClient(db, ev.coachId, ev.clientId, ['paused'])) {
    const given = Number(ev.payload?.pausedDays);
    const days = Number.isInteger(given) && given >= 0 && given <= 366 ? given : Math.max(0, daysBetween(londonDay(new Date(e.paused_at ?? ev.at)), londonDay(new Date(ev.at))));
    db.prepare("UPDATE campaign_enrolments SET status='active', paused_days=paused_days+?, paused_at=NULL WHERE id=? AND status='paused'").run(days, e.id);
  }
}

function onOffboarded(db, config, ev) {
  if (!ev.clientId || !ev.coachId) return;
  const now = new Date(ev.at);
  for (const e of openEnrolmentsOfClient(db, ev.coachId, ev.clientId, OPEN)) {
    const c = campaignRow(db, e.campaign_id);
    dropEnrolment(db, config, c, e, { now, note: 'Coaching ended' });
  }
}

// MARK: - Coach routes

const ownCampaign = ctx => { requireCoach(ctx); remember(ctx.db, ctx.config); return ownRow(ctx, 'campaigns', ctx.params.id); };

function ownEnrolment(ctx, c) {
  const e = ctx.db.prepare('SELECT e.* FROM campaign_enrolments e JOIN users u ON u.id=e.client_id AND u.coach_id=? WHERE e.id=? AND e.campaign_id=?').get(ctx.user.id, ctx.params.eid, c.id);
  if (!e) fail(404, 'Not found');
  return e;
}

function summaryOut(db, c, today) {
  const enrolled = enrolmentsOf(db, c, ['active', 'paused', 'completed']);
  const invited = enrolmentsOf(db, c, ['invited', 'waitlisted']);
  const acts = activitiesOf(db, c.id);
  const kit = kitOf(db, c.id);
  const stats = enrolled.map(e => statsOf(e, c, acts, progressOf(db, e.id), today));
  const users = new Map(db.prepare(`SELECT u.id, u.name FROM users u WHERE u.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(enrolled.map(e => e.client_id))).map(u => [u.id, u]));
  return {
    ...campaignOut(c), enrolled: enrolled.length, invited: invited.length, placesLeft: placesLeft(db, c),
    avgProgress: stats.length ? Math.round(stats.reduce((s, x) => s + x.pct, 0) / stats.length) : 0,
    behind: stats.filter(s => s.behind).length, activityCount: acts.length, phaseCount: db.prepare('SELECT COUNT(*) n FROM campaign_phases WHERE campaign_id=?').get(c.id).n,
    expectedSpendPence: expectedSpend(kit, acts), requiredKitPence: kitTotals(kit).requiredPence,
    people: enrolled.map(e => users.get(e.client_id)).filter(Boolean).map(who),
    today: c.status === 'live' && c.start_mode === 'fixed' && c.starts_on ? Math.max(0, Math.min(c.length_days, daysBetween(c.starts_on, today) + 1)) : null,
  };
}

function listCampaigns(_req, ctx) {
  requireCoach(ctx);
  remember(ctx.db, ctx.config);
  const today = londonDay(requestNow(ctx));
  const status = ctx.query.status ? oneOf(ctx.query.status, 'status', STATUSES) : null;
  const rows = ctx.db.prepare(`SELECT * FROM campaigns WHERE coach_id=? ${status ? 'AND status=?' : "AND status<>'archived'"} ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END, updated_at DESC`)
    .all(ctx.user.id, ...(status ? [status] : []));
  return { campaigns: rows.map(c => summaryOut(ctx.db, c, today)) };
}

// Templates: phases and activities a new campaign starts with.
const W = (n, d) => n * 7 + d;
function templateOf(name) {
  const act = (day, title, kind, extra = {}) => ({ day, title, kind, points: 10, required: true, spendPence: 0, detail: '', ...extra });
  if (name === 'challenge6') {
    const acts = [act(0, 'Starting measurements', 'measure', { detail: 'Weight, waist and a photo in the same light.' })];
    for (let w = 0; w < 6; w++) {
      acts.push(act(W(w, 0), `Strength A · week ${w + 1}`, 'workout'), act(W(w, 2), `Conditioning · week ${w + 1}`, 'workout'),
        act(W(w, 4), `Strength B · week ${w + 1}`, 'workout'), act(W(w, 6), 'Weekly check-in', 'checkin', { points: 5 }));
    }
    acts.push(act(41, 'Finishing measurements', 'measure', { points: 20 }));
    return { lengthDays: 42, phases: [['Foundation', 0, 13, 'chart-2'], ['Build', 14, 27, 'chart-1'], ['Finish', 28, 41, 'chart-5']], activities: acts, kit: [] };
  }
  if (name === 'event12') {
    const acts = [];
    for (let w = 0; w < 12; w++) {
      const long = Math.min(32, 10 + w * 2 - (w >= 10 ? (w - 9) * 8 : 0));
      acts.push(act(W(w, 1), 'Easy run 6 km', 'workout'), act(W(w, 3), w < 9 ? 'Intervals 6 × 800 m' : 'Race-pace 5 km', 'workout'),
        act(W(w, 5), `Long run ${long} km`, 'workout', { points: 20 }), act(W(w, 6), 'Weekly check-in', 'checkin', { points: 5 }));
    }
    return { lengthDays: 84, phases: [['Base', 0, 20, 'chart-2'], ['Build', 21, 48, 'chart-1'], ['Peak', 49, 69, 'chart-5'], ['Taper', 70, 83, 'chart-3']], activities: acts,
      kit: [{ name: 'Running shoes', estPence: 12000, required: true }, { name: 'Energy gels (box of 12)', estPence: 2500, required: true }, { name: 'Running belt', estPence: 1500, required: false }] };
  }
  if (name === 'reset30') {
    const acts = [act(0, 'Read: how the reset works', 'read')];
    for (let d = 0; d < 30; d++) acts.push(act(d, '10-minute walk after a meal', 'habit', { points: 5, detail: 'Any meal. Phone in your pocket.' }));
    for (let w = 0; w < 4; w++) acts.push(act(Math.min(29, W(w, 6)), 'Weekly check-in', 'checkin'));
    return { lengthDays: 30, phases: [['Reset', 0, 9, 'chart-3'], ['Rebuild', 10, 19, 'chart-2'], ['Lock it in', 20, 29, 'chart-1']], activities: acts, kit: [] };
  }
  return { lengthDays: 28, phases: [['Phase 1', 0, 27, 'chart-1']], activities: [], kit: [] };
}

/** Write a campaign's phases, activities and kit from a template-like spec (new rows only). */
function writeContent(db, cid, spec, { guides = {} } = {}) {
  const phaseIds = spec.phases.map(([name, startDay, endDay, color, guide, summary], i) => {
    const id = newId('cph');
    db.prepare('INSERT INTO campaign_phases (id, campaign_id, name, start_day, end_day, color, guide_id, summary, position) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, cid, name, startDay, endDay, color, guide ? guides[guide] ?? null : null, summary ?? '', i);
    return { id, startDay, endDay };
  });
  const kitIds = spec.kit.map((k, i) => {
    const id = newId('ck');
    db.prepare('INSERT INTO campaign_kit (id, campaign_id, name, est_pence, required, url, note, position) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, cid, k.name, k.estPence, k.required ? 1 : 0, k.url ?? null, k.note ?? '', i);
    return id;
  });
  const actIds = spec.activities.sort((a, b) => a.day - b.day).map((a, i) => {
    const id = newId('ca');
    const phase = phaseIds.find(p => a.day >= p.startDay && a.day <= p.endDay);
    db.prepare(`INSERT INTO campaign_activities (id, campaign_id, phase_id, day, title, kind, detail, guide_id, blocks, link_ref, points, required, spend_pence, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, cid, phase?.id ?? null, a.day, a.title, a.kind, a.detail ?? '', a.guide ? guides[a.guide] ?? null : null,
      a.blocks ? JSON.stringify(a.blocks) : null, a.kitIndex !== undefined ? kitIds[a.kitIndex] : a.linkRef ?? null, a.points ?? 10, a.required === false ? 0 : 1, a.spendPence ?? 0, i);
    return id;
  });
  return { phaseIds: phaseIds.map(p => p.id), kitIds, actIds };
}

function createCampaign(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const name = str(b.name, 'name', { max: 80 });
  const template = b.template === undefined ? 'blank' : oneOf(b.template, 'template', ['blank', 'challenge6', 'event12', 'reset30']);
  const spec = templateOf(template);
  const id = newId('cg');
  const now = nowIso();
  tx(ctx.db, () => {
    ctx.db.prepare(`INSERT INTO campaigns (id, coach_id, name, tagline, start_mode, length_days, settings, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, ctx.user.id, name, str(b.tagline ?? '', 'tagline', { max: 140, min: 0 }), template === 'reset30' ? 'rolling' : 'fixed', spec.lengthDays, JSON.stringify(DEFAULT_SETTINGS), now, now);
    writeContent(ctx.db, id, spec);
  });
  return { campaign: campaignOut(campaignRow(ctx.db, id)) };
}

const getCampaign = (_req, ctx) => designOut(ctx.db, ownCampaign(ctx));

const bool = (v, name) => { if (typeof v !== 'boolean') fail(400, `${name} must be true or false`); return v; };
const intIn = (v, name, min, max) => num(v, name, { min, max, int: true });
const optId = (v, name) => (v === undefined || v === null || v === '' ? null : str(v, name, { max: 60 }));

/** PUT /api/campaigns/:id: the whole design document, in one transaction; rows keep their ids. */
function saveCampaign(_req, ctx) {
  const c = ownCampaign(ctx);
  const db = ctx.db;
  const doc = ctx.body;
  const b = doc.campaign ?? {};
  const has = k => Object.hasOwn(b, k);
  const next = {
    name: has('name') ? str(b.name, 'campaign.name', { max: 80 }) : c.name,
    tagline: has('tagline') ? str(b.tagline ?? '', 'campaign.tagline', { max: 140, min: 0 }) : c.tagline,
    description: has('description') ? str(b.description ?? '', 'campaign.description', { max: 2000, min: 0 }) : c.description,
    cover_media_id: has('coverMediaId') ? optId(b.coverMediaId, 'campaign.coverMediaId') : c.cover_media_id,
    start_mode: has('startMode') ? oneOf(b.startMode, 'campaign.startMode', ['fixed', 'rolling']) : c.start_mode,
    starts_on: has('startsOn') ? dayParam(b.startsOn, 'campaign.startsOn', { optional: true }) : c.starts_on,
    length_days: has('lengthDays') ? intIn(b.lengthDays, 'campaign.lengthDays', 1, 366) : c.length_days,
    fee_pence: has('feePence') ? intIn(b.feePence, 'campaign.feePence', 0, 10_000_000) : c.fee_pence,
    capacity: has('capacity') ? (b.capacity === null ? null : intIn(b.capacity, 'campaign.capacity', 1, 1000)) : c.capacity,
    waitlist: has('waitlist') ? (bool(b.waitlist, 'campaign.waitlist') ? 1 : 0) : c.waitlist,
    public: has('public') ? (bool(b.public, 'campaign.public') ? 1 : 0) : c.public,
    challenge_id: has('challengeId') ? optId(b.challengeId, 'campaign.challengeId') : c.challenge_id,
    welcome_text: has('welcomeText') ? str(b.welcomeText ?? '', 'campaign.welcomeText', { max: 1000, min: 0 }) : c.welcome_text,
    completion_text: has('completionText') ? str(b.completionText ?? '', 'campaign.completionText', { max: 1000, min: 0 }) : c.completion_text,
    settings: settingsOf(c),
  };
  if (has('settings')) {
    const s = b.settings ?? {};
    if (typeof s !== 'object' || Array.isArray(s)) fail(400, 'campaign.settings must be an object');
    if (s.dailyNudge !== undefined) next.settings.dailyNudge = bool(s.dailyNudge, 'campaign.settings.dailyNudge');
    if (s.nudgeAt !== undefined) next.settings.nudgeAt = clock(s.nudgeAt, 'campaign.settings.nudgeAt');
    if (s.showRank !== undefined) next.settings.showRank = bool(s.showRank, 'campaign.settings.showRank');
  }
  if (next.cover_media_id && !db.prepare("SELECT 1 FROM media WHERE id=? AND owner_id=? AND client_id IS NULL AND kind='image'").get(next.cover_media_id, ctx.user.id)) fail(400, 'campaign.coverMediaId is not one of your images');
  if (next.challenge_id && !db.prepare('SELECT 1 FROM challenges WHERE id=? AND coach_id=?').get(next.challenge_id, ctx.user.id)) fail(400, 'campaign.challengeId is not one of your challenges');
  if (next.start_mode === 'fixed' && c.status === 'live' && !next.starts_on) fail(400, 'campaign.startsOn is required for fixed dates');
  const L = next.length_days;
  const guideOk = id => db.prepare('SELECT 1 FROM coach_guides WHERE id=? AND coach_id=?').get(id, ctx.user.id);

  // Phases
  const oldPhases = new Map(phasesOf(db, c.id).map(p => [p.id, p]));
  const phases = doc.phases === undefined ? null : (() => {
    if (!Array.isArray(doc.phases) || doc.phases.length > 12) fail(400, 'phases must be a list of up to 12');
    return doc.phases.map((p, i) => {
      const at = `phases[${i}]`;
      if (!p || typeof p !== 'object') fail(400, `${at} must be an object`);
      if (p.id !== undefined && p.id !== null && !oldPhases.has(p.id)) fail(400, `${at}.id is not in this campaign`);
      const startDay = intIn(p.startDay, `${at}.startDay`, 0, L - 1), endDay = intIn(p.endDay, `${at}.endDay`, 0, L - 1);
      if (endDay < startDay) fail(400, `${at}.endDay is before its startDay`);
      const guideId = optId(p.guideId, `${at}.guideId`);
      if (guideId && !guideOk(guideId)) fail(400, `${at}.guideId is not one of your guides`);
      return { id: p.id ?? null, key: typeof p.key === 'string' ? p.key.slice(0, 40) : null, name: str(p.name, `${at}.name`, { max: 60 }), startDay, endDay,
        color: p.color === undefined ? 'chart-1' : oneOf(p.color, `${at}.color`, COLORS), guideId, summary: str(p.summary ?? '', `${at}.summary`, { max: 300, min: 0 }) };
    });
  })();
  // Kit
  const oldKit = new Map(kitOf(db, c.id, { archived: true }).map(k => [k.id, k]));
  const kit = doc.kit === undefined ? null : (() => {
    if (!Array.isArray(doc.kit) || doc.kit.length > 40) fail(400, 'kit must be a list of up to 40');
    return doc.kit.map((k, i) => {
      const at = `kit[${i}]`;
      if (!k || typeof k !== 'object') fail(400, `${at} must be an object`);
      if (k.id !== undefined && k.id !== null && !oldKit.has(k.id)) fail(400, `${at}.id is not in this campaign`);
      let url = null;
      if (k.url) {
        try { const u = new URL(String(k.url).trim()); if (u.protocol !== 'https:') throw new Error(); url = u.toString(); } catch { fail(400, `${at}.url must be an https link`); }
        if (url.length > 500) fail(400, `${at}.url is too long`);
      }
      return { id: k.id ?? null, key: typeof k.key === 'string' ? k.key.slice(0, 40) : null, name: str(k.name, `${at}.name`, { max: 80 }), estPence: intIn(k.estPence ?? 0, `${at}.estPence`, 0, 10_000_000),
        required: k.required === undefined ? false : bool(k.required, `${at}.required`), url, note: str(k.note ?? '', `${at}.note`, { max: 300, min: 0 }) };
    });
  })();
  // Activities
  const oldActs = new Map(activitiesOf(db, c.id, { archived: true }).map(a => [a.id, a]));
  const phaseKeys = new Set((phases ?? [...oldPhases.values()].map(p => ({ id: p.id }))).flatMap(p => [p.id, p.key].filter(Boolean)));
  const kitKeys = new Set((kit ?? [...oldKit.values()].map(k => ({ id: k.id }))).flatMap(k => [k.id, k.key].filter(Boolean)));
  const acts = doc.activities === undefined ? null : (() => {
    if (!Array.isArray(doc.activities) || doc.activities.length > 400) fail(400, 'activities must be a list of up to 400');
    return doc.activities.map((a, i) => {
      const at = `activities[${i}]`;
      if (!a || typeof a !== 'object') fail(400, `${at} must be an object`);
      if (a.id !== undefined && a.id !== null && !oldActs.has(a.id)) fail(400, `${at}.id is not in this campaign`);
      const phaseId = optId(a.phaseId, `${at}.phaseId`);
      if (phaseId && !phaseKeys.has(phaseId)) fail(400, `${at}.phaseId is not a phase of this campaign`);
      const guideId = optId(a.guideId, `${at}.guideId`);
      if (guideId && !guideOk(guideId)) fail(400, `${at}.guideId is not one of your guides`);
      let linkRef = optId(a.linkRef, `${at}.linkRef`);
      if (linkRef && /^p_/.test(linkRef) && !db.prepare('SELECT 1 FROM programs WHERE id=? AND coach_id=?').get(linkRef, ctx.user.id)) fail(400, `${at}.linkRef is not one of your programs`);
      if (linkRef && /^ck_/.test(linkRef) && !kitKeys.has(linkRef)) fail(400, `${at}.linkRef is not kit of this campaign`);
      const blocks = a.blocks === undefined || a.blocks === null ? null : validateBlocks(a.blocks, { db, coachId: ctx.user.id, name: `${at}.blocks` });
      return { id: a.id ?? null, phaseId, day: intIn(a.day, `${at}.day`, 0, L - 1), title: str(a.title, `${at}.title`, { max: 120 }), kind: oneOf(a.kind ?? 'task', `${at}.kind`, KINDS),
        detail: str(a.detail ?? '', `${at}.detail`, { max: 1000, min: 0 }), guideId, blocks: blocks?.length ? blocks : null, linkRef: linkRef ?? null,
        points: intIn(a.points ?? 10, `${at}.points`, 0, 1000), required: a.required === undefined ? true : bool(a.required, `${at}.required`),
        spendPence: intIn(a.spendPence ?? 0, `${at}.spendPence`, 0, 10_000_000) };
    });
  })();

  tx(db, () => {
    db.prepare(`UPDATE campaigns SET name=?, tagline=?, description=?, cover_media_id=?, start_mode=?, starts_on=?, length_days=?, fee_pence=?, capacity=?, waitlist=?,
      public=?, challenge_id=?, settings=?, welcome_text=?, completion_text=?, updated_at=? WHERE id=? AND coach_id=?`)
      .run(next.name, next.tagline, next.description, next.cover_media_id, next.start_mode, next.starts_on, L, next.fee_pence, next.capacity, next.waitlist,
        next.public, next.challenge_id, JSON.stringify(next.settings), next.welcome_text, next.completion_text, nowIso(), c.id, ctx.user.id);
    const keyToId = new Map();
    if (phases) {
      const keep = new Set(phases.map(p => p.id).filter(Boolean));
      for (const id of oldPhases.keys()) if (!keep.has(id)) db.prepare('DELETE FROM campaign_phases WHERE id=?').run(id);
      phases.forEach((p, i) => {
        const id = p.id ?? newId('cph');
        if (p.key) keyToId.set(p.key, id);
        if (p.id) db.prepare('UPDATE campaign_phases SET name=?, start_day=?, end_day=?, color=?, guide_id=?, summary=?, position=? WHERE id=?').run(p.name, p.startDay, p.endDay, p.color, p.guideId, p.summary, i, id);
        else db.prepare('INSERT INTO campaign_phases (id, campaign_id, name, start_day, end_day, color, guide_id, summary, position) VALUES (?,?,?,?,?,?,?,?,?)').run(id, c.id, p.name, p.startDay, p.endDay, p.color, p.guideId, p.summary, i);
      });
    }
    if (kit) {
      const keep = new Set(kit.map(k => k.id).filter(Boolean));
      for (const id of oldKit.keys()) {
        if (keep.has(id)) continue;
        const used = db.prepare('SELECT 1 FROM campaign_progress WHERE item_id=? LIMIT 1').get(id);
        if (used) db.prepare('UPDATE campaign_kit SET archived=1 WHERE id=?').run(id);
        else db.prepare('DELETE FROM campaign_kit WHERE id=?').run(id);
      }
      kit.forEach((k, i) => {
        const id = k.id ?? newId('ck');
        if (k.key) keyToId.set(k.key, id);
        if (k.id) db.prepare('UPDATE campaign_kit SET name=?, est_pence=?, required=?, url=?, note=?, position=?, archived=0 WHERE id=?').run(k.name, k.estPence, k.required ? 1 : 0, k.url, k.note, i, id);
        else db.prepare('INSERT INTO campaign_kit (id, campaign_id, name, est_pence, required, url, note, position) VALUES (?,?,?,?,?,?,?,?)').run(id, c.id, k.name, k.estPence, k.required ? 1 : 0, k.url, k.note, i);
      });
    }
    if (acts) {
      const keep = new Set(acts.map(a => a.id).filter(Boolean));
      for (const id of oldActs.keys()) {
        if (keep.has(id)) continue;
        // Removing an activity that has progress archives it; one without progress is deleted.
        const used = db.prepare('SELECT 1 FROM campaign_progress WHERE item_id=? LIMIT 1').get(id);
        if (used) db.prepare('UPDATE campaign_activities SET archived=1 WHERE id=?').run(id);
        else db.prepare('DELETE FROM campaign_activities WHERE id=?').run(id);
      }
      acts.forEach((a, i) => {
        const id = a.id ?? newId('ca');
        const phaseId = a.phaseId ? keyToId.get(a.phaseId) ?? a.phaseId : null;
        const linkRef = a.linkRef ? keyToId.get(a.linkRef) ?? a.linkRef : null;
        const vals = [phaseId, a.day, a.title, a.kind, a.detail, a.guideId, a.blocks ? JSON.stringify(a.blocks) : null, linkRef, a.points, a.required ? 1 : 0, a.spendPence, i];
        if (a.id) db.prepare('UPDATE campaign_activities SET phase_id=?, day=?, title=?, kind=?, detail=?, guide_id=?, blocks=?, link_ref=?, points=?, required=?, spend_pence=?, position=?, archived=0 WHERE id=?').run(...vals, id);
        else db.prepare(`INSERT INTO campaign_activities (phase_id, day, title, kind, detail, guide_id, blocks, link_ref, points, required, spend_pence, position, id, campaign_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...vals, id, c.id);
      });
      for (const e of enrolmentsOf(db, c)) recomputePoints(db, e.id);
    }
  });
  return designOut(db, campaignRow(db, c.id));
}

function setStatus(_req, ctx) {
  const c = ownCampaign(ctx);
  const status = oneOf(ctx.body.status, 'status', STATUSES);
  if (status === 'live') {
    if (!ctx.db.prepare('SELECT 1 FROM campaign_activities WHERE campaign_id=? AND archived=0').get(c.id)) fail(409, 'Add at least one activity before going live');
    if (c.start_mode === 'fixed' && !c.starts_on) fail(409, 'Set the start date before going live');
  }
  ctx.db.prepare('UPDATE campaigns SET status=?, updated_at=? WHERE id=?').run(status, nowIso(), c.id);
  return { campaign: campaignOut(campaignRow(ctx.db, c.id)) };
}

function duplicate(_req, ctx) {
  const c = ownCampaign(ctx);
  const db = ctx.db;
  const id = newId('cg');
  const now = nowIso();
  tx(db, () => {
    db.prepare(`INSERT INTO campaigns (id, coach_id, name, tagline, description, cover_media_id, status, start_mode, starts_on, length_days, fee_pence, capacity, waitlist, public,
      challenge_id, settings, welcome_text, completion_text, created_at, updated_at) VALUES (?,?,?,?,?,?,'draft',?,NULL,?,?,?,?,0,?,?,?,?,?,?)`)
      .run(id, ctx.user.id, `${c.name} (copy)`.slice(0, 80), c.tagline, c.description, c.cover_media_id, c.start_mode, c.length_days, c.fee_pence, c.capacity, c.waitlist,
        c.challenge_id, c.settings, c.welcome_text, c.completion_text, now, now);
    const map = new Map();
    for (const p of phasesOf(db, c.id)) {
      const pid = newId('cph');
      map.set(p.id, pid);
      db.prepare('INSERT INTO campaign_phases (id, campaign_id, name, start_day, end_day, color, guide_id, summary, position) VALUES (?,?,?,?,?,?,?,?,?)').run(pid, id, p.name, p.start_day, p.end_day, p.color, p.guide_id, p.summary, p.position);
    }
    for (const k of kitOf(db, c.id)) {
      const kid = newId('ck');
      map.set(k.id, kid);
      db.prepare('INSERT INTO campaign_kit (id, campaign_id, name, est_pence, required, url, note, position) VALUES (?,?,?,?,?,?,?,?)').run(kid, id, k.name, k.est_pence, k.required, k.url, k.note, k.position);
    }
    for (const a of activitiesOf(db, c.id)) {
      db.prepare(`INSERT INTO campaign_activities (id, campaign_id, phase_id, day, title, kind, detail, guide_id, blocks, link_ref, points, required, spend_pence, position)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId('ca'), id, map.get(a.phase_id) ?? null, a.day, a.title, a.kind, a.detail, a.guide_id, a.blocks, map.get(a.link_ref) ?? a.link_ref, a.points, a.required, a.spend_pence, a.position);
    }
  });
  return { campaign: campaignOut(campaignRow(db, id)) };
}

function deleteCampaign(_req, ctx) {
  const c = ownCampaign(ctx);
  const any = ctx.db.prepare('SELECT 1 FROM campaign_enrolments WHERE campaign_id=? LIMIT 1').get(c.id);
  if (c.status !== 'draft' && any) fail(409, 'People have joined or been invited: archive it instead');
  ctx.db.prepare('DELETE FROM campaigns WHERE id=? AND coach_id=?').run(c.id, ctx.user.id);
  return { ok: true };
}

/** The people an enrol request names: listed ids (each checked, 404 on any foreign) plus an audience. */
function enrolTargets(ctx) {
  const b = ctx.body;
  const out = new Map();
  if (b.clientIds !== undefined) for (const c of ownClients(ctx, b.clientIds)) out.set(c.id, c);
  if (b.audience !== undefined) for (const c of resolveAudience(ctx.db, ctx.user.id, b.audience)) out.set(c.id, c);
  if (!out.size) fail(400, 'Choose at least one client');
  return [...out.values()];
}

function enrol(_req, ctx) {
  const c = ownCampaign(ctx);
  const db = ctx.db;
  const now = requestNow(ctx);
  const b = ctx.body;
  if (c.status !== 'live') fail(409, 'Make the campaign live before inviting anyone');
  const mode = b.mode === undefined ? 'invite' : oneOf(b.mode, 'mode', ['invite', 'inPerson']);
  const startOn = c.start_mode === 'rolling' ? dayParam(b.startOn, 'startOn', { optional: true }) : null;
  const discountCode = b.discountCode ? str(b.discountCode, 'discountCode', { max: 40 }).toUpperCase() : null;
  const discountPence = b.discountPence === undefined || b.discountPence === null ? 0 : intIn(b.discountPence, 'discountPence', 0, c.fee_pence);
  const invoice = b.invoice === undefined ? true : bool(b.invoice, 'invoice');
  const lay = b.layProgram === undefined ? false : bool(b.layProgram, 'layProgram');
  const targets = enrolTargets(ctx);
  const result = { invited: 0, enrolled: 0, waitlisted: 0, skipped: [] };
  tx(db, () => {
    for (const client of targets) {
      const existing = db.prepare('SELECT * FROM campaign_enrolments WHERE campaign_id=? AND client_id=?').get(c.id, client.id);
      if (existing && !['declined', 'dropped'].includes(existing.status)) { result.skipped.push({ clientId: client.id, reason: `Already ${existing.status}` }); continue; }
      const id = existing?.id ?? newId('ce');
      const vals = [mode === 'inPerson' && c.start_mode === 'fixed' ? c.starts_on : startOn, c.fee_pence, discountCode, discountPence, invoice ? 1 : 0, lay ? 1 : 0, now.toISOString()];
      if (existing) {
        db.prepare(`UPDATE campaign_enrolments SET status='invited', start_on=?, fee_pence=?, discount_code=?, discount_pence=?, invoice_wanted=?, lay_program=?, invited_at=?,
          responded_at=NULL, enrolled_at=NULL, completed_at=NULL, dropped_at=NULL, accepted_via=NULL, points=0, paused_at=NULL, paused_days=0, behind_since=NULL, note=NULL WHERE id=?`).run(...vals, id);
        db.prepare('DELETE FROM campaign_progress WHERE enrolment_id=?').run(id);
        db.prepare('DELETE FROM campaign_nudges WHERE enrolment_id=?').run(id);
      } else {
        db.prepare(`INSERT INTO campaign_enrolments (start_on, fee_pence, discount_code, discount_pence, invoice_wanted, lay_program, invited_at, id, campaign_id, coach_id, client_id, status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,'invited')`).run(...vals, id, c.id, ctx.user.id, client.id);
      }
      const e = reload(db, id);
      if (mode === 'inPerson') {
        // "Agreed in person": the coach confirms the client said yes; it starts at once.
        const row = acceptEnrolment(db, ctx.config, c, e, { via: 'inPerson', startOn: startOn ?? londonDay(now), now });
        if (row.status === 'waitlisted') result.waitlisted++; else result.enrolled++;
      } else {
        sendInvitation(db, ctx.config, c, e, now);
        evt(db, 'campaign.invited', c, e, `Invited to ${c.name}`);
        result.invited++;
      }
    }
  });
  return result;
}

function preview(_req, ctx) {
  const c = ownCampaign(ctx);
  const b = ctx.body;
  // Before anyone is picked the preview greets "{first}", the placeholder their name fills.
  const client = b.clientId ? clientFor(ctx, b.clientId) : { name: '{first}' };
  const fake = { id: 'ce_preview', fee_pence: c.fee_pence, discount_code: b.discountCode ? String(b.discountCode).slice(0, 40).toUpperCase() : null,
    discount_pence: b.discountPence ? intIn(b.discountPence, 'discountPence', 0, c.fee_pence) : 0, start_on: c.start_mode === 'rolling' ? dayParam(b.startOn, 'startOn', { optional: true }) : null };
  return { text: invitationText(ctx.db, ctx.config, c, fake, client, requestNow(ctx)) };
}

function resend(_req, ctx) {
  const c = ownCampaign(ctx);
  const e = ownEnrolment(ctx, c);
  if (e.status !== 'invited') fail(409, 'Only an open invitation can be resent');
  const now = requestNow(ctx);
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE campaign_enrolments SET invited_at=? WHERE id=?').run(now.toISOString(), e.id);
    sendInvitation(ctx.db, ctx.config, c, reload(ctx.db, e.id), now);
  });
  return { ok: true };
}

function unenrol(_req, ctx) {
  const c = ownCampaign(ctx);
  const e = ownEnrolment(ctx, c);
  const now = requestNow(ctx);
  tx(ctx.db, () => {
    if (['invited', 'waitlisted'].includes(e.status)) ctx.db.prepare('DELETE FROM campaign_enrolments WHERE id=?').run(e.id);
    else if (['active', 'paused'].includes(e.status)) dropEnrolment(ctx.db, ctx.config, c, e, { now, note: 'Unenrolled by the coach' });
    else fail(409, `This enrolment is already ${e.status}`);
  });
  return { ok: true };
}

/** The challenge a campaign links: its distance leaderboard (the existing metric challenge). */
function challengeBoard(db, c) {
  if (!c.challenge_id) return null;
  const ch = db.prepare('SELECT * FROM challenges WHERE id=? AND coach_id=?').get(c.challenge_id, c.coach_id);
  if (!ch) return null;
  const rows = db.prepare(`SELECT u.id, u.name, (SELECT COALESCE(SUM(value), 0) FROM health_samples h WHERE h.user_id=u.id AND h.kind='distance' AND h.date>=? AND h.date<=?) v
    FROM challenge_members m JOIN users u ON u.id=m.user_id AND u.coach_id=? WHERE m.challenge_id=? ORDER BY v DESC`).all(ch.start, ch.end, c.coach_id, ch.id);
  return { id: ch.id, title: ch.title, metric: ch.metric, target: ch.target, leaderboard: rows.map((r, i) => ({ rank: i + 1, client: who(r), value: Math.round(r.v * 10) / 10 })) };
}

function board(_req, ctx) {
  const c = ownCampaign(ctx);
  const db = ctx.db;
  const today = londonDay(requestNow(ctx));
  const phases = phasesOf(db, c.id);
  const acts = activitiesOf(db, c.id);
  const kit = kitOf(db, c.id);
  const users = new Map(db.prepare("SELECT * FROM users WHERE role='client' AND coach_id=?").all(ctx.user.id).map(u => [u.id, u]));
  const rows = enrolmentsOf(db, c, ['active', 'paused', 'completed', 'dropped']).map(e => {
    const out = enrolmentOut(db, e, c, today, { acts, kit, phases });
    return { enrolment: out, client: who(users.get(e.client_id)), pct: out.pct, pace: out.pace, behind: out.behind, points: out.points,
      expectedSpendPence: out.expectedSpendPence, spentPence: out.spentPence, cells: out.cells };
  });
  const ranked = rows.filter(r => r.enrolment.status !== 'dropped').sort((a, b) => b.points - a.points);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const invited = enrolmentsOf(db, c, ['invited', 'waitlisted', 'declined']).map(e => ({ enrolment: enrolmentOut(db, e, c, today, { acts, kit }), client: who(users.get(e.client_id)) }));
  const t = kitTotals(kit);
  return {
    campaign: summaryOut(db, c, today), phases: phases.map(phaseOut), clients: rows, invited,
    totals: { expectedSpendPence: rows.reduce((s, r) => s + r.expectedSpendPence, 0), spentPence: rows.reduce((s, r) => s + r.spentPence, 0), requiredKitPence: t.requiredPence, optionalKitPence: t.optionalPence },
    ...(c.challenge_id ? { challenge: challengeBoard(db, c) } : {}),
  };
}

/** Message every enrolled client (active and paused), as the coach. */
function announce(_req, ctx) {
  const c = ownCampaign(ctx);
  const text = str(ctx.body.text, 'text', { max: 4000 });
  const now = requestNow(ctx);
  let sent = 0;
  tx(ctx.db, () => {
    for (const e of enrolmentsOf(ctx.db, c, ['active', 'paused'])) {
      if (sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: e.client_id, text, via: 'coachAction', now }).message) sent++;
    }
  });
  return { sent };
}

/** "Nudge behind": the coach's text to the named enrolled clients (default: everyone behind), as a governed bulk nudge. */
function nudgeBehind(_req, ctx) {
  const c = ownCampaign(ctx);
  const text = str(ctx.body.text, 'text', { max: 4000 });
  const now = requestNow(ctx);
  const today = londonDay(now);
  const acts = activitiesOf(ctx.db, c.id);
  const active = enrolmentsOf(ctx.db, c, ['active']);
  let targets;
  if (ctx.body.clientIds !== undefined) {
    const ids = new Set(ownClients(ctx, ctx.body.clientIds).map(x => x.id));
    targets = active.filter(e => ids.has(e.client_id));
    if (targets.length !== ids.size) fail(404, 'Not found');
  } else targets = active.filter(e => statsOf(e, c, acts, progressOf(ctx.db, e.id), today).behind);
  const out = { sent: 0, deferred: 0, skipped: 0 };
  tx(ctx.db, () => {
    for (const e of targets) {
      const r = sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: e.client_id, text, via: 'nudge', now });
      if (r.message) out.sent++; else if (r.deferredUntil) out.deferred++; else out.skipped++;
    }
  });
  return out;
}

function ending(_req, ctx) {
  requireCoach(ctx);
  const days = ctx.query.days === undefined ? 30 : intIn(Number(ctx.query.days), 'days', 1, 366);
  const today = londonDay(requestNow(ctx));
  return { enrolments: endingWithin(ctx.db, ctx.user, today, days).map(x => ({ client: x.client, campaign: { id: x.c.id, name: x.c.name }, endsOn: x.endsOn, enrolmentId: x.e.id, status: x.e.status })) };
}

function endingWithin(db, coach, today, days) {
  const rows = db.prepare(`SELECT e.*, u.name client_name FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=?
    JOIN users u ON u.id=e.client_id AND u.coach_id=c.coach_id WHERE e.status IN ('active','paused')`).all(coach.id);
  const out = [];
  for (const e of rows) {
    const c = campaignRow(db, e.campaign_id);
    const endsOn = lastDay(e, c);
    if (endsOn && endsOn >= today && endsOn <= addDays(today, days)) out.push({ e, c, endsOn, client: who({ id: e.client_id, name: e.client_name }) });
  }
  return out.sort((a, b) => a.endsOn.localeCompare(b.endsOn));
}

function clientCampaigns(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.params.id);
  const now = requestNow(ctx);
  const today = londonDay(now);
  const rows = ctx.db.prepare(`SELECT e.* FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.client_id=? ORDER BY e.invited_at DESC`).all(ctx.user.id, client.id);
  return {
    enrolments: rows.map(e => {
      const c = campaignRow(ctx.db, e.campaign_id);
      const acts = activitiesOf(ctx.db, c.id);
      const done = progressOf(ctx.db, e.id);
      const idx = dayIndex(e, c, today);
      return { ...enrolmentOut(ctx.db, e, c, today, { acts }), campaign: { id: c.id, name: c.name, status: c.status, tagline: c.tagline },
        today: ['active', 'paused'].includes(e.status) ? acts.filter(a => a.day === idx).map(a => clientActivity(ctx.db, c.coach_id, e, a, done)) : [] };
    }),
  };
}

// MARK: - Client routes

const requireClient = ctx => { if (ctx.user.role !== 'client') fail(403, 'Clients only'); remember(ctx.db, ctx.config); };

/** One of the caller's own enrolments in a campaign of their current coach, or 404. */
function mine(ctx) {
  requireClient(ctx);
  const e = ctx.db.prepare('SELECT e.* FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.id=? AND e.client_id=?')
    .get(ctx.user.coach_id ?? '', ctx.params.eid, ctx.user.id);
  if (!e) fail(404, 'Not found');
  return { e, c: campaignRow(ctx.db, e.campaign_id) };
}

function myCampaigns(_req, ctx) {
  requireClient(ctx);
  const now = requestNow(ctx);
  const today = londonDay(now);
  const rows = ctx.db.prepare(`SELECT e.* FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.client_id=? ORDER BY e.invited_at DESC`)
    .all(ctx.user.coach_id ?? '', ctx.user.id);
  const recent = addDays(today, -30);
  return {
    invitations: rows.filter(e => ['invited', 'waitlisted'].includes(e.status)).map(e => invitationOut(ctx.db, e, campaignRow(ctx.db, e.campaign_id))),
    enrolments: rows.filter(e => ['active', 'paused'].includes(e.status) || (e.status === 'completed' && londonDay(new Date(e.completed_at)) >= recent))
      .map(e => clientEnrolmentOut(ctx.db, ctx.config, e, campaignRow(ctx.db, e.campaign_id), today, now)),
  };
}

function myAccept(_req, ctx) {
  const { e, c } = mine(ctx);
  const now = requestNow(ctx);
  const startOn = c.start_mode === 'rolling' && ctx.body.startOn !== undefined ? dayParam(ctx.body.startOn, 'startOn') : null;
  if (startOn && startOn < londonDay(now)) fail(400, 'startOn cannot be in the past');
  const row = acceptEnrolment(ctx.db, ctx.config, c, e, { via: 'app', startOn, now });
  return { enrolment: clientEnrolmentOut(ctx.db, ctx.config, row, c, londonDay(now), now) };
}

function myDecline(_req, ctx) {
  const { e, c } = mine(ctx);
  declineEnrolment(ctx.db, c, e, { now: requestNow(ctx), config: ctx.config });
  return { ok: true };
}

function myDetail(_req, ctx) {
  const { e, c } = mine(ctx);
  const now = requestNow(ctx);
  const today = londonDay(now);
  const done = progressOf(ctx.db, e.id);
  const guideOf = id => { const g = publishedGuide(ctx.db, c.coach_id, id); return g ? { id: g.id, title: g.title } : null; };
  return {
    enrolment: ['invited', 'waitlisted'].includes(e.status) ? { id: e.id, status: e.status, invitation: invitationOut(ctx.db, e, c) } : clientEnrolmentOut(ctx.db, ctx.config, e, c, today, now),
    campaign: { id: c.id, name: c.name, tagline: c.tagline, description: c.description, coverUrl: mediaUrl(c.cover_media_id), lengthDays: c.length_days, startMode: c.start_mode, welcomeText: c.welcome_text },
    phases: phasesOf(ctx.db, c.id).map(p => ({ id: p.id, name: p.name, startDay: p.start_day, endDay: p.end_day, color: p.color, summary: p.summary,
      startsOn: e.start_on ? addDays(e.start_on, p.start_day + e.paused_days) : null, guide: p.guide_id ? guideOf(p.guide_id) : null })),
    activities: activitiesOf(ctx.db, c.id).map(a => clientActivity(ctx.db, c.coach_id, e, a, done)),
    kit: kitOf(ctx.db, c.id).map(k => ({ ...kitOut(k), bought: done.has(k.id), spentPence: done.get(k.id)?.spent_pence ?? null })),
  };
}

function myItem(_req, ctx) {
  const { e, c } = mine(ctx);
  if (e.status !== 'active') fail(409, 'This campaign is not active for you');
  const db = ctx.db;
  const b = ctx.body;
  const now = requestNow(ctx);
  const itemId = ctx.params.itemId;
  const act = db.prepare('SELECT * FROM campaign_activities WHERE id=? AND campaign_id=? AND archived=0').get(itemId, c.id);
  const kit = act ? null : db.prepare('SELECT * FROM campaign_kit WHERE id=? AND campaign_id=? AND archived=0').get(itemId, c.id);
  if (!act && !kit) fail(404, 'Not found');
  const done = bool(b.done, 'done');
  if (act && done && act.day > dayIndex(e, c, londonDay(now))) fail(409, 'That one is not due yet');
  const value = b.value === undefined || b.value === null ? null : num(b.value, 'value', { min: -1e6, max: 1e6 });
  const note = b.note === undefined || b.note === null ? null : str(b.note, 'note', { max: 500, min: 0 });
  const spent = b.spentPence === undefined || b.spentPence === null ? null : intIn(b.spentPence, 'spentPence', 0, 10_000_000);
  const media = b.mediaId ? attachableMedia(ctx, b.mediaId, 'mediaId', ctx.user) : null;
  const out = tx(db, () => {
    const had = db.prepare('SELECT * FROM campaign_progress WHERE enrolment_id=? AND item_id=?').get(e.id, itemId);
    if (done) {
      db.prepare(`INSERT INTO campaign_progress (enrolment_id, client_id, item_id, done_at, value, note, media_id, spent_pence) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(enrolment_id, item_id) DO UPDATE SET value=COALESCE(excluded.value, value), note=COALESCE(excluded.note, note), media_id=COALESCE(excluded.media_id, media_id),
        spent_pence=COALESCE(excluded.spent_pence, spent_pence)`).run(e.id, ctx.user.id, itemId, had?.done_at ?? now.toISOString(), value, note, media?.id ?? null, spent);
      if (!had) evt(db, 'campaign.activityDone', c, e, `Ticked ${act ? act.title : kit.name}`, { itemId });
    } else db.prepare('DELETE FROM campaign_progress WHERE enrolment_id=? AND item_id=?').run(e.id, itemId);
    const points = recomputePoints(db, e.id);
    const s = statsOf(reload(db, e.id), c, activitiesOf(db, c.id), progressOf(db, e.id), londonDay(now));
    return { pct: s.pct, points, pace: s.pace };
  });
  return out;
}

// MARK: - The public plan page (/plan/<token>): server-rendered, no JS

const PLAN_CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0A0A0A;color:#F2F2F2;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:640px;margin:0 auto;padding:40px 20px 72px}
a{color:#D9D9D9}
.mark{display:inline-grid;place-items:center;width:44px;height:44px;border:1px solid #D9D9D9;border-radius:50%;color:#D9D9D9;font:600 15px/1 Georgia,serif;letter-spacing:.04em}
.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#A3A3A3;margin:28px 0 6px;font-weight:600}
h1{font:500 34px/1.1 "Newsreader",Georgia,serif;margin:4px 0 8px;letter-spacing:-.01em}
h1 em{color:#D9D9D9}
h2{font:500 22px/1.25 "Newsreader",Georgia,serif;margin:36px 0 10px}
h3{font-size:17px;margin:22px 0 6px}
p,li{color:#D4D4D4}
.sub{color:#A3A3A3;margin:0}
.card{background:#121212;border:1px solid #262626;border-radius:18px;padding:18px 20px;margin:14px 0}
.hero{background:radial-gradient(120% 80% at 100% 0%,rgba(217,217,217,.16) 0%,rgba(217,217,217,0) 60%),#121212}
.row{display:flex;gap:12px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}
.num{font:600 26px/1 -apple-system,BlinkMacSystemFont,sans-serif;font-variant-numeric:tabular-nums}
.k{font-size:12px;color:#A3A3A3;text-transform:uppercase;letter-spacing:.08em}
.bar{height:6px;border-radius:99px;background:rgba(242,242,242,.10);overflow:hidden;margin-top:12px}
.bar i{display:block;height:100%;background:#D9D9D9;border-radius:99px}
ul.plain{list-style:none;padding:0;margin:0}
ul.plain li{display:flex;gap:12px;padding:11px 0;border-top:1px solid #262626}
ul.plain li:first-child{border-top:0}
.tick{flex:none;width:22px;height:22px;border-radius:50%;border:1.5px solid #5C5C5C;display:grid;place-items:center;font-size:13px;color:#0A0A0A;margin-top:2px}
.tick.on{background:#D9D9D9;border-color:#D9D9D9}
.what{flex:1;min-width:0}
.what b{display:block;color:#F2F2F2;font-weight:600}
.meta{font-size:13px;color:#A3A3A3}
.pill{display:inline-block;font-size:12px;padding:2px 10px;border-radius:99px;border:1px solid #262626;color:#A3A3A3;margin-left:6px}
.phase{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid #262626}
.phase:first-child{border-top:0}
.dot{flex:none;width:10px;height:10px;border-radius:50%;background:#D9D9D9;margin-top:8px}
.dot.chart-2{background:#8FA3B3}.dot.chart-3{background:#9FB39A}.dot.chart-4{background:#A898C4}.dot.chart-5{background:#D98E5B}.dot.chart-6{background:#A3A3A3}
.now{color:#D9D9D9;font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse}
td{padding:9px 0;border-top:1px solid #262626;vertical-align:top}
tr:first-child td{border-top:0}
td.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.total td{color:#F2F2F2;font-weight:600}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px}
button{font:600 16px/1 inherit;font-family:inherit;padding:14px 26px;border-radius:12px;border:1px solid #5C5C5C;background:transparent;color:#F2F2F2;cursor:pointer}
button.primary{background:#F2F2F2;color:#0A0A0A;border-color:#F2F2F2}
button:focus-visible,a:focus-visible{outline:2px solid #D9D9D9;outline-offset:3px}
.note{border-left:2px solid #D9D9D9;padding:4px 0 4px 14px;color:#D4D4D4;margin:16px 0}
.flash{background:rgba(217,217,217,.16);border:1px solid rgba(217,217,217,.4);border-radius:12px;padding:12px 16px;color:#F2F2F2}
.guide{background:#141414;border:1px solid #262626;border-radius:18px;padding:6px 22px 18px;margin:16px 0}
.guide h3:first-child{font:500 22px/1.25 "Newsreader",Georgia,serif;margin-top:18px}
.callout{border-radius:12px;padding:12px 14px;margin:12px 0;background:rgba(159,179,154,.12);color:#E6E6E6}
.callout.warn{background:rgba(217,142,91,.14)}.callout.info{background:rgba(143,163,179,.14)}
ul.l-check{list-style:none;padding-left:0}ul.l-check li::before{content:"☐  ";color:#D9D9D9}
figure{margin:14px 0}figure img,figure video{width:100%;border-radius:12px;display:block}figcaption{font-size:13px;color:#A3A3A3;margin-top:6px}
audio{width:100%}
hr{border:0;border-top:1px solid #262626;margin:20px 0}
.exercise{background:#1A1A1A;border-radius:10px;padding:10px 12px}
footer{margin-top:48px;font-size:13px;color:#8A8A8A}
${Array.from({ length: 21 }, (_, i) => `.bar i.p${i * 5}{width:${i * 5}%}`).join('')}
@media (prefers-color-scheme:light){
  :root{color-scheme:light}
  body{background:#F5F5F5;color:#1C1C1C}a,.mark,h1 em,.now{color:#3A3A3A}.mark{border-color:#3A3A3A}
  p,li,.note{color:#3A3A3A}.sub,.meta,.k,.eyebrow,figcaption{color:#5E5E5E}
  .card,.guide{background:#FBFBFB;border-color:#DDDDDD}.hero{background:radial-gradient(120% 80% at 100% 0%,rgba(58,58,58,.10) 0%,rgba(58,58,58,0) 60%),#FBFBFB}
  .what b,.total td{color:#1C1C1C}ul.plain li,.phase,td{border-color:#DDDDDD}.bar{background:rgba(28,28,28,.08)}.bar i,.tick.on,.dot{background:#3A3A3A;border-color:#3A3A3A}
  .tick{border-color:#8F8F8F;color:#FBFBFB}button{color:#1C1C1C;border-color:#8F8F8F}button.primary{background:#1C1C1C;color:#FBFBFB;border-color:#1C1C1C}
  .exercise{background:#EAEAEA}.callout{color:#1C1C1C}.flash{color:#1C1C1C}footer{color:#666666}
}`;
const PLAN_CSP = `default-src 'none'; style-src 'sha256-${createHash('sha256').update(PLAN_CSS).digest('base64')}'; img-src 'self'; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
const PLAN_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': PLAN_CSP, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const page = (status, title, body, extra = {}) => raw(status, { ...PLAN_HEADERS, ...extra }, `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>${esc(title)} · JK Performance</title><style>${PLAN_CSS}</style></head><body><main><div class="mark" aria-hidden="true">JK</div>${body}
<footer>This page is private to you: please don't share the link. JK Performance · <a href="/privacy">Privacy</a></footer></main></body></html>`);
const notFound = () => page(404, 'Not found', '<h1>This link has expired</h1><p class="sub">Ask your coach for a fresh one, or open the app.</p>');

/**
 * The enrolment (or guide share) a token opens, or null: a bad or expired
 * token, an erased client, a client who has moved coach, a dropped
 * enrolment, or one completed more than 30 days ago all read as "not found".
 */
function planTarget(db, config, token, now) {
  const v = verifyPlan(config, token, now);
  if (!v) return null;
  if (v.subject.startsWith('ce_')) {
    const e = db.prepare('SELECT * FROM campaign_enrolments WHERE id=?').get(v.subject);
    if (!e || e.status === 'dropped') return null;
    if (e.status === 'completed' && e.completed_at && londonDay(new Date(e.completed_at)) < addDays(londonDay(now), -30)) return null;
    const c = campaignRow(db, e.campaign_id);
    const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.client_id, c.coach_id);
    if (!client) return null;
    return { kind: 'enrolment', e, c, client };
  }
  const [clientId, guideId] = v.subject.split('~');
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(clientId);
  const guide = client?.coach_id ? publishedGuide(db, client.coach_id, guideId) : null;
  return guide ? { kind: 'guide', client, guide } : null;
}

/** The guides a campaign shows: phase and activity guides (published, this coach's), in order of first use. */
function campaignGuides(db, c) {
  const ids = [...phasesOf(db, c.id).map(p => p.guide_id), ...activitiesOf(db, c.id).map(a => a.guide_id)].filter(Boolean);
  return [...new Set(ids)].map(id => publishedGuide(db, c.coach_id, id)).filter(Boolean);
}

const exerciseOf = db => id => db.prepare('SELECT * FROM exercises WHERE id=?').get(id);
const kindWord = { task: 'Task', workout: 'Workout', habit: 'Habit', checkin: 'Check-in', read: 'Read', purchase: 'Buy', session: 'Session', measure: 'Measure', custom: 'Activity' };

function activityLi(a, e, done, anchors) {
  const p = done.get(a.id);
  const guide = a.guide_id && anchors.has(a.guide_id) ? ` · <a href="#g-${esc(a.guide_id)}">Read guide</a>` : '';
  return `<li><span class="tick${p ? ' on' : ''}" aria-hidden="true">${p ? '✓' : ''}</span><span class="what"><b>${esc(a.title)}</b>
<span class="meta">${kindWord[a.kind] ?? 'Activity'} · ${a.points} pts${a.required ? '' : ' · optional'}${a.spend_pence ? ` · about ${money(a.spend_pence)}` : ''}${p ? ' · done' : ''}${guide}</span>
${a.detail ? `<span class="meta">${esc(a.detail)}</span>` : ''}</span></li>`;
}

function enrolmentPage(db, config, t, token, now, flash = null, status = 200) {
  const { e, c, client } = t;
  const today = londonDay(now);
  const acts = activitiesOf(db, c.id);
  const kit = kitOf(db, c.id);
  const phases = phasesOf(db, c.id);
  const done = progressOf(db, e.id);
  const tot = kitTotals(kit);
  const guides = campaignGuides(db, c);
  const anchors = new Set(guides.map(g => g.id));
  const mediaUrl = id => `/plan/${token}/media/${encodeURIComponent(id)}`;
  const parts = [`<p class="eyebrow">Campaign</p><h1>${esc(c.name)}</h1>${c.tagline ? `<p class="sub">${esc(c.tagline)}</p>` : ''}`,
    `<p>Hi ${esc(first(client.name))}.</p>`];
  if (flash) parts.push(`<p class="flash" role="status">${esc(flash)}</p>`);
  const kitTable = () => `<table>${kit.map(k => `<tr><td>${esc(k.name)}${k.required ? '' : ' <span class="pill">optional</span>'}${k.url ? ` · <a href="${esc(k.url)}" rel="noopener noreferrer" target="_blank">Link ↗</a>` : ''}${k.note ? `<div class="meta">${esc(k.note)}</div>` : ''}${done.has(k.id) ? '<div class="meta">Bought</div>' : ''}</td><td class="r">${money(k.est_pence)}</td></tr>`).join('')}
<tr class="total"><td>Required kit</td><td class="r">${money(tot.requiredPence)}</td></tr><tr><td class="meta">Optional kit, in total</td><td class="r meta">${money(tot.optionalPence)}</td></tr></table>`;

  if (['invited', 'waitlisted', 'declined'].includes(e.status)) {
    const inv = invitationOut(db, e, c);
    const net = Math.max(0, e.fee_pence - (e.discount_pence ?? 0));
    const dates = inv.campaign.startsOn ? `${fmtDay(inv.campaign.startsOn)} to ${fmtDay(inv.campaign.endsOn)}` : `${c.length_days} days from the day you accept`;
    parts.push(`<section class="card hero"><div class="row"><div><div class="k">Dates</div><div>${esc(dates)}</div></div><div><div class="k">Fee</div><div class="num">${e.fee_pence ? money(net) : 'None'}</div>${e.discount_pence ? `<div class="meta">${money(e.fee_pence)} less ${esc(e.discount_code || 'discount')}</div>` : e.discount_code ? `<div class="meta">Code ${esc(e.discount_code)} applies on the invoice</div>` : ''}</div>
<div><div class="k">Expected spend</div><div class="num">${money(inv.expectedSpendPence)}</div></div></div>
${inv.placesLeft !== null ? `<p class="meta">${inv.placesLeft ? `${inv.placesLeft} place${inv.placesLeft === 1 ? '' : 's'} left` : 'Full: accepting puts you on the waitlist'}</p>` : ''}
${c.description ? `<p>${esc(c.description)}</p>` : ''}${c.welcome_text ? `<p class="note">${esc(c.welcome_text)}</p>` : ''}</section>`);
    if (kit.length) parts.push(`<h2>Kit and spend</h2><section class="card">${kitTable()}</section>`);
    if (phases.length) parts.push(`<h2>How it runs</h2><section class="card">${phases.map(p => `<div class="phase"><span class="dot ${esc(p.color)}"></span><div><b>${esc(p.name)}</b> <span class="meta">days ${p.start_day + 1}–${p.end_day + 1}</span>${p.summary ? `<div class="meta">${esc(p.summary)}</div>` : ''}</div></div>`).join('')}</section>`);
    if (e.status === 'invited') {
      parts.push(`<form method="post" action="/plan/${esc(token)}" class="actions"><input type="hidden" name="csrf" value="${esc(planCsrf(config, token))}">
<button class="primary" name="action" value="accept">Accept</button><button name="action" value="decline">Not this time</button></form>
<p class="meta">Please answer by ${esc(fmtDay(respondBy(e, c)))}. Nothing is charged until you accept.</p>`);
    } else if (e.status === 'waitlisted') parts.push('<p class="note">You are on the waitlist. If a place comes free you will get a new invitation.</p>');
    else parts.push('<p class="note">You said not this time. Your coach can invite you again later.</p>');
    return page(status, c.name, parts.join('\n'));
  }

  const s = statsOf(e, c, acts, done, today, phases);
  const end = lastDay(e, c);
  if (e.status === 'completed') parts.push(`<section class="card hero"><p class="eyebrow">Completed</p><h2>You finished ${esc(c.name)}.</h2>${c.completion_text ? `<p class="note">${esc(c.completion_text)}</p>` : ''}<p class="meta">${s.points} points · ${s.pct}% of everything done</p></section>`);
  else {
    parts.push(`<section class="card hero"><div class="row"><div><div class="k">${e.status === 'paused' ? 'Paused' : s.idx < 0 ? 'Starts' : 'Day'}</div><div class="num">${s.idx < 0 ? esc(fmtDay(e.start_on)) : `${s.day} <span class="meta">of ${c.length_days}</span>`}</div></div>
<div><div class="k">Progress</div><div class="num">${s.pct}%</div></div><div><div class="k">Points</div><div class="num">${s.points}</div></div></div>
<div class="bar" role="img" aria-label="${s.pct}% done"><i class="p${Math.round(s.pct / 5) * 5}"></i></div><p class="meta">Ends ${esc(fmtDay(end))}${e.status === 'paused' ? ' · paused for now' : ''}</p></section>`);
    const todays = acts.filter(a => a.day === s.idx);
    parts.push(`<h2>Today</h2><section class="card">${todays.length ? `<ul class="plain">${todays.map(a => activityLi(a, e, done, anchors)).join('')}</ul>` : '<p class="meta">Nothing set for today. Rest well.</p>'}</section>`);
    const upcoming = [1, 2, 3].map(d => ({ d, list: acts.filter(a => a.day === s.idx + d) })).filter(x => x.list.length && s.idx + x.d < c.length_days);
    if (upcoming.length) parts.push(`<h2>Next three days</h2><section class="card">${upcoming.map(x => `<p class="k">${esc(fmtDay(addDays(today, x.d)))}</p><ul class="plain">${x.list.map(a => activityLi(a, e, done, anchors)).join('')}</ul>`).join('')}</section>`);
  }
  if (phases.length) {
    parts.push(`<h2>Phases</h2><section class="card">${phases.map(p => {
      const now_ = s.idx >= p.start_day && s.idx <= p.end_day && e.status !== 'completed';
      return `<div class="phase"><span class="dot ${esc(p.color)}"></span><div><b>${esc(p.name)}</b> <span class="meta">${esc(fmtDay(addDays(e.start_on, p.start_day + e.paused_days)))} – ${esc(fmtDay(addDays(e.start_on, p.end_day + e.paused_days)))}</span>${now_ ? ' <span class="now">· now</span>' : ''}${p.summary ? `<div class="meta">${esc(p.summary)}</div>` : ''}${p.guide_id && anchors.has(p.guide_id) ? `<div class="meta"><a href="#g-${esc(p.guide_id)}">Read the phase guide</a></div>` : ''}</div></div>`;
    }).join('')}</section>`);
  }
  if (kit.length) parts.push(`<h2>Kit</h2><section class="card">${kitTable()}</section>`);
  const inline = acts.filter(a => !a.guide_id && a.blocks && (a.day >= s.idx - 1) && (a.day <= s.idx + 3));
  if (guides.length || inline.length) {
    parts.push('<h2>Guides</h2>');
    for (const g of guides) parts.push(`<article class="guide" id="g-${esc(g.id)}">${blocksHtml([{ t: 'h', text: g.title }, ...json(g.blocks, []).filter((b, i) => !(i === 0 && b.t === 'h' && b.text === g.title))], { mediaUrl, exerciseOf: exerciseOf(db) })}</article>`);
    for (const a of inline) parts.push(`<article class="guide">${blocksHtml([{ t: 'h', text: a.title }, ...json(a.blocks, [])], { mediaUrl, exerciseOf: exerciseOf(db) })}</article>`);
  }
  return page(status, c.name, parts.join('\n'));
}

function guidePage(db, t, token, guideId) {
  if (t.guide.id !== guideId) return notFound();
  markOpened(db, t.guide, t.client.id);
  const blocks = json(t.guide.blocks, []);
  const body = `<p class="eyebrow">A guide from your coach</p><h1>${esc(t.guide.title)}</h1>${t.guide.summary ? `<p class="sub">${esc(t.guide.summary)}</p>` : ''}
<p>For ${esc(first(t.client.name))}.</p><article class="guide">${blocksHtml(blocks.filter((b, i) => !(i === 0 && b.t === 'h' && b.text === t.guide.title)), { mediaUrl: id => `/plan/${token}/media/${encodeURIComponent(id)}`, exerciseOf: exerciseOf(db) })}</article>`;
  return page(200, t.guide.title, body);
}

function planGet(_req, ctx) {
  remember(ctx.db, ctx.config);
  const now = requestNow(ctx);
  const t = planTarget(ctx.db, ctx.config, ctx.params.token, now);
  if (!t || t.kind !== 'enrolment') return notFound();
  const done = { accepted: 'You are in. Today\'s plan is below.', declined: 'Thanks for letting us know.', waitlisted: 'The campaign is full, so you are on the waitlist.' }[ctx.query.done] ?? null;
  return enrolmentPage(ctx.db, ctx.config, t, ctx.params.token, now, done);
}

/** Accept or Decline from the plan page: a form POST with a per-token CSRF field, 10 per token per hour. */
function planPost(_req, ctx) {
  remember(ctx.db, ctx.config);
  const now = requestNow(ctx);
  const token = ctx.params.token;
  const t = planTarget(ctx.db, ctx.config, token, now);
  if (!t || t.kind !== 'enrolment') return notFound();
  if (!limit(`plan:${token}`, { max: 10, perMs: 3_600_000, now: now.getTime() })) return page(429, 'Slow down', '<h1>Too many tries</h1><p class="sub">Please wait a while and try again.</p>');
  const form = new URLSearchParams(String(ctx.rawBody ?? ''));
  const want = Buffer.from(planCsrf(ctx.config, token));
  const got = Buffer.from(String(form.get('csrf') ?? ''));
  if (want.length !== got.length || !timingSafeEqual(want, got)) return page(403, 'Expired form', '<h1>That form has expired</h1><p class="sub">Reload the page and try again.</p>');
  const action = form.get('action');
  if (!['accept', 'decline'].includes(action)) return page(400, 'Not understood', '<h1>Please use the buttons</h1>');
  if (!['invited'].includes(t.e.status)) return enrolmentPage(ctx.db, ctx.config, t, token, now, 'You have already answered this invitation.', 409);
  try {
    if (action === 'accept') {
      const row = acceptEnrolment(ctx.db, ctx.config, t.c, t.e, { via: 'plan', now });
      return raw(303, { location: `/plan/${token}?done=${row.status === 'waitlisted' ? 'waitlisted' : 'accepted'}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, '');
    }
    declineEnrolment(ctx.db, t.c, t.e, { now, config: ctx.config });
    return raw(303, { location: `/plan/${token}?done=declined`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }, '');
  } catch (err) {
    if (err.status === 409) return enrolmentPage(ctx.db, ctx.config, { ...t, e: reload(ctx.db, t.e.id) }, token, now, err.message, 409);
    throw err;
  }
}

function planGuide(_req, ctx) {
  remember(ctx.db, ctx.config);
  const now = requestNow(ctx);
  const t = planTarget(ctx.db, ctx.config, ctx.params.token, now);
  if (!t) return notFound();
  if (t.kind === 'guide') return guidePage(ctx.db, t, ctx.params.token, ctx.params.guideId);
  // An enrolment token opens the guides its campaign uses.
  const g = campaignGuides(ctx.db, t.c).find(x => x.id === ctx.params.guideId);
  if (!g) return notFound();
  return guidePage(ctx.db, { client: t.client, guide: g }, ctx.params.token, g.id);
}

/** A file through the plan page: only one that sits in a guide (or inline blocks, or the cover) the token opens. */
function planMedia(req, ctx) {
  const now = requestNow(ctx);
  const t = planTarget(ctx.db, ctx.config, ctx.params.token, now);
  if (!t) return notFound();
  const id = ctx.params.mediaId;
  let m = null;
  if (t.kind === 'guide') m = guideMedia(ctx.db, t.guide, id);
  else {
    for (const g of campaignGuides(ctx.db, t.c)) if ((m = guideMedia(ctx.db, g, id))) break;
    if (!m) {
      const inline = activitiesOf(ctx.db, t.c.id).some(a => a.blocks && blockMediaIds(json(a.blocks, [])).has(id));
      if (inline || t.c.cover_media_id === id) m = ctx.db.prepare('SELECT * FROM media WHERE id=? AND owner_id=? AND client_id IS NULL').get(id, t.c.coach_id) ?? null;
    }
  }
  if (!m) return notFound();
  return streamMedia(req, ctx.config, m, { cache: 'no-store', extra: { 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } });
}

// MARK: - Hooks

function search(db, coach, q, lim) {
  const like = likeAny(q);
  return db.prepare("SELECT * FROM campaigns WHERE coach_id=? AND status<>'archived' AND (name LIKE ? ESCAPE '\\' OR tagline LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?")
    .all(coach.id, like, like, lim)
    .map(c => ({ type: 'campaign', id: c.id, title: c.name, detail: `Campaign · ${c.status[0].toUpperCase()}${c.status.slice(1)}`, path: `/campaigns/${c.id}`, icon: 'rocket_launch', score: matchScore(c.name, q), at: c.updated_at }));
}

function needs(db, coach, _clients, today) {
  const rows = db.prepare(`SELECT e.*, c.name campaign_name FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=?
    JOIN users u ON u.id=e.client_id AND u.coach_id=c.coach_id WHERE e.status='active' AND e.behind_since IS NOT NULL AND e.behind_since<=?`).all(coach.id, addDays(today, -3));
  return rows.map(e => {
    const c = campaignRow(db, e.campaign_id);
    const s = statsOf(e, c, activitiesOf(db, c.id), progressOf(db, e.id), today);
    if (!s.behind) return null;
    return { clientId: e.client_id, kind: 'campaignBehind', text: `Behind on ${c.name} (pace ${s.pace}%)`, at: `${e.behind_since}T07:00:00.000Z`, rank: 7, iconKey: 'rocket_launch',
      action: { label: 'Nudge', path: `/campaigns/${c.id}/board` } };
  }).filter(Boolean);
}

function timelineHook(db, coach, client, before, lim) {
  const rows = db.prepare(`SELECT e.*, c.name campaign_name FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.client_id=?`).all(coach.id, client.id);
  const items = [];
  for (const e of rows) {
    const path = `/campaigns/${e.campaign_id}/board`;
    items.push({ at: e.invited_at, kind: 'campaign', icon: 'rocket_launch', tone: 'data', title: `Invited to ${e.campaign_name}`, detail: e.fee_pence ? `Fee ${money(e.fee_pence)}` : '', path });
    if (e.enrolled_at) items.push({ at: e.enrolled_at, kind: 'campaign', icon: 'how_to_reg', tone: 'ok', title: `Joined ${e.campaign_name}`, detail: e.accepted_via === 'inPerson' ? 'Agreed in person' : e.accepted_via === 'plan' ? 'Accepted on the plan page' : 'Accepted in the app', path });
    if (e.status === 'declined' && e.responded_at) items.push({ at: e.responded_at, kind: 'campaign', icon: 'block', tone: 'data', title: `Declined ${e.campaign_name}`, detail: e.note ?? '', path });
    if (e.completed_at) items.push({ at: e.completed_at, kind: 'campaign', icon: 'celebration', tone: 'ok', title: `Completed ${e.campaign_name}`, detail: `${e.points} points`, path });
    if (e.dropped_at) items.push({ at: e.dropped_at, kind: 'campaign', icon: 'logout', tone: 'attention', title: `Left ${e.campaign_name}`, detail: e.note ?? '', path });
    if (e.behind_since && e.status === 'active') items.push({ at: `${e.behind_since}T07:00:00.000Z`, kind: 'campaign', icon: 'flag', tone: 'attention', title: `Fell behind on ${e.campaign_name}`, detail: '', path });
  }
  return items.filter(i => i.at && (!before || i.at < before)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, lim ?? 50);
}

function diaryHook(db, coach, d) {
  const out = [];
  for (const c of db.prepare("SELECT * FROM campaigns WHERE coach_id=? AND status IN ('live','ended')").all(coach.id)) {
    const path = `/campaigns/${c.id}/board`;
    if (c.start_mode === 'fixed' && c.starts_on === d) out.push({ at: null, day: d, kind: 'campaign', icon: 'rocket_launch', title: `${c.name} starts`, detail: `${enrolmentsOf(db, c, ['active', 'invited']).length} people`, path, tone: 'data' });
    if (c.start_mode === 'fixed' && campaignEnd(c) === d) out.push({ at: null, day: d, kind: 'campaign', icon: 'flag', title: `${c.name} ends`, detail: 'Last day', path, tone: 'data' });
    if (c.start_mode === 'rolling') {
      for (const e of enrolmentsOf(db, c, ['active', 'paused'])) {
        const u = db.prepare('SELECT name FROM users WHERE id=?').get(e.client_id);
        if (e.start_on === d) out.push({ at: null, day: d, kind: 'campaign', icon: 'rocket_launch', title: `${first(u?.name)} starts ${c.name}`, detail: '', path, tone: 'data' });
        if (lastDay(e, c) === d) out.push({ at: null, day: d, kind: 'campaign', icon: 'flag', title: `${first(u?.name)} finishes ${c.name}`, detail: '', path, tone: 'data' });
      }
    }
  }
  return out;
}

function forecastHook(db, coach, from, to) {
  const rows = db.prepare(`SELECT e.*, c.name campaign_name, c.start_mode, c.starts_on, u.name client_name FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=?
    JOIN users u ON u.id=e.client_id AND u.coach_id=c.coach_id WHERE e.fee_pence>0 AND ((e.status='invited') OR (e.status='active' AND e.invoice_wanted=0))`).all(coach.id);
  const out = [];
  for (const e of rows) {
    const day = e.start_on ?? (e.start_mode === 'fixed' ? e.starts_on : addDays(londonDay(new Date(e.invited_at)), 7));
    if (!day || day < from || day > to) continue;
    out.push({ label: `${e.campaign_name}: ${first(e.client_name)}`, day, pence: Math.max(0, e.fee_pence - e.discount_pence), confidence: e.status === 'invited' ? 'possible' : 'likely', source: 'campaigns' });
  }
  return out;
}

function exportFor(db, user) {
  const rows = db.prepare('SELECT e.*, c.name campaign_name FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id WHERE e.client_id=? ORDER BY e.invited_at').all(user.id);
  const out = {
    enrolments: rows.map(e => ({
      campaign: e.campaign_name, status: e.status, startOn: e.start_on, points: e.points, feePence: e.fee_pence, discountCode: e.discount_code, acceptedVia: e.accepted_via,
      invitedAt: e.invited_at, respondedAt: e.responded_at, enrolledAt: e.enrolled_at, completedAt: e.completed_at, droppedAt: e.dropped_at, pausedDays: e.paused_days,
      progress: db.prepare(`SELECT p.item_id itemId, COALESCE(a.title, k.name) item, p.done_at doneAt, p.value, p.note, p.media_id mediaId, p.spent_pence spentPence
        FROM campaign_progress p LEFT JOIN campaign_activities a ON a.id=p.item_id LEFT JOIN campaign_kit k ON k.id=p.item_id WHERE p.enrolment_id=? ORDER BY p.done_at`).all(e.id),
      spentPence: db.prepare('SELECT COALESCE(SUM(spent_pence), 0) n FROM campaign_progress WHERE enrolment_id=?').get(e.id).n,
    })),
  };
  if (user.role === 'coach') out.campaigns = db.prepare('SELECT * FROM campaigns WHERE coach_id=? ORDER BY created_at').all(user.id).map(c => designOut(db, c));
  return out;
}

function renewals(db, coach, days) {
  const today = londonDay();
  return endingWithin(db, coach, today, days ?? 30).map(x => ({ client: x.client, kind: 'campaign', label: x.c.name, on: x.endsOn, detail: `${x.c.name} ends ${fmtDay(x.endsOn)}`, path: `/campaigns/${x.c.id}/board` }));
}

function offboarding(db, coach, client) {
  const rows = db.prepare(`SELECT e.id, e.status, c.id cid, c.name FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.client_id=? AND e.status IN ('invited','waitlisted','active','paused')`).all(coach.id, client.id);
  return rows.length ? { enrolments: rows.map(r => ({ id: r.id, status: r.status, campaign: { id: r.cid, name: r.name } })) } : {};
}

function publicOffers(db, coachId) {
  return db.prepare("SELECT * FROM campaigns WHERE coach_id=? AND status='live' AND public=1 ORDER BY starts_on").all(coachId).map(c => ({
    id: c.id, name: c.name, tagline: c.tagline, description: c.description, startMode: c.start_mode, startsOn: c.starts_on, endsOn: c.start_mode === 'fixed' ? campaignEnd(c) : null,
    lengthDays: c.length_days, feePence: c.fee_pence, placesLeft: placesLeft(db, c),
  }));
}

/** Facts for one batch of clients: the active campaigns, the lowest pace and the soonest end. */
function activeFacts(db, coachId, clientIds, today) {
  const out = new Map();
  if (!clientIds.length) return out;
  const rows = db.prepare(`SELECT e.* FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.status='active' AND e.client_id IN (SELECT value FROM json_each(?))`)
    .all(coachId, JSON.stringify(clientIds));
  for (const e of rows) {
    const c = campaignRow(db, e.campaign_id);
    const s = statsOf(e, c, activitiesOf(db, c.id), progressOf(db, e.id), today ?? londonDay());
    const cur = out.get(e.client_id) ?? { ids: [], pace: null, ends: null };
    cur.ids.push(c.id);
    cur.pace = cur.pace === null ? s.pace : Math.min(cur.pace, s.pace);
    const left = daysBetween(today ?? londonDay(), lastDay(e, c));
    cur.ends = cur.ends === null ? left : Math.min(cur.ends, left);
    out.set(e.client_id, cur);
  }
  return out;
}
const factMap = (pick, fallback = null) => (db, coachId, ids, today) => {
  const f = activeFacts(db, coachId, ids, today);
  return new Map(ids.map(id => [id, f.has(id) ? pick(f.get(id)) : fallback]));
};

/** The client's soonest-ending active enrolment (variables). */
function currentOf(db, coachId, client) {
  const rows = db.prepare(`SELECT e.* FROM campaign_enrolments e JOIN campaigns c ON c.id=e.campaign_id AND c.coach_id=? WHERE e.client_id=? AND e.status='active'`).all(coachId, client.id);
  if (!rows.length) return null;
  const withC = rows.map(e => ({ e, c: campaignRow(db, e.campaign_id) })).sort((a, b) => lastDay(a.e, a.c).localeCompare(lastDay(b.e, b.c)));
  return withC[0];
}

// MARK: - The feature

export const feature = {
  name: 'campaigns',
  namespaces: ['campaign'],
  exact: [],
  schema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
        cover_media_id TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','ended','archived')),
        start_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (start_mode IN ('fixed','rolling')),
        starts_on TEXT, ends_on TEXT, length_days INTEGER NOT NULL CHECK (length_days BETWEEN 1 AND 366),
        fee_pence INTEGER NOT NULL DEFAULT 0, capacity INTEGER, waitlist INTEGER NOT NULL DEFAULT 1,
        public INTEGER NOT NULL DEFAULT 0, challenge_id TEXT REFERENCES challenges(id) ON DELETE SET NULL,
        settings TEXT NOT NULL DEFAULT '{"dailyNudge":true,"nudgeAt":"07:00","showRank":false}',
        welcome_text TEXT NOT NULL DEFAULT '', completion_text TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS campaigns_coach ON campaigns(coach_id, status);
      CREATE TABLE IF NOT EXISTS campaign_phases (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        name TEXT NOT NULL, start_day INTEGER NOT NULL, end_day INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT 'chart-1', guide_id TEXT, summary TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS campaign_activities (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        phase_id TEXT REFERENCES campaign_phases(id) ON DELETE SET NULL,
        day INTEGER NOT NULL, title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('task','workout','habit','checkin','read','purchase','session','measure','custom')),
        detail TEXT NOT NULL DEFAULT '', guide_id TEXT, blocks TEXT, link_ref TEXT,
        points INTEGER NOT NULL DEFAULT 10, required INTEGER NOT NULL DEFAULT 1, spend_pence INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS campaign_activities_campaign ON campaign_activities(campaign_id, day);
      CREATE TABLE IF NOT EXISTS campaign_kit (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        name TEXT NOT NULL, est_pence INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0,
        url TEXT, note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS campaign_enrolments (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'invited'
          CHECK (status IN ('invited','waitlisted','declined','active','paused','completed','dropped')),
        start_on TEXT, points INTEGER NOT NULL DEFAULT 0,
        fee_pence INTEGER NOT NULL DEFAULT 0, discount_code TEXT, discount_pence INTEGER NOT NULL DEFAULT 0, invoice_wanted INTEGER NOT NULL DEFAULT 1,
        lay_program INTEGER NOT NULL DEFAULT 0,
        accepted_via TEXT CHECK (accepted_via IN ('app','plan','inPerson')),
        paused_at TEXT, paused_days INTEGER NOT NULL DEFAULT 0, behind_since TEXT, note TEXT,
        invited_at TEXT NOT NULL, responded_at TEXT, enrolled_at TEXT, completed_at TEXT, dropped_at TEXT,
        UNIQUE (campaign_id, client_id));
      CREATE INDEX IF NOT EXISTS campaign_enrolments_client ON campaign_enrolments(client_id, status);
      CREATE INDEX IF NOT EXISTS campaign_enrolments_coach ON campaign_enrolments(coach_id);
      CREATE TABLE IF NOT EXISTS campaign_progress (
        enrolment_id TEXT NOT NULL REFERENCES campaign_enrolments(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        done_at TEXT NOT NULL, value REAL, note TEXT, media_id TEXT,
        spent_pence INTEGER,
        PRIMARY KEY (enrolment_id, item_id));
      CREATE INDEX IF NOT EXISTS campaign_progress_client ON campaign_progress(client_id);
      CREATE TABLE IF NOT EXISTS campaign_nudges (
        enrolment_id TEXT NOT NULL REFERENCES campaign_enrolments(id) ON DELETE CASCADE,
        day TEXT NOT NULL, message_id TEXT, PRIMARY KEY (enrolment_id, day));`);
  },
  routes(r) {
    // Specific paths before /api/campaigns/:id.
    r.add('GET', '/api/campaigns/mine', myCampaigns);
    r.add('GET', '/api/campaigns/ending', ending);
    r.add('GET', '/api/campaigns/mine/:eid', myDetail);
    r.add('POST', '/api/campaigns/mine/:eid/accept', myAccept);
    r.add('POST', '/api/campaigns/mine/:eid/decline', myDecline);
    r.add('POST', '/api/campaigns/mine/:eid/items/:itemId', myItem);
    r.add('GET', '/api/campaigns', listCampaigns);
    r.add('POST', '/api/campaigns', createCampaign);
    r.add('GET', '/api/campaigns/:id', getCampaign);
    r.add('PUT', '/api/campaigns/:id', saveCampaign);
    r.add('DELETE', '/api/campaigns/:id', deleteCampaign);
    r.add('POST', '/api/campaigns/:id/status', setStatus);
    r.add('POST', '/api/campaigns/:id/duplicate', duplicate);
    r.add('POST', '/api/campaigns/:id/enrol', enrol);
    r.add('POST', '/api/campaigns/:id/invitation-preview', preview);
    r.add('POST', '/api/campaigns/:id/enrolments/:eid/resend', resend);
    r.add('DELETE', '/api/campaigns/:id/enrolments/:eid', unenrol);
    r.add('GET', '/api/campaigns/:id/board', board);
    r.add('POST', '/api/campaigns/:id/announce', announce);
    r.add('POST', '/api/campaigns/:id/nudge', nudgeBehind);
    r.add('GET', '/api/coach/clients/:id/campaigns', clientCampaigns);
    // The public plan page (6.5): HMAC-signed links only, no session.
    r.add('GET', '/plan/:token', planGet, { public: true });
    r.add('POST', '/plan/:token', planPost, { public: true, rawBody: 4096 });
    r.add('GET', '/plan/:token/guide/:guideId', planGuide, { public: true });
    r.add('GET', '/plan/:token/media/:mediaId', planMedia, { public: true });
  },
  clocks: [{ id: 'campaigns.tick', everyMs: 5 * 60_000, run: (db, config, now) => sweep(db, config, now) }],
  on: {
    'day.started': (db, config, ev) => { sweep(db, config, new Date(ev.at), { coachId: ev.coachId }); },
    'client.paused': onPaused,
    'client.resumed': onResumed,
    'client.offboarded': onOffboarded,
  },
  emits: {
    'campaign.invited': { label: 'A client was invited to a campaign', payload: ['enrolmentId', 'campaignId'] },
    'campaign.declined': { label: 'A client declined a campaign (or the invitation expired)', payload: ['enrolmentId', 'campaignId', 'reason'] },
    'campaign.waitlisted': { label: 'A client joined a campaign waitlist', payload: ['enrolmentId', 'campaignId'] },
    'campaign.enrolled': { label: 'A client accepted a campaign', payload: ['enrolmentId', 'campaignId', 'feePence', 'invoice', 'campaignName', 'discountCode', 'discountPence', 'startOn', 'via'] },
    'campaign.activityDue': { label: 'Campaign activities are due today', payload: ['enrolmentId', 'campaignId', 'day', 'count'] },
    'campaign.activityDone': { label: 'A client ticked a campaign activity', payload: ['enrolmentId', 'campaignId', 'itemId'] },
    'campaign.behind': { label: 'A client fell behind pace on a campaign', payload: ['enrolmentId', 'campaignId', 'pace'] },
    'campaign.completed': { label: 'A client completed a campaign', payload: ['enrolmentId', 'campaignId'] },
    'campaign.dropped': { label: 'A client left a campaign', payload: ['enrolmentId', 'campaignId', 'reason'] },
  },
  actions: {
    'campaign.enrol': {
      label: 'Invite to a campaign', clientFacing: true,
      params: [{ key: 'campaignId', label: 'Campaign', type: 'campaign', required: true }],
      options: (db, coachId) => db.prepare("SELECT id value, name label FROM campaigns WHERE coach_id=? AND status='live' ORDER BY name").all(coachId),
      run(db, config, ctx) {
        remember(db, config);
        const c = db.prepare("SELECT * FROM campaigns WHERE id=? AND coach_id=? AND status='live'").get(ctx.params.campaignId, ctx.coachId);
        if (!c) return 'Skipped: campaign not live';
        const existing = db.prepare('SELECT * FROM campaign_enrolments WHERE campaign_id=? AND client_id=?').get(c.id, ctx.client.id);
        if (existing && !['declined', 'dropped'].includes(existing.status)) return `Skipped: already ${existing.status}`;
        const now = ctx.now ?? new Date();
        const id = existing?.id ?? newId('ce');
        if (existing) {
          db.prepare(`UPDATE campaign_enrolments SET status='invited', invited_at=?, fee_pence=?, discount_code=NULL, discount_pence=0, invoice_wanted=1, lay_program=0, responded_at=NULL,
            enrolled_at=NULL, completed_at=NULL, dropped_at=NULL, accepted_via=NULL, points=0, start_on=NULL, paused_at=NULL, paused_days=0, behind_since=NULL, note=NULL WHERE id=?`).run(now.toISOString(), c.fee_pence, id);
          db.prepare('DELETE FROM campaign_progress WHERE enrolment_id=?').run(id);
          db.prepare('DELETE FROM campaign_nudges WHERE enrolment_id=?').run(id);
        }
        else db.prepare(`INSERT INTO campaign_enrolments (id, campaign_id, coach_id, client_id, status, fee_pence, invited_at) VALUES (?,?,?,?,'invited',?,?)`).run(id, c.id, ctx.coachId, ctx.client.id, c.fee_pence, now.toISOString());
        const e = reload(db, id);
        // Always an invitation: automations never enrol anyone into spending.
        const r = sendInvitation(db, config, c, e, now, ctx.via ?? 'automation');
        evt(db, 'campaign.invited', c, e, `Invited to ${c.name}`, { by: 'automation' });
        return r.message ? 'Invited' : r.deferredUntil ? 'Invited (message held by the outreach rules)' : `Invited, message skipped: ${r.skipped}`;
      },
    },
  },
  facts: {
    'campaign.active': { label: 'Active campaigns', type: 'tags', compute: factMap(x => x.ids, []) },
    'campaign.pace': { label: 'Campaign pace (lowest active, %)', type: 'number', compute: factMap(x => x.pace) },
    'campaign.endsInDays': { label: 'Days until a campaign ends', type: 'days', compute: factMap(x => x.ends) },
  },
  variables: {
    campaign: { label: 'Campaign name', value: (db, coachId, client) => currentOf(db, coachId, client)?.c.name ?? null },
    campaignDay: { label: 'Campaign day ("Day 12")', value: (db, coachId, client) => { const x = currentOf(db, coachId, client); return x ? String(dayIndex(x.e, x.c, londonDay()) + 1) : null; } },
    campaignToday: { label: 'Today\'s campaign activities', value: (db, coachId, client) => {
      const x = currentOf(db, coachId, client);
      if (!x) return null;
      const idx = dayIndex(x.e, x.c, londonDay());
      const list = activitiesOf(db, x.c.id).filter(a => a.day === idx).map(a => a.title);
      return list.length ? list.join(', ') : null;
    } },
    planLink: { label: 'Link to the client\'s campaign plan page', value: (db, coachId, client) => {
      const x = currentOf(db, coachId, client);
      const config = configs.get(db);
      return x && config ? planLink(config, x.e.id) : null;
    } },
  },
  needs,
  search,
  timeline: timelineHook,
  diary: diaryHook,
  forecast: forecastHook,
  exportFor,
  renewals,
  offboarding,
  publicOffers,
  demo: {
    // No demo.tables: older tests build the demo before createApp has run feature schemas, so the foundation's wipe
    // would hit missing tables. buildDemo creates the tables if needed and clears the demo accounts' rows itself.
    build(db, ctx) { buildDemo(db, ctx); },
  },
};

// MARK: - Demo world

/**
 * "12-Week Marathon Build" (live, fixed, started 23 days ago, capacity 6, £49,
 * 4 phases, ~60 activities with guides, 6 kit items, four enrolled with
 * varied progress and spend, one invitation pending, one declined);
 * "January Reset" (live, rolling, 30 days, public, no one in it yet); "Ski-fit 6 weeks"
 * (ended, two completed). Rows only: no events, no messages.
 */
function buildDemo(db, { coach, clients, byName, today, rng }) {
  feature.schema(db);
  const ids = JSON.stringify([coach.id, ...clients.map(c => c.id)]);
  db.prepare('DELETE FROM campaign_enrolments WHERE client_id IN (SELECT value FROM json_each(?))').run(ids);
  db.prepare('DELETE FROM campaigns WHERE coach_id=?').run(coach.id);
  const guides = buildDemoGuides(db, { coach, clients, today });
  const at = (d, t = '07:30') => new Date(`${d}T${t}:00.000Z`).toISOString();
  const nowIs = nowIso();
  const insertCampaign = (fields) => {
    const id = newId('cg');
    db.prepare(`INSERT INTO campaigns (id, coach_id, name, tagline, description, status, start_mode, starts_on, length_days, fee_pence, capacity, waitlist, public, settings,
      welcome_text, completion_text, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, coach.id, fields.name, fields.tagline, fields.description, fields.status, fields.startMode, fields.startsOn ?? null, fields.lengthDays, fields.feePence ?? 0,
        fields.capacity ?? null, fields.waitlist ?? 1, fields.public ?? 0, JSON.stringify({ ...DEFAULT_SETTINGS, ...(fields.settings ?? {}) }),
        fields.welcome ?? '', fields.completion ?? '', at(addDays(today, -40)), nowIs);
    return id;
  };

  // 12-Week Marathon Build
  const start = addDays(today, -23);
  const mid = insertCampaign({ name: '12-Week Marathon Build', tagline: 'From 10 km to race day, one week at a time', status: 'live', startMode: 'fixed', startsOn: start, lengthDays: 84,
    feePence: 4900, capacity: 6, settings: { showRank: true },
    description: 'Three runs a week, one strength session, a long run that grows every weekend and a proper taper. Built for the spring marathon.',
    welcome: 'Welcome to the build. Read "Your first week" before Monday and tick as you go.', completion: 'You did it. Twelve weeks, every long run. Enjoy race day.' });
  const acts = [
    { day: 0, title: 'Read: Your first week', kind: 'read', guide: 'Your first week', points: 5 },
    { day: 1, title: 'Buy race shoes', kind: 'purchase', spendPence: 12000, kitIndex: 0, detail: 'Get fitted. Neutral unless you have been told otherwise.', points: 5 },
    { day: 2, title: 'Starting 5 km time trial', kind: 'measure', detail: 'Flat route, record the time.', points: 15 },
  ];
  for (let w = 0; w < 12; w++) {
    const long = [10, 12, 14, 16, 18, 16, 20, 22, 24, 26, 18, 12][w];
    acts.push(
      { day: W(w, 0), title: w < 10 ? 'Easy run 6 km' : 'Easy run 5 km', kind: 'workout', detail: 'Conversational pace. You should be able to talk.' },
      { day: W(w, 2), title: w < 3 ? 'Hills 8 × 60 s' : w < 9 ? 'Intervals 6 × 800 m' : 'Race-pace 5 km', kind: 'workout', points: 15 },
      { day: W(w, 3), title: 'Mobility 10', kind: 'habit', guide: 'Mobility 10', points: 5, required: false },
      { day: W(w, 5), title: `Long run ${long} km`, kind: 'workout', points: 20, guide: w >= 10 ? 'Taper week' : 'Fuel the long run' },
      { day: W(w, 6), title: 'Weekly check-in', kind: 'checkin', points: 5 },
    );
  }
  acts.push({ day: 77, title: 'Race-day kit check', kind: 'task', detail: 'Lay everything out. Nothing new on race day.', points: 10 });
  const marathon = writeContent(db, mid, {
    phases: [['Base', 0, 20, 'chart-2', 'Your first week', 'Easy miles, hills and habits.'], ['Build', 21, 48, 'chart-1', 'Fuel the long run', 'Long runs grow; practise fuelling.'],
      ['Peak', 49, 69, 'chart-5', 'Mobility 10', 'Biggest weeks. Sleep and mobility matter most.'], ['Taper', 70, 83, 'chart-3', 'Taper week', 'Less volume, same intensity.']],
    kit: [{ name: 'Running shoes', estPence: 12000, required: true, url: 'https://www.runnersneed.com/', note: 'Get fitted in store.' }, { name: 'Energy gels (box of 12)', estPence: 2500, required: true },
      { name: 'Running belt', estPence: 1500, required: false }, { name: 'Foam roller', estPence: 2000, required: false },
      { name: 'Anti-chafe balm', estPence: 800, required: true }, { name: 'Reflective vest', estPence: 1800, required: false }],
    activities: acts,
  }, { guides });
  const mActs = activitiesOf(db, mid);
  const mKit = kitOf(db, mid);
  const enrolDemo = (cid, client, status, extra = {}) => {
    const id = newId('ce');
    db.prepare(`INSERT INTO campaign_enrolments (id, campaign_id, coach_id, client_id, status, start_on, fee_pence, accepted_via, invited_at, responded_at, enrolled_at, completed_at, behind_since, note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, cid, coach.id, client.id, status, extra.startOn ?? null, extra.fee ?? 0, extra.via ?? null,
      extra.invitedAt, extra.respondedAt ?? null, extra.enrolledAt ?? null, extra.completedAt ?? null, extra.behindSince ?? null, extra.note ?? null);
    return id;
  };
  const tick = (eid, client, items, idx, rate, spend = {}) => {
    for (const a of items) {
      if (a.day > idx) continue;
      if (!(a.day === idx ? rng.chance(rate * 0.5) : rng.chance(rate))) continue;
      db.prepare('INSERT OR IGNORE INTO campaign_progress (enrolment_id, client_id, item_id, done_at, spent_pence) VALUES (?,?,?,?,?)')
        .run(eid, client.id, a.id, at(addDays(start, a.day), `0${6 + (a.day % 3)}:1${a.day % 6}`), spend[a.id] ?? (a.kind === 'purchase' && !a.link_ref ? a.spend_pence + rng.int(-1500, 2500) : null));
    }
  };
  const idx = 23;
  const people = [['Priya', 0.98, 'app', -27], ['Rory', 0.88, 'plan', -26], ['Sam', 0.78, 'inPerson', -25], ['Leo', 0.42, 'app', -24]];
  for (const [name, rate, via, invited] of people) {
    const client = byName[name];
    if (!client) continue;
    const eid = enrolDemo(mid, client, 'active', { startOn: start, fee: 4900, via, invitedAt: at(addDays(today, invited), '18:00'), respondedAt: at(addDays(today, invited + 1), '08:12'),
      enrolledAt: at(addDays(today, invited + 1), '08:12'), behindSince: name === 'Leo' ? addDays(today, -5) : null });
    tick(eid, client, mActs, idx, rate);
    // Kit: bought ticks with what they actually spent.
    const spent = { Priya: [13499, 2600, 1500, 900], Rory: [11000, 2400, null, 750], Sam: [12999, 2500, 2200, 800], Leo: [8999, null, null, null] }[name];
    [0, 1, name === 'Sam' ? 3 : 2, 4].forEach((ki, j) => {
      if (spent[j] === null || spent[j] === undefined || !mKit[ki]) return;
      db.prepare('INSERT OR IGNORE INTO campaign_progress (enrolment_id, client_id, item_id, done_at, spent_pence) VALUES (?,?,?,?,?)').run(eid, client.id, mKit[ki].id, at(addDays(start, 1 + j), '12:40'), spent[j]);
    });
    recomputePoints(db, eid);
    for (let d = 0; d < idx; d++) db.prepare('INSERT OR IGNORE INTO campaign_nudges (enrolment_id, day) VALUES (?,?)').run(eid, addDays(start, d));
  }
  if (byName.Alex) enrolDemo(mid, byName.Alex, 'invited', { fee: 4900, invitedAt: at(addDays(today, -2), '19:05') });
  if (byName.Tom) enrolDemo(mid, byName.Tom, 'declined', { fee: 4900, invitedAt: at(addDays(today, -27), '18:00'), respondedAt: at(addDays(today, -26), '21:30'), note: 'Not this time: work travel' });

  // January Reset: rolling, 30 days, public. Live (open for sign-ups, nobody in it yet) rather than the spec's draft, so the public
  // offer page and F28's demo (3 interested leads) have it: publicOffers lists live campaigns only, and a draft is never public.
  const jan = insertCampaign({ name: 'January Reset', tagline: 'Thirty days to get the basics back', status: 'live', startMode: 'rolling', lengthDays: 30, public: 1,
    description: 'A daily walk, protein at breakfast, lights out by eleven and one short session a week. Small things, every day.', welcome: 'Start when you are ready. One day at a time.' });
  const janActs = [{ day: 0, title: 'Read: Your first week', kind: 'read', guide: 'Your first week', points: 5 }, { day: 0, title: 'Starting weight and waist', kind: 'measure', points: 10 }];
  for (let d = 0; d < 30; d++) janActs.push({ day: d, title: 'Walk after a meal', kind: 'habit', points: 5, detail: '10 minutes, any meal.' });
  for (let w = 0; w < 4; w++) janActs.push({ day: Math.min(29, W(w, 2)), title: 'Full-body circuit', kind: 'workout', points: 15 }, { day: Math.min(29, W(w, 6)), title: 'Weekly check-in', kind: 'checkin', points: 5 });
  janActs.push({ day: 6, title: 'Read: Sleep basics', kind: 'read', guide: 'Sleep basics', points: 5 }, { day: 29, title: 'Finishing measurements', kind: 'measure', points: 20 });
  writeContent(db, jan, { phases: [['Reset', 0, 9, 'chart-3', 'Your first week', 'Walk daily and sleep on time.'], ['Rebuild', 10, 19, 'chart-2', 'Sleep basics', 'Add a session.'], ['Lock it in', 20, 29, 'chart-1', null, 'Make it yours.']],
    kit: [{ name: 'Water bottle', estPence: 1200, required: false }, { name: 'Step tracker (optional)', estPence: 3000, required: false }], activities: janActs }, { guides });

  // Ski-fit 6 weeks: ended, two completed
  const skiStart = addDays(today, -60);
  const ski = insertCampaign({ name: 'Ski-fit 6 weeks', tagline: 'Legs, lungs and knees for the slopes', status: 'ended', startMode: 'fixed', startsOn: skiStart, lengthDays: 42, feePence: 3500, capacity: 8,
    description: 'Strength, power and balance for a week on the mountain.', completion: 'Ready for the hill. Send me a photo from the top.' });
  const skiActs = [];
  for (let w = 0; w < 6; w++) skiActs.push({ day: W(w, 0), title: 'Ski strength', kind: 'workout', guide: 'Ski-fit warm-up', points: 15 }, { day: W(w, 2), title: 'Balance and landings', kind: 'workout', points: 15 }, { day: W(w, 4), title: 'Intervals on the bike', kind: 'workout', points: 10 }, { day: W(w, 6), title: 'Weekly check-in', kind: 'checkin', points: 5 });
  writeContent(db, ski, { phases: [['Strength', 0, 13, 'chart-4', 'Ski-fit warm-up', ''], ['Power', 14, 27, 'chart-1', null, ''], ['Hill-ready', 28, 41, 'chart-3', null, '']],
    kit: [{ name: 'Resistance bands', estPence: 1800, required: true }, { name: 'Balance pad', estPence: 2500, required: false }], activities: skiActs }, { guides });
  const sActs = activitiesOf(db, ski);
  for (const name of ['Sam', 'Alex']) {
    const client = byName[name];
    if (!client) continue;
    const eid = enrolDemo(ski, client, 'completed', { startOn: skiStart, fee: 3500, via: 'app', invitedAt: at(addDays(skiStart, -6), '18:00'), respondedAt: at(addDays(skiStart, -5), '07:40'),
      enrolledAt: at(addDays(skiStart, -5), '07:40'), completedAt: at(addDays(skiStart, 42), '07:00') });
    for (const a of sActs) db.prepare('INSERT OR IGNORE INTO campaign_progress (enrolment_id, client_id, item_id, done_at) VALUES (?,?,?,?)').run(eid, client.id, a.id, at(addDays(skiStart, a.day), '18:20'));
    recomputePoints(db, eid);
  }
  if (byName.Priya) enrolDemo(ski, byName.Priya, 'declined', { fee: 3500, invitedAt: at(addDays(skiStart, -6), '18:00'), respondedAt: at(addDays(skiStart, -4), '12:00') });
}
