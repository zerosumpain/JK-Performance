/**
 * F14 Guidebook (docs/design/desk-v2.md, WP4): block validation, media
 * ownership, what a client may read, guide media through the guide only,
 * sharing, isolation, export and erasure.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertNoRowsFor, makeWorld } from './helpers.mjs';
import { inlineRuns, validateBlocks } from '../features/guidebook.mjs';

let w, coach2, other;
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const upload = async (as, { clientId = null, purpose = 'other' } = {}) =>
  (await w.ok('POST', `/api/media?purpose=${purpose}${clientId ? `&clientId=${clientId}` : ''}`, { as, raw: jpeg, headers: { 'content-type': 'image/jpeg' } })).id;

before(async () => {
  w = await makeWorld();
  coach2 = await w.signIn('gb-coach2', 'coach2@example.com', { givenName: 'Other', familyName: 'Coach' });
  other = w.user('Olive Other', 'client', coach2.id);
});
after(() => w.close());

const events = type => w.db.prepare('SELECT * FROM events WHERE type=? ORDER BY seq').all(type).map(e => ({ ...e, payload: JSON.parse(e.payload) }));
const guide = async (body, as = w.coach) => (await w.ok('POST', '/api/guidebook', { as, body: { title: 'Fuel the long run', ...body } })).guide;

describe('block validation', () => {
  test('unknown types, oversize lists and bad fields are refused, naming the block', async () => {
    let r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: [{ t: 'p', text: 'ok' }, { t: 'html', text: '<b>' }] } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /blocks\[1\]\.t/);
    r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: Array.from({ length: 201 }, () => ({ t: 'divider' })) } });
    assert.equal(r.status, 400);
    r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: Array.from({ length: 40 }, () => ({ t: 'p', text: 'x'.repeat(1990) })) } });
    assert.equal(r.status, 413);
    r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: [{ t: 'link', url: 'javascript:alert(1)', label: 'x' }] } });
    assert.match(r.body.error, /blocks\[0\]\.url must be an https link/);
    r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: [{ t: 'list', style: 'roman', items: ['a'] }] } });
    assert.equal(r.status, 400);
    assert.throws(() => validateBlocks('nope'), /must be a list/);
  });

  test('HTML-looking text stays text, and unknown keys are dropped', async () => {
    const g = await guide({ blocks: [{ t: 'p', text: '<script>alert("x")</script> **bold**', onclick: 'x' }, { t: 'callout', text: '<img src=x onerror=1>' }] });
    assert.deepEqual(g.blocks[0], { t: 'p', text: '<script>alert("x")</script> **bold**' });
    assert.equal(g.blocks[1].tone, 'tip');
    assert.deepEqual(inlineRuns('Eat **30 g** of _carbs_ per snake_case hour'), [
      { text: 'Eat ', bold: false, italic: false }, { text: '30 g', bold: true, italic: false }, { text: ' of ', bold: false, italic: false },
      { text: 'carbs', bold: false, italic: true }, { text: ' per snake_case hour', bold: false, italic: false }]);
  });

  test('media must be the coach\'s own guide file, of the right kind', async () => {
    const mine = await upload(w.coach);
    const theirs = await upload(coach2);
    const clients = await upload(w.coach, { clientId: w.client.id });
    const ok = await guide({ blocks: [{ t: 'image', mediaId: mine, caption: 'Gels' }] });
    assert.equal(ok.blocks[0].mediaId, mine);
    for (const [id, why] of [[theirs, /not one of your guide files/], [clients, /not one of your guide files/], ['md_missing', /not one of your guide files/]]) {
      const r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: [{ t: 'image', mediaId: id }] } });
      assert.equal(r.status, 400);
      assert.match(r.body.error, why);
    }
    const r = await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: [{ t: 'video', mediaId: mine }] } });
    assert.match(r.body.error, /not a video file/);
    const ex = w.db.prepare('SELECT id FROM exercises LIMIT 1').get().id;
    assert.equal((await guide({ blocks: [{ t: 'exercise', exerciseId: ex }] })).blocks[0].exerciseId, ex);
    assert.equal((await w.call('POST', '/api/guidebook', { as: w.coach, body: { title: 'x', blocks: [{ t: 'exercise', exerciseId: 'ex_nope' }] } })).status, 400);
  });
});

describe('reading', () => {
  test('the client fetches only published guides of their own coach; guide.opened once', async () => {
    const draft = await guide({ title: 'Draft one' });
    const pub = await guide({ title: 'Published one', status: 'published', blocks: [{ t: 'h', text: 'Hello' }] });
    const foreign = await guide({ title: 'Theirs', status: 'published' }, coach2);
    assert.equal((await w.call('GET', `/api/guides/coach/${draft.id}`, { as: w.client })).status, 404);
    assert.equal((await w.call('GET', `/api/guides/coach/${foreign.id}`, { as: w.client })).status, 404);
    assert.equal((await w.call('GET', `/api/guides/coach/${pub.id}`, { as: other })).status, 404);
    const got = await w.ok('GET', `/api/guides/coach/${pub.id}`, { as: w.client });
    assert.equal(got.guide.title, 'Published one');
    await w.ok('GET', `/api/guides/coach/${pub.id}`, { as: w.client });
    await w.settle();
    assert.equal(events('guide.opened').filter(e => e.payload.guideId === pub.id && e.client_id === w.client.id).length, 1);
    assert.equal(events('guide.published').filter(e => e.payload.guideId === pub.id).length, 1);
    // Unpublishing hides it again.
    await w.ok('PUT', `/api/guidebook/${pub.id}`, { as: w.coach, body: { status: 'draft' } });
    assert.equal((await w.call('GET', `/api/guides/coach/${pub.id}`, { as: w.client })).status, 404);
  });

  test('guide media through a block works; a media id not in the guide is refused', async () => {
    const inGuide = await upload(w.coach);
    const notInGuide = await upload(w.coach);
    const g = await guide({ status: 'published', blocks: [{ t: 'image', mediaId: inGuide }] });
    const got = await w.ok('GET', `/api/guides/coach/${g.id}`, { as: w.client });
    assert.equal(got.guide.blocks[0].url, `/api/guides/coach/${g.id}/media/${inGuide}`);
    const file = await w.call('GET', got.guide.blocks[0].url, { as: w.client });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
    assert.equal(Buffer.compare(file.body, jpeg), 0);
    assert.equal((await w.call('GET', `/api/guides/coach/${g.id}/media/${notInGuide}`, { as: w.client })).status, 404);
    assert.equal((await w.call('GET', `/api/guides/coach/${g.id}/media/${inGuide}`, { as: other })).status, 404);
  });
});

describe('sharing', () => {
  test('send posts one coachAction message with the guide link; a draft is refused', async () => {
    const draft = await guide({ title: 'Not yet' });
    assert.equal((await w.call('POST', `/api/guidebook/${draft.id}/send`, { as: w.coach, body: { clientId: w.client.id } })).status, 409);
    const g = await guide({ title: 'Taper week', status: 'published' });
    const out = await w.ok('POST', `/api/guidebook/${g.id}/send`, { as: w.coach, body: { clientId: w.client.id } });
    assert.match(out.link, new RegExp(`^https://jk\\.example\\.com/plan/u_[^/]+~${g.id}\\.\\d+\\.[A-Za-z0-9_-]{43}/guide/${g.id}$`));
    const msg = w.db.prepare('SELECT * FROM messages WHERE id=?').get(out.messageId);
    assert.equal(msg.via, 'coachAction');
    assert.equal(msg.text, `John shared a guide: Taper week. Read it here: ${out.link}`);
    await w.settle();
    assert.ok(events('guide.sent').some(e => e.payload.guideId === g.id));
    assert.equal((await w.call('POST', `/api/guidebook/${g.id}/send`, { as: w.coach, body: { clientId: other.id } })).status, 404);
  });
});

describe('isolation, export and erasure', () => {
  test('every coach route is a 404 across coaches and a 403 for a client', async () => {
    const g = await guide({ status: 'published' });
    for (const [method, path] of [['GET', `/api/guidebook/${g.id}`], ['PUT', `/api/guidebook/${g.id}`], ['DELETE', `/api/guidebook/${g.id}`], ['POST', `/api/guidebook/${g.id}/send`]]) {
      const body = method === 'GET' || method === 'DELETE' ? undefined : { clientId: other.id, title: 'x' };
      assert.equal((await w.call(method, path, { as: coach2, body })).status, 404, `${method} ${path}`);
      assert.equal((await w.call(method, path, { as: w.client, body })).status, 403, `${method} ${path} as a client`);
    }
    assert.equal((await w.call('GET', '/api/guidebook', { as: w.client })).status, 403);
    assert.ok(!(await w.ok('GET', '/api/guidebook', { as: coach2 })).guides.some(x => x.id === g.id));
    assert.ok((await w.ok('GET', '/api/guidebook?q=fuel', { as: w.coach })).guides.some(x => x.id === g.id));
  });

  test('a client\'s reads are exported and erased with them; a coach\'s guides go with the coach', async () => {
    const g = await guide({ status: 'published' });
    const reader = await w.signIn('gb-reader', 'reader@example.com', { givenName: 'Rita', familyName: 'Reader' });
    await w.ok('GET', `/api/guides/coach/${g.id}`, { as: reader });
    const exp = await w.call('GET', '/api/me/export', { as: reader });
    assert.equal(exp.body.features.guidebook.opened[0].title, 'Fuel the long run');
    await w.ok('DELETE', '/api/me', { as: reader });
    assertNoRowsFor(w.db, reader.id);
    const gone = w.user('Gone Coach', 'coach');
    w.db.prepare("INSERT INTO coach_guides (id, coach_id, title, created_at, updated_at) VALUES ('gb_x', ?, 't', 'x', 'x')").run(gone.id);
    w.db.prepare('DELETE FROM users WHERE id=?').run(gone.id);
    assertNoRowsFor(w.db, gone.id);
  });
});
