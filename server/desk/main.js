/*
 * JK Performance coach web app: sign-in, the shell and start-up.
 *
 * The shell (docs/design/desk-v2.md 1.3): a grouped sidebar drawn from the
 * registerNav registry (it folds to an icon rail with ⌘\), a glass top bar
 * (breadcrumbs, the search trigger for the palette, + New, the notification
 * bell, the AI chip and the avatar menu with the theme), and on phones a
 * bottom bar with More. Screens are in their own modules; importing them
 * registers their routes, then features.js (generated) loads every f-*.js.
 */
import {
  NAV_GROUPS, api, button, capabilities, clientById, clients, errorLine, fill, fmtRelative, foundationApi, getToken, go,
  h, icon, live, monogram, onRegistryChange, prefs, refreshBadges, registerNav, registerPanel, registerQuickCreate, registered,
  setBadgeListener, setCrumbListener, setSignedOutHandler, setToken, startRouter, state, toast,
} from './core.js';
import { clientQuickView, menu, skeleton, slideOver, tabs } from './ui.js';
import { installShortcuts, openPalette, showShortcuts } from './palette.js';
import './today.js';
import './clients.js';
import './schedule.js';
import './messages.js';
import './programs.js';
import './guides.js';
import './plans.js';
import './features.js';

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
  stopShell();
  try { await api('POST', '/api/auth/logout'); } catch { /* signing out anyway */ }
  setToken(null);
  history.replaceState(null, '', '/desk');
  renderSignIn('Signed out.');
}

// MARK: - Shell

// The existing screens, as fallbacks: a package that refines one of these
// (registered at import, before this runs) keeps its keys.
for (const item of [
  { id: 'today', label: 'Today', icon: 'space_dashboard', group: 'command', order: 10, mobile: 10 },
  { id: 'clients', label: 'Clients', icon: 'group', group: 'clients', order: 10, mobile: 30 },
  { id: 'messages', label: 'Messages', icon: 'chat_bubble', group: 'engage', order: 10, badge: true, badgeOn: ['message.received'], mobile: 45 },
  { id: 'schedule', label: 'Calendar', icon: 'calendar_month', group: 'schedule', order: 10, mobile: 40 },
  { id: 'programs', label: 'Programs', icon: 'format_list_bulleted', group: 'build', order: 10 },
  { id: 'guides', label: 'Library', icon: 'auto_stories', group: 'build', order: 30 },
  { id: 'account', label: 'Settings', icon: 'settings', group: 'settings', order: 90 },
]) registerNav(item, { fallback: true });
registerQuickCreate({ id: 'program', label: 'Program', icon: 'format_list_bulleted', order: 90, run: () => go('/programs') }, { fallback: true });
registerQuickCreate({ id: 'booking', label: 'Booking', icon: 'event_available', order: 40, run: () => go('/schedule') }, { fallback: true });

// The default client panel (#…?panel=client:<id>); WP2 may register a richer one.
registerPanel('client', id => ({
  title: clientById(id)?.name || 'Client',
  build(body, close, { setTitle }) {
    const known = clientById(id);
    if (known) { clientQuickView(known, body, close); return; }
    body.append(skeleton('card'));
    clients().then(list => {
      const c = list.find(x => x.id === id);
      body.replaceChildren();
      if (!c) { body.append(errorLine('That client isn’t one of yours.')); return; }
      setTitle(c.name);
      clientQuickView(c, body, close);
    }).catch(err => { body.replaceChildren(errorLine(err)); });
  },
}), { fallback: true });

const navPath = n => n.path || `/${n.id}`;
const navForKey = key => registered.nav().find(n => n.id === key || navPath(n).split('/')[1] === key) || null;
const mobileSlot = n => (n.mobile === true ? 50 : Number(n.mobile) || 0);

let shell = null; // {side, bottom, top, crumbs, bell, ai, badges:{id: n}, current}
let badgeCounts = {};

// MARK: Theme and rail (coach prefs desk.theme, desk.shell.rail; mirrored locally so they apply before any request)

const systemDark = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(choice = prefs.peek('desk.theme', 'dark')) {
  const theme = choice === 'system' ? (systemDark.matches ? 'dark' : 'light') : choice === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeChoice = choice;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#F5F0E8' : '#0E0D0C'); // the browser chrome mirrors --bg
}
systemDark.addEventListener('change', () => applyTheme(prefs.peek('desk.theme', 'dark')));
function setTheme(choice) {
  applyTheme(choice);
  prefs.set('desk.theme', choice).catch(() => {});
  toast(`Theme: ${{ system: 'follows your system', dark: 'dark', light: 'light' }[choice]}`);
}
const toggleTheme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
function setRail(on) {
  document.documentElement.classList.toggle('rail', !!on);
  const b = shell?.side.querySelector('.shell-railbtn');
  if (b) { b.setAttribute('aria-pressed', String(!!on)); b.setAttribute('aria-label', on ? 'Expand the sidebar' : 'Collapse the sidebar'); }
}
const toggleRail = () => {
  const on = !document.documentElement.classList.contains('rail');
  setRail(on);
  prefs.set('desk.shell.rail', on).catch(() => {});
};
applyTheme();
setRail(prefs.peek('desk.shell.rail', false));

// MARK: Sidebar and bottom bar

function badgeEl(id) {
  const n = badgeCounts[id] || 0;
  return h('span', { class: 'nav-badge', hidden: !n, 'data-badge': id, 'aria-label': n ? `${n} new` : null }, n ? String(n) : '');
}
function navLink(n, { compact = false } = {}) {
  return h('a', { class: 'nav-item', href: `#${navPath(n)}`, 'data-nav': n.id, title: n.label },
    h('span', { class: 'nav-icon' }, icon(n.icon || 'chevron_right', 22), icon(n.icon || 'chevron_right', 22, { filled: true })),
    h('span', { class: 'nav-label' }, compact ? n.label.split(' ')[0] : n.label), badgeEl(n.id));
}
function drawSidebar() {
  const items = registered.nav();
  const me = state.me || {};
  fill(shell.sideNav, NAV_GROUPS.map(([g, label]) => {
    const list = items.filter(n => (n.group || 'build') === g);
    if (!list.length) return null;
    return h('div', { class: 'nav-group', role: 'group', 'aria-label': label }, h('div', { class: 'nav-group-label' }, label), list.map(n => navLink(n)));
  }));
  fill(shell.sideFoot,
    h('button', { class: 'shell-me', type: 'button', 'aria-haspopup': 'menu', onclick: e => avatarMenu(e.currentTarget) },
      h('span', { class: 'avatar coach shell-avatar' }, monogram(18, { label: 'JK' })),
      h('span', { class: 'shell-me-text' }, h('span', { class: 'strong clamp1' }, me.name || 'Coach'), h('span', { class: 'tiny muted clamp1' }, me.email || 'Coach account'))),
    h('button', { class: 'shell-railbtn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Collapse the sidebar', title: 'Collapse the sidebar (⌘\\)', onclick: toggleRail },
      icon('left_panel_close', 20), icon('left_panel_open', 20)));
  setRail(document.documentElement.classList.contains('rail'));
  // The phone's bottom bar: four items by slot, then More.
  const slots = items.filter(n => n.mobile).sort((a, b) => mobileSlot(a) - mobileSlot(b)).slice(0, 4);
  const moreCount = items.filter(n => !slots.includes(n)).reduce((sum, n) => sum + (badgeCounts[n.id] || 0), 0);
  fill(shell.bottom, slots.map(n => navLink(n, { compact: true })),
    h('button', { class: 'nav-item', type: 'button', 'data-nav': 'more', onclick: openMore, 'aria-label': 'More' },
      h('span', { class: 'nav-icon' }, icon('more_horiz', 22)), h('span', { class: 'nav-label' }, 'More'),
      h('span', { class: 'nav-badge', hidden: !moreCount }, String(moreCount))));
  selectNav(shell.current);
}

function openMore() {
  slideOver('Everything', (body, close) => {
    const items = registered.nav();
    body.append(...NAV_GROUPS.map(([g, label]) => {
      const list = items.filter(n => (n.group || 'build') === g);
      return list.length ? h('section', { class: 'more-group' }, h('div', { class: 'nav-group-label' }, label),
        h('div', { class: 'more-grid' }, list.map(n => h('a', { class: 'more-item', href: `#${navPath(n)}`, onclick: () => close() },
          icon(n.icon || 'chevron_right', 22), h('span', null, n.label), badgeEl(n.id))))) : null;
    }).filter(Boolean),
    h('div', { class: 'more-foot' },
      button(h('span', { class: 'row gap4' }, icon('contrast', 18), 'Theme'), e => themeMenu(e.currentTarget), { small: true }),
      button(h('span', { class: 'row gap4' }, icon('logout', 18), 'Sign out'), () => { close(); signOut(); }, { small: true })));
  }, { className: 'more' });
}

function selectNav(key) {
  if (!shell) return;
  shell.current = key;
  const nav = navForKey(key);
  for (const a of document.querySelectorAll('.shell [data-nav]')) {
    const on = !!nav && a.dataset.nav === nav.id;
    a.classList.toggle('sel', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (!shell.crumbsSet) drawCrumbs(null);
}

// MARK: Top bar

function drawCrumbs(list) {
  shell.crumbsSet = !!list;
  const nav = navForKey(shell.current);
  const group = NAV_GROUPS.find(([g]) => g === nav?.group)?.[1];
  let trail = list || (nav ? [{ label: nav.label, path: navPath(nav) }] : []);
  // Every page leads with its nav group, drawn the same way. A page's own leading group step ("Engage", "Clients")
  // is folded into it; a lone crumb that is the group itself ("Settings") stands alone.
  const same = c => !!group && String(c?.label ?? '').toLowerCase() === group.toLowerCase();
  if (trail.length > 1 && same(trail[0])) trail = trail.slice(1);
  const lead = group && !(trail.length === 1 && same(trail[0])) && !(trail.length > 1 && !trail[0].path);
  fill(shell.crumbs, lead ? h('span', { class: 'crumb-group' }, group) : null,
    trail.map((c, i) => [i || lead ? h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, icon('chevron_right', 14)) : null,
      i < trail.length - 1
        // A step with no path ("Engage") reads as the group label, and phones drop it like the shell's own group.
        ? (c.path ? h('a', { class: 'crumb', href: `#${c.path}` }, c.label) : h('span', { class: 'crumb-group' }, c.label))
        : h('span', { class: 'crumb now', 'aria-current': 'page' }, c.label)]));
  document.title = `${trail.at(-1)?.label ? `${trail.at(-1).label} · ` : ''}JK Studio`;
}

function avatarMenu(anchor) {
  menu(anchor, [
    { label: 'Theme', icon: 'contrast', detail: { system: 'System', dark: 'Dark', light: 'Light' }[prefs.peek('desk.theme', 'dark')], onclick: () => themeMenu(anchor) },
    { label: 'Keyboard shortcuts', icon: 'keyboard', kbd: '?', onclick: showShortcuts },
    { label: 'Settings', icon: 'settings', onclick: () => go('/account') },
    'sep',
    { label: 'Sign out', icon: 'logout', danger: true, onclick: signOut },
  ], { label: 'Account' });
}
function themeMenu(anchor) {
  const now = prefs.peek('desk.theme', 'dark');
  menu(anchor, [['system', 'System', 'contrast'], ['dark', 'Dark', 'dark_mode'], ['light', 'Light', 'light_mode']].map(([v, label, ic]) => ({
    label, icon: ic, detail: v === now ? 'Current' : null, onclick: () => setTheme(v),
  })), { label: 'Theme' });
}
function quickCreate(anchor = shell?.newBtn) {
  const items = registered.quickCreates();
  if (!anchor) return;
  menu(anchor, items.length ? items.map(q => ({ label: q.label, icon: q.icon, onclick: () => q.run() })) : [{ label: 'Nothing to create yet', disabled: true }], { label: 'New' });
}

// MARK: Notifications (F3): the bell and its slide-over

async function refreshBell() {
  const out = await foundationApi('GET', '/api/notifications/count').catch(() => null);
  if (!shell) return;
  shell.bell.hidden = out === null;
  const n = out?.unread || 0;
  const count = shell.bell.querySelector('.bell-count');
  const was = Number(count.textContent) || 0;
  count.textContent = n ? String(n > 99 ? '99+' : n) : '';
  count.hidden = !n;
  shell.bell.setAttribute('aria-label', n ? `Notifications: ${n} unread` : 'Notifications');
  if (n > was) { count.classList.remove('pop'); void count.offsetWidth; count.classList.add('pop'); }
}
function openNotifications() {
  slideOver('Notifications', (body, close) => {
    let filter = 'unread';
    const listBox = h('div', { class: 'nt-list' }, skeleton('table', { rows: 4 }));
    const load = async () => {
      const out = await foundationApi('GET', '/api/notifications?limit=30').catch(err => { fill(listBox, errorLine(err)); return undefined; });
      if (out === undefined) return;
      const items = (out?.items || []).filter(n => filter === 'all' || !n.readAt);
      if (!items.length) {
        fill(listBox, h('div', { class: 'ui-empty small-empty' }, h('span', { class: 'brand-rule', 'aria-hidden': 'true' }), h('h2', { class: 'ui-empty-title' }, filter === 'unread' ? 'Nothing new.' : 'No notifications yet.')));
        return;
      }
      fill(listBox, items.map(n => h('a', {
        class: `nt-row${n.readAt ? '' : ' unread'}`, href: n.path ? `#${n.path}` : '#', onclick: async e => {
          if (!n.path) e.preventDefault();
          close();
          await foundationApi('POST', '/api/notifications/read', { ids: [n.id] }).catch(() => null);
          refreshBell();
        },
      }, h('span', { class: `nt-icon tone-${n.tone || 'data'}` }, icon(n.icon || 'notifications', 18)),
      h('span', { class: 'grow' }, h('span', { class: 'nt-title' }, n.title), n.body ? h('span', { class: 'nt-body clamp2' }, n.body) : null,
        h('span', { class: 'nt-meta' }, [n.client?.name, fmtRelative(n.at)].filter(Boolean).join(' · '))),
      n.tone === 'urgent' ? h('span', { class: 'pill' }, h('span', { class: 'dot bg-urgent', 'aria-hidden': 'true' }), 'Urgent') : null)));
    };
    body.append(
      h('div', { class: 'spread' },
        tabs([{ id: 'unread', label: 'Unread' }, { id: 'all', label: 'All' }], filter, v => { filter = v; load(); }, { label: 'Show' }),
        button('Mark all read', async e => {
          e.currentTarget.disabled = true;
          await foundationApi('POST', '/api/notifications/read', { all: true }).catch(err => toast(err.message, { error: true }));
          refreshBell(); load();
        }, { small: true, kind: 'text' })),
      listBox);
    load();
  });
}

// MARK: AI chip (GET /api/ai/status)

async function refreshAi() {
  const out = await foundationApi('GET', '/api/ai/status').catch(() => null);
  if (!shell) return;
  shell.ai.hidden = !out;
  if (!out) return;
  const word = out.provider === 'openrouter' ? 'on' : out.provider === 'stub' ? 'stub' : 'off';
  shell.ai.dataset.state = word;
  fill(shell.ai, icon('auto_awesome', 16), h('span', null, `AI · ${word}`));
  shell.ai.title = out.provider === 'openrouter' ? `AI on${out.model ? ` (${out.model})` : ''}` : out.provider === 'stub' ? 'AI is a labelled stub: no key is set, nothing leaves the server' : 'AI is off';
}

// MARK: Badges: one GET /api/coach/badges, coalesced to one request per 2 s

let badgeTimer = null, badgeBusy = false, badgeAgain = false, badgeLast = 0;
function queueBadges() {
  const wait = Math.max(0, 2000 - (Date.now() - badgeLast));
  if (badgeTimer || badgeBusy) { badgeAgain = true; return; }
  badgeTimer = setTimeout(loadBadges, wait);
}
async function loadBadges() {
  badgeTimer = null;
  badgeBusy = true;
  badgeLast = Date.now();
  try {
    const out = await foundationApi('GET', '/api/coach/badges').catch(() => null);
    const next = { ...(out?.badges || {}) };
    if (next.messages === undefined) {
      // Unread threads, as before the foundation (and until a feature supplies the count).
      const { threads } = await api('GET', '/api/threads');
      next.messages = threads.reduce((n, t) => n + (t.unread || 0), 0);
    }
    const grew = Object.keys(next).filter(k => (next[k] || 0) > (badgeCounts[k] || 0));
    badgeCounts = next;
    // The whole document: the More sheet's badges live in a slide-over outside .shell.
    for (const el of document.querySelectorAll('[data-badge]')) {
      const n = badgeCounts[el.dataset.badge] || 0;
      el.hidden = !n;
      el.textContent = n ? String(n > 99 ? '99+' : n) : '';
      el.setAttribute('aria-label', n ? `${n} new` : '');
      if (grew.includes(el.dataset.badge)) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    }
    const more = shell?.bottom.querySelector('[data-nav="more"] .nav-badge');
    if (more) {
      const inBar = new Set([...shell.bottom.querySelectorAll('[data-nav]')].map(a => a.dataset.nav));
      const n = Object.entries(badgeCounts).filter(([k]) => !inBar.has(k)).reduce((s, [, v]) => s + (v || 0), 0);
      more.hidden = !n; more.textContent = String(n);
    }
  } catch { /* try again on the next tick */ } finally {
    badgeBusy = false;
    if (badgeAgain) { badgeAgain = false; queueBadges(); }
  }
}

let liveOff = [];
let minuteTimer = null;
function renderShell() {
  liveOff.forEach(f => f()); liveOff = [];
  clearInterval(minuteTimer);
  const crumbs = h('nav', { class: 'shell-crumbs', 'aria-label': 'Breadcrumb' });
  const bell = h('button', { class: 'top-btn shell-bell', type: 'button', hidden: true, 'aria-label': 'Notifications', onclick: openNotifications },
    icon('notifications', 20), h('span', { class: 'bell-count', hidden: true }));
  const ai = h('button', { class: 'shell-ai', type: 'button', hidden: true, onclick: () => go('/account/ai') });
  const newBtn = h('button', { class: 'top-btn shell-new', type: 'button', 'aria-haspopup': 'menu', title: 'New (n)', onclick: e => quickCreate(e.currentTarget) },
    icon('add', 20), h('span', { class: 'shell-new-label' }, 'New'));
  const top = h('header', { class: 'shell-top' },
    h('a', { class: 'shell-top-brand', href: '#/today', 'aria-label': 'JK Studio, Today' }, monogram(24, { label: 'JK' })),
    crumbs,
    h('button', { class: 'shell-search', type: 'button', onclick: () => openPalette(), 'aria-label': 'Search or jump to (⌘K)' },
      icon('search', 18), h('span', { class: 'shell-search-text' }, 'Search or jump to…'), h('span', { class: 'shell-search-kbd' }, h('kbd', { class: 'ui-kbd' }, '⌘'), h('kbd', { class: 'ui-kbd' }, 'K'))),
    h('div', { class: 'shell-actions' }, newBtn, bell, ai,
      h('button', { class: 'top-btn shell-avatar-btn', type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Account and theme', onclick: e => avatarMenu(e.currentTarget) },
        h('span', { class: 'avatar coach' }, monogram(17, { label: 'JK' })))));
  const sideNav = h('div', { class: 'nav-list' });
  const sideFoot = h('div', { class: 'sidebar-foot' });
  const side = h('nav', { class: 'sidebar', 'aria-label': 'Main' },
    h('a', { class: 'brand', href: '#/today' }, monogram(30, { label: 'JK' }),
      h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'JK ', h('em', null, 'Studio')), h('span', { class: 'tiny muted' }, 'The coach desk'))),
    sideNav, sideFoot);
  const bottom = h('nav', { class: 'bottombar', 'aria-label': 'Main' });
  const outlet = h('main', { class: 'content', id: 'outlet', tabindex: '-1' });
  shell = { side, sideNav, sideFoot, bottom, top, crumbs, bell, ai, newBtn, current: null, crumbsSet: false };
  fill(app(), h('div', { class: 'shell' },
    h('a', { class: 'skip', href: '#outlet', onclick: e => { e.preventDefault(); outlet.focus(); } }, 'Skip to content'),
    side, h('div', { class: 'shell-main' }, top, outlet), bottom));
  drawSidebar();
  liveOff.push(onRegistryChange(kind => { if (kind === 'nav') drawSidebar(); }));
  setCrumbListener(list => { if (shell) drawCrumbs(list); });
  setBadgeListener(queueBadges);
  startRouter(() => document.getElementById('outlet'), selectNav);
  // Foundation parts (bell, AI chip, badges, live) ask the server once what it has.
  capabilities(true).then(() => {
    refreshBell(); refreshAi();
    // The server's copy of the desk prefs wins over this browser's (another computer may have changed them).
    prefs.get('desk.theme', 'dark').then(applyTheme).catch(() => {});
    prefs.get('desk.shell.rail', false).then(setRail).catch(() => {});
  });
  queueBadges();
  live.start();
  const badgeTypes = () => new Set(registered.nav().flatMap(n => n.badgeOn || []));
  liveOff.push(live.on('*', ev => {
    if (ev.type === 'notification') { refreshBell(); return; }
    if (ev.type === 'poll' || badgeTypes().has(ev.type)) queueBadges();
  }));
  minuteTimer = setInterval(() => { if (!document.hidden) queueBadges(); }, 60_000);
}

addEventListener('scroll', () => { shell?.top.classList.toggle('scrolled', scrollY > 4); }, { passive: true });
installShortcuts({ quickCreate: () => quickCreate(), toggleRail, toggleTheme });
addEventListener('jk:theme', e => setTheme(e.detail));

// MARK: - Start

setSignedOutHandler(message => { stopShell(); renderSignIn(message); });
function stopShell() {
  clearTimeout(badgeTimer); badgeTimer = null;
  clearInterval(minuteTimer);
  liveOff.forEach(f => f()); liveOff = [];
  live.stop();
  shell = null;
}

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
