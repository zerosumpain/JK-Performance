#!/usr/bin/env node
// Screenshot the coach web app (/desk) in headless Chromium, signed in with the
// demo coach code, and print any console errors or page errors.
//
//   node scripts/desk-shot.mjs http://127.0.0.1:5690 /today shots/today.png [--mobile] [--click "Text"]... [--full]
//
// Needs playwright-core (default ~/jk-web-tools/node_modules/playwright-core,
// override with JK_PLAYWRIGHT) and a Chromium (default: Playwright's cached
// headless shell, override with JK_CHROME). Code: --code (default local-demo-coach).
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const clicks = [];
for (let c; (c = flag('--click'));) clicks.push(c);
const code = flag('--code') || 'local-demo-coach';
const mobile = bool('--mobile');
const full = bool('--full');
const [base, route = '/today', out = 'desk.png'] = args;
if (!base) { console.error('usage: desk-shot.mjs <base-url> <route> <out.png> [--mobile] [--full] [--click "Text"]… [--code CODE]'); process.exit(2); }

const require = createRequire(import.meta.url);
const pw = require(process.env.JK_PLAYWRIGHT || join(homedir(), 'jk-web-tools/node_modules/playwright-core'));
function chrome() {
  if (process.env.JK_CHROME) return process.env.JK_CHROME;
  const root = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(root) ? readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) {
    const p = join(root, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (existsSync(p)) return p;
  }
  throw new Error('No Chromium found; set JK_CHROME');
}

const browser = await pw.chromium.launch({ executablePath: chrome() });
const context = await browser.newContext(mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const problems = [];
page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));

// "Network idle", ignoring the desk's live event stream (it stays open by design,
// so Playwright's own 'networkidle' would never arrive once the foundation is up).
const LONG_LIVED = /\/api\/coach\/stream(\?|$)/;
const inflight = new Set();
page.on('request', r => { if (!LONG_LIVED.test(r.url())) inflight.add(r); });
page.on('requestfinished', r => inflight.delete(r));
page.on('requestfailed', r => inflight.delete(r));
async function settle(quietMs = 500, maxMs = 30_000) {
  const end = Date.now() + maxMs;
  let quietSince = inflight.size ? 0 : Date.now();
  while (Date.now() < end) {
    await page.waitForTimeout(50);
    if (inflight.size) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return;
  }
  throw new Error(`network not idle after ${maxMs} ms: ${[...inflight].map(r => r.url()).join(', ')}`);
}

if (code !== 'none') {
  const res = await fetch(`${base}/api/auth/web/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(body)}`);
  await context.addInitScript(t => { try { localStorage.setItem('jk.desk.token', t); } catch { /* */ } }, body.token);
}
await page.goto(`${base}/desk#${route}`, { waitUntil: 'load' });
await settle();
for (const text of clicks) {
  await page.getByText(text, { exact: false }).first().click();
  await settle();
  await page.waitForTimeout(300);
}
await page.waitForTimeout(400);
mkdirSync(dirname(out) || '.', { recursive: true });
await page.screenshot({ path: out, fullPage: full });
await browser.close();
console.log(`saved ${out}`);
if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1; }
