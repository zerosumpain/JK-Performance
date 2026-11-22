import { readdirSync, readFileSync } from 'node:fs';
import { raw } from './http.mjs';

/**
 * The coach web app at /desk: everything the coach can do in the phone apps,
 * from a browser. Plain ES modules in server/desk/ (no build step), talking to
 * the same JSON API as the apps. Sign-in: Google, Sign in with Apple on the
 * web, a one-time code made in the app, or the demo coach code.
 *
 * Every .js and .css file in server/desk/ is read once at start-up and served
 * at /desk/<name>, and every .woff2 in server/desk/fonts/ at /desk/fonts/<name>
 * (the self-hosted Newsreader serif); nothing else in the folder is reachable.
 */
const DIR = new URL('./desk/', import.meta.url);
const TYPES = { '.js': 'text/javascript', '.css': 'text/css' };
const FILES = new Map(readdirSync(DIR)
  .filter(name => /^[a-z0-9-]+\.(js|css)$/.test(name))
  .map(name => [name, { type: TYPES[name.slice(name.lastIndexOf('.'))], body: readFileSync(new URL(name, DIR), 'utf8') }]));

const FONT_DIR = new URL('./desk/fonts/', import.meta.url);
const FONTS = new Map(readdirSync(FONT_DIR)
  .filter(name => /^[a-z0-9-]+\.woff2$/.test(name))
  .map(name => [name, readFileSync(new URL(name, FONT_DIR))]));

// app.css first (tokens), then each screen's own stylesheet.
const STYLES = [...FILES.keys()].filter(n => n.endsWith('.css')).sort((a, b) => (a === 'app.css' ? -1 : b === 'app.css' ? 1 : a.localeCompare(b)));
const HTML = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0E0D0C">
<title>JK Performance · Coach</title>
${[...FONTS.keys()].filter(n => n.includes('roman')).map(n => `<link rel="preload" href="/desk/fonts/${n}" as="font" type="font/woff2" crossorigin>`).join('\n')}
${STYLES.map(n => `<link rel="stylesheet" href="/desk/${n}">`).join('\n')}
<script type="module" src="/desk/main.js"></script>
</head><body><div id="app"><p class="muted pad">Loading…</p></div>
<noscript><p class="pad">JK Performance needs JavaScript.</p></noscript></body></html>`;

// Google's sign-in button is the only third party: its script, its iframe and its styles.
const GSI = 'https://accounts.google.com/gsi/';
const CSP = [
  "default-src 'none'",
  `script-src 'self' ${GSI}client`,
  `style-src 'self' ${GSI}style`,
  `frame-src ${GSI}`,
  `connect-src 'self' ${GSI}`,
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",   // previewing a voice or video note before it is sent
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const headers = type => ({
  'content-type': `${type}; charset=utf-8`,
  'cache-control': 'no-cache',
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  // Google's button needs the page's origin; nothing else is sent anywhere.
  'referrer-policy': 'strict-origin-when-cross-origin',
});

const page = () => raw(200, headers('text/html'), HTML);

function asset(_req, ctx) {
  const file = FILES.get(ctx.params.file);
  if (!file) return raw(404, headers('text/plain'), 'Not found');
  return raw(200, headers(file.type), file.body);
}

function font(_req, ctx) {
  const body = FONTS.get(ctx.params.file);
  if (!body) return raw(404, headers('text/plain'), 'Not found');
  return raw(200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff' }, body);
}

export function deskRoutes(r) {
  r.add('GET', '/desk', page, { public: true });
  r.add('GET', '/login', () => raw(302, { location: '/desk', 'cache-control': 'no-store' }, ''), { public: true });
  r.add('GET', '/desk/:file', asset, { public: true });
  r.add('GET', '/desk/fonts/:file', font, { public: true });
}
