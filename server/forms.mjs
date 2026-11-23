import { clientFor, initials, requireCoach } from './access.mjs';
import { fail, num, oneOf, str } from './http.mjs';
import { emit } from './events.mjs';
import { notify } from './push.mjs';
import { newId, nowIso } from './store.mjs';

/**
 * Forms: questionnaires a coach builds once (intake, PAR-Q, a monthly goals
 * review) and sends to a client, by hand or from an autoflow. Each request
 * keeps its own copy of the questions, so editing a form later never changes
 * what a client was asked or how their answers read.
 *
 * A yes/no question can be marked `flag`: a "yes" (a PAR-Q "do you have chest
 * pain?") makes the response urgent for the coach until they've read it.
 */

const KINDS = ['text', 'long', 'scale', 'yesno', 'choice'];

/** Ready-made forms the app offers as a starting point. Nothing is stored until the coach saves one. */
export const FORM_TEMPLATES = [
  {
    name: 'Intake', intro: 'A few questions so your coaching starts from where you are.',
    questions: [
      { id: 'goal', kind: 'long', label: 'What do you most want to achieve in the next 12 weeks?' },
      { id: 'why', kind: 'long', label: 'Why does that matter to you now?' },
      { id: 'experience', kind: 'choice', label: 'Training experience', options: ['New to it', 'Under a year', '1–3 years', '3+ years'] },
      { id: 'days', kind: 'choice', label: 'Days a week you can train', options: ['2', '3', '4', '5+'] },
      { id: 'injuries', kind: 'long', label: 'Injuries or anything that hurts when you train', required: false },
      { id: 'sleep', kind: 'scale', label: 'How well do you sleep? (1 poor – 5 great)' },
      { id: 'stress', kind: 'scale', label: 'Day-to-day stress (1 low – 5 high)' },
    ],
  },
  {
    name: 'PAR-Q health check', intro: 'The standard pre-exercise questions. Answer honestly; a yes just means we talk first.',
    questions: [
      { id: 'heart', kind: 'yesno', flag: true, label: 'Has a doctor ever said you have a heart condition?' },
      { id: 'chest', kind: 'yesno', flag: true, label: 'Do you get chest pain at rest, in daily life, or when active?' },
      { id: 'dizzy', kind: 'yesno', flag: true, label: 'Do you lose balance from dizziness or have you lost consciousness in the last year?' },
      { id: 'condition', kind: 'yesno', flag: true, label: 'Have you been diagnosed with another chronic condition (other than heart disease or high blood pressure)?' },
      { id: 'medication', kind: 'yesno', flag: true, label: 'Are you taking prescribed medication for a chronic condition?' },
      { id: 'joint', kind: 'yesno', flag: true, label: 'Do you have a bone, joint or soft-tissue problem that could get worse with more activity?' },
      { id: 'supervised', kind: 'yesno', flag: true, label: 'Has a doctor said you should only do medically supervised activity?' },
      { id: 'details', kind: 'long', label: 'If you answered yes to any, tell me more', required: false },
    ],
  },
  {
    name: 'Monthly review', intro: 'Five minutes to look back on the month and set the next one.',
    questions: [
      { id: 'proud', kind: 'long', label: 'What are you proudest of this month?' },
      { id: 'hard', kind: 'long', label: 'What got in the way?' },
      { id: 'enjoy', kind: 'scale', label: 'How much are you enjoying training? (1–5)' },
      { id: 'next', kind: 'long', label: 'One thing to focus on next month' },
    ],
  },
  {
    name: 'Injury report', intro: 'Tell me what happened so I can adjust your plan today.',
    questions: [
      { id: 'where', kind: 'text', label: 'Where does it hurt?' },
      { id: 'how', kind: 'long', label: 'What were you doing when it started?' },
      { id: 'level', kind: 'scale', label: 'How bad is it? (1 niggle – 5 can\'t train)' },
      { id: 'sharp', kind: 'yesno', flag: true, label: 'Is the pain sharp, or is there swelling or numbness?' },
    ],
  },
];

function cleanQuestions(list) {
  if (!Array.isArray(list) || !list.length || list.length > 40) fail(400, 'questions must be a list of 1 to 40');
  const seen = new Set();
  return list.map((q, i) => {
    const name = `questions[${i}]`;
    const id = str(q?.id ?? `q${i + 1}`, `${name}.id`, { max: 40 });
    if (seen.has(id)) fail(400, `${name}.id is repeated`);
    seen.add(id);
    const kind = oneOf(q.kind, `${name}.kind`, KINDS);
    const out = { id, kind, label: str(q.label, `${name}.label`, { max: 300 }) };
    if (kind === 'choice') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 12) fail(400, `${name}.options must list 2 to 12 choices`);
      out.options = q.options.map((o, j) => str(o, `${name}.options[${j}]`, { max: 80 }));
    }
    if (kind === 'yesno' && q.flag) out.flag = true;
    if (q.required === false) out.required = false;
    return out;
  });
}

/** Answers checked against the questions they reply to. */
function cleanAnswers(questions, answers) {
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) fail(400, 'answers must be an object');
  const out = {};
  for (const q of questions) {
    const v = answers[q.id];
    const name = `answers.${q.id}`;
    if (v === undefined || v === null || v === '') {
      if (q.required !== false) fail(400, `"${q.label}" needs an answer`);
      continue;
    }
    if (q.kind === 'text') out[q.id] = str(v, name, { max: 300 });
    else if (q.kind === 'long') out[q.id] = str(v, name, { max: 4000 });
    else if (q.kind === 'scale') out[q.id] = num(v, name, { min: 1, max: 5, int: true });
    else if (q.kind === 'yesno') { if (typeof v !== 'boolean') fail(400, `${name} must be true or false`); out[q.id] = v; }
    else out[q.id] = oneOf(v, name, q.options);
  }
  return out;
}

/** The flagged questions a response answered yes to. */
export const flaggedAnswers = r => (r.submitted_at ? JSON.parse(r.questions).filter(q => q.flag && JSON.parse(r.answers ?? '{}')[q.id] === true) : []);

const formOut = (db, f) => {
  const counts = db.prepare('SELECT COUNT(*) sent, SUM(submitted_at IS NULL) waiting, SUM(submitted_at IS NOT NULL AND reviewed_at IS NULL) unread FROM form_requests WHERE form_id=?').get(f.id);
  return {
    id: f.id, name: f.name, intro: f.intro, questions: JSON.parse(f.questions), updatedAt: f.updated_at,
    sent: counts.sent, waiting: counts.waiting ?? 0, toReview: counts.unread ?? 0,
  };
};

export function requestOut(db, r) {
  const client = db.prepare('SELECT id, name FROM users WHERE id=?').get(r.client_id);
  const flagged = flaggedAnswers(r);
  return {
    id: r.id, formId: r.form_id, name: r.name, intro: r.intro, questions: JSON.parse(r.questions),
    client: client ? { id: client.id, name: client.name, initials: initials(client.name) } : null,
    sentAt: r.sent_at, answers: r.answers ? JSON.parse(r.answers) : null, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
    flagged: flagged.map(q => q.label), fromAutoflow: !!r.autoflow_id,
  };
}

function ownForm(ctx) {
  requireCoach(ctx);
  const f = ctx.db.prepare('SELECT * FROM forms WHERE id=? AND coach_id=?').get(ctx.params.id, ctx.user.id);
  if (!f) fail(404, 'Not found');
  return f;
}

function formFields(b) {
  return { name: str(b.name, 'name', { max: 80 }), intro: str(b.intro ?? '', 'intro', { max: 500, min: 0 }), questions: cleanQuestions(b.questions) };
}

function listForms(_req, ctx) {
  requireCoach(ctx);
  const forms = ctx.db.prepare('SELECT * FROM forms WHERE coach_id=? ORDER BY name').all(ctx.user.id);
  return { forms: forms.map(f => formOut(ctx.db, f)), templates: FORM_TEMPLATES };
}

function createForm(_req, ctx) {
  requireCoach(ctx);
  const f = formFields(ctx.body);
  const id = newId('f');
  ctx.db.prepare('INSERT INTO forms (id, coach_id, name, intro, questions, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, ctx.user.id, f.name, f.intro, JSON.stringify(f.questions), nowIso(), nowIso());
  return formOut(ctx.db, ctx.db.prepare('SELECT * FROM forms WHERE id=?').get(id));
}

function updateForm(_req, ctx) {
  const form = ownForm(ctx);
  const f = formFields(ctx.body);
  ctx.db.prepare('UPDATE forms SET name=?, intro=?, questions=?, updated_at=? WHERE id=?').run(f.name, f.intro, JSON.stringify(f.questions), nowIso(), form.id);
  return formOut(ctx.db, ctx.db.prepare('SELECT * FROM forms WHERE id=?').get(form.id));
}

function deleteForm(_req, ctx) {
  const form = ownForm(ctx);
  ctx.db.prepare('DELETE FROM forms WHERE id=?').run(form.id); // sent copies stay with the client
  return { ok: true };
}

/**
 * Send a form to a client (also used by autoflows). Returns the new request row.
 * `emit` (form.sent) is set only by request paths and actions, never by shared builders.
 */
export function sendForm(db, config, form, client, { autoflowId = null, coachName = 'Your coach', emit: emitEvent = false } = {}) {
  const id = newId('fr');
  db.prepare('INSERT INTO form_requests (id, form_id, client_id, name, intro, questions, sent_at, autoflow_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, form.id, client.id, form.name, form.intro, form.questions, nowIso(), autoflowId);
  if (emitEvent) emit(db, 'form.sent', { coachId: client.coach_id, clientId: client.id, summary: `Sent ${form.name}`, requestId: id, formId: form.id });
  notify(db, config, client.id, { title: coachName, body: `Please fill in: ${form.name}`, kind: 'form', id });
  return db.prepare('SELECT * FROM form_requests WHERE id=?').get(id);
}

function send(_req, ctx) {
  const form = ownForm(ctx);
  const client = clientFor(ctx, ctx.body.clientId);
  return requestOut(ctx.db, sendForm(ctx.db, ctx.config, form, client, { coachName: ctx.user.name, emit: true }));
}

/**
 * A client's forms (theirs, or a named client's for the coach). A coach who
 * names no client gets every response waiting to be read.
 */
function listRequests(_req, ctx) {
  const client = clientFor(ctx, ctx.query.clientId, { coachMayOmit: true });
  const rows = client
    ? ctx.db.prepare('SELECT * FROM form_requests WHERE client_id=? ORDER BY sent_at DESC LIMIT 100').all(client.id)
    : ctx.db.prepare(`SELECT r.* FROM form_requests r JOIN users u ON u.id=r.client_id
        WHERE u.coach_id=? AND r.submitted_at IS NOT NULL AND r.reviewed_at IS NULL ORDER BY r.submitted_at DESC`).all(ctx.user.id);
  return { requests: rows.map(r => requestOut(ctx.db, r)) };
}

function visibleRequest(ctx) {
  const r = ctx.db.prepare('SELECT * FROM form_requests WHERE id=?').get(ctx.params.id);
  if (!r) fail(404, 'Not found');
  clientFor(ctx, r.client_id);
  return r;
}

function getRequest(_req, ctx) {
  return requestOut(ctx.db, visibleRequest(ctx));
}

function answer(_req, ctx) {
  if (ctx.user.role !== 'client') fail(403, 'Clients only');
  const r = visibleRequest(ctx);
  if (r.submitted_at) fail(409, 'This form has already been sent');
  const answers = cleanAnswers(JSON.parse(r.questions), ctx.body.answers);
  ctx.db.prepare('UPDATE form_requests SET answers=?, submitted_at=? WHERE id=?').run(JSON.stringify(answers), nowIso(), r.id);
  const done = ctx.db.prepare('SELECT * FROM form_requests WHERE id=?').get(r.id);
  const flagged = flaggedAnswers(done).length;
  emit(ctx.db, 'form.submitted', { coachId: ctx.user.coach_id, clientId: ctx.user.id, summary: `Answered ${r.name}`, requestId: r.id, formId: r.form_id, flagged });
  notify(ctx.db, ctx.config, ctx.user.coach_id, {
    title: ctx.user.name, body: flagged ? `${r.name}: answered yes to ${flagged === 1 ? 'a health question' : `${flagged} health questions`}` : `Filled in ${r.name}`,
    kind: 'form', id: r.id, clientId: ctx.user.id,
  });
  return requestOut(ctx.db, done);
}

function review(_req, ctx) {
  requireCoach(ctx);
  const r = visibleRequest(ctx);
  ctx.db.prepare('UPDATE form_requests SET reviewed_at=COALESCE(reviewed_at, ?) WHERE id=?').run(nowIso(), r.id);
  return requestOut(ctx.db, ctx.db.prepare('SELECT * FROM form_requests WHERE id=?').get(r.id));
}

function withdraw(_req, ctx) {
  requireCoach(ctx);
  const r = visibleRequest(ctx);
  if (r.submitted_at) fail(409, 'Answered forms stay on the record');
  ctx.db.prepare('DELETE FROM form_requests WHERE id=?').run(r.id);
  return { ok: true };
}

export function formRoutes(r) {
  r.add('GET', '/api/forms', listForms);
  r.add('POST', '/api/forms', createForm);
  r.add('PUT', '/api/forms/:id', updateForm);
  r.add('DELETE', '/api/forms/:id', deleteForm);
  r.add('POST', '/api/forms/:id/send', send);
  r.add('GET', '/api/form-requests', listRequests);
  r.add('GET', '/api/form-requests/:id', getRequest);
  r.add('POST', '/api/form-requests/:id/answers', answer);
  r.add('POST', '/api/form-requests/:id/review', review);
  r.add('DELETE', '/api/form-requests/:id', withdraw);
}
