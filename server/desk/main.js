/*
 * JK Performance coach web app: sign-in, the shell (sidebar / bottom bar) and
 * start-up. Screens are in their own modules; importing them registers their
 * routes with core.js.
 */
import {
  api, button, errorLine, fill, getToken, go, h, icon, monogram, refreshBadges, setBadgeListener, setSignedOutHandler,
  setToken, startRouter, state, toast,
} from './core.js';
import './today.js';
import './clients.js';
import './schedule.js';
import './messages.js';
import './programs.js';
import './guides.js';
import './plans.js';

const app = () => document.getElementById('app');

// MARK: - Sign in

const APPLE_STATE_KEY = 'jk.desk.appleState';
let webConfig = null;

async function loadConfig() {
  if (!webConfig) {
    try { webConfig = await api('GET', '/api/auth/web/config'); } catch { webConfig = { google: false, apple: false, demo: false }; }
  }
  return webConfig;
}

async function signedIn(out) {
  setToken(out.token);
  state.me = out.me;
  state.clients = null;
  state.plans = null;
  if (!location.hash || location.hash === '#' || location.hash === '#/') history.replaceState(null, '', '#/today');
  renderShell();
}

/** Google's button, drawn by Google's own script (the one third party on the page). */
function googleButton(clientId, status) {
  const holder = h('div', { class: 'gsi-holder' });
  const draw = () => {
    const g = window.google?.accounts?.id;
    if (!g) return;
    g.initialize({
      client_id: clientId,
      ux_mode: 'popup',
      callback: async resp => {
        fill(status, h('p', { class: 'muted small' }, 'Signing in…'));
        try {
          await signedIn(await api('POST', '/api/auth/web/google', { idToken: resp.credential }));
        } catch (err) {
          fill(status, errorLine(err));
        }
      },
    });
    g.renderButton(holder, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 300 });
  };
  if (window.google?.accounts?.id) draw();
  else {
    const s = h('script', { src: 'https://accounts.google.com/gsi/client', async: true });
    s.addEventListener('load', draw);
    s.addEventListener('error', () => fill(holder, h('p', { class: 'small faint' }, 'Google sign-in could not load.')));
    document.head.append(s);
  }
  return holder;
}

function appleButton() {
  return h('button', {
    class: 'btn apple', type: 'button',
    onclick: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      const state = 'web-' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { sessionStorage.setItem(APPLE_STATE_KEY, state); } catch { /* still works, without the check */ }
      location.href = `/api/auth/apple/web?state=${encodeURIComponent(state)}`;
    },
  }, h('span', { class: 'apple-mark', 'aria-hidden': 'true' }, ''), 'Sign in with Apple');
}

async function renderSignIn(message) {
  state.me = null;
  state.clients = null;
  state.plans = null;
  const cfg = await loadConfig();
  const status = h('div');
  const input = h('input', { id: 'code', autocomplete: 'one-time-code', spellcheck: 'false', placeholder: 'Code', maxlength: '60', 'aria-label': 'Sign-in code' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
  const form = h('form', {
    class: 'code-form',
    onsubmit: async e => {
      e.preventDefault();
      const code = input.value.trim();
      if (!code) return;
      submit.disabled = true;
      fill(status);
      try {
        let out;
        try {
          out = await api('POST', '/api/auth/link', { code }); // a code made in the app
        } catch (err) {
          if (err.status !== 401) throw err;
          out = await api('POST', '/api/auth/web/code', { code }); // the demo coach code
        }
        if (out.me.role !== 'coach') {
          setToken(out.token);
          try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ }
          setToken(null);
          throw new Error('The JK Performance website is for coaches. Clients sign in in the iPhone or Android app.');
        }
        await signedIn(out);
      } catch (err) {
        fill(status, errorLine(err.status === 401 ? 'That code isn’t valid, or it has expired.' : err));
      } finally {
        submit.disabled = false;
      }
    },
  }, input, submit);

  const providers = [cfg.google ? googleButton(cfg.googleClientId, status) : null, cfg.apple ? appleButton() : null].filter(Boolean);
  fill(app(), h('main', { class: 'signin' },
    h('div', { class: 'brand-mark' }, monogram(64, { label: 'JK Performance' })),
    h('div', { class: 'eyebrow center' }, 'Performance'),
    h('h1', { class: 'center' }, 'Coach sign in'),
    h('p', { class: 'muted center' }, 'Your clients, programmes, schedule and messages: everything in the coach app, on a bigger screen.'),
    h('div', { class: 'card signin-card' },
      providers.length ? [h('div', { class: 'providers' }, providers), h('div', { class: 'or' }, h('span', null, 'or use a code'))] : null,
      form,
      h('p', { class: 'tiny faint m0' }, 'A code from the app: Guides › Coach desk on the web. Codes last 10 minutes and work once.'),
      status),
    message ? h('p', { class: 'muted small center' }, message) : null,
    h('p', { class: 'small faint center' }, 'Clients: sign in in the iPhone or Android app.'),
    h('p', { class: 'small center' }, h('a', { href: '/' }, 'jk.strangeramblings.com'))));
}

/** Coming back from Apple: /desk#state=…&code=… (or &error=…). */
async function finishApple() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has('state') || !(params.has('code') || params.has('error'))) return false;
  history.replaceState(null, '', '/desk');
  let expected = null;
  try { expected = sessionStorage.getItem(APPLE_STATE_KEY); sessionStorage.removeItem(APPLE_STATE_KEY); } catch { /* no check possible */ }
  if (params.get('error')) { await renderSignIn(params.get('error')); return true; }
  if (expected && expected !== params.get('state')) { await renderSignIn('That sign-in didn’t start here. Try again.'); return true; }
  try {
    await signedIn(await api('POST', '/api/auth/apple/finish', { code: params.get('code'), web: true }));
  } catch (err) {
    await renderSignIn(err.message);
  }
  return true;
}

async function signOut() {
  try { await api('POST', '/api/auth/logout'); } catch { /* signing out anyway */ }
  setToken(null);
  history.replaceState(null, '', '/desk');
  renderSignIn('Signed out.');
}

// MARK: - Shell

const NAV = [
  ['today', 'Today', 'coachToday'],
  ['clients', 'Clients', 'clients'],
  ['schedule', 'Schedule', 'schedule'],
  ['messages', 'Messages', 'messages'],
  ['programs', 'Programs', 'programs'],
  ['guides', 'Guides', 'guides'],
  ['account', 'Account', 'account'],
];

let navItems = {};
function renderShell() {
  navItems = {};
  const items = NAV.map(([id, label, ic]) => {
    const badge = h('span', { class: 'nav-badge', hidden: true });
    const a = h('a', { class: 'nav-item', href: `#/${id}`, 'data-nav': id }, icon(ic, 22), h('span', { class: 'nav-label' }, label), badge);
    navItems[id] = { a, badge };
    return a;
  });
  const main = h('main', { class: 'content', id: 'outlet' });
  fill(app(), h('div', { class: 'shell' },
    h('nav', { class: 'sidebar', 'aria-label': 'Main' },
      h('a', { class: 'brand', href: '#/today' }, monogram(30, { label: 'JK' }), h('span', null, h('div', { class: 'strong' }, 'JK Performance'), h('div', { class: 'tiny muted' }, 'The studio'))),
      h('div', { class: 'nav-list' }, items),
      h('div', { class: 'sidebar-foot' },
        h('div', { class: 'small muted clamp1' }, state.me?.name || ''),
        button(h('span', { class: 'row gap4' }, icon('signout', 16), 'Sign out'), signOut, { small: true }))),
    main));
  setBadgeListener(updateBadges);
  startRouter(() => document.getElementById('outlet'), selectNav);
  updateBadges();
}

function selectNav(id) {
  for (const [key, { a }] of Object.entries(navItems)) a.classList.toggle('sel', key === id);
}

let badgeTimer = null;
async function updateBadges() {
  clearTimeout(badgeTimer);
  try {
    const { threads } = await api('GET', '/api/threads');
    const unread = threads.reduce((n, t) => n + (t.unread || 0), 0);
    const b = navItems.messages?.badge;
    if (b) { b.hidden = unread === 0; b.textContent = String(unread); }
    document.title = unread ? `(${unread}) JK Performance · Coach` : 'JK Performance · Coach';
  } catch { /* try again on the next tick */ }
  badgeTimer = setTimeout(updateBadges, 30_000);
}

// MARK: - Start

setSignedOutHandler(message => { clearTimeout(badgeTimer); renderSignIn(message); });

async function boot() {
  if (await finishApple()) return;
  if (!getToken()) { renderSignIn(); return; }
  try {
    const me = await api('GET', '/api/me');
    if (me.role !== 'coach') { setToken(null); renderSignIn('The JK Performance website is for coaches.'); return; }
    state.me = me;
    renderShell();
  } catch (err) {
    if (err.status === 401) return; // already showing sign-in
    fill(app(), h('div', { class: 'pad' }, errorLine(err), button('Try again', boot)));
  }
}

window.addEventListener('jk:signout', signOut);
boot();
export { refreshBadges, go, toast };
