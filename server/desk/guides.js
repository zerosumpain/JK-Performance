/*
 * Guides (the coach library) and the coach's Account. Ported from the iPhone
 * app's GuidesView and CoachAccountView (+ WebSessionsRow and
 * CalendarSubscribeCard), with the client account's export and delete.
 */
import {
  ApiError, api, apiBlob, avatar, busy, button, card, confirmBox, errorLine, eyebrow, fill, fmtRelative, h, icon,
  loading, readDraft, route, screenHeader, sheet, state, toast, todayLondon, writeDraft, clearDraft,
} from './core.js';

// MARK: - Local icons (SF Symbols the core set doesn't have)

const SVG = 'http://www.w3.org/2000/svg';
const EXTRA_ICONS = {
  lightbulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z',
  book: 'M3 5c3-1 6-1 9 1 3-2 6-2 9-1v14c-3-1-6-1-9 1-3-2-6-2-9-1zM12 6v14',
  desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
  hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v7M14 10V5.5a1.5 1.5 0 0 1 3 0V13M17 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.7L3.8 15a1.5 1.5 0 0 1 2.4-1.8L8 15',
  download: 'M12 3v12M7 10l5 5 5-5M4 20h16',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  calendarPlus: 'M4 5h16v15H4zM4 9h16M9 3v4M15 3v4M12 12v5M9.5 14.5h5',
};
/** Like core's icon(), for the few extra symbols these screens draw. */
function xicon(name, size = 18) {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, String(v));
  svg.classList.add('icon');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', EXTRA_ICONS[name] || 'M12 12h.01');
  svg.append(path);
  return svg;
}
/** The iPhone's IconTile: a symbol in a raised rounded square. */
const iconTile = (svg, size = 38) => h('span', { class: 'icon-tile', style: { width: `${size}px`, height: `${size}px` } }, svg);
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
    iconTile(xicon('lightbulb', 15), 32),
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

route('/account', async (el, _params, view) => {
  el.append(screenHeader(null, 'Account'));
  const body = h('div', null, loading());
  el.append(body);
  let me;
  try {
    me = await api('GET', '/api/me');
    state.me = me;
  } catch (err) {
    if (view.fresh()) fill(body, errorLine(err));
    return;
  }
  if (!view.fresh()) return;
  const status = h('div');
  const exportBtn = h('button', { class: 'row-card row-btn', type: 'button', onclick: e => exportData(e.currentTarget, status) },
    iconTile(xicon('download')), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Export your data'), h('div', { class: 'tiny faint' }, 'Everything stored about you, as JSON')), icon('chevron', 14));
  const deleteBtn = h('button', { class: 'row-card row-btn', type: 'button', onclick: e => deleteAccount(e.currentTarget, status) },
    iconTile(icon('trash')), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Delete account'), h('div', { class: 'tiny faint' }, 'Erases your account and everything stored about you')), icon('chevron', 14));

  fill(body,
    h('div', { class: 'row nowrap account-id' }, avatar(me.name || 'Coach', 48),
      h('div', null, h('h2', null, me.name || 'Coach'), h('div', { class: 'small faint' }, me.email || 'Coach account'))),
    h('p', { class: 'small muted' }, 'Signed in as the coach. Clients who sign up are assigned to you.'),
    h('div', { class: 'account-grid' },
      h('section', null,
        eyebrow('Settings'),
        rowCard(iconTile(xicon('hand')), 'Privacy policy', null, h('span', { class: 'faint' }, xicon('external', 14)),
          { href: '/privacy', target: '_blank', rel: 'noopener', class: 'row-link' }),
        me.isDemo ? null : calendarCard(me),
        webSessionsRow()),
      h('section', null,
        eyebrow('Your data'),
        exportBtn,
        deleteBtn,
        status,
        button('Sign out', async () => {
          if (await confirmBox('Sign out?', { ok: 'Sign out', danger: true })) window.dispatchEvent(new Event('jk:signout'));
        }, { kind: 'primary' }),
        h('p', { class: 'tiny faint' }, 'To see the client side, use the iPhone app: Guides › View the app as a client.'))));
});
