import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../app.mjs';
import { seedCatalogue } from '../catalogue.mjs';
import { openStore } from '../store.mjs';

// The same stand-in for Apple as api.test.mjs: our own RSA key served as the JWKS.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'desk-kid', alg: 'RS256', use: 'sig' };
const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function appleToken(claims) {
  const head = b64({ alg: 'RS256', kid: 'desk-kid' }), body = b64({ iss: 'https://appleid.apple.com', aud: 'com.jkperformance.app', exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}

const DESK = new URL('../desk/', import.meta.url);
const config = { dataDir: '', appleAudience: 'com.jkperformance.app', coachEmails: ['coach@example.com'], primaryCoachEmail: null, supportEmail: 's@example.com', publicUrl: 'https://jk.example.com', gateServices: false, payments: false, demoCode: null, demoCoachCode: null, fetchImpl };
let server, base, coach, client;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
}
const signIn = async (sub, email) => (await call('POST', '/api/auth/apple', { body: { identityToken: appleToken({ sub, email }) } })).body;

before(async () => {
  const db = openStore(':memory:');
  seedCatalogue(db);
  server = createApp(db, config);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  coach = await signIn('desk-coach', 'coach@example.com');
  client = await signIn('desk-client', 'client@example.com');
});
after(() => server.close());

describe('Coach desk', () => {
  test('serves the page and its modules under a strict CSP', async () => {
    const page = await call('GET', '/desk');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client(;|$)/, 'only our modules and Google\'s sign-in button');
    assert.doesNotMatch(csp, /unsafe/);
    assert.match(page.body, /<script type="module" src="\/desk\/main\.js">/);
    assert.match(page.body, /href="\/desk\/app\.css"/);
    for (const name of ['main.js', 'core.js', 'today.js', 'clients.js', 'overview.js', 'letters.js', 'symbols.js', 'schedule.js', 'messages.js', 'programs.js', 'guides.js',
      'ui.js', 'charts.js', 'composer.js', 'live.js', 'palette.js', 'features.js']) {
      const js = await call('GET', `/desk/${name}`);
      assert.equal(js.status, 200, name);
      assert.match(js.headers.get('content-type'), /javascript/);
    }
    assert.match((await call('GET', '/desk/core.js')).body, /jk\.desk\.token/);
    assert.equal((await call('GET', '/desk/app.css')).status, 200);
    assert.equal((await call('GET', '/desk/nope.js')).status, 404, 'only files in server/desk/');
    // The self-hosted Newsreader serif, allowed by the CSP; nothing else in fonts/ is served.
    assert.match(csp, /font-src 'self'/);
    for (const name of ['newsreader-roman.woff2', 'newsreader-italic.woff2']) {
      const font = await fetch(`${base}/desk/fonts/${name}`);
      assert.equal(font.status, 200, name);
      assert.equal(font.headers.get('content-type'), 'font/woff2');
      assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString('latin1'), 'wOF2');
    }
    assert.equal((await call('GET', '/desk/fonts/OFL-Newsreader.txt')).status, 404);
    assert.match((await call('GET', '/desk/app.css')).body, /--accent:#C8A970/);
    assert.equal((await call('GET', '/desk/..%2Fapp.mjs')).status, 404);
    const login = await fetch(base + '/login', { redirect: 'manual' });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/desk');
  });

  test('stylesheets load in a fixed order: tokens, kit, screens, then features', async () => {
    const page = (await call('GET', '/desk')).body;
    const linked = [...page.matchAll(/<link rel="stylesheet" href="\/desk\/([a-z0-9-]+\.css)">/g)].map(m => m[1]);
    const all = readdirSync(DESK).filter(n => /^[a-z0-9-]+\.css$/.test(n)).sort();
    const kit = ['app.css', 'ui.css', 'charts.css', 'composer.css'];
    assert.deepEqual(linked, [
      ...kit,
      ...all.filter(n => !kit.includes(n) && !n.startsWith('f-')),
      ...all.filter(n => n.startsWith('f-')),
    ]);
    for (const n of kit) assert.equal((await call('GET', `/desk/${n}`)).status, 200, n);
  });

  test('/desk/features.js imports every f-*.js in name order, after the screens', async () => {
    const res = await call('GET', '/desk/features.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const imported = [...res.body.matchAll(/^import '\.\/([a-z0-9-]+\.js)';$/gm)].map(m => m[1]);
    assert.deepEqual(imported, readdirSync(DESK).filter(n => /^f-[a-z0-9-]+\.js$/.test(n)).sort());
    const main = readFileSync(new URL('main.js', DESK), 'utf8');
    const imports = [...main.matchAll(/^import '\.\/([a-z0-9-]+\.js)';$/gm)].map(m => m[1]);
    assert.equal(imports.at(-1), 'features.js', 'main.js imports features.js after every screen');
  });

  test('desk modules parse, use the CSSOM for inline style, and keep var() out of SVG attributes', () => {
    for (const name of readdirSync(DESK).filter(n => n.endsWith('.js'))) {
      const src = readFileSync(new URL(name, DESK), 'utf8');
      assert.doesNotMatch(src, /setAttribute\(\s*['"]style['"]/, `${name}: the CSP blocks a style attribute; use el.style or h({style})`);
      assert.doesNotMatch(src, /\b(fill|stroke)['"]?\s*:\s*['"`]var\(/, `${name}: SVG presentation attributes do not resolve var(); use a class`);
      const check = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: src, encoding: 'utf8' });
      assert.equal(check.status, 0, `${name}: ${check.stderr}`);
    }
  });

  test('core.js exposes the desk-v2 registries and keeps its existing exports', () => {
    const core = readFileSync(new URL('core.js', DESK), 'utf8');
    for (const name of ['registerNav', 'registerCommand', 'registerQuickCreate', 'registerWidget', 'registerClientTab', 'registerClientAction',
      'registerBulkAction', 'registerComposerTool', 'registerSendGuard', 'registerSlash', 'registerSettingsSection', 'registerSearchRenderer',
      'registerPanel', 'setCrumbs', 'prefs', 'registered', 'capabilities', 'foundationApi',
      'api', 'h', 'fill', 'icon', 'route', 'go', 'toast', 'confirmBox', 'sheet', 'sparkline', 'ring', 'screenHeader', 'state', 'clients']) {
      assert.match(core, new RegExp(`export (async )?(function|const|class) ${name}\\b`), name);
    }
    assert.match(core, /export \{ live \} from '\.\/live\.js'/);
  });

  test('the design lint is clean: colour literals live only in the app.css token blocks', () => {
    const out = spawnSync('bash', [new URL('../../scripts/lint-design.sh', import.meta.url).pathname, 'desk'], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stdout + out.stderr);
  });

  test('every icon the desk-v2 spec lists is in symbols.js', async () => {
    const { SYMBOLS } = await import('../desk/symbols.js');
    const spec = `space_dashboard inbox notifications notifications_active add search keyboard_command_key more_horiz close drag_indicator undo redo bolt
      campaign rocket_launch receipt_long payments request_quote sell percent redeem card_giftcard loyalty view_kanban filter_alt label monitoring trending_up
      trending_down savings account_balance_wallet calendar_month event_busy event_available edit_calendar edit_note sticky_note_2 task_alt checklist
      local_fire_department mic stop pause play_arrow graphic_eq auto_awesome verified gpp_maybe warning error schedule_send forum description sync link
      link_off person_add group handshake heart_broken pause_circle logout dark_mode light_mode contrast settings open_in_new content_copy upload download
      print chevron_left chevron_right expand_more expand_less check done_all snooze archive reply menu_book auto_stories route map shopping_bag flag
      timeline star sentiment_satisfied sentiment_neutral sentiment_dissatisfied shield workspace_premium bar_chart donut_large grid_view hourglass_empty
      timer alarm inventory_2 tune visibility visibility_off lock key travel_explore person_search hub science summarize translate psychology
      monitor_heart storefront format_quote cake celebration event_repeat how_to_reg mail block approval front_hand`.split(/\s+/);
    const missing = spec.filter(n => !SYMBOLS[n]);
    assert.deepEqual(missing, []);
  });

  test('a coach makes a one-time code; a client cannot', async () => {
    assert.equal((await call('POST', '/api/auth/link-code', { token: client.token })).status, 403);
    assert.equal((await call('POST', '/api/auth/link-code')).status, 401);
    const made = await call('POST', '/api/auth/link-code', { token: coach.token });
    assert.equal(made.status, 200);
    assert.match(made.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(made.body.url, 'https://jk.example.com/desk');

    // Typed lower-case without the dash still works, once.
    const typed = made.body.code.replace('-', '').toLowerCase();
    const first = await call('POST', '/api/auth/link', { body: { code: typed } });
    assert.equal(first.status, 200);
    assert.equal(first.body.me.role, 'coach');
    assert.equal((await call('POST', '/api/auth/link', { body: { code: typed } })).status, 401);
    assert.equal((await call('POST', '/api/auth/link', { body: { code: 'WRONGCODE' } })).status, 401);

    const clients = await call('GET', '/api/coach/clients', { token: first.body.token });
    assert.equal(clients.status, 200);
    assert.ok(clients.body.clients.some(c => c.id === client.me.id));
  });

  test('a newer code replaces an older one', async () => {
    const a = (await call('POST', '/api/auth/link-code', { token: coach.token })).body.code;
    const b = (await call('POST', '/api/auth/link-code', { token: coach.token })).body.code;
    assert.equal((await call('POST', '/api/auth/link', { body: { code: a } })).status, 401);
    assert.equal((await call('POST', '/api/auth/link', { body: { code: b } })).status, 200);
  });
});
