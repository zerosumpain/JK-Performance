/*
 * WP2 Clients and lifecycle (docs/design/desk-v2.md F5, F7, F8): the shared
 * pieces (stage pills, health rings, trend chips), the flows that act on a
 * client (pause, End coaching, notes, a check-in message, tags), and the
 * registrations: nav (Segments, Retention), client tabs (Timeline, Notes),
 * client actions, bulk actions, Today widgets (at risk, renewals), Settings ›
 * Tags and a richer client panel. Screens: f-crm-retention.js and
 * f-crm-segments.js; the clients list and Client 360 live in clients.js.
 *
 * Every piece of client data goes on the page through h() (textContent).
 */
import {
  addDays, api, avatar, busy, button, confirmBox, errorLine, field, fill, firstName, fmtDay, fmtRelative, fmtShort, fmtTime, go, h,
  hasFeature, icon, link, londonParts, registerBulkAction, registerClientAction, registerClientTab, registerNav, registerPanel,
  registerSettingsSection, registerWidget, sheet, toast, todayLondon,
} from './core.js';
import { composer } from './composer.js';
import { emptyHero, inlineEdit, menu, popover, scoreRing, skeleton, slideOver, tagChip, tagPicker, timeline, wizard } from './ui.js';

const enc = encodeURIComponent;

// MARK: - Vocabulary

export const STAGE = {
  onboarding: { word: 'Onboarding', tone: 'data', icon: 'checklist' },
  active: { word: 'Active', tone: 'ok', icon: 'verified' },
  atRisk: { word: 'At risk', tone: 'urgent', icon: 'warning' },
  paused: { word: 'Paused', tone: 'attention', icon: 'pause_circle' },
  churned: { word: 'Churned', tone: 'data', icon: 'logout' },
  alumni: { word: 'Alumni', tone: 'accent', icon: 'workspace_premium' },
};
export const STAGES = Object.keys(STAGE);
export const BAND = {
  thriving: { word: 'Thriving', tone: 'ok' }, steady: { word: 'Steady', tone: 'data' },
  watch: { word: 'Watch', tone: 'attention' }, atRisk: { word: 'At risk', tone: 'urgent' },
};
export const EXIT = {
  cost: 'Cost', time: 'Time', injury: 'Injury', results: 'Results', moved: 'Moved away', coachFit: 'Coach fit', goalReached: 'Goal reached', other: 'Other',
};
const EXIT_TONE = { cost: 1, time: 2, injury: 5, results: 6, moved: 4, coachFit: 6, goalReached: 3, other: 6 };
export const exitTone = r => EXIT_TONE[r] ?? 6;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A stage as a word, a glyph and a dot in its colour. */
export function stagePill(stage, { manual = false, small = false } = {}) {
  const s = STAGE[stage] ?? STAGE.active;
  return h('span', { class: `pill crm-stage st-${stage}${small ? ' small' : ''}`, title: manual ? 'Set by you: the rules leave it alone' : null },
    h('span', { class: `crm-stage-ic tone-${s.tone}` }, icon(s.icon, small ? 14 : 16)), h('span', { class: 'crm-stage-word' }, s.word),
    manual ? h('span', { class: 'crm-manual', 'aria-label': '(set by you)' }, icon('edit', 12)) : null);
}

/** The health ring in the band's colour (band word beneath). */
export function healthRing(health, band, { size = 44, label = 'Health' } = {}) {
  const b = BAND[band];
  return scoreRing(health, { size, label, band: b ? { word: b.word, tone: b.tone } : { word: 'No score', tone: 'data' } });
}

/** "+6" / "−12" with an arrow, coloured by direction; null draws nothing. */
export function trendChip(trend, { quiet = 3 } = {}) {
  if (trend === null || trend === undefined) return null;
  const up = trend > quiet, down = trend < -quiet;
  return h('span', { class: `crm-trend ${up ? 'tone-ok' : down ? 'tone-urgent' : 'muted'}`, title: 'Change over 14 days' },
    icon(up ? 'north_east' : down ? 'south_east' : 'east', 14), h('span', { class: 't-num' }, `${trend > 0 ? '+' : trend < 0 ? '−' : '±'}${Math.abs(trend)}`));
}

export const bandOf = h => (h === null || h === undefined ? null : h >= 75 ? 'thriving' : h >= 50 ? 'steady' : h >= 30 ? 'watch' : 'atRisk');

// MARK: - Data

let roster = null;
/** GET /api/crm/clients, shared by the list, widgets and panels (refreshed on demand). */
export async function crmClients(force = false) {
  if (!roster || force) roster = api('GET', '/api/crm/clients').then(r => r.clients).catch(err => { roster = null; throw err; });
  return roster;
}

/** Something about a client changed: drop caches and tell open screens (the Client 360 redraws its header). */
export function changed(clientId) {
  roster = null;
  window.dispatchEvent(new CustomEvent('crm:changed', { detail: { clientId } }));
}

let tagsCache = null;
export async function allTags(force = false) {
  if (!tagsCache || force) tagsCache = api('GET', '/api/tags').then(r => r.tags).catch(err => { tagsCache = null; throw err; });
  return tagsCache;
}
export const dropTags = () => { tagsCache = null; };

// MARK: - Score details (the ring's popover, the Overview tile)

const PART = [['engagement', 'Engagement', 30], ['adherence', 'Adherence', 30], ['consistency', 'Consistency', 20], ['wellbeing', 'Wellbeing', 20]];

/** Factor bars and the notes behind a score. */
export function factorBars(factors) {
  if (!factors) return null;
  return h('div', { class: 'crm-factors' },
    PART.map(([key, label, max]) => {
      const v = factors[key] ?? 0;
      return h('div', { class: 'crm-factor' },
        h('div', { class: 'crm-factor-k' }, h('span', null, label), h('span', { class: 't-num muted' }, `${v}/${max}`)),
        h('div', { class: 'crm-factor-track', role: 'img', 'aria-label': `${label} ${v} of ${max}` }, h('div', { class: 'crm-factor-fill', style: { '--pct': `${Math.round((100 * v) / max)}%` } })));
    }),
    factors.notes?.length ? h('ul', { class: 'crm-notes-list' }, factors.notes.slice(0, 5).map(n => h('li', null, n))) : null);
}

/** Hover (or focus, or click) a ring to see why: the factor bars and notes. */
export function withScorePopover(anchor, load) {
  let pop = null, timer = null, data = null;
  const open = async () => {
    clearTimeout(timer);
    if (pop) return;
    pop = popover(anchor, box => {
      box.append(skeleton('lines', { rows: 3 }));
      (data ? Promise.resolve(data) : load()).then(s => {
        data = s;
        box.replaceChildren(
          h('div', { class: 'crm-pop-head' }, h('span', { class: 'ui-eyebrow' }, 'Health score'), h('span', { class: `t-num tone-${BAND[s.band]?.tone ?? 'data'}` }, `${s.health} · ${BAND[s.band]?.word ?? ''}`)),
          factorBars(s.factors),
          h('p', { class: 'tiny muted m0' }, 'Engagement, adherence, consistency and wellbeing over the last two to four weeks. Money owed is not part of it.'));
      }).catch(err => box.replaceChildren(errorLine(err)));
      box.addEventListener('mouseenter', () => clearTimeout(timer));
      box.addEventListener('mouseleave', later);
    }, { className: 'crm-pop', label: 'Health score factors' });
    const close = pop.close;
    pop.close = () => { close(); pop = null; };
    // popover() closes itself on Esc and outside clicks; forget it then too.
    const mo = new MutationObserver(() => { if (pop && !pop.el.isConnected) { pop = null; mo.disconnect(); } });
    mo.observe(document.body, { childList: true });
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(() => pop?.close(), 220); };
  anchor.setAttribute('tabindex', anchor.getAttribute('tabindex') ?? '0');
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.addEventListener('mouseenter', open);
  anchor.addEventListener('mouseleave', later);
  anchor.addEventListener('focus', open);
  anchor.addEventListener('blur', later);
  anchor.addEventListener('click', open);
  anchor.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return anchor;
}

// MARK: - Templates for plays (WP5 templates when present, else built-in words)

const BUILT_IN = {
  winback: c => `Hi ${firstName(c.name)}, I have been thinking about you. No pressure at all, but how are things? If training has slipped, we can make the plan smaller for a few weeks and build back from there.`,
  checkIn: c => `Hi ${firstName(c.name)}, just checking in. How has this week felt? Anything getting in the way that I can help with?`,
  farewell: c => `${firstName(c.name)}, thank you for training with me. You put the work in and it showed. The door is always open, and the app is still yours: your history stays right where it is.`,
  renew: c => `Hi ${firstName(c.name)}, your current block is nearly done. Shall we line up the next one? I have a couple of ideas for where we take it.`,
  upgrade: c => `${firstName(c.name)}, you have been so consistent lately. I think you are ready for more support: want to hear what the next plan up would look like?`,
};

/** Template texts for a category (WP5's /api/templates when the feature is here; built-in otherwise). */
async function templatesFor(category, client) {
  if (await hasFeature('templates')) {
    try {
      // WP5's categories: the renewal play reads "renewal" templates, a check-in "checkin"; upgrade and farewell have none (built-in words).
      const wp5 = { billing: 'renewal', checkIn: 'checkin' }[category] ?? category;
      const r = await api('GET', `/api/templates?category=${enc(wp5)}`);
      // Fill the name variables; a template that still needs others (filled only by a real send) is left out, so no raw {variable} goes out.
      const list = (r.templates ?? []).map(t => ({ name: t.name ?? t.title ?? 'Template',
        text: String(t.body ?? t.text ?? '').replaceAll('{first}', firstName(client.name)).replaceAll('{name}', client.name) }))
        .filter(t => t.text && !/\{[a-zA-Z][\w.]*\}/.test(t.text));
      if (list.length) return list;
    } catch { /* fall back to the built-in words */ }
  }
  const key = category === 'winback' ? 'winback' : category === 'billing' ? 'renew' : category === 'upgrade' ? 'upgrade' : category === 'farewell' ? 'farewell' : 'checkIn';
  return [{ name: 'Suggested', text: BUILT_IN[key](client) }];
}

/**
 * A message to one client in a slide-over, prefilled from a template. The
 * coach reads, edits and presses Send (composer send guards run first).
 */
export async function openMessage(client, { category = 'checkIn', title = null, text = null } = {}) {
  const list = text ? [{ name: 'Suggested', text }] : await templatesFor(category, client);
  slideOver(title || `Message ${firstName(client.name)}`, (body, close) => {
    const c = composer({
      clientId: client.id, placeholder: `Write to ${firstName(client.name)}`, initial: list[0].text, label: `Message to ${client.name}`,
      onSend: async ({ text, mediaId, kind }) => {
        await api('POST', '/api/messages', { clientId: client.id, text, ...(mediaId ? { mediaId } : {}), ...(kind && kind !== 'text' ? { kind } : {}) });
        toast(`Sent to ${firstName(client.name)}.`, { action: { label: 'Open thread', run: () => go(`/messages/${enc(client.id)}`) } });
        changed(client.id);
        close(true);
      },
    });
    body.append(
      h('div', { class: 'crm-msg-who' }, avatar(client.initials || client.name, 36), h('div', null, h('div', { class: 'strong' }, client.name), h('div', { class: 'small muted' }, 'Nothing is sent until you press Send.'))),
      list.length > 1 ? h('div', { class: 'crm-chips' }, list.map(t => h('button', { type: 'button', class: 'cl-chip', onclick: () => c.setText(t.text) }, t.name))) : null,
      c.el);
    requestAnimationFrame(() => c.focus());
  });
}

// MARK: - Pause

/** Pause a membership for 2–12 weeks with a reason. Resolves true when paused. */
export function openPause(client) {
  return sheet(`Pause ${firstName(client.name)}`, (body, close) => {
    let weeks = 4;
    const reason = h('input', { type: 'text', maxlength: '200', placeholder: 'Holiday, surgery, exams…' });
    const back = h('div', { class: 'crm-pause-back' });
    const status = h('div');
    const choose = h('div', { class: 'crm-weeks', role: 'radiogroup', 'aria-label': 'Pause length' });
    const draw = () => {
      choose.replaceChildren(...[2, 3, 4, 6, 8, 12].map(n => h('button', { type: 'button', role: 'radio', 'aria-checked': String(n === weeks), class: 'cl-chip' + (n === weeks ? ' on' : ''),
        onclick: () => { weeks = n; draw(); } }, `${n} weeks`)));
      fill(back, icon('event_available', 18), h('span', null, `Back on ${fmtDay(addDays(todayLondon(), weeks * 7))}`), h('span', { class: 'muted' }, ' · billing, campaigns and automations hold until then'));
    };
    draw();
    body.append(
      h('p', { class: 'muted m0' }, `Keep ${firstName(client.name)} instead of losing them. Nudges and automations stop, recurring billing pauses, packages are extended by the pause when they come back.`),
      field('How long', choose), field('Why (only you see this)', reason), back, status);
    const ok = button('Pause membership', e => busy(e.currentTarget, status, async () => {
      await api('POST', `/api/coach/clients/${enc(client.id)}/pause`, { weeks, reason: reason.value.trim() });
      toast(`${firstName(client.name)} is paused for ${weeks} weeks.`);
      changed(client.id);
      close(true);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), ok);
  }).then(v => v === true);
}

export async function resume(client) {
  if (!await confirmBox(`Welcome ${firstName(client.name)} back now?`, { ok: 'Resume', detail: 'Billing, campaigns and nudges pick up again today.' })) return false;
  await api('POST', `/api/coach/clients/${enc(client.id)}/resume`);
  toast(`${firstName(client.name)} is back.`);
  changed(client.id);
  return true;
}

// MARK: - End coaching (F8): a slide-over wizard that commits in one request

const ACTIVE_LABEL = { schedules: 'Recurring billing', packages: 'Packages', enrolments: 'Campaign places', runs: 'Automation runs', scheduled: 'Scheduled messages' };
const itemLabel = it => it?.label ?? it?.name ?? it?.campaign?.name ?? it?.title ?? it?.automation?.name ?? it?.text ?? it?.id ?? 'Item';

export function openEnd(client, { onDone = null } = {}) {
  const first = firstName(client.name);
  const s = slideOver(`End coaching · ${client.name}`, (body, close) => {
    body.append(skeleton('card'));
    const data = { money: 'leave', keepChasing: false, packages: 'expire', exitReason: null, exitNote: '', survey: false, farewell: true, farewellText: BUILT_IN.farewell(client) };
    Promise.all([api('GET', `/api/coach/clients/${enc(client.id)}/offboarding`), hasFeature('billing')]).then(([off, billing]) => {
      const balance = off.balancePence ?? null;
      const lists = Object.entries(ACTIVE_LABEL).filter(([k]) => Array.isArray(off[k]) && off[k].length);
      const steps = [
        { id: 'money', label: 'Money', render(box) {
          if (!billing) {
            box.append(h('h3', { class: 'crm-wiz-h' }, 'Money'), h('p', { class: 'muted' }, 'Billing is not set up here, so there is nothing to settle. Invoices and packages are handled by the billing desk when it is on.'));
            return;
          }
          const opt = (value, title, detail) => h('label', { class: 'crm-choice' + (data.money === value ? ' on' : '') },
            h('input', { type: 'radio', name: 'crm-money', value, checked: data.money === value, onchange: () => { data.money = value; box.replaceChildren(); this.render(box); } }),
            h('div', null, h('div', { class: 'strong' }, title), h('div', { class: 'small muted' }, detail)));
          box.append(h('h3', { class: 'crm-wiz-h' }, 'Money'),
            h('div', { class: 'crm-balance' }, h('span', { class: 'muted' }, 'Outstanding balance'), h('span', { class: 'crm-balance-v t-num' }, balance === null ? '—' : `£${(balance / 100).toFixed(2)}`)),
            opt('invoice', 'Final invoice', 'Issue the open drafts, or raise one for what is owed.'),
            opt('writeOff', 'Write off', 'A credit note for the balance: “Write-off at end of coaching”.'),
            opt('leave', 'Leave as is', 'Nothing changes on their account.'),
            data.money === 'leave' ? h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: data.keepChasing, onchange: e => { data.keepChasing = e.target.checked; } }), 'Keep chasing overdue invoices') : null);
        } },
        { id: 'stops', label: 'What stops', render(box) {
          box.append(h('h3', { class: 'crm-wiz-h' }, 'What stops'));
          if (!lists.length) box.append(h('p', { class: 'muted' }, `Nothing else is running for ${first}: no recurring billing, packages, campaigns or automations.`));
          for (const [k, label] of lists) {
            box.append(h('div', { class: 'crm-stop' }, h('div', { class: 'ui-eyebrow' }, label),
              h('ul', { class: 'crm-stop-list' }, off[k].map(it => h('li', null, icon('block', 16), h('span', null, itemLabel(it)))))));
          }
          if (Array.isArray(off.packages) && off.packages.length) {
            box.append(h('div', { class: 'crm-seg-row' }, h('span', { class: 'small muted' }, 'Unused package credits'),
              ...[['expire', 'Expire them'], ['refund', 'Refund unused share']].map(([v, l]) => h('button', { type: 'button', class: 'cl-chip' + (data.packages === v ? ' on' : ''),
                onclick: () => { data.packages = v; box.replaceChildren(); this.render(box); } }, l))));
          }
          box.append(h('p', { class: 'small muted' }, 'Ending does not change their plan or remove the app: they keep their history and can still message you.'));
        } },
        { id: 'why', label: 'Why', valid: d => !!d.exitReason, render(box) {
          const note = h('textarea', { rows: '3', maxlength: '1000', placeholder: 'What happened, in a line or two (private)', value: data.exitNote, oninput: e => { data.exitNote = e.target.value; } });
          box.append(h('h3', { class: 'crm-wiz-h' }, `Why is ${first} leaving?`),
            h('div', { class: 'crm-reasons', role: 'radiogroup', 'aria-label': 'Exit reason' }, Object.entries(EXIT).map(([v, l]) => h('button', {
              type: 'button', role: 'radio', 'aria-checked': String(data.exitReason === v), class: 'cl-chip' + (data.exitReason === v ? ' on' : ''),
              onclick: () => { data.exitReason = v; box.replaceChildren(); this.render(box); box.dispatchEvent(new CustomEvent('ui-change', { bubbles: true })); },
            }, l))),
            data.exitReason === 'goalReached' ? h('p', { class: 'small tone-ok' }, icon('workspace_premium', 16), ` ${first} becomes an Alumni.`) : null,
            field('Note', note),
            h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: data.survey, onchange: e => { data.survey = e.target.checked; } }),
              'Send a short exit survey (“What could JK have done better?”)'));
        } },
        { id: 'goodbye', label: 'Goodbye', render(box) {
          const text = h('textarea', { rows: '5', maxlength: '4000', value: data.farewellText, oninput: e => { data.farewellText = e.target.value; } });
          box.append(h('h3', { class: 'crm-wiz-h' }, 'A goodbye'),
            h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: data.farewell, onchange: e => { data.farewell = e.target.checked; text.disabled = !e.target.checked; } }), `Send ${first} this message`),
            text,
            h('div', { class: 'crm-review' }, h('div', { class: 'ui-eyebrow' }, 'You are about to'),
              h('ul', null,
                h('li', null, `Mark ${first} as ${data.exitReason === 'goalReached' ? 'Alumni' : 'Churned'} (${EXIT[data.exitReason] ?? '…'})`),
                billing ? h('li', null, data.money === 'invoice' ? 'Raise the final invoice' : data.money === 'writeOff' ? 'Write off the balance' : data.keepChasing ? 'Leave the balance and keep chasing' : 'Leave the balance, no more chasing') : null,
                lists.length ? h('li', null, `Stop ${lists.map(([, l]) => l.toLowerCase()).join(', ')}`) : null,
                data.survey ? h('li', null, 'Send the exit survey') : null,
                data.farewell ? h('li', null, 'Send your goodbye message') : null)));
        } },
      ];
      const wiz = wizard(steps, { data, finishLabel: 'End coaching', onFinish: async d => {
        await api('POST', `/api/coach/clients/${enc(client.id)}/end`, { exitReason: d.exitReason, exitNote: d.exitNote, money: d.money, keepChasing: d.keepChasing, packages: d.packages, survey: d.survey });
        if (d.farewell && d.farewellText.trim()) {
          try { await api('POST', '/api/messages', { clientId: client.id, text: d.farewellText.trim() }); } catch (err) { toast(`Coaching ended, but the message did not send: ${err.message}`, { error: true }); }
        }
        changed(client.id);
        toast(`Coaching ended for ${first}.`, { action: { label: 'See retention', run: () => go('/retention/ended') } });
        close(true);
        onDone?.();
      } });
      body.replaceChildren(wiz.el);
    }).catch(err => body.replaceChildren(errorLine(err)));
  }, { wide: true, deepLink: `end:${client.id}` });
  return s;
}

// MARK: - Notes

/** Add or edit a private note. Resolves the saved note (or undefined). */
export function openNote(client, note = null) {
  return sheet(note ? 'Edit note' : `Note about ${firstName(client.name)}`, (body, close) => {
    const text = h('textarea', { rows: '6', maxlength: '4000', placeholder: 'Only you see notes. They never reach the client’s app.', value: note?.body ?? '' });
    let pinned = !!note?.pinned;
    const pin = h('label', { class: 'crm-check' }, h('input', { type: 'checkbox', checked: pinned, onchange: e => { pinned = e.target.checked; } }), 'Pin to the top of their timeline');
    const status = h('div');
    body.append(text, pin, status);
    requestAnimationFrame(() => text.focus());
    const save = button('Save note', e => busy(e.currentTarget, status, async () => {
      if (!text.value.trim()) throw new Error('Write something first.');
      const out = note
        ? await api('PATCH', `/api/coach/clients/${enc(client.id)}/notes/${enc(note.id)}`, { body: text.value, pinned })
        : await api('POST', `/api/coach/clients/${enc(client.id)}/notes`, { body: text.value, pinned });
      toast(note ? 'Note saved.' : 'Note added.');
      window.dispatchEvent(new CustomEvent('crm:notes', { detail: { clientId: client.id } }));
      close(out.note);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

// MARK: - Tags

/** Edit one client's tags in a popover under `anchor`. */
export async function editTags(anchor, client, current = []) {
  const all = await allTags();
  popover(anchor, (box, close) => {
    box.append(h('div', { class: 'ui-eyebrow' }, `Tags for ${firstName(client.name)}`), tagPicker({
      selected: current.map(t => t.id), all, allowCreate: true,
      onChange: async ids => {
        try {
          await api('PUT', `/api/coach/clients/${enc(client.id)}/tags`, { tagIds: ids });
          dropTags();
          changed(client.id);
        } catch (err) { toast(err.message, { error: true }); }
      },
    }), h('div', { class: 'row end mt-s' }, button('Done', () => close(), { small: true })));
  }, { className: 'crm-tag-pop', label: 'Tags' });
}

/** Add or remove tags on many clients at once. */
function bulkTags(clientIds) {
  return sheet(`Tag ${plural(clientIds.length, 'client')}`, (body, close) => {
    const status = h('div');
    const pickers = h('div', null, skeleton('lines', { rows: 2 }));
    let add = [], remove = [];
    body.append(pickers, status);
    allTags().catch(() => []).then(all => fill(pickers,
      field('Add', tagPicker({ all, allowCreate: true, onChange: ids => { add = ids; } })),
      field('Remove', tagPicker({ all, onChange: ids => { remove = ids; } }))));
    const ok = button('Apply', e => busy(e.currentTarget, status, async () => {
      if (!add.length && !remove.length) throw new Error('Pick a tag to add or remove.');
      const r = await api('POST', '/api/coach/clients/tags', { clientIds, add, remove });
      dropTags();
      changed(null);
      toast(r.changed ? `${plural(r.changed, 'change')} made.` : 'Nothing to change.');
      close(true);
    }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close(false)), ok);
  });
}

/** The selected clients as a CSV file, made in the browser. */
async function exportCsv(clientIds) {
  const list = (await crmClients()).filter(c => clientIds.includes(c.id));
  const cell = v => {
    const s = v === null || v === undefined ? '' : String(v);
    // Neutralise spreadsheet formulas, then quote.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const head = ['Name', 'Stage', 'Health', 'Band', 'Trend', 'Plan', 'Last active', 'Next session', 'Tags'];
  const rows = list.map(c => [c.name, STAGE[c.stage]?.word ?? c.stage, c.health, BAND[c.band]?.word ?? '', c.trend, c.planName, c.lastActiveAt ? londonParts(c.lastActiveAt).day : '',
    c.nextSessionAt ? `${londonParts(c.nextSessionAt).day} ${fmtTime(c.nextSessionAt)}` : '', c.tags.map(t => t.name).join('; ')]);
  const csv = [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `clients-${todayLondon()}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Exported ${plural(list.length, 'client')}.`);
}

// MARK: - Registrations

registerNav({ id: 'segments', label: 'Segments', icon: 'filter_alt', group: 'clients', order: 40, path: '/segments' });
registerNav({ id: 'retention', label: 'Retention', icon: 'monitor_heart', group: 'clients', order: 50, path: '/retention', badge: true,
  badgeOn: ['client.stageChanged', 'crm.bandChanged', 'client.offboarded'], tabs: [{ id: 'radar', label: 'Radar', path: '/retention/radar' }, { id: 'renewals', label: 'Renewals', path: '/retention/renewals' }, { id: 'ended', label: 'Ended', path: '/retention/ended' }] });

registerClientAction({ id: 'message', label: 'Message', icon: 'chat_bubble', order: 10, run: c => go(`/messages/${enc(c.id)}`) });
registerClientAction({ id: 'note', label: 'Note', icon: 'sticky_note_2', order: 40, run: c => openNote(c) });
registerClientAction({ id: 'tag', label: 'Tag', icon: 'label', order: 45, run: async c => {
  const anchor = document.querySelector(`[data-action="tag"]`) || document.activeElement || document.body;
  const current = (await crmClients().catch(() => [])).find(x => x.id === c.id)?.tags ?? [];
  editTags(anchor, c, current);
} });
registerClientAction({ id: 'pause', label: 'Pause', icon: 'pause_circle', order: 70, run: async c => {
  const l = await api('GET', `/api/coach/clients/${enc(c.id)}/lifecycle`).catch(() => null);
  if (l?.stage === 'paused') return resume(c);
  if (l && ['churned', 'alumni'].includes(l.stage)) { toast('Coaching has ended for this client.'); return false; }
  return openPause(c);
} });
registerClientAction({ id: 'end', label: 'End coaching', icon: 'logout', order: 95, run: c => openEnd(c) });

registerBulkAction({ id: 'tag', label: 'Tag', icon: 'label', order: 10, run: ids => bulkTags(ids) });
registerBulkAction({ id: 'export-csv', label: 'Export CSV', icon: 'download', order: 90, run: ids => exportCsv(ids) });

registerPanel('end', id => ({
  title: 'End coaching',
  build(body, close) {
    // A deep link (#…?panel=end:<id>) reopens the flow: look the client up, then swap to the wizard.
    body.append(skeleton('card'));
    crmClients().then(list => {
      const c = list.find(x => x.id === id);
      close();
      if (c) setTimeout(() => openEnd(c), 0);
      else toast('That client isn’t one of yours.', { error: true });
    }).catch(err => body.replaceChildren(errorLine(err)));
  },
}));

// The richer client panel (#…?panel=client:<id>): ring, stage, tags and the actions.
registerPanel('client', id => ({
  title: 'Client',
  build(body, close, { setTitle }) {
    body.append(skeleton('card'));
    crmClients().then(async list => {
      const c = list.find(x => x.id === id);
      if (!c) { body.replaceChildren(errorLine('That client isn’t one of yours.')); return; }
      setTitle(c.name);
      body.replaceChildren(quickView(c, close));
    }).catch(err => body.replaceChildren(errorLine(err)));
  },
}));

/** A client at a glance, for panels. */
export function quickView(c, close = () => {}) {
  return h('div', { class: 'crm-qv' },
    h('div', { class: 'crm-qv-head' }, avatar(c.initials || c.name, 56),
      h('div', { class: 'grow' }, h('div', { class: 'crm-qv-name' }, c.name), h('div', { class: 'row gap4 wrap' }, stagePill(c.stage, { manual: c.manual, small: true }), h('span', { class: 'pill small' }, c.planName ?? c.plan))),
      healthRing(c.health, c.band, { size: 56 })),
    h('div', { class: 'crm-qv-facts' },
      fact('Last active', c.lastActiveAt ? fmtRelative(c.lastActiveAt) : '—'),
      fact('Next session', c.nextSessionAt ? `${fmtShort(londonParts(c.nextSessionAt).day)} ${fmtTime(c.nextSessionAt)}` : 'None booked'),
      fact('Trend', c.trend === null || c.trend === undefined ? '—' : `${c.trend > 0 ? '+' : ''}${c.trend} in 14 days`)),
    c.tags?.length ? h('div', { class: 'crm-chips' }, c.tags.map(t => tagChip(t))) : null,
    h('div', { class: 'ui-qv-actions' },
      link(`/clients/${enc(c.id)}`, { class: 'btn primary', onclick: () => close() }, 'Open client'),
      link(`/messages/${enc(c.id)}`, { class: 'btn', onclick: () => close() }, icon('chat_bubble', 16), `Message ${firstName(c.name)}`),
      h('button', { type: 'button', class: 'btn', onclick: () => { close(); openNote(c); } }, icon('sticky_note_2', 16), 'Note')));
}
const fact = (k, v) => h('div', { class: 'crm-fact' }, h('div', { class: 'tiny muted' }, k), h('div', { class: 'crm-fact-v' }, v));

// MARK: - Client tabs: Timeline and Notes

const KIND_FILTERS = [['', 'Everything'], ['message', 'Messages'], ['session', 'Sessions'], ['workout', 'Workouts'], ['checkin', 'Check-ins'], ['letter', 'Letters'],
  ['form', 'Forms'], ['stage', 'Lifecycle'], ['note', 'Notes'], ['tag', 'Tags']];

registerClientTab({ key: 'timeline', label: 'Timeline', order: 20, async render(box, { client, view }) {
  let kind = '';
  const chips = h('div', { class: 'crm-chips crm-kinds', role: 'radiogroup', 'aria-label': 'Show' });
  const list = h('div', { class: 'crm-tl' });
  const more = h('div', { class: 'crm-tl-more' });
  let next = null, loadingMore = false, items = [];
  const drawChips = () => chips.replaceChildren(...KIND_FILTERS.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === kind), class: 'cl-chip' + (k === kind ? ' on' : ''),
    onclick: () => { kind = k; drawChips(); load(true); } }, l)));
  const load = async (reset = false) => {
    if (loadingMore) return;
    loadingMore = true;
    if (reset) { items = []; next = null; fill(list, skeleton('lines', { rows: 6 })); }
    try {
      const qs = new URLSearchParams({ limit: '40' });
      if (kind) qs.set('kinds', kind);
      if (!reset && next) qs.set('before', next);
      const r = await api('GET', `/api/coach/clients/${enc(client.id)}/timeline?${qs}`);
      if (!view.fresh()) return;
      items = reset ? r.items : [...items, ...r.items];
      next = r.next;
      fill(list, items.length ? timeline(items) : emptyHero({ icon: 'timeline', title: 'Nothing here yet', line: kind ? 'Nothing of this kind so far.' : 'Messages, sessions, check-ins and changes will build up here.' }));
      fill(more, next ? button('Load older', () => load(false), { small: true }) : items.length ? h('span', { class: 'tiny muted' }, 'That is the beginning.') : null);
    } catch (err) {
      if (view.fresh()) fill(list, errorLine(err));
    } finally { loadingMore = false; }
  };
  // Infinite scroll: the "Load older" row loads itself when it comes into view.
  const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && next) load(false); }, { rootMargin: '300px' });
  io.observe(more);
  view.onLeave(() => io.disconnect());
  drawChips();
  box.append(h('div', { class: 'crm-tl-wrap' }, chips, list, more));
  await load(true);
} });

registerClientTab({ key: 'notes', label: 'Notes', order: 80, async render(box, { client, view }) {
  const listBox = h('div', { class: 'crm-notes' });
  const input = h('textarea', { rows: '3', maxlength: '4000', placeholder: `A private note about ${firstName(client.name)}. Only you see it.`, 'aria-label': 'New note' });
  let pinNew = false;
  const pinBtn = h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', onclick: () => { pinNew = !pinNew; pinBtn.setAttribute('aria-pressed', String(pinNew)); pinBtn.classList.toggle('on', pinNew); } }, icon('star', 16), 'Pin');
  const status = h('div');
  const add = button('Add note', e => busy(e.currentTarget, status, async () => {
    if (!input.value.trim()) return;
    await api('POST', `/api/coach/clients/${enc(client.id)}/notes`, { body: input.value, pinned: pinNew });
    input.value = '';
    pinNew = false; pinBtn.setAttribute('aria-pressed', 'false'); pinBtn.classList.remove('on');
    await draw();
  }), { kind: 'primary', small: true });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add.click(); } });
  const noteRow = n => h('article', { class: 'crm-note' + (n.pinned ? ' pinned' : '') },
    h('div', { class: 'crm-note-meta' },
      n.pinned ? h('span', { class: 'tone-accent row gap4' }, icon('star', 14, { filled: true }), 'Pinned') : null,
      h('time', { class: 'tiny muted', datetime: n.createdAt }, `${fmtShort(londonParts(n.createdAt).day)} · ${fmtTime(n.createdAt)}`),
      n.updatedAt !== n.createdAt ? h('span', { class: 'tiny muted' }, '· edited') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': n.pinned ? 'Unpin' : 'Pin', title: n.pinned ? 'Unpin' : 'Pin', onclick: async () => {
        await api('PATCH', `/api/coach/clients/${enc(client.id)}/notes/${enc(n.id)}`, { pinned: !n.pinned }); draw();
      } }, icon('star', 16, { filled: n.pinned })),
      h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': 'Delete note', title: 'Delete', onclick: async () => {
        if (!await confirmBox('Delete this note?', { ok: 'Delete', danger: true })) return;
        await api('DELETE', `/api/coach/clients/${enc(client.id)}/notes/${enc(n.id)}`);
        draw();
      } }, icon('delete', 16))),
    h('div', { class: 'crm-note-body' }, inlineEdit(n.body, async next => {
      if (!next) throw new Error('A note can’t be empty.');
      await api('PATCH', `/api/coach/clients/${enc(client.id)}/notes/${enc(n.id)}`, { body: next });
    }, { multiline: true, label: 'Note' })));
  const draw = async () => {
    try {
      const { notes } = await api('GET', `/api/coach/clients/${enc(client.id)}/notes`);
      if (!view.fresh()) return;
      fill(listBox, notes.length ? notes.map(noteRow) : emptyHero({ icon: 'sticky_note_2', title: 'No notes yet', line: 'Injuries, life context, what works for them. Private to you.' }));
    } catch (err) { fill(listBox, errorLine(err)); }
  };
  const onNotes = e => { if (e.detail?.clientId === client.id && view.fresh()) draw(); };
  window.addEventListener('crm:notes', onNotes);
  view.onLeave(() => window.removeEventListener('crm:notes', onNotes));
  box.append(h('div', { class: 'crm-notes-wrap' },
    h('div', { class: 'crm-note-new' }, input, h('div', { class: 'row spread' }, pinBtn, h('span', { class: 'tiny muted hide-s' }, '⌘↵ to add'), add), status),
    listBox));
  fill(listBox, skeleton('lines', { rows: 4 }));
  await draw();
} });

// MARK: - Today widgets: at risk and renewals

registerWidget({ id: 'at-risk', title: 'At risk', size: 'm', order: 40, async render(body, view) {
  fill(body, skeleton('lines', { rows: 4 }));
  try {
    const r = await api('GET', '/api/retention');
    if (view && !view.fresh?.()) return;
    const cards = [...r.suggested, ...r.atRisk, ...r.watch].slice(0, 4);
    fill(body,
      h('div', { class: 'crm-w-stats' },
        h('div', null, h('div', { class: 'ui-tile-num tone-urgent' }, String(r.atRisk.length + r.suggested.length)), h('div', { class: 'tiny muted' }, 'at risk')),
        h('div', null, h('div', { class: 'ui-tile-num' }, String(r.watch.length)), h('div', { class: 'tiny muted' }, 'to watch'))),
      cards.length ? h('ul', { class: 'crm-w-list' }, cards.map(c => h('li', null, link(`/clients/${enc(c.client.id)}`, { class: 'crm-w-row' },
        healthRing(c.health, c.band, { size: 30 }), h('div', { class: 'grow' }, h('div', { class: 'strong clamp1' }, c.client.name), h('div', { class: 'tiny muted clamp1' }, c.suggested ? 'Looks like they have stopped' : c.reasons[0] ?? '')),
        trendChip(c.trend))))) : h('p', { class: 'small muted' }, 'Nobody is slipping. Lovely.'),
      link('/retention', { class: 'ui-tile-action' }, 'Open the radar', icon('chevron_right', 16)));
  } catch (err) { fill(body, errorLine(err)); }
} });

registerWidget({ id: 'renewals', title: 'Renewals', size: 'm', order: 42, async render(body, view) {
  fill(body, skeleton('lines', { rows: 3 }));
  try {
    const { items } = await api('GET', '/api/retention/renewals?days=30');
    if (view && !view.fresh?.()) return;
    fill(body, items.length ? h('ul', { class: 'crm-w-list' }, items.slice(0, 4).map(i => h('li', null, link(i.path || `/clients/${enc(i.client.id)}`, { class: 'crm-w-row' },
      avatar(i.client.initials || i.client.name, 30), h('div', { class: 'grow' }, h('div', { class: 'strong clamp1' }, i.client.name), h('div', { class: 'tiny muted clamp1' }, i.label)),
      h('span', { class: 'tiny muted' }, i.on ? fmtShort(i.on) : 'Now'))))) : h('p', { class: 'small muted' }, 'Nothing runs out in the next 30 days.'),
    link('/retention/renewals', { class: 'ui-tile-action' }, 'All renewals', icon('chevron_right', 16)));
  } catch (err) { fill(body, errorLine(err)); }
} });

// MARK: - Settings › Tags

const TONES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
registerSettingsSection({ id: 'tags', label: 'Tags', icon: 'label', order: 40, async render(box) {
  const listBox = h('div', { class: 'crm-tagset' });
  const name = h('input', { type: 'text', maxlength: '40', placeholder: 'New tag name', 'aria-label': 'New tag name' });
  const status = h('div');
  const draw = async () => {
    const tags = await allTags(true);
    fill(listBox, tags.length ? tags.map(t => h('div', { class: 'crm-tagrow' },
      tagChip(t),
      h('span', { class: 'grow' }),
      h('span', { class: 'tiny muted t-num' }, plural(t.count ?? 0, 'client')),
      inlineEdit(t.name, async next => { await api('PATCH', `/api/tags/${enc(t.id)}`, { name: next }); dropTags(); draw(); }, { label: `Rename ${t.name}` }),
      h('div', { class: 'crm-swatches', role: 'radiogroup', 'aria-label': `Colour of ${t.name}` }, TONES.map(tone => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(t.color === tone), 'aria-label': tone, class: `crm-swatch ui-${tone}${t.color === tone ? ' on' : ''}`,
        onclick: async () => { await api('PATCH', `/api/tags/${enc(t.id)}`, { color: tone }); dropTags(); draw(); },
      }))),
      h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': `Delete ${t.name}`, onclick: async () => {
        if (!await confirmBox(`Delete “${t.name}”?`, { ok: 'Delete', danger: true, detail: `It comes off ${plural(t.count ?? 0, 'client')}. Segments that use it stop matching on it.` })) return;
        await api('DELETE', `/api/tags/${enc(t.id)}`); dropTags(); draw();
      } }, icon('delete', 16)))) : emptyHero({ icon: 'label', title: 'No tags yet', line: 'Tags group people: “Morning crew”, “Marathon 2027”. Use them in segments, broadcasts and automations.' }));
  };
  const add = button('Add tag', e => busy(e.currentTarget, status, async () => {
    if (!name.value.trim()) return;
    await api('POST', '/api/tags', { name: name.value.trim(), color: TONES[Math.floor(Math.random() * TONES.length)] });
    name.value = '';
    dropTags();
    await draw();
  }), { small: true });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add.click(); } });
  box.append(h('h2', { class: 'crm-set-h' }, 'Tags'), h('p', { class: 'muted' }, 'Rename, recolour or delete the tags you use across clients, segments and automations.'),
    h('div', { class: 'row gap4 crm-tag-add' }, name, add), status, listBox);
  fill(listBox, skeleton('lines', { rows: 3 }));
  await draw();
} });

/** Days from a London day to another, for "in 3 days" text. */
export const inDays = (day, from = todayLondon()) => {
  const n = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 ? `in ${n} days` : `${-n} days ago`;
};
