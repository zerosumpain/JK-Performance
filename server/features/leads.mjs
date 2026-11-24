import { clientFor, initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { fail, num, oneOf, raw, str } from '../http.mjs';
import { notifyCoach } from '../notifications.mjs';
import { limit } from '../ratelimit.mjs';
import { hooks } from '../registry.mjs';
import { coachPref, newId, nowIso, tx } from '../store.mjs';
import { addDays, daysBetween, londonDay, londonToUtc } from '../time.mjs';

/**
 * F6 Leads pipeline and the public enquiry form (docs/design/desk-v2.md F6,
 * WP11). Every enquiry, referral or person met at the gym is a lead: a row
 * that is not a user. The coach moves it from Enquiry to Won on a board; when
 * the person signs up in the app (client.joined, matched by e-mail) the lead
 * becomes a client automatically.
 *
 * The public page /enquire/<slug> is server-rendered HTML with no script, its
 * own strict CSP and its own stylesheet (/enquire.css). It is rate-limited,
 * honeypotted and consent-gated; leads that never become clients are deleted
 * 12 months after they were last touched (the promise printed on the form).
 *
 * Lead names never go into event summaries (events outlive the 12-month
 * purge by up to 400 days); notifications (pruned at 90 days) may carry them.
 */

export const STAGES = ['enquiry', 'contacted', 'consult', 'trial', 'won', 'lost'];
const OPEN = ['enquiry', 'contacted', 'consult', 'trial'];
const FUNNEL = ['enquiry', 'contacted', 'consult', 'trial', 'won'];
export const STAGE_LABEL = { enquiry: 'Enquiry', contacted: 'Contacted', consult: 'Consult booked', trial: 'Trial', won: 'Won', lost: 'Lost' };
export const PROBABILITY = { enquiry: 0.1, contacted: 0.2, consult: 0.4, trial: 0.6, won: 1, lost: 0 };
export const SOURCES = ['manual', 'enquiryForm', 'referral', 'instagram', 'word', 'event', 'other'];
export const SOURCE_LABEL = { manual: 'Added by you', enquiryForm: 'Enquiry form', referral: 'Referral', instagram: 'Instagram', word: 'Word of mouth', event: 'Event', other: 'Other' };
export const LOST_REASONS = ['price', 'timing', 'location', 'fit', 'noReply', 'other'];
const LOST_LABEL = { price: 'Price', timing: 'Timing', location: 'Location', fit: 'Not the right fit', noReply: 'No reply', other: 'Other' };
const ACTIVITY_KINDS = ['note', 'call', 'email', 'message'];
export const FORM_FIELDS = ['goal', 'experience', 'times', 'budget'];
const SLUG = /^[a-z0-9-]{3,40}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"'?&#%]{1,64}@[^\s@<>()[\]\\,;:"'?&#%]{1,120}\.[A-Za-z]{2,24}$/;
const PHONE = /^[0-9+()\-.\s]{6,24}$/;
const MAX_VALUE = 1_000_000; // £10,000 a month: anything above is a typo
const PURGE_MONTHS = 12;
const rank = stage => FUNNEL.indexOf(stage);

// MARK: - Schema

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, email TEXT, phone TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_detail TEXT NOT NULL DEFAULT '', referral_code TEXT, campaign_id TEXT,
      stage TEXT NOT NULL DEFAULT 'enquiry' CHECK (stage IN ('enquiry','contacted','consult','trial','won','lost')),
      position REAL NOT NULL DEFAULT 0, value_pence INTEGER NOT NULL DEFAULT 0,
      answers TEXT NOT NULL DEFAULT '{}', consent_at TEXT,
      next_action_on TEXT, lost_reason TEXT, lost_note TEXT,
      client_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT,
      reached TEXT NOT NULL DEFAULT 'enquiry');
    CREATE INDEX IF NOT EXISTS leads_coach_stage ON leads(coach_id, stage, position);
    CREATE INDEX IF NOT EXISTS leads_client ON leads(client_id);
    CREATE TABLE IF NOT EXISTS lead_activities (
      id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS lead_activities_lead ON lead_activities(lead_id, at);
    CREATE TABLE IF NOT EXISTS lead_forms (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '["goal","experience","times"]', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    -- Erasure: a client who deletes their account takes the enquiry that became them
    -- with it (the FK alone would only unlink it, leaving their name and answers).
    CREATE TRIGGER IF NOT EXISTS leads_erase_with_client BEFORE DELETE ON users
      BEGIN DELETE FROM leads WHERE client_id = OLD.id; END;`);
}

// MARK: - Shapes

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const campaignName = l => (l.source_detail?.startsWith('campaign:') ? l.source_detail.slice(9) : null);

/** A lead for the desk. The linked client shows only while it is still this coach's. */
export function leadOut(db, l, today = londonDay()) {
  const c = l.client_id ? db.prepare("SELECT id, name FROM users WHERE id=? AND role='client' AND coach_id=?").get(l.client_id, l.coach_id) : null;
  return {
    id: l.id, name: l.name, email: l.email, phone: l.phone,
    source: l.source, sourceLabel: SOURCE_LABEL[l.source] ?? l.source, sourceDetail: l.source_detail,
    referralCode: l.referral_code, campaignId: l.campaign_id, campaignName: campaignName(l),
    stage: l.stage, stageLabel: STAGE_LABEL[l.stage], position: l.position, reached: l.reached,
    valuePence: l.value_pence, probability: PROBABILITY[l.stage], weightedPence: Math.round(l.value_pence * PROBABILITY[l.stage]),
    answers: parse(l.answers, {}), consentAt: l.consent_at, nextActionOn: l.next_action_on,
    lostReason: l.lost_reason, lostReasonLabel: l.lost_reason ? LOST_LABEL[l.lost_reason] ?? l.lost_reason : null, lostNote: l.lost_note,
    client: c ? { id: c.id, name: c.name, initials: initials(c.name) } : null,
    createdAt: l.created_at, updatedAt: l.updated_at, closedAt: l.closed_at,
    ageDays: Math.max(0, daysBetween(londonDay(new Date(l.created_at)), today)),
  };
}

const activityOut = a => ({ id: a.id, kind: a.kind, text: a.text, at: a.at });

function totalsOf(rows) {
  const out = Object.fromEntries(STAGES.map(s => [s, { count: 0, valuePence: 0, weightedPence: 0 }]));
  for (const l of rows) {
    const t = out[l.stage];
    t.count++;
    t.valuePence += l.value_pence;
    t.weightedPence += Math.round(l.value_pence * PROBABILITY[l.stage]);
  }
  return out;
}

export function logActivity(db, lead, kind, text, at = nowIso()) {
  const id = newId('la');
  db.prepare('INSERT INTO lead_activities (id, lead_id, coach_id, kind, text, at) VALUES (?,?,?,?,?,?)').run(id, lead.id, lead.coach_id, kind, String(text).slice(0, 2000), at);
  return db.prepare('SELECT * FROM lead_activities WHERE id=?').get(id);
}

const formUrl = (config, slug) => `${String(config.publicUrl || '').replace(/\/$/, '')}/enquire/${slug}`;
const formOut = f => ({ id: f.id, slug: f.slug, title: f.title, intro: f.intro, fields: parse(f.fields, []), active: !!f.active, exists: true, updatedAt: f.updated_at });

// MARK: - Input checks

const email = (v, { optional = true } = {}) => {
  if (v === undefined || v === null || v === '') { if (optional) return null; fail(400, 'email is required'); }
  const e = str(v, 'email', { max: 190 }).toLowerCase();
  if (!EMAIL.test(e)) fail(400, 'email does not look like an e-mail address');
  return e;
};
const phone = v => {
  if (v === undefined || v === null || v === '') return null;
  const p = str(v, 'phone', { max: 24 });
  if (!PHONE.test(p)) fail(400, 'phone may hold digits, spaces and + ( ) - only');
  return p;
};
const dayOrNull = (v, name) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) fail(400, `${name} must be YYYY-MM-DD`);
  return v;
};
const pence = (v, name) => num(v, name, { min: 0, max: MAX_VALUE, int: true });

// MARK: - Coach API

function listLeads(_req, ctx) {
  requireCoach(ctx);
  const today = londonDay(requestNow(ctx));
  const where = ['coach_id=?'], args = [ctx.user.id];
  if (ctx.query.stage) { where.push('stage=?'); args.push(oneOf(ctx.query.stage, 'stage', STAGES)); }
  const all = ctx.db.prepare(`SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY stage, position, created_at DESC`).all(...args);
  const q = String(ctx.query.q ?? '').trim().toLowerCase();
  const rows = q ? all.filter(l => [l.name, l.email, l.phone, l.source_detail, l.referral_code].some(v => String(v ?? '').toLowerCase().includes(q))) : all;
  return { leads: rows.map(l => leadOut(ctx.db, l, today)), totals: totalsOf(rows) };
}

/** Insert a lead and its "created" activity; emits lead.created. Runs inside the caller's tx. */
export function createLead(db, coachId, b, { activity = 'Added by you', now = new Date() } = {}) {
  const id = newId('ld');
  const at = now.toISOString();
  const top = db.prepare("SELECT MIN(position) p FROM leads WHERE coach_id=? AND stage='enquiry'").get(coachId).p;
  db.prepare(`INSERT INTO leads (id, coach_id, name, email, phone, source, source_detail, referral_code, campaign_id, stage, position, value_pence,
      answers, consent_at, next_action_on, created_at, updated_at, reached) VALUES (?,?,?,?,?,?,?,?,?,'enquiry',?,?,?,?,?,?,?,'enquiry')`)
    .run(id, coachId, b.name, b.email ?? null, b.phone ?? null, b.source ?? 'manual', b.sourceDetail ?? '', b.referralCode ?? null, b.campaignId ?? null,
      top === null ? 0 : top - 1, b.valuePence ?? 0, JSON.stringify(b.answers ?? {}), b.consentAt ?? null, b.nextActionOn ?? null, at, at);
  const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(id);
  logActivity(db, lead, 'created', activity, at);
  if (b.note) logActivity(db, lead, 'note', b.note, at);
  emit(db, 'lead.created', {
    coachId, summary: `New lead · ${SOURCE_LABEL[lead.source] ?? lead.source}`,
    leadId: id, source: lead.source, ...(lead.referral_code ? { referralCode: lead.referral_code } : {}), ...(lead.campaign_id ? { campaignId: lead.campaign_id } : {}),
  });
  return lead;
}

function addLead(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const input = {
    name: str(b.name, 'name', { max: 80 }), email: email(b.email), phone: phone(b.phone),
    source: b.source === undefined ? 'manual' : oneOf(b.source, 'source', SOURCES),
    sourceDetail: str(b.sourceDetail, 'sourceDetail', { max: 120, min: 0, optional: true }) ?? '',
    valuePence: b.valuePence === undefined || b.valuePence === null ? 0 : pence(b.valuePence, 'valuePence'),
    note: str(b.note, 'note', { max: 2000, min: 0, optional: true }) || null,
    nextActionOn: dayOrNull(b.nextActionOn, 'nextActionOn') ?? null,
  };
  const now = requestNow(ctx);
  const lead = tx(ctx.db, () => createLead(ctx.db, ctx.user.id, input, { now }));
  return { lead: leadOut(ctx.db, lead, londonDay(now)) };
}

function getLead(_req, ctx) {
  requireCoach(ctx);
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const activities = ctx.db.prepare('SELECT * FROM lead_activities WHERE lead_id=? ORDER BY at DESC, rowid DESC LIMIT 200').all(l.id).map(activityOut);
  return { lead: leadOut(ctx.db, l, londonDay(requestNow(ctx))), activities };
}

function patchLead(_req, ctx) {
  requireCoach(ctx);
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const b = ctx.body;
  const set = {};
  if (b.name !== undefined) set.name = str(b.name, 'name', { max: 80 });
  if (b.email !== undefined) set.email = email(b.email);
  if (b.phone !== undefined) set.phone = phone(b.phone);
  if (b.source !== undefined) set.source = oneOf(b.source, 'source', SOURCES);
  if (b.sourceDetail !== undefined) set.source_detail = str(b.sourceDetail ?? '', 'sourceDetail', { max: 120, min: 0 });
  if (b.valuePence !== undefined) set.value_pence = pence(b.valuePence, 'valuePence');
  if (b.nextActionOn !== undefined) set.next_action_on = dayOrNull(b.nextActionOn, 'nextActionOn');
  if (b.lostNote !== undefined) set.lost_note = str(b.lostNote ?? '', 'lostNote', { max: 500, min: 0 }) || null;
  if (b.lostReason !== undefined) {
    if (l.stage !== 'lost') fail(400, 'lostReason is only for a lost lead');
    set.lost_reason = oneOf(b.lostReason, 'lostReason', LOST_REASONS);
  }
  if (b.stage !== undefined) fail(400, 'Move a lead with POST /api/leads/:id/move');
  if (!Object.keys(set).length) fail(400, 'Nothing to change');
  set.updated_at = nowIso();
  const cols = Object.keys(set);
  ctx.db.prepare(`UPDATE leads SET ${cols.map(c => `${c}=?`).join(', ')} WHERE id=?`).run(...cols.map(c => set[c]), l.id);
  return { lead: leadOut(ctx.db, ctx.db.prepare('SELECT * FROM leads WHERE id=?').get(l.id), londonDay(requestNow(ctx))) };
}

/** Change a lead's stage (and its place in the new column). Inside the caller's tx; emits the stage events. */
export function setStage(db, l, to, { lostReason = null, lostNote = null, clientId = undefined, now = new Date(), note = null } = {}) {
  const from = l.stage;
  const at = now.toISOString();
  const closed = to === 'won' || to === 'lost';
  const reached = to !== 'lost' && rank(to) > rank(l.reached) ? to : l.reached;
  db.prepare(`UPDATE leads SET stage=?, reached=?, closed_at=?, lost_reason=?, lost_note=?, updated_at=?${clientId !== undefined ? ', client_id=?' : ''} WHERE id=?`)
    .run(to, reached, closed ? (from === to ? l.closed_at ?? at : at) : null, to === 'lost' ? lostReason : null, to === 'lost' ? lostNote : null, at,
      ...(clientId !== undefined ? [clientId] : []), l.id);
  const after = db.prepare('SELECT * FROM leads WHERE id=?').get(l.id);
  if (from !== to) {
    logActivity(db, after, 'stage', note ?? `${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}${to === 'lost' && lostReason ? ` (${LOST_LABEL[lostReason]})` : ''}`, at);
    emit(db, 'lead.stageChanged', { coachId: l.coach_id, summary: `Lead moved to ${STAGE_LABEL[to]}`, leadId: l.id, from, to });
    if (to === 'lost') emit(db, 'lead.lost', { coachId: l.coach_id, summary: `Lead lost · ${LOST_LABEL[lostReason] ?? 'no reason'}`, leadId: l.id, reason: lostReason });
  }
  if (to === 'won' && (from !== 'won' || (clientId && clientId !== l.client_id))) {
    emit(db, 'lead.won', { coachId: l.coach_id, clientId: after.client_id ?? null, summary: 'Lead won', leadId: l.id });
  }
  return after;
}

/** Renumber a column so the lead sits at `index` (0 = top). */
function place(db, coachId, leadId, stage, index) {
  const ids = db.prepare('SELECT id FROM leads WHERE coach_id=? AND stage=? AND id<>? ORDER BY position, created_at DESC').all(coachId, stage, leadId).map(r => r.id);
  ids.splice(Math.max(0, Math.min(ids.length, index)), 0, leadId);
  const upd = db.prepare('UPDATE leads SET position=? WHERE id=?');
  ids.forEach((id, i) => upd.run(i, id));
}

function moveLead(_req, ctx) {
  requireCoach(ctx);
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const b = ctx.body;
  const to = oneOf(b.stage, 'stage', STAGES);
  const index = b.position === undefined ? 0 : num(b.position, 'position', { min: 0, max: 10_000, int: true });
  let lostReason = null, lostNote = null;
  if (to === 'lost') {
    if (!b.lostReason) fail(400, 'Say why the lead was lost');
    lostReason = oneOf(b.lostReason, 'lostReason', LOST_REASONS);
    lostNote = str(b.lostNote, 'lostNote', { max: 500, min: 0, optional: true }) || null;
  }
  const now = requestNow(ctx);
  const after = tx(ctx.db, () => {
    const moved = l.stage === to && !lostReason ? l : setStage(ctx.db, l, to, { lostReason, lostNote, now });
    place(ctx.db, ctx.user.id, l.id, to, index);
    return ctx.db.prepare('SELECT * FROM leads WHERE id=?').get(moved.id);
  });
  return { lead: leadOut(ctx.db, after, londonDay(now)) };
}

function addActivity(_req, ctx) {
  requireCoach(ctx);
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const kind = oneOf(ctx.body.kind, 'kind', ACTIVITY_KINDS);
  const text = str(ctx.body.text, 'text', { max: 2000 });
  const a = tx(ctx.db, () => {
    ctx.db.prepare('UPDATE leads SET updated_at=? WHERE id=?').run(nowIso(), l.id);
    return logActivity(ctx.db, l, kind, text);
  });
  return { activity: activityOut(a) };
}

function convertLead(_req, ctx) {
  requireCoach(ctx);
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const client = clientFor(ctx, ctx.body.clientId);
  const now = requestNow(ctx);
  const after = tx(ctx.db, () => {
    const won = setStage(ctx.db, l, 'won', { clientId: client.id, now, note: l.stage === 'won' ? null : `${STAGE_LABEL[l.stage]} → Won` });
    logActivity(ctx.db, won, 'converted', `Linked to ${client.name}`, now.toISOString());
    return won;
  });
  return { lead: leadOut(ctx.db, after, londonDay(now)) };
}

function deleteLead(_req, ctx) {
  requireCoach(ctx);
  const l = ownRow(ctx, 'leads', ctx.params.id);
  tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM leads WHERE id=?').run(l.id);
    emit(ctx.db, 'lead.deleted', { coachId: ctx.user.id, summary: 'Lead deleted', leadId: l.id });
  });
  return { ok: true };
}

// MARK: - The enquiry form settings

const DEFAULT_FORM = { title: 'Train with JK', intro: 'Tell me a little about you and what you want from coaching. I read every enquiry myself and reply within a day.', fields: ['goal', 'experience', 'times'] };

function getForm(_req, ctx) {
  requireCoach(ctx);
  const f = ctx.db.prepare('SELECT * FROM lead_forms WHERE coach_id=?').get(ctx.user.id);
  if (!f) return { form: { slug: 'train-with-jk', ...DEFAULT_FORM, active: true, exists: false }, url: null };
  return { form: formOut(f), url: formUrl(ctx.config, f.slug) };
}

function putForm(_req, ctx) {
  requireCoach(ctx);
  const b = ctx.body;
  const slug = str(b.slug, 'slug', { max: 40, min: 3 }).toLowerCase();
  if (!SLUG.test(slug)) fail(400, 'slug may use a-z, 0-9 and dashes (3 to 40 characters)');
  const title = str(b.title, 'title', { max: 80 });
  const intro = str(b.intro ?? '', 'intro', { max: 600, min: 0 });
  const fields = b.fields === undefined ? DEFAULT_FORM.fields : b.fields;
  if (!Array.isArray(fields) || fields.some(x => !FORM_FIELDS.includes(x))) fail(400, `fields must be a list from ${FORM_FIELDS.join(', ')}`);
  const active = b.active === undefined ? true : !!b.active;
  const taken = ctx.db.prepare('SELECT coach_id FROM lead_forms WHERE slug=?').get(slug);
  if (taken && taken.coach_id !== ctx.user.id) fail(409, 'That address is taken. Try another.');
  const at = nowIso();
  ctx.db.prepare(`INSERT INTO lead_forms (id, coach_id, slug, title, intro, fields, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(coach_id) DO UPDATE SET slug=excluded.slug, title=excluded.title, intro=excluded.intro, fields=excluded.fields, active=excluded.active, updated_at=excluded.updated_at`)
    .run(newId('lf'), ctx.user.id, slug, title, intro, JSON.stringify(FORM_FIELDS.filter(x => fields.includes(x))), active ? 1 : 0, at, at);
  const f = ctx.db.prepare('SELECT * FROM lead_forms WHERE coach_id=?').get(ctx.user.id);
  return { form: formOut(f), url: formUrl(ctx.config, f.slug) };
}

/** The furthest stage each lead reached, as a funnel over the leads created in the window. */
export function funnelOf(db, coachId, sinceIso) {
  const rows = db.prepare('SELECT reached FROM leads WHERE coach_id=? AND created_at>=?').all(coachId, sinceIso);
  return FUNNEL.map((stage, i) => {
    const entered = rows.filter(r => rank(r.reached) >= i).length;
    const converted = stage === 'won' ? entered : rows.filter(r => rank(r.reached) > i).length;
    return { stage, label: STAGE_LABEL[stage], entered, converted };
  });
}

function funnel(_req, ctx) {
  requireCoach(ctx);
  const days = ctx.query.days === undefined ? 90 : num(Number(ctx.query.days), 'days', { min: 1, max: 3650, int: true });
  const since = londonToUtc(addDays(londonDay(requestNow(ctx)), -days)).toISOString();
  return { stages: funnelOf(ctx.db, ctx.user.id, since) };
}

// MARK: - The public enquiry page (no JS, its own CSP)

const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = p => `£${(p / 100).toLocaleString('en-GB', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = d => { const [y, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
export const CONSENT_TEXT = "JK may contact me about coaching. My details are kept for up to 12 months if I don't become a client.";

const EXPERIENCE = [['new', 'New to training'], ['some', 'Some experience'], ['regular', 'I train regularly'], ['athlete', 'Competitive athlete']];
const TIMES = [['early', 'Early mornings'], ['daytime', 'Daytime'], ['evening', 'Evenings'], ['weekend', 'Weekends']];
const BUDGET = [['under80', 'Up to £80 a month', 8000], ['80to150', '£80 to £150 a month', 12000], ['over150', '£150 or more a month', 18000], ['unsure', 'Not sure yet', 0]];
export const ANSWER_LABELS = { experience: Object.fromEntries(EXPERIENCE), times: Object.fromEntries(TIMES), budget: Object.fromEntries(BUDGET.map(([k, l]) => [k, l])) };

export const ENQUIRE_CSS = `:root{color-scheme:dark;--bg:#000;--card:#121212;--edge:#222;--line:#333;--text:#f2f2f2;--muted:#c8c8c8;--faint:#888;--accent:#D9D9D9;
--btn-top:#f4f4f4;--btn-bottom:#bdbdbd;--btn-text:#000;--error:#E8816F;--error-wash:rgba(232,129,111,.12);--focus:#D9D9D9}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 20px 80px}
.mark{display:inline-grid;place-items:center;width:56px;height:56px;border:1px solid #999;border-radius:12px;font-weight:600;font-size:22px}
h1{font-size:32px;line-height:1.15;margin:20px 0 6px;letter-spacing:-.01em}
.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin:24px 0 0}
.offer .eyebrow{margin:0}
p,li{color:var(--muted)}a{color:var(--text)}
.card{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:18px 20px;margin:16px 0}
.offer{border-color:var(--accent)}
.offer .eyebrow{color:var(--accent)}
.offer h2{margin:4px 0 2px;font-size:22px}
.offer .meta{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0 0;font-size:14px;color:var(--muted)}
.offer .meta b{color:var(--text);font-weight:600}
form{display:grid;gap:16px}
label{display:grid;gap:6px;font-weight:600;font-size:15px}
label .hint{font-weight:400;color:var(--faint);font-size:13px}
input[type=text],input[type=email],input[type=tel],select,textarea{width:100%;font:inherit;color:var(--text);background:#000;border:1px solid var(--line);border-radius:10px;padding:11px 12px}
textarea{min-height:96px;resize:vertical}
input:focus,select:focus,textarea:focus,button:focus{outline:2px solid var(--focus);outline-offset:2px}
fieldset{border:0;margin:0;padding:0;display:grid;gap:8px}
legend{font-weight:600;font-size:15px;margin-bottom:6px}
.choices{display:flex;flex-wrap:wrap;gap:8px}
.choice{display:inline-flex;align-items:center;gap:8px;font-weight:400;border:1px solid var(--line);border-radius:999px;padding:6px 14px 6px 10px}
.consent{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:14px;color:var(--muted)}
.consent input{margin-top:4px;width:18px;height:18px;flex:none}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.btn{justify-self:start;font:inherit;font-weight:600;border:0;cursor:pointer;padding:12px 24px;border-radius:12px;background:linear-gradient(var(--btn-top),var(--btn-bottom));color:var(--btn-text)}
.errors{border:1px solid var(--error);background:var(--error-wash);border-radius:12px;padding:10px 14px;color:var(--text)}
.errors ul{margin:4px 0 0;padding-left:20px}
.note{font-size:13px;color:var(--faint)}
.banner{font-size:13px;color:var(--text);border:1px dashed var(--accent);border-radius:10px;padding:8px 12px}
footer{margin-top:48px;font-size:13px;color:var(--faint)}`;

const page = (status, title, body) => raw(status, {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CSP,
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
}, `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · JK Performance</title><link rel="stylesheet" href="/enquire.css"></head><body><main><div class="mark">JK</div>${body}
<footer>JK Performance · <a href="/privacy">Privacy</a> · <a href="/support">Support</a></footer></main></body></html>`);

const notice = (status, eyebrow, title, line) => page(status, title, `<p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1><p>${esc(line)}</p>`);

/** The coach's live, public campaign with this id (through WP4's publicOffers hook), or null. Ended ones are ignored. */
function publicOffer(db, coachId, campaignId, today) {
  if (!campaignId || typeof campaignId !== 'string' || campaignId.length > 64) return null;
  for (const [f, fn] of hooks('publicOffers')) {
    try {
      const hit = (fn(db, coachId) ?? []).find(o => o && o.id === campaignId);
      if (hit && !(hit.endsOn && hit.endsOn < today)) return hit;
    } catch (e) { console.error(`publicOffers of ${f.name} failed`, e); }
  }
  return null;
}

function offerBlock(o) {
  const when = o.startsOn ? (o.endsOn ? `${shortDay(o.startsOn)} to ${shortDay(o.endsOn)}` : `From ${shortDay(o.startsOn)}`) : o.lengthDays ? `${o.lengthDays} days, starting when you join` : null;
  return `<section class="card offer" aria-label="Offer"><p class="eyebrow">Register interest</p><h2>${esc(o.name)}</h2>
${o.tagline ? `<p>${esc(o.tagline)}</p>` : ''}<p class="meta">${when ? `<span><b>Dates</b> ${esc(when)}</span>` : ''}<span><b>Fee</b> ${o.feePence ? esc(money(o.feePence)) : 'Free'}</span>${
  Number.isFinite(o.placesLeft) && o.placesLeft !== null ? `<span><b>Places left</b> ${esc(o.placesLeft)}</span>` : ''}</p></section>`;
}

function formPage(status, { form, coach, offer, values = {}, errors = [], ref = '', campaign = '' }) {
  const fields = parse(form.fields, []);
  const v = k => esc(values[k] ?? '');
  const sel = (name, opts, label) => `<label>${label}<select name="${name}"><option value="">Choose…</option>${opts.map(([k, l]) => `<option value="${k}"${values[name] === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const picked = new Set(values.times ?? []);
  const parts = [
    errors.length ? `<div class="errors" role="alert"><b>Please check the form</b><ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '',
    `<label>Your name<input type="text" name="name" required maxlength="80" autocomplete="name" value="${v('name')}"></label>`,
    `<label>E-mail<input type="email" name="email" required maxlength="190" autocomplete="email" value="${v('email')}"></label>`,
    `<label><span>Phone <span class="hint">Optional</span></span><input type="tel" name="phone" maxlength="24" autocomplete="tel" value="${v('phone')}"></label>`,
    fields.includes('goal') ? `<label>What would you like to achieve?<textarea name="goal" maxlength="1000">${v('goal')}</textarea></label>` : '',
    fields.includes('experience') ? sel('experience', EXPERIENCE, 'Your training so far') : '',
    fields.includes('times') ? `<fieldset><legend>When suits you to train?</legend><div class="choices">${TIMES.map(([k, l]) => `<label class="choice"><input type="checkbox" name="times" value="${k}"${picked.has(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div></fieldset>` : '',
    fields.includes('budget') ? sel('budget', BUDGET.map(([k, l]) => [k, l]), 'Budget') : '',
    `<div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`,
    ref ? `<input type="hidden" name="ref" value="${esc(ref)}">` : '',
    campaign ? `<input type="hidden" name="campaign" value="${esc(campaign)}">` : '',
    `<label class="consent"><input type="checkbox" name="consent" value="yes" required${values.consent ? ' checked' : ''}> <span>${esc(CONSENT_TEXT)}</span></label>`,
    `<button class="btn" type="submit">Send enquiry</button>`,
    ref ? '<p class="note">Referred by a friend? Your referral code is included, so they get the credit.</p>' : '',
  ];
  const demo = coach.is_demo ? '<p class="banner">This is the demo studio’s enquiry page. It shows the form but does not accept enquiries.</p>' : '';
  return page(status, form.title, `<p class="eyebrow">Coaching enquiry</p><h1>${esc(form.title)}</h1>${form.intro ? `<p>${esc(form.intro)}</p>` : ''}${demo}
${offer ? offerBlock(offer) : ''}<form class="card" method="post" action="/enquire/${esc(form.slug)}" novalidate>${parts.join('\n')}</form>`);
}

const formFor = (db, slug) => (typeof slug === 'string' && SLUG.test(slug) ? db.prepare('SELECT * FROM lead_forms WHERE slug=? AND active=1').get(slug) : null);
const gone = () => notice(404, 'Enquiries', 'This page isn’t available', 'The enquiry page you followed is not open right now. Try again later, or contact the coach directly.');
const tidyRef = r => (typeof r === 'string' ? r.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24) : '');

function enquirePage(_req, ctx) {
  const form = formFor(ctx.db, ctx.params.slug);
  if (!form) return gone();
  const coach = ctx.db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(form.coach_id);
  if (!coach) return gone();
  const today = londonDay(requestNow(ctx));
  const offer = publicOffer(ctx.db, coach.id, ctx.query.campaign, today);
  return formPage(200, { form, coach, offer, ref: tidyRef(ctx.query.ref), campaign: offer ? offer.id : '' });
}

/** Does this code belong to one of the coach's referral codes (WP3's table, read only when it exists)? */
function referralCodeKnown(db, coachId, code) {
  if (!code) return false;
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='referral_codes'").get()) return false;
    return !!db.prepare('SELECT 1 FROM referral_codes rc JOIN users u ON u.id=rc.client_id AND u.coach_id=rc.coach_id WHERE rc.coach_id=? AND rc.code=?').get(coachId, code);
  } catch { return false; }
}

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/**
 * The submitter's address. cf-connecting-ip is believed only when the request
 * came from a proxy on this machine or its private network (the Cloudflare
 * tunnel); a request straight from the internet can't pick its own address.
 */
const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|::ffff:(127|10|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i;
function clientIp(req) {
  const peer = String(req.socket?.remoteAddress ?? '');
  const forwarded = req.headers['cf-connecting-ip'];
  return String(forwarded && PRIVATE.test(peer) ? forwarded : peer || 'unknown').slice(0, 64);
}

function enquireSubmit(req, ctx) {
  const form = formFor(ctx.db, ctx.params.slug);
  if (!form) return gone();
  const coach = ctx.db.prepare("SELECT * FROM users WHERE id=? AND role='coach'").get(form.coach_id);
  if (!coach) return gone();
  if (coach.is_demo) return notice(403, 'Demo', 'This is a demo page', 'The demo studio shows the enquiry form but does not take enquiries. Nothing you typed was kept.');
  const ip = clientIp(req);
  // Per address, and an overall cap per form, so a flood (spoofed addresses included) can't fill the pipeline.
  if (!limit(`enquire:${form.slug}:${ip}`, { max: 5, perMs: 3_600_000 }) || !limit(`enquire:${form.slug}`, { max: 30, perMs: 3_600_000 })) {
    return notice(429, 'Enquiries', 'Too many enquiries', 'We’ve had several enquiries from this connection in the last hour. Please try again a little later.');
  }
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return notice(415, 'Enquiries', 'That didn’t work', 'Please send the enquiry from the form on this page.');
  }
  const p = new URLSearchParams(ctx.rawBody ? ctx.rawBody.toString('utf8') : '');
  const now = requestNow(ctx);
  const today = londonDay(now);
  const thanks = () => notice(200, 'Thank you', 'Thanks, JK will be in touch within a day', 'Your enquiry has arrived. Keep an eye on your inbox (and your spam folder, just in case).');
  // A filled honeypot is a bot: thank it, keep nothing.
  if (clip(p.get('website'), 200)) return thanks();
  const fields = parse(form.fields, []);
  const values = {
    name: clip(p.get('name'), 80), email: clip(p.get('email'), 190).toLowerCase(), phone: clip(p.get('phone'), 24),
    goal: fields.includes('goal') ? clip(p.get('goal'), 1000) : '',
    experience: fields.includes('experience') && EXPERIENCE.some(([k]) => k === p.get('experience')) ? p.get('experience') : '',
    times: fields.includes('times') ? [...new Set(p.getAll('times').filter(t => TIMES.some(([k]) => k === t)))] : [],
    budget: fields.includes('budget') && BUDGET.some(([k]) => k === p.get('budget')) ? p.get('budget') : '',
    consent: p.get('consent') === 'yes',
  };
  const ref = tidyRef(p.get('ref'));
  const offer = publicOffer(ctx.db, coach.id, clip(p.get('campaign'), 64), today);
  const errors = [];
  if (!values.name) errors.push('Tell us your name.');
  if (!EMAIL.test(values.email)) errors.push('Add an e-mail address we can reply to.');
  if (values.phone && !PHONE.test(values.phone)) errors.push('The phone number can hold digits, spaces and + ( ) - only.');
  if (!values.consent) errors.push('Tick the box to say JK may contact you about coaching.');
  if (errors.length) return formPage(400, { form, coach, offer, values, errors, ref, campaign: offer ? offer.id : '' });

  const referral = referralCodeKnown(ctx.db, coach.id, ref);
  const answers = Object.fromEntries(Object.entries({ goal: values.goal, experience: values.experience, times: values.times, budget: values.budget })
    .filter(([, x]) => (Array.isArray(x) ? x.length : x)));
  tx(ctx.db, () => {
    const lead = createLead(ctx.db, coach.id, {
      name: values.name, email: values.email, phone: values.phone || null,
      source: referral ? 'referral' : 'enquiryForm',
      sourceDetail: offer ? `campaign:${offer.name}`.slice(0, 120) : referral ? `code:${ref}` : '',
      referralCode: ref || null, campaignId: offer ? offer.id : null,
      valuePence: BUDGET.find(([k]) => k === values.budget)?.[2] ?? 0,
      answers, consentAt: now.toISOString(),
    }, { activity: offer ? `Enquiry form: ${offer.name}` : referral ? `Enquiry form, referred with ${ref}` : 'Enquiry form', now });
    const prefsOn = coachPref(ctx.db, coach.id, 'notify.prefs', {});
    if (prefsOn?.lead !== false) {
      // Past a few form enquiries an hour, one "new enquiries" notification per hour instead of one each.
      const recent = ctx.db.prepare("SELECT COUNT(*) n FROM leads WHERE coach_id=? AND source IN ('enquiryForm','referral') AND created_at>=?")
        .get(coach.id, new Date(now.getTime() - 3_600_000).toISOString()).n;
      notifyCoach(ctx.db, ctx.config, coach.id, recent > 3
        ? { kind: 'lead', title: 'New enquiries', body: `${recent} enquiries in the last hour. Open the pipeline to sort them.`, path: '/pipeline', icon: 'person_add', tone: 'attention',
          dedupe: `leadflood:${coach.id}:${now.toISOString().slice(0, 13)}`, now }
        : { kind: 'lead', title: `New enquiry: ${values.name}`, body: offer ? `Interested in ${offer.name}` : values.goal ? values.goal.slice(0, 140) : SOURCE_LABEL[lead.source],
          path: `/pipeline/${lead.id}`, icon: 'person_add', tone: 'attention', dedupe: `lead:${lead.id}`, now });
    }
  });
  return thanks();
}

// MARK: - Event handlers

/** client.joined: an unconverted lead of the same coach with the same e-mail becomes this client and is won. */
function onClientJoined(db, _config, e) {
  const mail = typeof e.payload?.email === 'string' ? e.payload.email.toLowerCase() : '';
  if (!mail || !e.coachId || !e.clientId) return;
  const client = db.prepare("SELECT * FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.clientId, e.coachId);
  if (!client) return;
  const now = new Date();
  for (const l of db.prepare("SELECT * FROM leads WHERE coach_id=? AND client_id IS NULL AND lower(email)=? ORDER BY created_at DESC").all(e.coachId, mail)) {
    const won = setStage(db, l, 'won', { clientId: client.id, now, note: l.stage === 'won' ? null : `${STAGE_LABEL[l.stage]} → Won` });
    logActivity(db, won, 'converted', `Joined the app as ${client.name}`, now.toISOString());
  }
}

// MARK: - Clock: the 12-month purge

/** Hard-delete lost or unconverted leads untouched for 12 months (the promise on the form). Returns how many went. */
export function purgeLeads(db, now = new Date()) {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - PURGE_MONTHS);
  const due = db.prepare("SELECT id, coach_id FROM leads WHERE updated_at<? AND (client_id IS NULL OR stage='lost') LIMIT 500").all(cutoff.toISOString());
  for (const l of due) {
    tx(db, () => {
      db.prepare('DELETE FROM leads WHERE id=?').run(l.id);
      emit(db, 'lead.deleted', { coachId: l.coach_id, summary: 'Lead deleted after 12 months', leadId: l.id });
    });
  }
  return due.length;
}

// MARK: - Hooks

const newLeads = (db, coachId, now) => db.prepare("SELECT * FROM leads WHERE coach_id=? AND stage='enquiry' AND created_at>=? ORDER BY created_at DESC")
  .all(coachId, new Date(now.getTime() - 7 * 86_400_000).toISOString());

function inbox(db, coach, opts = {}) {
  const now = opts?.now instanceof Date ? opts.now : new Date();
  return newLeads(db, coach.id, now).map(l => {
    const a = parse(l.answers, {});
    return {
      key: `lead:${l.id}`, kind: 'lead', clientId: null, title: `New enquiry: ${l.name}`,
      preview: [SOURCE_LABEL[l.source] ?? l.source, campaignName(l), a.goal].filter(Boolean).join(' · ').slice(0, 200),
      at: l.created_at, icon: 'person_add', tone: 'attention', path: `/pipeline/${l.id}`,
      actions: [{ id: 'contacted', label: 'Mark contacted', method: 'POST', url: `/api/leads/${l.id}/move`, body: { stage: 'contacted', position: 0 } }],
    };
  });
}

function badges(db, coach) {
  const n = newLeads(db, coach.id, new Date()).length;
  return n ? { pipeline: n } : {};
}

function search(db, coach, q, lim) {
  const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const s = q.toLowerCase();
  return db.prepare(`SELECT * FROM leads WHERE coach_id=? AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?`).all(coach.id, like, like, lim).map(l => ({
    type: 'lead', id: l.id, title: l.name, detail: `Lead · ${STAGE_LABEL[l.stage]} · ${SOURCE_LABEL[l.source] ?? l.source}`, path: `/pipeline/${l.id}`, icon: 'person_search',
    score: l.name.toLowerCase() === s ? 0.95 : l.name.toLowerCase().startsWith(s) ? 0.8 : 0.6, at: l.updated_at,
  }));
}

/**
 * The weighted pipeline (value × stage probability) for open leads, spread evenly
 * over the next 60 days as weekly lines (F26 forecast hook, confidence possible).
 */
function forecast(db, coach, fromDay, toDay) {
  const open = db.prepare(`SELECT stage, value_pence FROM leads WHERE coach_id=? AND stage IN (${OPEN.map(() => '?').join(',')}) AND value_pence>0`).all(coach.id, ...OPEN);
  const weighted = open.reduce((n, l) => n + l.value_pence * PROBABILITY[l.stage], 0);
  if (!weighted) return [];
  const start = londonDay();
  const out = [];
  for (let d = 7; d <= 63; d += 7) {
    const span = Math.min(7, 60 - (d - 7));
    if (span <= 0) break;
    const day = addDays(start, Math.min(d, 60));
    if (day < fromDay || day > toDay) continue;
    out.push({ day, pence: Math.round(weighted * span / 60), label: `Pipeline: ${open.length} open lead${open.length === 1 ? '' : 's'}, weighted`, confidence: 'possible', source: 'leads' });
  }
  return out;
}

/** The enquiry that became this client: their own words, kept while they are a client. */
function exportFor(db, user) {
  const rows = db.prepare('SELECT * FROM leads WHERE client_id=? ORDER BY created_at').all(user.id);
  return {
    enquiries: rows.map(l => ({
      name: l.name, email: l.email, phone: l.phone, source: l.source, answers: parse(l.answers, {}), consentAt: l.consent_at, createdAt: l.created_at,
      activities: db.prepare('SELECT kind, text, at FROM lead_activities WHERE lead_id=? ORDER BY at').all(l.id),
    })),
  };
}

// MARK: - Demo

/**
 * Nine leads over four sources (instagram, referral from Sam, the enquiry form,
 * word of mouth): one at each open stage, one lost and four won (the four most
 * recent demo clients). Values £80–£200 a month, with activities, and the demo
 * enquiry form at /enquire/demo-jk. Rows only: no events, no notifications.
 */
function buildDemo(db, { coach, byName, today }) {
  schema(db);
  db.prepare('DELETE FROM leads WHERE coach_id=?').run(coach.id);
  const at = (d, t = '09:00') => londonToUtc(d, t).toISOString();
  const ago = n => addDays(today, -n);
  const joined = c => (c ? londonDay(new Date(c.created_at)) : null);
  const offer = (() => {
    for (const [, fn] of hooks('publicOffers')) {
      try { const list = fn(db, coach.id) ?? []; const o = list.find(x => /reset/i.test(x.name)) ?? list[0]; if (o) return o; } catch { /* a missing campaign just means no offer */ }
    }
    return null;
  })();
  const specs = [
    { name: 'Hannah Lee', email: 'hannah.lee@example.com', phone: '07700 900412', source: 'referral', referralCode: 'SAM-K7QP', detail: 'Sam Carter’s friend', stage: 'enquiry', value: 12000, created: 2,
      answers: { goal: 'Get strong enough to deadlift my bodyweight and stop my back aching at work.', experience: 'some', times: ['early', 'weekend'], budget: '80to150' },
      log: [['note', 'Sam mentioned she’s been to a few classes at her work gym.', 1]], next: 0, campaign: true },
    { name: 'Marcus Webb', email: 'marcus.webb@example.com', source: 'instagram', detail: 'Replied to the squat clinic reel', stage: 'contacted', value: 15000, created: 6,
      answers: { goal: 'Half marathon in April, under 1:45.', experience: 'regular', times: ['evening'] },
      log: [['message', 'DM’d on Instagram: asked about running programmes.', 6], ['email', 'Sent the welcome note and pricing.', 5], ['call', '15 min call. Wants a run-and-lift split, two sessions a week.', 3]], next: -1, campaign: true },
    { name: 'Chloe Barnes', email: 'chloe.barnes@example.com', phone: '07700 900883', source: 'enquiryForm', stage: 'consult', value: 18000, created: 9,
      answers: { goal: 'Back to lifting after my second baby. Pelvic floor safe, please!', experience: 'some', times: ['daytime'], budget: 'over150' },
      log: [['email', 'Replied to the enquiry form, offered a consult.', 8], ['note', 'Consult booked Thursday 12:30, in person.', 4]], next: 2 },
    { name: 'Daniel Osei', email: 'dan.osei@example.com', source: 'word', detail: 'Met at the park run', stage: 'trial', value: 20000, created: 15,
      answers: { goal: 'Hyrox in the spring. Needs the engine and the sled work.', experience: 'athlete' },
      log: [['note', 'Chatted after Saturday’s park run. Very keen.', 15], ['call', 'Consult done. Two-week trial agreed, £40.', 10], ['note', 'Trial session one: great work ethic, tight hips.', 3]], next: 1 },
    { name: 'Ella Hughes', email: 'ella.h@example.com', source: 'instagram', detail: 'Story poll', stage: 'lost', value: 8000, created: 34, closed: 20, lostReason: 'price', lostNote: 'Going with the gym’s group plan for now. Asked us to check back in the new year.',
      answers: { goal: 'Tone up for a wedding in June.', experience: 'new', budget: 'under80' },
      log: [['email', 'Sent pricing and the Foundation plan.', 32], ['call', 'Liked it but the budget is tight until January.', 22]], next: 40, campaign: true },
  ];
  // [first name, source, detail, value, days from enquiry to joining]
  const won = [['Rory', 'instagram', 'Saw the marathon build posts', 15000, 18], ['Tom', 'word', 'Colleague of Leo', 8000, 9], ['Alex', 'enquiryForm', '', 15000, 21], ['Leo', 'referral', 'Referred by Sam', 10000, 12]];
  for (const [first, source, detail, value, lead] of won) {
    const c = byName[first];
    if (!c) continue;
    const j = joined(c) ?? ago(30);
    specs.push({ name: c.name, email: null, source, detail, referralCode: source === 'referral' ? 'SAM-K7QP' : null, stage: 'won', value, createdDay: addDays(j, -lead), closedDay: j, client: c,
      answers: { goal: first === 'Rory' ? 'A spring marathon without the calf trouble.' : first === 'Tom' ? 'Lose 10 kg and keep it off.' : first === 'Alex' ? 'Put on size, train four days a week.' : 'Move without my back hurting.' },
      logAt: [['email', 'Replied the same day.', -11], ['call', 'Consult call.', -8], ['note', 'Trial went well; signing up.', -3]] });
  }
  const insert = db.prepare(`INSERT INTO leads (id, coach_id, name, email, phone, source, source_detail, referral_code, campaign_id, stage, position, value_pence, answers, consent_at,
    next_action_on, lost_reason, lost_note, client_id, created_at, updated_at, closed_at, reached) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const act = db.prepare('INSERT INTO lead_activities (id, lead_id, coach_id, kind, text, at) VALUES (?,?,?,?,?,?)');
  const position = {};
  for (const s of specs) {
    const createdDay = s.createdDay ?? ago(s.created);
    const closedDay = s.closedDay ?? (s.closed !== undefined ? ago(s.closed) : null);
    const id = newId('ld');
    const reached = s.stage === 'lost' ? 'contacted' : s.stage;
    const camp = s.campaign && offer ? offer : null;
    insert.run(id, coach.id, s.name, s.email, s.phone ?? null, s.source, camp ? `campaign:${offer.name}` : s.detail ?? '', s.referralCode ?? null, camp ? offer.id : null, s.stage,
      position[s.stage] = (position[s.stage] ?? -1) + 1, s.value, JSON.stringify(s.answers ?? {}), s.source === 'enquiryForm' || s.source === 'referral' ? at(createdDay, '20:14') : null,
      s.next === undefined ? null : addDays(today, s.next), s.lostReason ?? null, s.lostNote ?? null, s.client?.id ?? null,
      at(createdDay, '19:40'), at(closedDay ?? ago(Math.max(0, (s.log?.at(-1)?.[2]) ?? 0)), '12:00'), closedDay ? at(closedDay, '17:00') : null, reached);
    act.run(newId('la'), id, coach.id, 'created', s.source === 'enquiryForm' ? 'Enquiry form' : s.source === 'referral' ? `Enquiry form, referred with ${s.referralCode}` : 'Added by you', at(createdDay, '19:40'));
    for (const [kind, text, n] of s.log ?? []) act.run(newId('la'), id, coach.id, kind, text, at(ago(n), '11:15'));
    for (const [kind, text, n] of s.logAt ?? []) act.run(newId('la'), id, coach.id, kind, text, at(addDays(closedDay, n), '11:15'));
    const path = { enquiry: [], contacted: ['enquiry'], consult: ['enquiry', 'contacted'], trial: ['enquiry', 'contacted', 'consult'], won: ['enquiry', 'contacted', 'consult', 'trial'], lost: ['enquiry', 'contacted'] }[s.stage];
    path.forEach((from, i) => {
      const to = path[i + 1] ?? s.stage;
      const when = s.stage === 'won' ? addDays(closedDay, -(path.length - i) * 2) : ago(Math.max(0, (s.created ?? 0) - 1 - i * 2));
      act.run(newId('la'), id, coach.id, 'stage', `${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}${to === 'lost' ? ` (${LOST_LABEL[s.lostReason]})` : ''}`, at(when, '16:30'));
    });
    if (s.client) act.run(newId('la'), id, coach.id, 'converted', `Joined the app as ${s.client.name}`, at(closedDay, '17:00'));
  }
  const at0 = at(ago(60));
  const taken = db.prepare('SELECT coach_id FROM lead_forms WHERE slug=?').get('demo-jk');
  const slug = taken && taken.coach_id !== coach.id ? `demo-jk-${coach.id.slice(-6).toLowerCase().replace(/[^a-z0-9]/g, 'x')}` : 'demo-jk';
  db.prepare(`INSERT INTO lead_forms (id, coach_id, slug, title, intro, fields, active, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)
    ON CONFLICT(coach_id) DO UPDATE SET slug=excluded.slug, title=excluded.title, intro=excluded.intro, fields=excluded.fields, active=1, updated_at=excluded.updated_at`)
    .run(newId('lf'), coach.id, slug, 'Train with JK', 'Strength, running and everything in between, coached one to one in Bristol and online. Tell me where you are and where you want to be: I read every enquiry myself.',
      JSON.stringify(FORM_FIELDS), at0, at0);
}

export const feature = {
  name: 'leads',
  namespaces: ['lead'],
  schema,
  routes(r) {
    // The fixed paths first, so /api/leads/form is never read as a lead id.
    r.add('GET', '/api/leads/form', getForm);
    r.add('PUT', '/api/leads/form', putForm);
    r.add('GET', '/api/leads/funnel', funnel);
    r.add('GET', '/api/leads', listLeads);
    r.add('POST', '/api/leads', addLead);
    r.add('GET', '/api/leads/:id', getLead);
    r.add('PATCH', '/api/leads/:id', patchLead);
    r.add('DELETE', '/api/leads/:id', deleteLead);
    r.add('POST', '/api/leads/:id/move', moveLead);
    r.add('POST', '/api/leads/:id/activities', addActivity);
    r.add('POST', '/api/leads/:id/convert', convertLead);
    r.add('GET', '/enquire.css', () => raw(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' }, ENQUIRE_CSS), { public: true });
    r.add('GET', '/enquire/:slug', enquirePage, { public: true });
    r.add('POST', '/enquire/:slug', enquireSubmit, { public: true, rawBody: 8192 });
  },
  clocks: [{ id: 'lead.purge', everyMs: 6 * 3_600_000, run: (db, _config, now) => purgeLeads(db, now) }],
  on: { 'client.joined': onClientJoined },
  emits: {
    'lead.created': { label: 'A new lead arrived', payload: ['leadId', 'source', 'referralCode', 'campaignId'] },
    'lead.stageChanged': { label: 'A lead moved stage', payload: ['leadId', 'from', 'to'] },
    'lead.won': { label: 'A lead was won', payload: ['leadId', 'clientId'] },
    'lead.lost': { label: 'A lead was lost', payload: ['leadId', 'reason'] },
    'lead.deleted': { label: 'A lead was deleted', payload: ['leadId'] },
  },
  inbox, badges, search, forecast, exportFor,
  demo: { build(db, ctx) { buildDemo(db, ctx); } },
};
