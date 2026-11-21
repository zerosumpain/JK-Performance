import { readFileSync } from 'node:fs';
import { raw } from './http.mjs';

/**
 * The coach desk: a small browser app at /desk for writing weekly feedback,
 * plans and check-in replies from a computer. It is the same JSON API the
 * iPhone app uses; sign-in is a one-time code made in the app (Guides › Coach
 * desk on the web). Static files are read once at start-up.
 */
const JS = readFileSync(new URL('./desk/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('./desk/app.css', import.meta.url), 'utf8');

const HTML = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Coach desk · JK Performance</title>
<link rel="stylesheet" href="/desk/app.css">
<script src="/desk/app.js" defer></script>
</head><body><div id="app"><p class="muted pad">Loading…</p></div>
<noscript><p class="pad">The coach desk needs JavaScript.</p></noscript></body></html>`;

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const send = (type, body) => () => raw(200, {
  'content-type': `${type}; charset=utf-8`,
  'cache-control': 'no-cache',
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}, body);

export function deskRoutes(r) {
  r.add('GET', '/desk', send('text/html', HTML), { public: true });
  r.add('GET', '/desk/app.js', send('text/javascript', JS), { public: true });
  r.add('GET', '/desk/app.css', send('text/css', CSS), { public: true });
}
