import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../app.mjs';
import { runDue, startJoinFlows } from '../autoflows.mjs';
import { issueSession } from '../auth.mjs';
import { exerciseId, seedCatalogue } from '../catalogue.mjs';
import { FORM_TEMPLATES } from '../forms.mjs';
import { newId, nowIso, openStore, setCoachPref } from '../store.mjs';
import { addDays, londonDay } from '../time.mjs';

const sent = [];
const config = {
  appleAudience: 'x', coachEmails: [], supportEmail: 's@example.com', publicUrl: 'https://x', gateServices: false, payments: false,
  fetchImpl: fetch, dataDir: '/tmp', pushTransport: (device, payload) => { sent.push(payload); return { status: 200 }; },
};
let db, server, base, coach, other, sam;

const user = (name, role, coachId = null) => {
  const id = newId('u');
  db.prepare('INSERT INTO users (id, apple_sub, name, role, coach_id, created_at) VALUES (?,?,?,?,?,?)').run(id, `sub-${id}`, name, role, coachId, nowIso());
  return { id, token: issueSession(db, id), row: db.prepare('SELECT * FROM users WHERE id=?').get(id) };
};
async function call(who, method, path, body) {
  const res = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${who.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const ok = async (...args) => {
  const r = await call(...args);
  assert.equal(r.status, 200, `${args[1]} ${args[2]} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

before(async () => {
  db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = user('Coach JK', 'coach');
  other = user('Other Coach', 'coach');
  sam = user('Sam Client', 'client', coach.id);
  // Autoflow messages are governed (desk v2, 3.5): with the default quiet hours they would be held when this runs at night.
  setCoachPref(db, coach.id, 'outreach.quietHours', null);
});
after(() => server.close());

test('a form goes out, comes back, and a health "yes" puts the client first', async () => {
  const { templates } = await ok(coach, 'GET', '/api/forms');
  const parq = templates.find(t => t.name.startsWith('PAR-Q'));
  assert.equal((await call(coach, 'POST', '/api/forms', { name: 'Bad', questions: [{ kind: 'choice', label: 'Pick', options: ['one'] }] })).status, 400);
  const form = await ok(coach, 'POST', '/api/forms', parq);
  assert.equal((await call(other, 'POST', `/api/forms/${form.id}/send`, { clientId: sam.id })).status, 404);
  const request = await ok(coach, 'POST', `/api/forms/${form.id}/send`, { clientId: sam.id });
  assert.equal(request.client.id, sam.id);

  const mine = await ok(sam, 'GET', '/api/form-requests');
  assert.equal(mine.requests.length, 1);
  const answers = Object.fromEntries(parq.questions.filter(q => q.kind === 'yesno').map(q => [q.id, false]));
  assert.equal((await call(sam, 'POST', `/api/form-requests/${request.id}/answers`, { answers: { heart: false } })).status, 400, 'every required question');
  const done = await ok(sam, 'POST', `/api/form-requests/${request.id}/answers`, { answers: { ...answers, joint: true, details: 'Old ankle sprain' } });
  assert.deepEqual(done.flagged, [parq.questions.find(q => q.id === 'joint').label]);
  assert.equal((await call(sam, 'POST', `/api/form-requests/${request.id}/answers`, { answers })).status, 409, 'answers once');
  // Editing the form later doesn't change what Sam was asked.
  await ok(coach, 'PUT', `/api/forms/${form.id}`, { ...parq, name: 'Health check v2' });
  assert.equal((await ok(coach, 'GET', `/api/form-requests/${request.id}`)).name, parq.name);

  const clients = await ok(coach, 'GET', '/api/coach/clients');
  assert.equal(clients.clients[0].demand.kind, 'urgent');
  assert.match(clients.clients[0].demand.reason, /yes/);
  const today = await ok(coach, 'GET', '/api/coach/today');
  assert.equal(today.formsToReview, 1);
  assert.equal((await ok(coach, 'GET', '/api/form-requests')).requests.length, 1, 'the coach\'s inbox of answers');
  await ok(coach, 'POST', `/api/form-requests/${request.id}/review`);
  assert.notEqual((await ok(coach, 'GET', '/api/coach/clients')).clients[0].demand.kind, 'urgent');
  assert.equal((await call(coach, 'DELETE', `/api/form-requests/${request.id}`)).status, 409, 'answered forms stay');
});

test('a join autoflow starts on sign-up and does each step once, on its day', async () => {
  const intake = await ok(coach, 'POST', '/api/forms', FORM_TEMPLATES[0]);
  const flow = await ok(coach, 'POST', '/api/autoflows', {
    name: 'Onboarding', trigger: 'join', steps: [
      { day: 2, action: 'message', text: 'Two days in, {first}!' },
      { day: 0, action: 'message', text: 'Welcome, {first}.' },
      { day: 0, action: 'form', formId: intake.id },
    ],
  });
  assert.deepEqual(flow.steps.map(s => s.day), [0, 0, 2], 'steps in day order');
  assert.equal((await call(coach, 'POST', '/api/autoflows', { name: 'x', steps: [{ day: 0, action: 'form', formId: 'nope' }] })).status, 400);

  const ann = user('Ann New', 'client', coach.id);
  startJoinFlows(db, config, ann.row);
  const texts = () => db.prepare("SELECT text FROM messages WHERE client_id=? AND from_role='coach' ORDER BY at").all(ann.id).map(m => m.text);
  assert.deepEqual(texts(), ['Welcome, Ann.']);
  assert.equal((await ok(ann, 'GET', '/api/form-requests')).requests[0].fromAutoflow, true);
  assert.equal(runDue(db, config), 0, 'nothing twice');
  assert.equal(runDue(db, config, { today: addDays(londonDay(), 2) }), 1);
  assert.deepEqual(texts(), ['Welcome, Ann.', 'Two days in, Ann!']);

  const listed = (await ok(coach, 'GET', '/api/autoflows')).autoflows[0];
  assert.equal(listed.runs[0].stepsDone, 3);
  assert.equal(listed.runs[0].next, null);
});

test('a manual autoflow lays a program live, and can be stopped', async () => {
  const program = await ok(coach, 'POST', '/api/programs', {
    name: 'Rehab', daysPerWeek: 2, weeks: 1,
    workouts: [{ dayOffset: 0, title: 'Rehab A', items: [{ exerciseId: exerciseId('Glute Bridge'), sets: 3, reps: '12', load: '' }] }, { dayOffset: 3, title: 'Rehab B', items: [] }],
  });
  const flow = await ok(coach, 'POST', '/api/autoflows', {
    name: 'Return from injury', trigger: 'manual', steps: [{ day: 0, action: 'program', programId: program.id }, { day: 10, action: 'message', text: 'Check in?' }],
  });
  const run = await ok(coach, 'POST', `/api/autoflows/${flow.id}/enrol`, { clientId: sam.id });
  assert.equal(run.stepsDone, 1);
  assert.equal(run.next.day, 10);
  const laid = db.prepare('SELECT published FROM workouts WHERE client_id=? AND program_id=?').all(sam.id, program.id);
  assert.equal(laid.length, 2);
  assert.ok(laid.every(w => w.published === 1), 'an autoflow publishes what it lays');
  assert.equal((await call(coach, 'POST', `/api/autoflows/${flow.id}/enrol`, { clientId: sam.id })).status, 409);
  const today = await ok(coach, 'GET', '/api/coach/today');
  assert.ok(today.upcoming.some(u => u.client.id === sam.id) === false, 'day 10 is beyond the coming week');

  await ok(coach, 'DELETE', `/api/autoflows/${flow.id}/runs/${run.id}`);
  assert.equal(runDue(db, config, { today: addDays(londonDay(), 11) }) >= 0, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE client_id=? AND text='Check in?'").get(sam.id).n, 0, 'a stopped run sends nothing');
  const runs = await ok(coach, 'GET', `/api/coach/clients/${sam.id}/autoflows`);
  assert.ok(runs.runs[0].stoppedAt);
  assert.equal((await call(other, 'GET', `/api/coach/clients/${sam.id}/autoflows`)).status, 404);
});
