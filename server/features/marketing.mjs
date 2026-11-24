import { clientFor, initials, ownRow, requestNow, requireCoach } from '../access.mjs';
import { emit } from '../events.mjs';
import { clientFacts } from '../facts.mjs';
import { fail, num, oneOf, str } from '../http.mjs';
import { sendMessage } from '../messages.mjs';
import { allFacts, hooks } from '../registry.mjs';
import { coachPref, newId, nowIso, setCoachPref, tx } from '../store.mjs';
import { addDays, daysBetween, londonDay, londonToUtc } from '../time.mjs';

/**
 * F28 Marketing (docs/design/desk-v2.md F28, WP11): which channels bring
 * clients who stay and pay (Sources), a ready-written note for every lead that
 * is due a follow-up (Follow-ups, copy or mailto: only, D14: the server sends
 * no e-mail), testimonials captured with the client's explicit permission, and
 * the campaigns the coach has made public (Offers).
 *
 * This file reads and writes the leads tables that server/features/leads.mjs
 * creates. Both ship together in WP11, and leads loads first (name order); the
 * reads are still guarded, so marketing alone answers empty lists.
 */

const STAGE_LABEL = { enquiry: 'Enquiry', contacted: 'Contacted', consult: 'Consult booked', trial: 'Trial', won: 'Won', lost: 'Lost' };
const TEMPLATE_STAGES = ['enquiry', 'contacted', 'consult', 'trial', 'lost'];
const SOURCE_LABEL = { manual: 'Added by you', enquiryForm: 'Enquiry form', referral: 'Referral', instagram: 'Instagram', word: 'Word of mouth', event: 'Event', other: 'Other' };
const TESTIMONIAL_STATUS = ['requested', 'received', 'approved', 'archived'];
const SEEDED = 'marketing.followups.seeded';
const VARIABLES = ['leadFirst', 'coachFirst', 'enquiryLink', 'offer'];

// MARK: - Schema

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS followup_templates (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stage TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
      next_in_days INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS followup_templates_coach ON followup_templates(coach_id, stage);
    CREATE TABLE IF NOT EXISTS testimonials (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','received','approved','archived')),
      quote TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '',
      consent_publish INTEGER NOT NULL DEFAULT 0, consent_at TEXT, evidence_message_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      survey_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS testimonials_client ON testimonials(client_id);
    -- Suggested asks from a pulse score of 9 or 10 (F25): one per client and survey.
    CREATE TABLE IF NOT EXISTS testimonial_asks (
      id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      survey_id TEXT NOT NULL DEFAULT '', score INTEGER, created_at TEXT NOT NULL,
      asked_at TEXT, dismissed_at TEXT, UNIQUE (client_id, survey_id));`);
}

const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const campaignName = l => (l.source_detail?.startsWith('campaign:') ? l.source_detail.slice(9) : null);
const firstOf = name => String(name ?? '').trim().split(/\s+/)[0] || '';
/** "Coach JK" → "JK"; "John Kelly" → "John". */
const coachFirst = name => firstOf(String(name ?? '').replace(/^coach\s+/i, '')) || 'JK';
const median = list => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const leadLite = (l, today) => ({
  id: l.id, name: l.name, email: l.email, phone: l.phone, stage: l.stage, stageLabel: STAGE_LABEL[l.stage], source: l.source, sourceLabel: SOURCE_LABEL[l.source] ?? l.source,
  valuePence: l.value_pence, nextActionOn: l.next_action_on, campaignId: l.campaign_id, campaignName: campaignName(l), createdAt: l.created_at,
  ageDays: Math.max(0, daysBetween(londonDay(new Date(l.created_at)), today)),
});

// MARK: - Sources (who brings clients who stay and pay)

function windowStart(days, today) {
  return days ? londonToUtc(addDays(today, -days)).toISOString() : '';
}

/**
 * Lead counts, wins, conversion, median days to win, average LTV of the won
 * clients and their revenue, grouped by source, by referral code and by
 * campaign. LTV comes only from the `billing.ltv` fact (WP3); without it,
 * avgLtvPence and revenue12Pence are null. revenue12Pence is the sum of
 * `billing.paid12` when that fact exists, else the LTV of clients won in the
 * last 12 months (all of whose payments fall inside the 12 months).
 */
export function sourcesOf(db, coachId, { days = 365, today = londonDay() } = {}) {
  if (!hasTable(db, 'leads')) return { sources: [], referralCodes: [], campaigns: [] };
  const rows = db.prepare('SELECT * FROM leads WHERE coach_id=? AND created_at>=? ORDER BY created_at').all(coachId, windowStart(days, today));
  const factIds = new Set(allFacts().map(f => f.id));
  const want = ['billing.ltv', 'billing.paid12'].filter(id => factIds.has(id));
  const won = rows.filter(l => l.stage === 'won' && l.client_id);
  const facts = want.length && won.length ? clientFacts(db, coachId, [...new Set(won.map(l => l.client_id))], { only: want, today }) : new Map();
  const yearAgo = londonToUtc(addDays(today, -365)).toISOString();
  const stat = (key, label, list) => {
    const wins = list.filter(l => l.stage === 'won');
    const wonClients = wins.filter(l => l.client_id && facts.has(l.client_id));
    const ltvs = wonClients.map(l => facts.get(l.client_id)['billing.ltv']).filter(v => Number.isFinite(v));
    let revenue12 = null;
    if (factIds.has('billing.paid12')) revenue12 = wonClients.reduce((n, l) => n + (Number(facts.get(l.client_id)['billing.paid12']) || 0), 0);
    else if (factIds.has('billing.ltv')) revenue12 = wonClients.filter(l => (l.closed_at ?? '') >= yearAgo).reduce((n, l) => n + (Number(facts.get(l.client_id)['billing.ltv']) || 0), 0);
    return {
      source: key, label, leads: list.length, won: wins.length,
      conversionPct: list.length ? Math.round((wins.length / list.length) * 100) : null,
      medianDaysToWin: median(wins.filter(l => l.closed_at).map(l => Math.max(0, daysBetween(londonDay(new Date(l.created_at)), londonDay(new Date(l.closed_at)))))),
      avgLtvPence: factIds.has('billing.ltv') && ltvs.length ? Math.round(ltvs.reduce((a, b) => a + b, 0) / ltvs.length) : null,
      revenue12Pence: revenue12,
    };
  };
  const group = (keyOf, labelOf) => {
    const m = new Map();
    for (const l of rows) { const k = keyOf(l); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(l); } }
    return [...m.entries()].map(([k, list]) => stat(k, labelOf(k, list), list)).sort((a, b) => b.won - a.won || b.leads - a.leads);
  };
  return {
    sources: group(l => l.source, k => SOURCE_LABEL[k] ?? k),
    referralCodes: group(l => l.referral_code, k => k),
    campaigns: group(l => l.campaign_id, (_k, list) => list.map(campaignName).find(Boolean) ?? 'A past offer'),
  };
}

function sources(_req, ctx) {
  requireCoach(ctx);
  const raw = ctx.query.days;
  const days = raw === undefined ? 365 : raw === 'all' ? 0 : num(Number(raw), 'days', { min: 0, max: 3650, int: true });
  return sourcesOf(ctx.db, ctx.user.id, { days, today: londonDay(requestNow(ctx)) });
}

// MARK: - Follow-up templates

const DEFAULT_TEMPLATES = [
  ['enquiry', 'First reply', 'Your coaching enquiry', 'Hi {leadFirst},\n\nThanks for getting in touch, it’s great to hear from you. I’d love to learn a bit more about what you’re after. Have you got 15 minutes for a quick call this week? Just reply with a couple of times that suit.\n\n{coachFirst}', 2],
  ['contacted', 'Still keen?', 'Quick follow-up', 'Hi {leadFirst},\n\nJust floating this back to the top of your inbox. If now isn’t the right time, no problem at all. If it is, tell me a bit more here and I’ll take it from there: {enquiryLink}\n\n{coachFirst}', 4],
  ['consult', 'After the consult', 'Great to meet you', 'Hi {leadFirst},\n\nGreat to chat today. As promised, my suggestion is a two-week trial, so you can see how we work together before committing. Shall I pencil in the first session?\n\n{coachFirst}', 2],
  ['trial', 'Trial wrap-up', 'How did the trial feel?', 'Hi {leadFirst},\n\nThat’s your trial done, well played. How did it feel? If you’d like to carry on, the next step is the JK Performance app, so I can build your plan. Any questions, just ask.\n\n{coachFirst}', 3],
  ['lost', 'The door’s open', 'Checking in', 'Hi {leadFirst},\n\nIt’s been a little while, so I thought I’d check in. If the timing’s better now, I’d love to help you get going. {offer}\n\n{enquiryLink}\n\n{coachFirst}', 60],
];

function seedTemplates(db, coachId, at = nowIso()) {
  const ins = db.prepare('INSERT INTO followup_templates (id, coach_id, stage, name, subject, body, next_in_days, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
  DEFAULT_TEMPLATES.forEach(([stage, name, subject, body, next], i) => {
    const t = new Date(Date.parse(at) + i * 1000).toISOString();
    ins.run(newId('ft'), coachId, stage, name, subject, body, next, t, t);
  });
}

/** The coach's templates; the five defaults are written the first time (once: deleting them all does not bring them back). */
function templatesOf(db, coachId) {
  if (coachPref(db, coachId, SEEDED) !== true && !db.prepare('SELECT 1 FROM followup_templates WHERE coach_id=?').get(coachId)) {
    tx(db, () => { seedTemplates(db, coachId); setCoachPref(db, coachId, SEEDED, true); });
  }
  return db.prepare('SELECT * FROM followup_templates WHERE coach_id=? ORDER BY created_at, rowid').all(coachId);
}

const templateOut = t => ({ id: t.id, stage: t.stage, name: t.name, subject: t.subject, body: t.body, nextInDays: t.next_in_days, updatedAt: t.updated_at });

function templateInput(b, old = null) {
  return {
    stage: b.stage === undefined && old ? old.stage : oneOf(b.stage, 'stage', TEMPLATE_STAGES),
    name: b.name === undefined && old ? old.name : str(b.name, 'name', { max: 60 }),
    subject: b.subject === undefined ? old?.subject ?? '' : str(b.subject ?? '', 'subject', { max: 150, min: 0 }),
    body: b.body === undefined && old ? old.body : str(b.body, 'body', { max: 4000 }),
    nextInDays: b.nextInDays === undefined ? old?.next_in_days ?? 3 : num(b.nextInDays, 'nextInDays', { min: 0, max: 365, int: true }),
  };
}

function listTemplates(_req, ctx) {
  requireCoach(ctx);
  return { templates: templatesOf(ctx.db, ctx.user.id).map(templateOut), variables: VARIABLES };
}

function addTemplate(_req, ctx) {
  requireCoach(ctx);
  templatesOf(ctx.db, ctx.user.id);
  const t = templateInput(ctx.body);
  const id = newId('ft'), at = nowIso();
  ctx.db.prepare('INSERT INTO followup_templates (id, coach_id, stage, name, subject, body, next_in_days, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, t.stage, t.name, t.subject, t.body, t.nextInDays, at, at);
  return { template: templateOut(ctx.db.prepare('SELECT * FROM followup_templates WHERE id=?').get(id)) };
}

function putTemplate(_req, ctx) {
  requireCoach(ctx);
  const old = ownRow(ctx, 'followup_templates', ctx.params.id);
  const t = templateInput(ctx.body, old);
  ctx.db.prepare('UPDATE followup_templates SET stage=?, name=?, subject=?, body=?, next_in_days=?, updated_at=? WHERE id=?').run(t.stage, t.name, t.subject, t.body, t.nextInDays, nowIso(), old.id);
  return { template: templateOut(ctx.db.prepare('SELECT * FROM followup_templates WHERE id=?').get(old.id)) };
}

function deleteTemplate(_req, ctx) {
  requireCoach(ctx);
  const t = ownRow(ctx, 'followup_templates', ctx.params.id);
  ctx.db.prepare('DELETE FROM followup_templates WHERE id=?').run(t.id);
  return { ok: true };
}

// MARK: - Rendering a follow-up for a lead (leads are not clients: templating.mjs is not used)

/** WP4's live public campaigns (publicOffers hook), without any that have already ended. */
function liveOffers(db, coachId, today = londonDay()) {
  const out = [];
  for (const [f, fn] of hooks('publicOffers')) {
    try { out.push(...(fn(db, coachId) ?? []).filter(o => o && o.id && o.name && !(o.endsOn && o.endsOn < today))); } catch (e) { console.error(`publicOffers of ${f.name} failed`, e); }
  }
  return out;
}

function enquiryBase(db, config, coachId) {
  if (!hasTable(db, 'lead_forms')) return null;
  const f = db.prepare('SELECT slug FROM lead_forms WHERE coach_id=? AND active=1').get(coachId);
  return f ? `${String(config.publicUrl || '').replace(/\/$/, '')}/enquire/${f.slug}` : null;
}

/** {leadFirst} {coachFirst} {enquiryLink} {offer}; unknown names stay as written. */
export function renderFollowup(text, vars) {
  return String(text ?? '').replace(/\{([a-zA-Z]+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? vars[k] : m)).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** mailto: with every part URL-encoded; null when the lead has no e-mail. */
export function mailtoFor(email, subject, body) {
  if (!email) return null;
  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject ?? '')}&body=${encodeURIComponent(body ?? '')}`;
}

function varsFor(db, config, coach, lead, offers) {
  const base = enquiryBase(db, config, coach.id);
  const offer = campaignName(lead) ?? offers[0]?.name ?? '';
  return {
    leadFirst: firstOf(lead.name), coachFirst: coachFirst(coach.name),
    enquiryLink: base ? `${base}${lead.campaign_id && offers.some(o => o.id === lead.campaign_id) ? `?campaign=${encodeURIComponent(lead.campaign_id)}` : ''}` : '',
    offer,
  };
}

/** The template to suggest: the stage's templates in order, one further on for each follow-up already sent at this stage. */
function suggest(db, lead, templates) {
  const list = templates.filter(t => t.stage === (lead.stage === 'lost' ? 'lost' : lead.stage));
  if (!list.length) return null;
  const since = db.prepare("SELECT MAX(at) at FROM lead_activities WHERE lead_id=? AND kind IN ('stage','created')").get(lead.id)?.at ?? '';
  const done = db.prepare("SELECT COUNT(*) n FROM lead_activities WHERE lead_id=? AND kind='email' AND text LIKE 'Follow%' AND at>=?").get(lead.id, since).n;
  return list[Math.min(done, list.length - 1)];
}

function followups(_req, ctx) {
  requireCoach(ctx);
  if (!hasTable(ctx.db, 'leads')) return { due: [], templates: [] };
  const today = londonDay(requestNow(ctx));
  const templates = templatesOf(ctx.db, ctx.user.id);
  const offers = liveOffers(ctx.db, ctx.user.id);
  const leads = ctx.db.prepare("SELECT * FROM leads WHERE coach_id=? AND stage<>'won' AND next_action_on IS NOT NULL AND next_action_on<=? ORDER BY next_action_on, created_at").all(ctx.user.id, today);
  return {
    due: leads.map(l => {
      const t = suggest(ctx.db, l, templates);
      const vars = varsFor(ctx.db, ctx.config, ctx.user, l, offers);
      const rendered = t ? { subject: renderFollowup(t.subject, vars), body: renderFollowup(t.body, vars) } : null;
      return {
        lead: leadLite(l, today), overdueDays: Math.max(0, daysBetween(l.next_action_on, today)),
        template: t ? templateOut(t) : null, rendered, mailto: rendered ? mailtoFor(l.email, rendered.subject, rendered.body) : null,
      };
    }),
  };
}

/** Render any template for any lead (the "Follow up" picker on a lead). */
function renderFor(_req, ctx) {
  requireCoach(ctx);
  if (!hasTable(ctx.db, 'leads')) fail(404, 'Not found');
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const templates = templatesOf(ctx.db, ctx.user.id);
  const offers = liveOffers(ctx.db, ctx.user.id);
  const vars = varsFor(ctx.db, ctx.config, ctx.user, l, offers);
  const suggested = suggest(ctx.db, l, templates);
  return {
    suggestedId: suggested?.id ?? null,
    options: templates.map(t => {
      const rendered = { subject: renderFollowup(t.subject, vars), body: renderFollowup(t.body, vars) };
      return { template: templateOut(t), rendered, mailto: mailtoFor(l.email, rendered.subject, rendered.body) };
    }),
  };
}

function followedUp(_req, ctx) {
  requireCoach(ctx);
  if (!hasTable(ctx.db, 'leads')) fail(404, 'Not found');
  const l = ownRow(ctx, 'leads', ctx.params.id);
  const t = ownRow(ctx, 'followup_templates', ctx.body.templateId);
  const channel = oneOf(ctx.body.channel, 'channel', ['copy', 'mailto']);
  if (channel === 'mailto' && !l.email) fail(400, 'This lead has no e-mail address');
  const now = requestNow(ctx);
  const today = londonDay(now);
  const next = addDays(today, t.next_in_days);
  tx(ctx.db, () => {
    ctx.db.prepare('UPDATE leads SET next_action_on=?, updated_at=? WHERE id=?').run(next, now.toISOString(), l.id);
    ctx.db.prepare('INSERT INTO lead_activities (id, lead_id, coach_id, kind, text, at) VALUES (?,?,?,?,?,?)')
      .run(newId('la'), l.id, ctx.user.id, 'email', `${channel === 'mailto' ? 'Followed up by e-mail' : 'Follow-up copied'}: ${t.name}`, now.toISOString());
    emit(ctx.db, 'marketing.followedUp', { coachId: ctx.user.id, summary: 'Followed up a lead', leadId: l.id });
  });
  return { lead: leadLite(ctx.db.prepare('SELECT * FROM leads WHERE id=?').get(l.id), today) };
}

/** lead.created: the suggested cadence starts with a first reply due the next day (day 1, then 3, 7 and 14 through the templates). */
function onLeadCreated(db, _config, e) {
  if (!e.payload?.leadId || !hasTable(db, 'leads')) return;
  const l = db.prepare('SELECT * FROM leads WHERE id=? AND coach_id=?').get(String(e.payload.leadId), e.coachId);
  if (!l || l.next_action_on || l.stage !== 'enquiry') return;
  db.prepare('UPDATE leads SET next_action_on=? WHERE id=?').run(addDays(londonDay(new Date(l.created_at)), 1), l.id);
}

// MARK: - Testimonials

/** A testimonial or ask is shown only while its client is still this coach's (6.1: the stored coach_id is not trusted). */
const OWN = 'JOIN users u ON u.id=t.client_id AND u.role=\'client\' AND u.coach_id=?';

function testimonialOut(db, t) {
  const ev = t.evidence_message_id ? db.prepare("SELECT id, text, at FROM messages WHERE id=? AND client_id=? AND from_role='client'").get(t.evidence_message_id, t.client_id) : null;
  return {
    id: t.id, client: { id: t.client_id, name: t.client_name, initials: initials(t.client_name) }, status: t.status, quote: t.quote, attribution: t.attribution,
    consentPublish: !!t.consent_publish, consentAt: t.consent_at, evidence: ev ? { id: ev.id, text: ev.text, at: ev.at } : null,
    source: t.source, surveyId: t.survey_id, createdAt: t.created_at, updatedAt: t.updated_at,
  };
}

const ownTestimonial = (ctx, id) => {
  const t = typeof id === 'string' ? ctx.db.prepare(`SELECT t.*, u.name client_name FROM testimonials t ${OWN} WHERE t.id=?`).get(ctx.user.id, id) : null;
  if (!t) fail(404, 'Not found');
  return t;
};

const openAsks = (db, coachId) => db.prepare(`SELECT t.*, u.name client_name FROM testimonial_asks t ${OWN}
  WHERE t.asked_at IS NULL AND t.dismissed_at IS NULL ORDER BY t.created_at DESC`).all(coachId);
const askOut = a => ({ id: a.id, client: { id: a.client_id, name: a.client_name, initials: initials(a.client_name) }, surveyId: a.survey_id || null, score: a.score, at: a.created_at });

function listTestimonials(_req, ctx) {
  requireCoach(ctx);
  const rows = ctx.db.prepare(`SELECT t.*, u.name client_name FROM testimonials t ${OWN} ORDER BY t.updated_at DESC`).all(ctx.user.id);
  return { testimonials: rows.map(t => testimonialOut(ctx.db, t)), asks: openAsks(ctx.db, ctx.user.id).map(askOut) };
}

function addTestimonial(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const quote = str(ctx.body.quote ?? '', 'quote', { max: 1500, min: 0 });
  const attribution = str(ctx.body.attribution ?? '', 'attribution', { max: 80, min: 0 });
  const id = newId('tm'), at = nowIso();
  tx(ctx.db, () => {
    ctx.db.prepare("INSERT INTO testimonials (id, coach_id, client_id, status, quote, attribution, source, created_at, updated_at) VALUES (?,?,?,?,?,?,'manual',?,?)")
      .run(id, ctx.user.id, client.id, quote ? 'received' : 'requested', quote, attribution || defaultAttribution(client.name), at, at);
    if (!quote) emit(ctx.db, 'testimonial.requested', { coachId: ctx.user.id, clientId: client.id, summary: 'Testimonial requested', testimonialId: id });
  });
  return { testimonial: testimonialOut(ctx.db, ownTestimonial(ctx, id)) };
}

const defaultAttribution = name => firstOf(name);

function patchTestimonial(_req, ctx) {
  requireCoach(ctx);
  const t = ownTestimonial(ctx, ctx.params.id);
  const b = ctx.body;
  const set = {};
  if (b.quote !== undefined) set.quote = str(b.quote ?? '', 'quote', { max: 1500, min: 0 });
  if (b.attribution !== undefined) set.attribution = str(b.attribution ?? '', 'attribution', { max: 80, min: 0 });
  if (b.evidenceMessageId !== undefined && b.evidenceMessageId !== null) {
    const m = typeof b.evidenceMessageId === 'string' ? ctx.db.prepare("SELECT id FROM messages WHERE id=? AND client_id=? AND from_role='client'").get(b.evidenceMessageId, t.client_id) : null;
    if (!m) fail(400, 'The evidence must be a message from this client');
    set.evidence_message_id = m.id;
  }
  if (b.consentPublish !== undefined) {
    if (b.consentPublish === true) {
      const evidence = set.evidence_message_id ?? (b.evidenceMessageId === undefined ? t.evidence_message_id : null);
      if (!evidence || !ctx.db.prepare("SELECT 1 FROM messages WHERE id=? AND client_id=? AND from_role='client'").get(evidence, t.client_id)) {
        fail(400, 'Consent to publish needs the client’s message saying yes');
      }
      set.consent_publish = 1;
      set.consent_at = t.consent_publish ? t.consent_at : nowIso();
    } else if (b.consentPublish === false) {
      set.consent_publish = 0;
      set.consent_at = null;
    } else fail(400, 'consentPublish must be true or false');
  }
  let status = b.status === undefined ? null : oneOf(b.status, 'status', TESTIMONIAL_STATUS);
  const quote = set.quote ?? t.quote;
  const consent = set.consent_publish ?? t.consent_publish;
  if (!status && set.consent_publish === 1 && t.status !== 'archived') status = 'approved';
  if (!status && set.consent_publish === 0 && t.status === 'approved') status = 'received';
  if (!status && set.quote && t.status === 'requested') status = 'received';
  if (status === 'approved' && (!consent || !quote)) fail(400, 'An approved testimonial needs a quote and the client’s consent to publish');
  if (status) set.status = status;
  if (!Object.keys(set).length) fail(400, 'Nothing to change');
  set.updated_at = nowIso();
  const cols = Object.keys(set);
  tx(ctx.db, () => {
    ctx.db.prepare(`UPDATE testimonials SET ${cols.map(c => `${c}=?`).join(', ')} WHERE id=?`).run(...cols.map(c => set[c]), t.id);
    if (set.status === 'approved' && t.status !== 'approved') emit(ctx.db, 'testimonial.approved', { coachId: ctx.user.id, clientId: t.client_id, summary: 'Testimonial approved', testimonialId: t.id });
  });
  return { testimonial: testimonialOut(ctx.db, ownTestimonial(ctx, t.id)) };
}

/** The client's recent messages, to pick a quote or the "yes" as evidence. Does not mark anything read. */
function clientMessages(_req, ctx) {
  requireCoach(ctx);
  const t = ownTestimonial(ctx, ctx.params.id);
  const rows = ctx.db.prepare("SELECT id, text, at FROM messages WHERE client_id=? AND from_role='client' AND text<>'' ORDER BY at DESC LIMIT 40").all(t.client_id);
  return { messages: rows };
}

export const ASK_TEXT = first => `Hi ${first}, thank you for the lovely feedback. Would you be happy to share a sentence or two about training together that I could use as a testimonial? Only with your OK, and I'll check the wording with you first.`;

/** The coach presses Send on the ask: one message (via coachAction) and a requested testimonial. */
function ask(_req, ctx) {
  requireCoach(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  const text = str(ctx.body.text, 'text', { max: 4000 });
  const surveyId = ctx.body.surveyId === undefined || ctx.body.surveyId === null ? null : str(ctx.body.surveyId, 'surveyId', { max: 64 });
  const now = requestNow(ctx);
  const out = tx(ctx.db, () => {
    const sent = sendMessage(ctx.db, ctx.config, { coachId: ctx.user.id, clientId: client.id, text, via: 'coachAction', now });
    const id = newId('tm'), at = now.toISOString();
    ctx.db.prepare("INSERT INTO testimonials (id, coach_id, client_id, status, attribution, source, survey_id, created_at, updated_at) VALUES (?,?,?,'requested',?,?,?,?,?)")
      .run(id, ctx.user.id, client.id, defaultAttribution(client.name), surveyId ? 'nps' : 'manual', surveyId, at, at);
    ctx.db.prepare('UPDATE testimonial_asks SET asked_at=? WHERE client_id=? AND asked_at IS NULL AND dismissed_at IS NULL' + (surveyId ? ' AND survey_id=?' : ''))
      .run(at, client.id, ...(surveyId ? [surveyId] : []));
    emit(ctx.db, 'testimonial.requested', { coachId: ctx.user.id, clientId: client.id, summary: 'Testimonial requested', testimonialId: id });
    return { id, messageId: sent.message?.id ?? null };
  });
  return { testimonial: testimonialOut(ctx.db, ownTestimonial(ctx, out.id)), messageId: out.messageId };
}

function dismissAsk(_req, ctx) {
  requireCoach(ctx);
  const a = typeof ctx.params.id === 'string' ? ctx.db.prepare(`SELECT t.* FROM testimonial_asks t ${OWN} WHERE t.id=?`).get(ctx.user.id, ctx.params.id) : null;
  if (!a) fail(404, 'Not found');
  ctx.db.prepare('UPDATE testimonial_asks SET dismissed_at=? WHERE id=?').run(nowIso(), a.id);
  return { ok: true };
}

/** pulse.answered with a score of 9 or 10: suggest asking for a testimonial (once per client and survey). */
function onPulseAnswered(db, _config, e) {
  const score = Number(e.payload?.score);
  if (!(score >= 9) || !e.clientId || !e.coachId) return;
  const client = db.prepare("SELECT id FROM users WHERE id=? AND role='client' AND coach_id=?").get(e.clientId, e.coachId);
  if (!client) return;
  if (db.prepare("SELECT 1 FROM testimonials WHERE client_id=? AND status IN ('requested','received','approved')").get(client.id)) return;
  db.prepare('INSERT OR IGNORE INTO testimonial_asks (id, coach_id, client_id, survey_id, score, created_at) VALUES (?,?,?,?,?,?)')
    .run(newId('tm'), e.coachId, client.id, String(e.payload?.surveyId ?? ''), Math.round(score), nowIso());
}

// MARK: - Offers (WP4's public campaigns, with their enquiry link and the interest so far)

function offers(_req, ctx) {
  requireCoach(ctx);
  const base = enquiryBase(ctx.db, ctx.config, ctx.user.id);
  const count = hasTable(ctx.db, 'leads') ? ctx.db.prepare('SELECT COUNT(*) n FROM leads WHERE coach_id=? AND campaign_id=?') : null;
  return {
    offers: liveOffers(ctx.db, ctx.user.id).map(c => ({
      campaign: c, link: base ? `${base}?campaign=${encodeURIComponent(c.id)}` : null, interest: count ? count.get(ctx.user.id, c.id).n : 0,
    })),
    formLive: !!base,
  };
}

// MARK: - Hooks

function inbox(db, coach) {
  return openAsks(db, coach.id).map(a => ({
    key: `testimonial:${a.client_id}:${a.survey_id || 'manual'}`, kind: 'testimonial', clientId: a.client_id,
    title: `Ask ${firstOf(a.client_name)} for a testimonial`, preview: a.score ? `Scored ${a.score} out of 10 on the pulse survey` : 'Happy client',
    at: a.created_at, icon: 'format_quote', tone: 'ok', path: `/marketing/testimonials?ask=${a.id}`,
    actions: [{ id: 'dismiss', label: 'Not now', method: 'POST', url: `/api/marketing/testimonials/asks/${a.id}/dismiss` }],
  }));
}

function badges(db, coach) {
  if (!hasTable(db, 'leads')) return {};
  const n = db.prepare("SELECT COUNT(*) n FROM leads WHERE coach_id=? AND stage<>'won' AND next_action_on IS NOT NULL AND next_action_on<=?").get(coach.id, londonDay()).n;
  return n ? { marketing: n } : {};
}

function search(db, coach, q, lim) {
  const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  return db.prepare(`SELECT t.*, u.name client_name FROM testimonials t ${OWN} WHERE t.quote LIKE ? ESCAPE '\\' ORDER BY t.updated_at DESC LIMIT ?`).all(coach.id, like, lim).map(t => {
    const i = t.quote.toLowerCase().indexOf(q.toLowerCase());
    const from = Math.max(0, i - 30);
    return {
      type: 'testimonial', id: t.id, title: `Testimonial · ${t.client_name}`, detail: `${from ? '…' : ''}${t.quote.slice(from, from + 90)}${from + 90 < t.quote.length ? '…' : ''}`,
      path: '/marketing/testimonials', icon: 'format_quote', score: 0.55, at: t.updated_at,
    };
  });
}

function exportFor(db, user) {
  return {
    testimonials: db.prepare('SELECT status, quote, attribution, consent_publish, consent_at, source, created_at, updated_at FROM testimonials WHERE client_id=? ORDER BY created_at').all(user.id)
      .map(t => ({ status: t.status, quote: t.quote, attribution: t.attribution, consentToPublish: !!t.consent_publish, consentAt: t.consent_at, source: t.source, createdAt: t.created_at, updatedAt: t.updated_at })),
    testimonialAsks: db.prepare('SELECT score, created_at, asked_at, dismissed_at FROM testimonial_asks WHERE client_id=? ORDER BY created_at').all(user.id)
      .map(a => ({ score: a.score, at: a.created_at, askedAt: a.asked_at, dismissedAt: a.dismissed_at })),
  };
}

// MARK: - Demo

/**
 * Five follow-up templates; three testimonials (Rory requested, Priya received,
 * Sam approved with his "yes" as evidence, the messages written into their
 * threads); and a pulse-score ask for Alex. Rows only: no events, no sends.
 */
function buildDemo(db, { coach, byName, today }) {
  schema(db);
  const ids = [coach.id, ...Object.values(byName).map(c => c.id)];
  const json = JSON.stringify(ids);
  db.prepare('DELETE FROM followup_templates WHERE coach_id=?').run(coach.id);
  db.prepare('DELETE FROM testimonials WHERE coach_id=? OR client_id IN (SELECT value FROM json_each(?))').run(coach.id, json);
  db.prepare('DELETE FROM testimonial_asks WHERE coach_id=? OR client_id IN (SELECT value FROM json_each(?))').run(coach.id, json);
  const at = (n, t = '10:00') => londonToUtc(addDays(today, -n), t).toISOString();
  seedTemplates(db, coach.id, at(40));
  setCoachPref(db, coach.id, SEEDED, true);
  const msg = (client, role, text, when) => {
    const id = newId('m');
    db.prepare('INSERT INTO messages (id, client_id, from_id, from_role, text, at, read_at, kind, via) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, client.id, role === 'coach' ? coach.id : client.id, role, text, when, when, 'text', role === 'coach' ? 'coachAction' : 'app');
    return id;
  };
  const tm = db.prepare(`INSERT INTO testimonials (id, coach_id, client_id, status, quote, attribution, consent_publish, consent_at, evidence_message_id, source, survey_id, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const { Sam: sam, Priya: priya, Rory: rory, Alex: alex } = byName;
  if (sam) {
    msg(sam, 'coach', ASK_TEXT('Sam'), at(12, '18:05'));
    const quote = 'Sixteen weeks in and I’m squatting more than I did at 25. JK plans around my work trips and still gets the best out of me every single session.';
    msg(sam, 'client', `Course! ${quote}`, at(11, '07:42'));
    msg(sam, 'coach', 'That’s brilliant, thank you. Happy for me to put it on the website and Instagram as “Sam, squatting 102.5 kg”?', at(11, '08:10'));
    const yes = msg(sam, 'client', 'Yes, go for it. Proud of that number!', at(11, '12:31'));
    tm.run(newId('tm'), coach.id, sam.id, 'approved', quote, 'Sam, squatting 102.5 kg', 1, at(11, '12:40'), yes, 'nps', 'demo-nps', at(12, '18:05'), at(11, '12:40'));
  }
  if (priya) {
    msg(priya, 'coach', ASK_TEXT('Priya'), at(6, '17:20'));
    const quote = 'I’d never run further than 10k. Now I’m five weeks out from a marathon and actually looking forward to the long runs. The strength work kept me injury-free all winter.';
    msg(priya, 'client', `Of course! How about this: ${quote}`, at(5, '06:55'));
    tm.run(newId('tm'), coach.id, priya.id, 'received', quote, 'Priya, marathon runner', 0, null, null, 'nps', 'demo-nps', at(6, '17:20'), at(5, '07:10'));
  }
  if (rory) {
    msg(rory, 'coach', ASK_TEXT('Rory'), at(2, '19:02'));
    tm.run(newId('tm'), coach.id, rory.id, 'requested', '', 'Rory', 0, null, null, 'manual', null, at(2, '19:02'), at(2, '19:02'));
  }
  if (alex) {
    db.prepare('INSERT INTO testimonial_asks (id, coach_id, client_id, survey_id, score, created_at) VALUES (?,?,?,?,?,?)').run(newId('tm'), coach.id, alex.id, 'demo-nps', 10, at(1, '20:15'));
  }
}

export const feature = {
  name: 'marketing',
  namespaces: ['marketing', 'testimonial'],
  schema,
  routes(r) {
    r.add('GET', '/api/marketing/sources', sources);
    r.add('GET', '/api/marketing/followups/templates', listTemplates);
    r.add('POST', '/api/marketing/followups/templates', addTemplate);
    r.add('PUT', '/api/marketing/followups/templates/:id', putTemplate);
    r.add('DELETE', '/api/marketing/followups/templates/:id', deleteTemplate);
    r.add('GET', '/api/marketing/followups', followups);
    r.add('GET', '/api/leads/:id/followups', renderFor);
    r.add('POST', '/api/leads/:id/followed-up', followedUp);
    r.add('GET', '/api/marketing/testimonials', listTestimonials);
    r.add('POST', '/api/marketing/testimonials', addTestimonial);
    r.add('POST', '/api/marketing/testimonials/ask', ask);
    r.add('POST', '/api/marketing/testimonials/asks/:id/dismiss', dismissAsk);
    r.add('PATCH', '/api/marketing/testimonials/:id', patchTestimonial);
    r.add('GET', '/api/marketing/testimonials/:id/messages', clientMessages);
    r.add('GET', '/api/marketing/offers', offers);
  },
  on: { 'pulse.answered': onPulseAnswered, 'lead.created': onLeadCreated },
  emits: {
    'marketing.followedUp': { label: 'A lead was followed up', payload: ['leadId'] },
    'testimonial.requested': { label: 'A testimonial was requested', payload: ['testimonialId'] },
    'testimonial.approved': { label: 'A testimonial was approved to publish', payload: ['testimonialId'] },
  },
  inbox, badges, search, exportFor,
  demo: { build(db, ctx) { buildDemo(db, ctx); } },
};
