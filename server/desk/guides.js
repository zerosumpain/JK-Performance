/*
 * Guides (the coach library) and the coach's Account. Ported from the iPhone
 * app's GuidesView and CoachAccountView (+ WebSessionsRow and
 * CalendarSubscribeCard), with the client account's export and delete.
 */
import {
  ApiError, api, apiBlob, apiUpload, avatar, busy, button, card, confirmBox, errorLine, eyebrow, field, fill, fmtRelative, h, icon,
  loading, mediaImage, monogram, plans, readDraft, route, screenHeader, sheet, state, switchRow, toast, todayLondon, writeDraft, clearDraft,
} from './core.js';

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

route('/account', async (el, _params, view) => {
  el.append(screenHeader(null, 'Account and settings'));
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
    iconTile(xicon('download')), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Export your data'), h('div', { class: 'tiny faint' }, 'Everything stored about you, as JSON')), icon('chevron', 18));
  const deleteBtn = h('button', { class: 'row-card row-btn', type: 'button', onclick: e => deleteAccount(e.currentTarget, status) },
    iconTile(icon('trash')), h('div', { class: 'grow' }, h('div', { class: 'strong' }, 'Delete account'), h('div', { class: 'tiny faint' }, 'Erases your account and everything stored about you')), icon('chevron', 18));

  const settingsBox = h('div');
  fill(body,
    h('div', { class: 'row nowrap account-id' }, avatar(me.name || 'Coach', 48, { photo: me.coachSettings?.avatarMediaId ? `/api/media/${encodeURIComponent(me.coachSettings.avatarMediaId)}` : null, coach: true }),
      h('div', null, h('h2', null, me.name || 'Coach'), h('div', { class: 'small faint' }, me.email || 'Coach account'))),
    h('p', { class: 'small muted' }, 'Signed in as the coach. Clients who sign up are assigned to you.'),
    settingsBox,
    h('div', { class: 'account-grid' },
      h('section', null,
        h('h2', { class: 'set-h' }, 'Desk and calendar'),
        rowCard(iconTile(xicon('hand')), 'Privacy policy', null, h('span', { class: 'faint' }, xicon('external', 18)),
          { href: '/privacy', target: '_blank', rel: 'noopener', class: 'row-link' }),
        me.isDemo ? null : calendarCard(me),
        webSessionsRow()),
      h('section', null,
        h('h2', { class: 'set-h' }, 'Your data'),
        exportBtn,
        deleteBtn,
        status,
        button('Sign out', async () => {
          if (await confirmBox('Sign out?', { ok: 'Sign out', danger: true })) window.dispatchEvent(new Event('jk:signout'));
        }),
        h('p', { class: 'tiny faint' }, 'To see the client side, use the iPhone app: Account › Preview as client.'))));
  coachSettingsSection(settingsBox, view);
});
