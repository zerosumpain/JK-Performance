/*
 * Guides (the coach library) and the coach's Account. Ported from the iPhone
 * app's GuidesView and CoachAccountView (+ WebSessionsRow and
 * CalendarSubscribeCard), with the client account's export and delete.
 *
 * Desk v2: Account is Settings at /account/:section, a section list beside
 * the section; the existing parts are three sections and packages add theirs
 * with registerSettingsSection. /account/kit?kit=1 is the living style guide
 * and the registry harness (widgets, a client tab, the composer).
 */
import {
  ApiError, api, apiBlob, apiUpload, avatar, busy, button, card, clients, confirmBox, errorLine, eyebrow, field, fill, fmtMoney, fmtRelative, h, hashQuery,
  icon, link, loading, mediaImage, monogram, plans, prefs, readDraft, registerBulkAction, registerClientAction, registerClientTab,
  registerComposerTool, registerSendGuard, registerSettingsSection, registerSlash, registerWidget, registered, route, screenHeader,
  pill, setCrumbs, sheet, state, switchRow, toast, todayLondon, writeDraft, clearDraft,
} from './core.js';
import { composer } from './composer.js';
import {
  avatarStack, bento, countUp, dataTable, dateField, dateRange, emptyHero, inlineEdit, kanban, kbd, menu, moneyInput, openPanel, pageHead, popover,
  progressBar, ruleBuilder, scoreRing, segmentedNav, skeleton, slideOver, tabs, tagPicker, tile, timeField, timeline, wizard,
} from './ui.js';
import { barChart, cohortGrid, donut, funnel, gauge, heatmap, lineChart, sparkline } from './charts.js';

// MARK: - Local icons (SF Symbols the core set doesn't have)

/** The few extra symbols these screens draw, as Material Symbols (core icon()). */
const EXTRA = { lightbulb: 'lightbulb', book: 'guide', desktop: 'desktop_windows', hand: 'front_hand', download: 'download', external: 'open_in_new', calendarPlus: 'calendarFeed' };
const xicon = (name, size = 20) => icon(EXTRA[name] ?? name, size);
/** The iPhone's IconTile: a symbol in a raised rounded square. */
const iconTile = svg => h('span', { class: 'icon-tile' }, svg);
/** A row card: tile, title and detail, something on the right. */
const rowCard = (tile, title, detail, trailing, attrs = {}) => h(attrs.href ? 'a' : 'div', { ...attrs, class: 'row-card' + (attrs.class ? ` ${attrs.class}` : '') },
  tile, h('div', { class: 'grow' }, h('div', { class: 'strong' }, title), detail ? h('div', { class: 'tiny faint' }, detail) : null), trailing || null);

// MARK: - Guides

/** A guide opened in a sheet: minutes and tags, the title, the whole text. */
function openGuide(g) {
  sheet(g.title, body => {
    const meta = [g.minutes ? `${g.minutes} min` : null, ...(g.tags || [])].filter(Boolean).join(' · ');
    if (meta) body.append(h('div', { class: 'eyebrow mt-s' }, meta));
    body.append(h('p', { class: 'guide-body' }, g.body));
  });
}

function featuredCard(g) {
  return h('button', { class: 'featured-guide', type: 'button', onclick: () => openGuide(g) },
    h('div', { class: 'featured-art' }, xicon('book', 34), g.tags?.[0] ? h('span', { class: 'featured-tag' }, g.tags[0]) : null),
    h('div', { class: 'featured-text' },
      h('div', { class: 'eyebrow m0' }, 'Featured guide' + (g.minutes ? ` · ${g.minutes} min` : '')),
      h('h3', null, g.title),
      h('div', { class: 'small faint clamp3' }, g.body)));
}

function tipCard(tip) {
  return h('button', { class: 'tip-card', type: 'button', onclick: () => openGuide(tip) },
    iconTile(xicon('lightbulb', 18), 32),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, tip.title), h('div', { class: 'tiny faint clamp3' }, tip.body)));
}

route('/guides', async (el, _params, view) => {
  el.append(screenHeader('Coach library', 'Hints & guides'));
  let query = '';
  let filter = 'All';
  let guides = null;
  const search = h('input', { type: 'search', placeholder: 'Search guides and cues', 'aria-label': 'Search guides and cues', oninput: () => { query = search.value.trim().toLowerCase(); draw(); } });
  const chips = h('div', { class: 'guide-chips', role: 'toolbar', 'aria-label': 'Filter by tag' });
  const body = h('div', null, loading());
  el.append(h('label', { class: 'search-box' }, icon('search', 16), search), chips, body);
  el.append(
    h('p', { class: 'tiny faint guides-foot' }, 'To see the client side, use the iPhone app: Guides › View the app as a client.'),
    button('Sign out', () => window.dispatchEvent(new Event('jk:signout'))));

  const matches = g => (filter === 'All' || (g.tags || []).includes(filter))
    && (!query || g.title.toLowerCase().includes(query) || g.body.toLowerCase().includes(query));

  function draw() {
    const tags = ['All'];
    for (const t of [...(guides.tips || []).flatMap(x => x.tags || []), ...(guides.featured?.tags || [])]) if (!tags.includes(t)) tags.push(t);
    fill(chips, tags.map(t => h('button', { type: 'button', class: 'chip chip-btn' + (t === filter ? ' on' : ''), 'aria-pressed': String(t === filter), onclick: () => { filter = t; draw(); } }, t)));
    const tips = (guides.tips || []).filter(matches);
    fill(body,
      guides.featured && matches(guides.featured) ? featuredCard(guides.featured) : null,
      eyebrow('Quick tips'),
      tips.length ? h('div', { class: 'tip-grid' }, tips.map(tipCard)) : h('p', { class: 'small faint m0' }, 'Nothing matches.'));
  }

  const load = async () => {
    fill(body, loading());
    try {
      guides = await api('GET', '/api/guides');
      if (view.fresh()) draw();
    } catch (err) {
      if (view.fresh()) fill(body, errorLine(err), button('Try again', load, { small: true }));
    }
  };
  await load();
});

// MARK: - Account

/** Browsers signed in to the coach desk, and a button to sign them all out. */
function webSessionsRow() {
  const detail = h('div', { class: 'tiny faint' }, ' ');
  const right = h('div');
  const row = h('div', { class: 'row-card' }, iconTile(xicon('desktop')),
    h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Coach desk on the web'), detail), right);
  const show = s => {
    fill(detail, s.count === 0 ? 'Not signed in on any browser'
      : (s.count === 1 ? '1 browser' : `${s.count} browsers`) + (s.latestSignIn ? ` · last sign-in ${fmtRelative(s.latestSignIn)}` : ''));
    fill(right, s.count > 0 ? button('Sign out all', async e => {
      const ok = await confirmBox('Sign out every browser?', {
        ok: 'Sign out all', danger: true,
        detail: 'This ends every coach desk session, this browser included. You’ll need to sign in again here.',
      });
      if (!ok) return;
      await busy(e.currentTarget, null, async () => {
        await api('DELETE', '/api/auth/web-sessions');
        // This browser's session has just gone too: back to sign-in.
        window.dispatchEvent(new Event('jk:signout'));
      });
    }, { small: true }) : null);
  };
  api('GET', '/api/auth/web-sessions').then(show).catch(() => fill(detail, 'Couldn’t load browser sessions'));
  return row;
}

/** Subscribe to every booking and class in a calendar app (webcal feed). Hidden for the demo coach, as on the iPhone. */
function calendarCard(me) {
  const key = `jk.calendar.webcal.${me.id}`;
  const status = h('div');
  const actions = h('div', { class: 'row mt' });
  const title = h('div', { class: 'strong' }, 'Add all to your calendar');
  const urlLine = h('div');
  let active = null;

  const draw = () => {
    const saved = readDraft(key);
    title.textContent = active ? 'In your calendar' : 'Add all to your calendar';
    fill(urlLine, active && saved?.url ? h('div', { class: 'tiny faint mt-s' },
      'For Google or Outlook, subscribe by URL: ', h('code', { class: 'feed-url' }, saved.url)) : null);
    if (active) {
      fill(actions,
        saved?.webcal ? h('a', { class: 'btn small', href: saved.webcal }, 'Open again') : button('New link', subscribe, { small: true }),
        saved?.url ? button('Copy URL', async () => {
          try { await navigator.clipboard.writeText(saved.url); toast('Copied'); } catch { toast('Couldn’t copy. Select the URL instead.', { error: true }); }
        }, { small: true }) : null,
        button('Stop', stop, { small: true }));
    } else {
      fill(actions, button('Subscribe in Calendar', subscribe, { kind: 'primary', disabled: active === null }));
    }
  };
  async function subscribe(e) {
    await busy(e?.currentTarget, status, async () => {
      const feed = await api('POST', '/api/calendar/feed');
      active = feed.active;
      writeDraft(key, { webcal: feed.webcal, url: feed.url });
      draw();
      location.href = feed.webcal; // hands it to the calendar app, as the iPhone opens webcal://
    });
  }
  async function stop(e) {
    await busy(e?.currentTarget, status, async () => {
      const feed = await api('DELETE', '/api/calendar/feed');
      active = feed.active;
      clearDraft(key);
      draw();
    });
  }
  api('GET', '/api/calendar/feed').then(f => { active = f.active; draw(); }).catch(err => fill(status, errorLine(err)));
  draw();
  return card(null,
    h('div', { class: 'row nowrap' }, iconTile(xicon('calendarPlus')),
      h('div', { class: 'grow' }, title, h('div', { class: 'tiny faint' }, 'Every booking and class, kept up to date'))),
    urlLine, status, actions);
}

/** Download everything stored about this account as JSON. */
async function exportData(btn, status) {
  await busy(btn, status, async () => {
    const blob = await apiBlob('/api/me/export');
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `jk-performance-export-${todayLondon()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('Export downloaded');
  });
}

async function deleteAccount(btn, status) {
  const ok = await confirmBox('Delete your account?', {
    ok: 'Delete account and all data', danger: true,
    detail: 'This permanently erases your account and everything stored about you. It can’t be undone. A coach with clients can’t delete their account here.',
  });
  if (!ok) return;
  await busy(btn, status, async () => {
    try {
      await api('DELETE', '/api/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) throw new Error('You have clients, so this account can’t be deleted here. Contact support to close a coach account.');
      throw err;
    }
    window.dispatchEvent(new Event('jk:signout'));
  });
}

// MARK: - Coach settings (the phone app's Account: portrait, reply lines, rhythm, toggles)

const IMAGE_TYPES = ['image/jpeg', 'image/png'];

/** Portrait or signature: the current image (or the monogram) and an upload. */
function imageSetting(label, purpose, mediaId, onSaved, hint) {
  const status = h('div');
  const preview = mediaId
    ? mediaImage(`/api/media/${encodeURIComponent(mediaId)}`, label, { class: purpose === 'avatar' ? 'set-portrait' : 'set-signature' })
    : (purpose === 'avatar' ? h('span', { class: 'set-portrait empty' }, monogram(40, { label: 'JK monogram' })) : h('span', { class: 'set-signature empty small muted' }, 'None yet'));
  const file = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), 'aria-label': `Upload ${label.toLowerCase()}` });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) { fill(status, errorLine('Choose a JPEG or PNG image.')); return; }
    busy(file, status, async () => {
      await apiUpload(`/api/media?purpose=${purpose}`, f, f.type);
      toast(`${label} updated.`);
      onSaved();
    });
  });
  return h('div', { class: 'set-image' }, preview, h('div', { class: 'grow' }, h('div', { class: 'strong' }, label), h('div', { class: 'small muted' }, hint), file, status));
}

async function coachSettingsSection(box, view) {
  fill(box, loading());
  let s, p;
  try {
    [s, p] = await Promise.all([api('GET', '/api/coach/settings'), plans().catch(() => null)]);
  } catch (err) {
    if (view.fresh()) fill(box, errorLine(err));
    return;
  }
  if (!view.fresh()) return;
  const again = () => coachSettingsSection(box, view);
  const status = h('div');
  const patch = async (body, okText) => {
    try {
      s = await api('PATCH', '/api/coach/settings', body);
      if (okText) toast(okText);
      return true;
    } catch (err) { fill(status, errorLine(err)); return false; }
  };

  const room = h('input', { type: 'url', value: s.defaultMeetingUrl || '', placeholder: 'https://meet.example.com/jk', maxlength: '500' });
  const std = h('input', { value: s.replyExpectation.standard, maxlength: '60' });
  const pri = h('input', { value: s.replyExpectation.priority, maxlength: '60' });
  const saveText = button('Save', async () => {
    await busy(saveText, status, async () => {
      fill(status);
      if (await patch({ defaultMeetingUrl: room.value.trim() || null, replyExpectation: { standard: std.value.trim(), priority: pri.value.trim() } }, 'Saved.')) again();
    });
  }, { kind: 'primary' });

  const planRows = (p?.plans ?? []).filter(pl => s.letterRhythm[pl.id]);
  const rhythmRow = pl => {
    const r = s.letterRhythm[pl.id];
    const lettersOn = pl.features.includes('checkin');
    const every = h('select', { 'aria-label': `${pl.name} letter rhythm`, disabled: !lettersOn,
      onchange: e => patch({ letterRhythm: { [pl.id]: { every: e.target.value } } }, `${pl.name}: ${e.target.value === 'none' ? 'no letters' : `${e.target.value} letters`}.`) },
    [['weekly', 'Weekly'], ['fortnightly', 'Fortnightly'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: r.every === v }, l)));
    const media = h('input', { type: 'checkbox', checked: r.media, disabled: !lettersOn, 'aria-label': `${pl.name} letters carry a voice or video note`,
      onchange: e => patch({ letterRhythm: { [pl.id]: { media: e.target.checked } } }, e.target.checked ? `${pl.name} letters carry a note.` : `${pl.name} letters are written.`) });
    return h('div', { class: 'set-rhythm' },
      h('div', { class: 'grow' }, h('div', null, pl.name), h('div', { class: 'small muted' }, lettersOn ? 'Includes the weekly check-in' : 'No check-in on this plan, so no letters')),
      every, h('label', { class: 'set-media' }, media, 'With a note'));
  };

  const toggle = (key, text, detail) => switchRow(text, !!s[key], async (on, input) => {
    if (!await patch({ [key]: on }, null)) input.checked = !on;
  }, { detail });

  fill(box,
    h('div', { class: 'account-grid' },
      h('section', null,
        h('h2', { class: 'set-h' }, 'You, as clients see you'),
        card({ class: 'flush' },
          imageSetting('Portrait', 'avatar', s.avatarMediaId, again, 'On the JK tab and your letters. Without one, clients see the JK monogram.'),
          imageSetting('Signature', 'signature', s.signatureMediaId, again, 'Signs every letter. A PNG on a clear background works best.')),
        h('h2', { class: 'set-h' }, 'Replies and calls'),
        card(null,
          field('Reply line', std, 'Shown to clients on standard plans.'),
          field('Priority reply line', pri, 'Shown to clients on plans with priority replies.'),
          field('Meeting room', room, 'Video calls without their own link use this one.'),
          status, h('div', { class: 'row end' }, saveText))),
      h('section', null,
        h('h2', { class: 'set-h' }, 'Letter rhythm'),
        card({ class: 'flush' }, planRows.length ? planRows.map(rhythmRow) : h('p', { class: 'muted pad' }, 'Plans could not load.')),
        h('p', { class: 'small muted' }, 'Letters arrive on Monday at 07:00. A client can be moved to fortnightly from their letter.'),
        h('h2', { class: 'set-h' }, 'On the phone'),
        card({ class: 'flush' },
          toggle('studioTools', 'Show studio tools', 'Programs, Forms, Autoflows, Plans & prices, Business and availability in the phone app. They are always here on the desk.'),
          toggle('formChecks', 'Form checks', 'Clients can send a video of a lift.'),
          toggle('mealPhotos', 'Meal photos', 'Clients can send a photo of a meal.'),
          toggle('challenges', 'Challenges', 'Show challenges on clients’ Progress.')))));
}

// MARK: - Settings: /account/:section (desk v2). Packages add sections with registerSettingsSection.

/** Coach profile, replies, letter rhythm and the phone toggles. */
async function generalSection(box, view, me) {
  const settingsBox = h('div');
  box.append(
    h('div', { class: 'row nowrap account-id' }, avatar(me.name || 'Coach', 48, { photo: me.coachSettings?.avatarMediaId ? `/api/media/${encodeURIComponent(me.coachSettings.avatarMediaId)}` : null, coach: true }),
      h('div', null, h('h2', null, me.name || 'Coach'), h('div', { class: 'small faint' }, me.email || 'Coach account'))),
    h('p', { class: 'small muted' }, 'Signed in as the coach. Clients who sign up are assigned to you.'),
    settingsBox);
  await coachSettingsSection(settingsBox, view);
}

/** The desk itself: theme, calendar feed, browsers, privacy. */
function deskSection(box, _view, me) {
  const choice = prefs.peek('desk.theme', 'dark');
  box.append(
    h('h2', { class: 'set-h' }, 'Appearance'),
    card(null,
      h('div', { class: 'spread' }, h('div', null, h('div', { class: 'strong' }, 'Theme'), h('div', { class: 'small muted' }, 'Dark is the studio’s signature. Light suits bright rooms; System follows this computer.')),
        segmentedNav([{ id: 'system', label: 'System' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }], choice,
          v => window.dispatchEvent(new CustomEvent('jk:theme', { detail: v })), { label: 'Theme' }))),
    h('h2', { class: 'set-h' }, 'Desk and calendar'),
    rowCard(iconTile(xicon('hand')), 'Privacy policy', null, h('span', { class: 'faint' }, xicon('external', 18)),
      { href: '/privacy', target: '_blank', rel: 'noopener', class: 'row-link' }),
    me.isDemo ? null : calendarCard(me),
    webSessionsRow());
}

/** Export, delete, sign out. */
function dataSection(box) {
  const status = h('div');
  const exportBtn = h('button', { class: 'row-card row-btn', type: 'button', onclick: e => exportData(e.currentTarget, status) },
    iconTile(xicon('download')), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Export your data'), h('div', { class: 'tiny faint' }, 'Everything stored about you, as JSON')), icon('chevron', 18));
  const deleteBtn = h('button', { class: 'row-card row-btn', type: 'button', onclick: e => deleteAccount(e.currentTarget, status) },
    iconTile(icon('trash')), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Delete account'), h('div', { class: 'tiny faint' }, 'Erases your account and everything stored about you')), icon('chevron', 18));
  box.append(
    h('h2', { class: 'set-h' }, 'Your data'),
    exportBtn, deleteBtn, status,
    button('Sign out', async () => {
      if (await confirmBox('Sign out?', { ok: 'Sign out', danger: true })) window.dispatchEvent(new Event('jk:signout'));
    }),
    h('p', { class: 'tiny faint' }, 'To see the client side, use the iPhone app: Account › Preview as client.'));
}

registerSettingsSection({ id: 'general', label: 'Coach profile', icon: 'person', order: 10, render: generalSection }, { fallback: true });
registerSettingsSection({ id: 'desk', label: 'Desk and calendar', icon: 'desktop_windows', order: 20, render: deskSection }, { fallback: true });
registerSettingsSection({ id: 'data', label: 'Your data', icon: 'shield', order: 95, render: dataSection }, { fallback: true });

const kitOn = () => hashQuery().get('kit') === '1';

// MARK: - The kit: a living style guide and the registry harness (/account/kit?kit=1)

let kitDemoDone = false;
/** Test-only registrations, made the first time a kit page opens: they prove every host draws what is registered. */
function registerKitDemo() {
  if (kitDemoDone) return;
  kitDemoDone = true;
  registerWidget({ id: 'kit-demo', title: 'Kit widget', icon: 'grid_view', size: 's', order: 999,
    render: async body => { body.append(h('div', { class: 'ui-tile-num' }, '42'), h('div', { class: 'small muted' }, 'A registered widget (kit only)')); } });
  registerClientTab({ key: 'kit-demo', label: 'Kit tab', order: 999,
    render: async (box, { client }) => { box.append(card(null, h('div', { class: 'strong' }, `A registered client tab for ${client.name || client.id}`), h('p', { class: 'small muted m0' }, 'Drawn from registerClientTab (kit only).'))); } });
  registerClientAction({ id: 'kit-demo', label: 'Kit action', icon: 'bolt', order: 999, run: c => toast(`Kit action for ${c.name || c.id}`) });
  registerBulkAction({ id: 'kit-demo', label: 'Kit bulk', icon: 'done_all', run: async ids => toast(`Kit bulk action on ${ids.length} client${ids.length === 1 ? '' : 's'}`) });
  registerComposerTool({ id: 'kit-demo', label: 'Insert', icon: 'format_quote', order: 999, run: c => c.insert('Hello from the kit. ') });
  registerSlash({ id: 'kit', label: 'Kit greeting', detail: 'Inserts a line', run: c => c.insert('Morning! Quick one from the kit. ') });
  registerSendGuard({ id: 'kit-demo', order: 999, check: async (draft, ctx) => {
    if (!/check/i.test(draft.text)) return { ok: true };
    const panel = h('div', null,
      h('div', { class: 'row gap4' }, h('span', { class: 'pill' }, h('span', { class: 'dot bg-attention', 'aria-hidden': 'true' }), 'Worth a look'), h('span', { class: 'small muted' }, 'The kit guard stops drafts that say “check”.')),
      h('div', { class: 'row mt' }, button('Send anyway', () => ctx.proceed({ kitGuard: 'overridden' }), { small: true, kind: 'primary' }), button('Edit', () => ctx.dismiss(), { small: true })));
    return { ok: false, panel };
  } });
}

// Opening the desk with ?kit=1 on any route registers the demos at once, so every host shows them.
if (kitOn()) registerKitDemo();

const kitGate = (el, view) => {
  if (kitOn()) { registerKitDemo(); return true; }
  el.append(emptyHero({ icon: 'lock', title: 'The kit is a developer page.', line: 'Open it with ?kit=1 in the address.', action: { label: 'Open the kit', path: '/account/kit?kit=1' } }));
  return false;
};
const kitNav = here => h('nav', { class: 'ui-head-actions' }, [['/account/kit?kit=1', 'Components'], ['/account/kit/widgets?kit=1', 'Widgets'], ['/account/kit/client-tab/kit-demo?kit=1', 'Client tab'], ['/account/kit/composer?kit=1', 'Composer']]
  .map(([path, label]) => link(path, { class: 'btn small' + (here === label ? ' primary' : '') }, label)));

route('/account/kit/widgets', async (el, _p, view) => {
  if (!kitGate(el, view)) return;
  setCrumbs([{ label: 'Settings', path: '/account' }, { label: 'Kit', path: '/account/kit?kit=1' }, { label: 'Widgets' }]);
  el.append(pageHead({ eyebrow: 'Kit harness', title: 'Every registered', accent: 'widget', actions: kitNav('Widgets') }));
  const { widgetGrid } = await import('./today.js');
  el.append(await widgetGrid(view, { all: true }));
}, { nav: 'account' });

route('/account/kit/client-tab/:key', async (el, { key }, view) => {
  if (!kitGate(el, view)) return;
  setCrumbs([{ label: 'Settings', path: '/account' }, { label: 'Kit', path: '/account/kit?kit=1' }, { label: 'Client tab' }]);
  const tab = registered.clientTabs().find(t => t.key === key);
  el.append(pageHead({ eyebrow: 'Kit harness', title: 'Client tab', accent: tab?.label || key, actions: kitNav('Client tab') }));
  const picker = h('div', { class: 'row mb' }, registered.clientTabs().map(t => link(`/account/kit/client-tab/${t.key}?kit=1${view.query.get('client') ? `&client=${encodeURIComponent(view.query.get('client'))}` : ''}`, { class: 'chip' + (t.key === key ? ' on' : '') }, t.label)));
  const box = h('div', null, skeleton('card'));
  el.append(picker, box);
  if (!tab) { fill(box, errorLine(`No client tab is registered as “${key}”.`)); return; }
  const list = await clients().catch(() => []);
  const client = list.find(c => c.id === view.query.get('client')) || list[0];
  if (!view.fresh()) return;
  if (!client) { fill(box, errorLine('No client to draw the tab for.')); return; }
  const ctx = { id: client.id, view, name: client.name, planName: client.plan, first: () => client.name.split(' ')[0] };
  const detailP = api('GET', `/api/coach/clients/${encodeURIComponent(client.id)}`).catch(() => null);
  ctx.detail = () => detailP;
  ctx.reloadDetail = () => detailP;
  fill(box);
  await tab.render(box, { client, detail: await detailP, view, ctx });
}, { nav: 'account' });

route('/account/kit/composer', async (el, _p, view) => {
  if (!kitGate(el, view)) return;
  setCrumbs([{ label: 'Settings', path: '/account' }, { label: 'Kit', path: '/account/kit?kit=1' }, { label: 'Composer' }]);
  el.append(pageHead({ eyebrow: 'Kit harness', title: 'The', accent: 'composer', sub: 'Every registered tool, slash item and send guard. Nothing is sent: a send is logged below. Type “check” to see the kit guard.', actions: kitNav('Composer') }));
  const log = h('ol', { class: 'small muted' });
  const c = composer({ clientId: view.query.get('client'), draftKey: 'jk.desk.kit.composer', placeholder: 'Write something, or type / for shortcuts',
    onSend: async draft => { log.prepend(h('li', null, `Would send: “${draft.text}”${Object.keys(draft.meta || {}).length ? ` · ${JSON.stringify(draft.meta)}` : ''}`)); toast('Logged, not sent'); } });
  el.append(card(null, c.el), eyebrow('Tools'), h('div', { class: 'row' }, registered.composerTools().map(t => h('span', { class: 'chip' }, t.label))),
    eyebrow('Send guards'), h('div', { class: 'row' }, registered.sendGuards().map(g => h('span', { class: 'chip' }, g.id))),
    eyebrow('Sends'), log);
}, { nav: 'account' });

route('/account/kit', async (el, _p, view) => {
  if (!kitGate(el, view)) return;
  setCrumbs([{ label: 'Settings', path: '/account' }, { label: 'Design kit' }]);
  el.append(pageHead({ eyebrow: 'Atelier Night', title: 'The desk', accent: 'kit', sub: 'Every component in the desk-v2 kit, live. Switch the theme (⌘.) to see both.', actions: kitNav('Components') }));
  await kitPage(el, view);
}, { nav: 'account' });

// Registered after the kit routes, so /account/kit is never read as a section.
route('/account/:section?', async (el, { section }, view) => {
  const sections = registered.settings();
  const id = section || 'general';
  const current = sections.find(s => s.id === id);
  el.append(pageHead({ eyebrow: 'Settings', title: current && id !== 'general' ? current.label : 'Account and', accent: current && id !== 'general' ? null : 'settings' }));
  setCrumbs([{ label: 'Settings', path: '/account' }, ...(current && id !== 'general' ? [{ label: current.label }] : [])]);
  const nav = h('nav', { class: 'set-nav', 'aria-label': 'Settings sections' },
    sections.map(s => link(s.id === 'general' ? '/account' : `/account/${s.id}`, { class: s.id === id ? 'sel' : '', 'aria-current': s.id === id ? 'page' : null }, icon(s.icon || 'settings', 18), s.label)),
    // The kit is a developer page: its link shows only once the desk is opened with ?kit=1.
    kitOn() ? link('/account/kit?kit=1', { class: 'set-kit' }, icon('grid_view', 18), 'Design kit') : null);
  const body = h('div', { class: 'set-body' }, skeleton('card', { rows: 4 }));
  el.append(h('div', { class: 'set-layout' }, nav, body));
  if (!current) {
    fill(body, emptyHero({ icon: 'settings', title: 'Not here yet.', line: 'That settings section belongs to a feature this desk doesn’t have yet.', action: { label: 'Back to settings', path: '/account' } }));
    return;
  }
  let me;
  try {
    me = await api('GET', '/api/me');
    state.me = me;
  } catch (err) {
    if (view.fresh()) fill(body, errorLine(err));
    return;
  }
  if (!view.fresh()) return;
  fill(body);
  try { await current.render(body, view, me); } catch (err) { if (view.fresh()) body.append(errorLine(err)); }
});


// MARK: - The kit page: every component, live

const kitSec = (title, line, ...body) => h('section', { class: 'kit-sec' }, h('h2', null, title), line ? h('p', null, line) : null, ...body);
const SAMPLE = ['Sam Carter', 'Priya Shah', 'Tom Burke', 'Leo Grant', 'Alex Morgan', 'Ella Hughes', 'Maya Patel'];

async function kitPage(el, view) {
  const days = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(2026, 10, 1 + i * 2, 12)); return d.toISOString().slice(0, 10); });
  const fmtD = d => `${Number(d.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(d.slice(5, 7)) - 1]}`;
  const swatches = ['bg', 'surface', 'raised', 'paper', 'hairline', 'text', 'text-secondary', 'text-tertiary', 'accent', 'accent-wash', 'on-track', 'attention', 'data', 'urgent', 'error', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'heat-0', 'heat-2', 'heat-4']
    .map(t => h('div', { class: 'kit-swatch' }, h('span', { style: { '--sw': `var(--${t})` } }), h('div', null, h('code', null, `--${t}`))));

  // Bento
  const bentoBox = h('div');
  const tiles = [
    tile({ id: 'needs', eyebrow: 'Command', title: 'Needs you', icon: 'inbox', size: 'l', tall: true, hero: true, action: { label: 'Open', path: '/today' },
      body: [h('div', { class: 'ui-tile-num serif' }, '4'), h('p', { class: 'small muted' }, 'people need you today'), avatarStack(SAMPLE.slice(0, 6).map(name => ({ name })))] }),
    tile({ id: 'revenue', title: 'Collected this month', icon: 'payments', size: 's', body: [h('div', { class: 'ui-tile-num', 'data-count': '3840' }, '£0'), h('div', { class: 'small muted' }, '+12% on last month')] }),
    tile({ id: 'score', title: 'Health', icon: 'monitor_heart', size: 's', body: h('div', { class: 'row' }, scoreRing(82), scoreRing(58), scoreRing(31)) }),
    tile({ id: 'loading', title: 'Loading', size: 'l', loading: true }),
    tile({ id: 'spark', title: 'Sessions', icon: 'calendar_month', size: 'l', body: [h('div', { class: 'ui-tile-num' }, '26'), sparkline([12, 14, 13, 18, 17, 21, 19, 24, 26], { width: 200, height: 36, label: 'Sessions per week' })] }),
    tile({ id: 'progress', title: 'Onboarding', icon: 'how_to_reg', size: 'l', body: [progressBar(68, { label: 'Ella · 5 of 7 steps' }), h('div', { class: 'mt' }, progressBar(30, { label: 'Maya · 2 of 7', tone: 'attention' }))] }),
  ];
  const grid = bento(bentoBox, tiles, { editable: true, onLayout: l => toast(`Layout: ${l.map(x => `${x.id}:${x.size}${x.hidden ? ' (hidden)' : ''}`).join(', ')}`) });
  let editing = false;
  const editBtn = button('Customise', () => { editing = !editing; grid.setEditing(editing); editBtn.textContent = editing ? 'Done' : 'Customise'; }, { small: true });
  requestAnimationFrame(() => bentoBox.querySelectorAll('[data-count]').forEach(n => countUp(n, Number(n.dataset.count), { format: v => fmtMoney(Math.round(v) * 100) })));

  // Table
  const rows = SAMPLE.map((name, i) => ({ id: `k${i}`, name, plan: ['Elite', 'Performance', 'Foundation'][i % 3], health: [82, 58, 31, 74, 91, 45, 66][i], balance: [0, 12000, 4500, 0, 0, 9000, 0][i], last: `${i + 1} days ago` }));
  const table = dataTable({
    label: 'Clients', rows, selectable: true, initialSort: { key: 'health', dir: -1 },
    columns: [
      { key: 'name', label: 'Client', sort: true, render: r => h('span', { class: 'row gap4' }, avatar(r.name, 24), r.name) },
      { key: 'plan', label: 'Plan', sort: true },
      { key: 'health', label: 'Health', sort: true, align: 'right', render: r => h('span', { class: `t-num ${r.health >= 70 ? 'tone-ok' : r.health >= 45 ? 'tone-attention' : 'tone-urgent'}` }, String(r.health)) },
      { key: 'balance', label: 'Balance', sort: true, align: 'right', render: r => h('span', { class: 't-num' }, fmtMoney(r.balance)) },
      { key: 'last', label: 'Last active' },
    ],
    onRow: r => slideOver(r.name, body => { body.append(h('p', null, `${r.plan} plan · health ${r.health}`), timeline([
      { at: new Date().toISOString(), icon: 'chat_bubble', title: 'Message sent', detail: 'Great session today.' },
      { at: new Date(Date.now() - 864e5).toISOString(), icon: 'event_available', tone: 'ok', title: 'Booked Tue 07:00', detail: '1:1 · Studio' },
    ])); }),
    bulkActions: [{ label: 'Tag', icon: 'label', run: picked => toast(`Tag ${picked.length}`) }, { label: 'Message', icon: 'chat_bubble', run: picked => toast(`Message ${picked.length}`) }],
  });

  // Kanban
  const stages = [{ id: 'new', label: 'New', tone: 'data' }, { id: 'consult', label: 'Consult booked', tone: 'attention' }, { id: 'won', label: 'Won', tone: 'ok' }];
  const leads = SAMPLE.slice(0, 5).map((name, i) => ({ id: `l${i}`, name, stage: stages[i % 3].id, value: (i + 2) * 6000 }));
  const board = kanban({ label: 'Pipeline', columns: stages, items: leads, columnOf: l => l.stage, sum: list => fmtMoney(list.reduce((n, l) => n + l.value, 0)),
    render: l => [h('div', { class: 'strong small' }, l.name), h('div', { class: 'tiny faint' }, `${fmtMoney(l.value)} · via Instagram`)],
    onMove: async (l, to) => { if (to === 'won' && l.name.startsWith('Tom')) throw new Error('the server said no (kit demo)'); l.stage = to; toast(`${l.name} → ${stages.find(x => x.id === to).label}`, { undo: async () => toast('Undone (kit)') }); },
    onOpen: l => toast(`Open ${l.name}`) });

  // Wizard and rules
  const wiz = wizard([
    { id: 'who', label: 'Client', render: (box, d) => box.append(field('Client', h('select', { onchange: e => { d.client = e.target.value; } }, h('option', { value: '' }, 'Choose…'), SAMPLE.map(n => h('option', { value: n }, n))))), valid: d => !!d.client },
    { id: 'amount', label: 'Amount', render: (box, d) => box.append(field('Amount', moneyInput({ value: d.pence ?? null, onChange: p => { d.pence = p; } }))), valid: d => d.pence > 0 },
    { id: 'due', label: 'Due', render: (box, d) => box.append(field('Due', dateField({ value: d.due || '', onChange: v => { d.due = v; } }))), valid: d => !!d.due },
  ], { finishLabel: 'Create', onFinish: async d => toast(`Would create ${fmtMoney(d.pence)} for ${d.client}, due ${d.due}`) });
  const facts = [
    { id: 'core.daysQuiet', label: 'Days quiet', type: 'days' }, { id: 'core.plan', label: 'Plan', type: 'enum', options: [{ value: 'foundation', label: 'Foundation' }, { value: 'performance', label: 'Performance' }, { value: 'elite', label: 'Elite' }] },
    { id: 'core.pain14', label: 'Pain in 14 days', type: 'bool' }, { id: 'billing.balance', label: 'Balance owed', type: 'money' }, { id: 'core.tags', label: 'Tags', type: 'tags' },
  ];
  const tags = [{ id: 't1', name: 'Marathon', color: 'chart-1' }, { id: 't2', name: 'Rehab', color: 'chart-5' }, { id: 't3', name: 'VIP', color: 'chart-4' }, { id: 't4', name: 'Studio', color: 'chart-2' }];
  const rules = ruleBuilder({ facts, tags, value: { match: 'all', rules: [{ fact: 'core.daysQuiet', op: 'gte', value: 7 }, { match: 'any', rules: [{ fact: 'core.plan', op: 'in', value: ['performance', 'elite'] }] }] }, count: async r => 3 + r.rules.length });

  const menuBtn = button(h('span', { class: 'row gap4' }, icon('more_horiz', 18), 'Menu'), e => menu(e.currentTarget, [
    { label: 'Message', icon: 'chat_bubble', kbd: 'r', onclick: () => toast('Message') }, { label: 'Snooze', icon: 'snooze', kbd: 's', onclick: () => toast('Snoozed', { undo: async () => toast('Unsnoozed') }) }, 'sep',
    { label: 'End coaching', icon: 'heart_broken', danger: true, onclick: () => confirmBox('End coaching for Sam?', { ok: 'End coaching', danger: true }) }]), { small: true });
  const popBtn = button('Popover', e => popover(e.currentTarget, box => box.append(h('div', { class: 'pad-s' }, h('div', { class: 'strong' }, 'Adherence 82'), h('div', { class: 'small muted' }, 'Quiet 1 day · Kept 2/3 commitments')))), { small: true });

  el.append(
    kitSec('Tokens', 'Colours are unchanged from Atelier; desk v2 adds glass, tiles, sheen, shimmer, floating shadows, chart and heat ramps.', h('div', { class: 'kit-swatches' }, swatches)),
    kitSec('Type', null, h('div', { class: 'stack' }, h('div', { class: 't-display' }, 'Good morning, ', h('em', { class: 'accent-word' }, 'JK')), h('div', { class: 't-display-s' }, 'Display small, 32'),
      h('div', { class: 't-number' }, '£12,480'), h('div', { class: 't-quote' }, 'Keep going. The work is working.'), h('p', { class: 'muted m0' }, 'Body text in the sans, 15 px, for everything the coach scans.'))),
    kitSec('Buttons, pills, keys', null, h('div', { class: 'kit-row' }, button('Primary', () => toast('Primary'), { kind: 'primary' }), button('Secondary', () => toast('Secondary')), button('Text', () => {}, { kind: 'text' }),
      button('Danger', () => {}, { kind: 'danger' }), button('Small', () => {}, { small: true }), menuBtn, popBtn, pill('On track', 'ok'), pill('Overdue', 'attention'), pill('Pain flag', 'urgent'), pill('Lead', 'data'), kbd('⌘K'), kbd('g i'))),
    kitSec('Tiles and the bento', 'Hover lifts a tile 1 px; Customise drags (or arrow-keys the handle), resizes and hides.', h('div', { class: 'row mb' }, editBtn), bentoBox),
    kitSec('Tabs and segmented', null, tabs([{ id: 'all', label: 'All', badge: 12 }, { id: 'msg', label: 'Messages', badge: 4 }, { id: 'forms', label: 'Forms' }], 'all', v => toast(`Tab ${v}`), { sync: 'kittab' }),
      h('div', { class: 'mt' }, segmentedNav([{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'year', label: 'Year' }], 'month', v => toast(v)))),
    kitSec('Data table', 'Sort by a column, filter, select rows for the bulk bar; Enter opens a row in a slide-over.', table.el),
    kitSec('Kanban', 'Drag, or focus a card and press Space, arrows, Space. Moving Tom to Won fails on purpose and rolls back.', board.el),
    kitSec('Slide-over and toasts', null, h('div', { class: 'kit-row' },
      button('Open slide-over', () => slideOver('Sam Carter', body => { body.append(h('p', null, 'A preview that keeps the list’s place.'), button('Open a second', () => slideOver('Invoice JK-0012', b2 => b2.append(h('p', null, 'Two deep at most.')), { wide: true }))); })),
      button('Client panel (deep link)', () => openPanel('client', state.clients?.[0]?.id || 'none')),
      button('Toast', () => toast('Saved.')), button('Toast with Undo', () => toast('Marked done', { undo: async () => toast('Undone') })), button('Error toast', () => toast('Couldn’t reach the server.', { error: true })))),
    kitSec('Timeline', null, card(null, timeline([
      { at: new Date().toISOString(), icon: 'graphic_eq', tone: 'accent', title: 'Voice note · 0:42', detail: 'Transcribed' },
      { at: new Date(Date.now() - 3 * 3600e3).toISOString(), icon: 'task_alt', tone: 'ok', title: 'Workout completed', detail: 'Lower A · felt strong' },
      { at: new Date(Date.now() - 864e5).toISOString(), icon: 'receipt_long', tone: 'attention', title: 'Invoice overdue', detail: 'JK-2026-0012 · £120', path: '/today' },
    ]))),
    kitSec('Wizard', null, card(null, wiz.el)),
    kitSec('Rule builder', 'One level of any/all groups, typed value controls, a live match count.', card(null, rules.el)),
    kitSec('Tags, people, inline edit', null, h('div', { class: 'stack' }, tagPicker({ selected: ['t1', 't3'], all: tags, onChange: ids => toast(`Tags: ${ids.join(', ')}`) }),
      avatarStack(SAMPLE.map(name => ({ name }))), h('div', null, 'Goal: ', inlineEdit('Run a sub-4 marathon', async v => toast(`Saved “${v}”`), { label: 'Goal' })),
      h('div', { class: 'kit-row' }, dateField({ value: '2026-11-24' }), timeField({ value: '07:00' }), dateRange({ from: '2026-11-24', to: '2026-12-01' }), moneyInput({ value: 12000 })))),
    kitSec('Empty state and skeletons', null, h('div', { class: 'grid2' }, card(null, emptyHero({ title: 'Inbox zero.', line: 'Go coach someone.', action: { label: 'Open Today', path: '/today' } })),
      card(null, skeleton('lines'), h('div', { class: 'mt' }, skeleton('table', { rows: 3 })), h('div', { class: 'mt' }, skeleton('chart'))))),
    kitSec('Charts', 'Hand-written SVG. Hover for the crosshair; focus a chart and use the arrow keys.', h('div', { class: 'ui-bento' },
      tile({ size: 'xl', title: 'Revenue', body: lineChart({ ariaLabel: 'Revenue by day', series: [{ label: 'Collected', tone: 1, points: days.map((d, i) => ({ x: d, y: 200 + i * 35 + (i % 3) * 40 })) }, { label: 'Forecast', tone: 2, points: days.map((d, i) => ({ x: d, y: 260 + i * 28 })) }], area: true, goal: { value: 600, label: 'Target' }, xFormat: fmtD, yFormat: v => `£${v}` }) }),
      tile({ size: 'm', title: 'Plans', body: donut({ parts: [{ label: 'Elite', value: 6 }, { label: 'Performance', value: 11 }, { label: 'Foundation', value: 8 }], centre: { value: '25', label: 'clients' }, size: 120 }) }),
      tile({ size: 'l', title: 'Sessions by week', body: barChart({ ariaLabel: 'Sessions by week', stacked: true, bars: ['W44', 'W45', 'W46', 'W47', 'W48'].map((w, i) => ({ label: w, parts: [{ label: '1:1', value: 10 + i, tone: 1 }, { label: 'Group', value: 6 + (i % 2) * 3, tone: 2 }, { label: 'Video', value: 3 + i, tone: 4 }] })) }) }),
      tile({ size: 'l', title: 'When clients train', body: heatmap({ rows: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], cols: ['6', '8', '10', '12', '14', '16', '18', '20'], values: Array.from({ length: 7 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r * 7 + c * 5) % 11))) }) }),
      tile({ size: 'l', title: 'Retention by cohort', body: cohortGrid({ cohorts: ['Jul', 'Aug', 'Sep', 'Oct'].map((m, i) => ({ label: m, size: 8 + i, values: [100, 88, 76, 70, 64].slice(0, 5 - i) })) }) }),
      tile({ size: 's', title: 'Lead funnel', body: funnel({ stages: [{ label: 'Enquiries', value: 48 }, { label: 'Consults', value: 21 }, { label: 'Trials', value: 12 }, { label: 'Clients', value: 8 }] }) }),
      tile({ size: 's', title: 'Gauge', body: gauge(72, { label: 'Health' }) }))),
    kitSec('Composer', 'Enter sends, Shift+Enter is a new line, / opens shortcuts. Nothing is sent from the kit.', card(null, composer({ draftKey: 'jk.desk.kit.inline', placeholder: 'Try / or the word “check”', onSend: async d => toast(`Would send: ${d.text}`) }).el)),
  );
  void view;
}
