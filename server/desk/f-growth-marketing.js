/*
 * WP11 Growth, part two (docs/design/desk-v2.md F28): /marketing/:tab?
 *
 *   Sources       which channels, referral codes and offers bring clients who
 *                 stay and pay (leads, wins, conversion, days to win, LTV)
 *   Follow-ups    every lead due a nudge today, with its note written; the
 *                 templates behind them (copy or mailto: only, D14)
 *   Testimonials  asks suggested by happy pulse scores, requests, received
 *                 quotes and approved ones (consent with the client's own
 *                 message as evidence); nothing is published by the app
 *   Offers        the campaigns marked public, with their enquiry links
 *
 * All data reaches the page through h() (textContent).
 */
import {
  api, avatar, busy, button, clients, errorLine, field, fill, firstName, fmtDay, fmtRelative, go, h, hasFeature, icon, link, live, londonParts,
  registerCommand, registerNav, route, setCrumbs, sheet, toast,
} from './core.js';
import { dataTable, emptyHero, pageHead, segmentedNav, skeleton, slideOver, tabs, tile } from './ui.js';
import { barChart } from './charts.js';
import { composer } from './composer.js';
import { copyText, enc, followUpSheet, money, onLeadsChanged, openLead, sourceIcon, stagePill } from './f-growth.js';

const TABS = [['sources', 'Sources'], ['followups', 'Follow-ups'], ['testimonials', 'Testimonials'], ['offers', 'Offers']];
const TEMPLATE_STAGES = [['enquiry', 'Enquiry'], ['contacted', 'Contacted'], ['consult', 'Consult booked'], ['trial', 'Trial'], ['lost', 'Lost: reopen']];

registerNav({
  id: 'marketing', label: 'Marketing', icon: 'storefront', group: 'clients', order: 25, badge: true, badgeOn: ['lead.created', 'lead.stageChanged', 'marketing.followedUp'],
  path: '/marketing', tabs: TABS.map(([id, label]) => ({ id, label, path: `/marketing/${id}` })),
});
registerCommand({ id: 'go-marketing', label: 'Go to Marketing', group: 'Jump to', icon: 'storefront', run: () => go('/marketing') });
registerCommand({ id: 'followups-due', label: 'Follow-ups due today', icon: 'mail', run: () => go('/marketing/followups') });
registerCommand({ id: 'ask-testimonial', label: 'Ask a client for a testimonial…', icon: 'format_quote', run: () => go('/marketing/testimonials?new=1') });

route('/marketing/:tab?', async (el, params, view) => {
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'sources';
  setCrumbs([{ label: 'Marketing', path: '/marketing' }, { label: TABS.find(t => t[0] === tab)[1] }]);
  const sub = h('p', { class: 'ui-head-sub' }, ' ');
  const head = pageHead({
    eyebrow: 'Clients · Growth', title: 'Marketing', accent: { sources: 'that pays', followups: 'that follows up', testimonials: 'in their words', offers: 'out in the open' }[tab],
    actions: [link('/pipeline', { class: 'btn' }, icon('view_kanban', 18), 'Pipeline')],
  });
  head.querySelector('.ui-head-text').append(sub);
  const body = h('div', { class: 'mk-body' }, skeleton('table', { rows: 5 }));
  el.append(head, tabs(TABS.map(([id, label]) => ({ id, label })), tab, id => go(`/marketing/${id}`), { label: 'Marketing sections' }), body);
  const draw = async () => {
    try {
      if (tab === 'sources') await sourcesTab(body, sub, view);
      else if (tab === 'followups') await followupsTab(body, sub, view, draw);
      else if (tab === 'testimonials') await testimonialsTab(body, sub, view, draw);
      else await offersTab(body, sub, view);
    } catch (err) { if (view.fresh()) fill(body, errorLine(err)); }
  };
  await draw();
  if (tab === 'followups') {
    let t = null;
    const soon = () => { clearTimeout(t); t = setTimeout(() => view.fresh() && draw(), 250); };
    const offs = [onLeadsChanged(soon), live.on('lead.created', soon), live.on('marketing.followedUp', soon)];
    view.onLeave(() => { clearTimeout(t); offs.forEach(off => off()); });
  }
}, { nav: 'marketing' });

// MARK: - Sources

let period = '90';
async function sourcesTab(body, sub, view) {
  const data = await api('GET', `/api/marketing/sources?days=${period === 'all' ? 'all' : period}`);
  if (!view.fresh()) return;
  const all = data.sources;
  const leads = all.reduce((n, s) => n + s.leads, 0), won = all.reduce((n, s) => n + s.won, 0);
  sub.textContent = `${leads} lead${leads === 1 ? '' : 's'} · ${won} won · ${leads ? Math.round(won / leads * 100) : 0}% overall`;
  const picker = segmentedNav([['90', '90 days'], ['365', '12 months'], ['all', 'All time']], period, v => { period = v; sourcesTab(body, sub, view); }, { label: 'Period' });
  if (!all.length) {
    fill(body, h('div', { class: 'mk-toolbar' }, picker), emptyHero({ icon: 'monitoring', title: 'No leads in this period', line: 'Sources fill in as enquiries arrive and leads are won.', action: { label: 'Open the pipeline', path: '/pipeline' } }));
    return;
  }
  const best = [...all].filter(s => s.leads >= 2 && s.conversionPct !== null).sort((a, b) => b.conversionPct - a.conversionPct || b.won - a.won)[0];
  const fastest = [...all].filter(s => s.medianDaysToWin !== null).sort((a, b) => a.medianDaysToWin - b.medianDaysToWin)[0];
  const richest = [...all].filter(s => s.avgLtvPence !== null).sort((a, b) => b.avgLtvPence - a.avgLtvPence)[0];
  const busiest = [...all].sort((a, b) => b.leads - a.leads)[0];
  const chart = barChart({
    stacked: true, height: 220, ariaLabel: 'Leads by source, won and not won', yFormat: v => String(Math.round(v)),
    bars: all.map(s => ({ label: s.label, parts: [{ label: 'Won', value: s.won, tone: 3 }, { label: 'Not won (yet)', value: s.leads - s.won, tone: 6 }] })),
  });
  const insight = (glyph, eyebrow, s, line) => tile({ size: 's', icon: glyph, eyebrow, hero: eyebrow === 'Best converting', body: s
    ? [h('div', { class: 'mk-ins-name' }, icon(sourceIcon(s.source), 18), s.label), h('div', { class: 'mk-ins-line' }, line(s))]
    : h('p', { class: 'muted small' }, 'Not enough wins yet.') });
  fill(body,
    h('div', { class: 'mk-toolbar' }, picker, h('span', { class: 'small muted' }, 'Lifetime value comes from Billing; it shows once payments are recorded.')),
    h('div', { class: 'ui-bento mk-bento' },
      tile({ size: 'l', tall: true, title: 'Leads and wins by source', icon: 'bar_chart', body: [chart, h('div', { class: 'mk-legend' }, h('span', null, h('i', { class: 'mk-key ch-tone-3' }), 'Won'), h('span', null, h('i', { class: 'mk-key ch-tone-6' }), 'Not won (yet)'))] }),
      insight('trending_up', 'Best converting', best, s => `${s.conversionPct}% of ${s.leads} leads became clients`),
      insight('timer', 'Quickest to win', fastest, s => `${s.medianDaysToWin} day${s.medianDaysToWin === 1 ? '' : 's'} from hello to client (median)`),
      richest ? insight('savings', 'Most valuable', richest, s => `${money(s.avgLtvPence)} average lifetime value`)
        : insight('group', 'Most enquiries', busiest, s => `${s.leads} lead${s.leads === 1 ? '' : 's'} in this period`),
      insight('handshake', 'Referrals', all.find(s => s.source === 'referral'), s => `${s.leads} referred · ${s.won} won`)),
    sourceTable('By source', all, true),
    data.referralCodes.length ? sourceTable('By referral code', data.referralCodes) : null,
    data.campaigns.length ? sourceTable('By offer', data.campaigns) : null);
}

function sourceTable(title, rows, icons = false) {
  const pct = v => (v === null ? h('span', { class: 'faint' }, '—') : h('span', { class: 'mk-pct' }, h('span', { class: 'mk-pct-bar', style: { '--pct': `${v}%` } }), h('b', { class: 't-num' }, `${v}%`)));
  return h('section', { class: 'mk-section' }, h('h2', { class: 'mk-h' }, title), dataTable({
    label: title, rows, rowKey: r => r.source, filter: false, initialSort: { key: 'won', dir: -1 },
    columns: [
      { key: 'label', label: icons ? 'Source' : title.replace('By ', '').replace(/^\w/, c => c.toUpperCase()), sort: true, render: r => h('span', { class: 'mk-src' }, icons ? icon(sourceIcon(r.source), 16) : null, r.label) },
      { key: 'leads', label: 'Leads', align: 'right', sort: true, render: r => h('span', { class: 't-num' }, String(r.leads)) },
      { key: 'won', label: 'Won', align: 'right', sort: true, render: r => h('b', { class: 't-num' }, String(r.won)) },
      { key: 'conversionPct', label: 'Conversion', sort: r => r.conversionPct ?? -1, render: r => pct(r.conversionPct) },
      { key: 'medianDaysToWin', label: 'Days to win', align: 'right', sort: r => r.medianDaysToWin ?? 1e9, render: r => h('span', { class: 't-num' }, r.medianDaysToWin === null ? '—' : String(r.medianDaysToWin)) },
      { key: 'avgLtvPence', label: 'Avg LTV', align: 'right', sort: r => r.avgLtvPence ?? -1, render: r => h('span', { class: 't-num' }, r.avgLtvPence === null ? '—' : money(r.avgLtvPence)) },
      { key: 'revenue12Pence', label: 'Revenue, 12 mo', align: 'right', sort: r => r.revenue12Pence ?? -1, render: r => h('span', { class: 't-num' }, r.revenue12Pence === null ? '—' : money(r.revenue12Pence)) },
    ],
  }).el);
}

// MARK: - Follow-ups

async function followupsTab(body, sub, view, redraw) {
  const [{ due }, { templates, variables }] = await Promise.all([api('GET', '/api/marketing/followups'), api('GET', '/api/marketing/followups/templates')]);
  if (!view.fresh()) return;
  sub.textContent = due.length ? `${due.length} lead${due.length === 1 ? '' : 's'} due a follow-up today` : 'Everyone is followed up';
  const list = due.length ? h('ol', { class: 'mk-due' }, due.map(d => dueCard(d, redraw)))
    : emptyHero({ icon: 'done_all', title: 'All followed up', line: 'Nobody is waiting on you. New enquiries get their first reply due the next day, then 3, 7 and 14 days after.' });
  const byStage = TEMPLATE_STAGES.map(([id, label]) => [id, label, templates.filter(t => t.stage === id)]);
  fill(body, h('div', { class: 'mk-fu' },
    h('section', { class: 'mk-fu-due', 'aria-label': 'Due today' }, h('h2', { class: 'mk-h' }, 'Due today', h('span', { class: 'ui-count' }, String(due.length))), list),
    h('section', { class: 'mk-fu-tpl', 'aria-label': 'Templates' },
      h('div', { class: 'spread' }, h('h2', { class: 'mk-h' }, 'Templates'), h('button', { type: 'button', class: 'btn small', onclick: async () => { if (await templateSheet(null, variables)) redraw(); } }, icon('add', 16), 'New template')),
      h('p', { class: 'small muted' }, 'Write them once; each lead gets the right one with their name filled in. Variables: ', variables.map(v => h('code', { class: 'mk-var' }, `{${v}}`))),
      byStage.map(([id, label, list]) => h('div', { class: 'mk-tpl-group' },
        h('div', { class: 'mk-tpl-stage' }, stagePill(id === 'lost' ? 'lost' : id), id === 'lost' ? h('span', { class: 'small muted' }, 'to reopen') : null),
        list.length ? list.map(t => h('button', { type: 'button', class: 'mk-tpl', onclick: async () => { if (await templateSheet(t, variables)) redraw(); } },
          h('div', { class: 'spread' }, h('b', null, t.name), h('span', { class: 'mk-tpl-next' }, icon('schedule', 14), `then ${t.nextInDays} d`)),
          t.subject ? h('div', { class: 'mk-tpl-subject' }, t.subject) : null,
          h('div', { class: 'mk-tpl-body' }, t.body.replace(/^Hi \{leadFirst\},?\s*/, ''))))
          : h('p', { class: 'small faint mk-tpl-none' }, 'No template for this stage.'))))));
}

function dueCard(d, redraw) {
  const l = d.lead;
  const late = d.overdueDays > 0;
  const log = async channel => {
    try { await api('POST', `/api/leads/${enc(l.id)}/followed-up`, { templateId: d.template.id, channel }); toast(`Logged for ${firstName(l.name)}`); redraw(); } catch (err) { toast(err.message, { error: true }); }
  };
  return h('li', { class: 'mk-due-card' + (late ? ' late' : '') },
    h('div', { class: 'mk-due-head' }, avatar(l.name, 36),
      h('div', { class: 'grow' }, h('button', { type: 'button', class: 'mk-name', onclick: () => openLead(l.id) }, l.name),
        h('div', { class: 'row gap4' }, stagePill(l.stage), h('span', { class: `mk-when${late ? ' tone-attention' : ''}` }, icon(late ? 'alarm' : 'schedule', 14), late ? `${d.overdueDays} day${d.overdueDays === 1 ? '' : 's'} overdue` : 'Due today'),
          h('span', { class: 'small faint' }, `${l.sourceLabel} · ${l.ageDays}d old`))),
      l.valuePence ? h('span', { class: 'mk-due-value t-num' }, money(l.valuePence), h('small', null, '/mo')) : null),
    d.rendered ? h('div', { class: 'mk-due-note' },
      h('div', { class: 'mk-due-tpl' }, icon('description', 14), d.template.name, d.rendered.subject ? h('span', { class: 'faint' }, ` · ${d.rendered.subject}`) : null),
      h('p', { class: 'mk-due-body' }, d.rendered.body)) : h('p', { class: 'small muted' }, 'No template for this stage yet.'),
    h('div', { class: 'mk-due-actions' },
      d.rendered ? h('button', { type: 'button', class: 'btn small', onclick: async () => { if (await copyText(d.rendered.body, 'Message copied')) log('copy'); } }, icon('content_copy', 16), 'Copy') : null,
      d.mailto ? h('a', { class: 'btn small primary', href: d.mailto, onclick: () => log('mailto') }, icon('mail', 16), 'Open in mail') : null,
      h('button', { type: 'button', class: 'btn small text', onclick: async () => { if (await followUpSheet(l.id)) redraw(); } }, 'Edit first'),
      !l.email ? h('span', { class: 'tiny faint' }, 'No e-mail: copy it into a DM or text') : null));
}

function templateSheet(t, variables) {
  return sheet(t ? 'Edit template' : 'New template', (body, close) => {
    const stage = h('select', null, TEMPLATE_STAGES.map(([id, label]) => h('option', { value: id, selected: (t?.stage ?? 'enquiry') === id }, label)));
    const name = h('input', { type: 'text', maxlength: '60', value: t?.name ?? '', placeholder: 'First reply' });
    const subject = h('input', { type: 'text', maxlength: '150', value: t?.subject ?? '' });
    const text = h('textarea', { rows: '9', maxlength: '4000' }, t?.body ?? 'Hi {leadFirst},\n\n\n\n{coachFirst}');
    const next = h('input', { type: 'number', min: '0', max: '365', value: String(t?.nextInDays ?? 3) });
    const status = h('div');
    const insert = v => { const s = text.selectionStart ?? text.value.length; text.setRangeText(`{${v}}`, s, text.selectionEnd ?? s, 'end'); text.focus(); };
    body.append(h('div', { class: 'ld-two' }, field('For leads at', stage), field('Name', name)), field('Subject', subject),
      field('Message', text), h('div', { class: 'row gap4' }, h('span', { class: 'small muted' }, 'Insert:'), variables.map(v => h('button', { type: 'button', class: 'chip', onclick: () => insert(v) }, `{${v}}`))),
      field('Next follow-up after (days)', next, 'Following up with this template moves the lead’s next action on by this many days.'), status);
    const save = button('Save', e => busy(e.currentTarget, status, async () => {
      const payload = { stage: stage.value, name: name.value, subject: subject.value, body: text.value, nextInDays: Number(next.value) };
      await api(t ? 'PUT' : 'POST', t ? `/api/marketing/followups/templates/${enc(t.id)}` : '/api/marketing/followups/templates', payload);
      close(true);
      toast('Template saved');
    }), { kind: 'primary' });
    const del = t ? button('Delete', e => busy(e.currentTarget, status, async () => { await api('DELETE', `/api/marketing/followups/templates/${enc(t.id)}`); close(true); toast('Template deleted'); }), { kind: 'danger' }) : null;
    return h('div', { class: 'row end' }, del, h('span', { class: 'grow' }), button('Cancel', () => close(false)), save);
  }, { wide: true });
}

// MARK: - Testimonials

const COLUMNS = [['requested', 'Requested', 'hourglass_empty'], ['received', 'Received', 'format_quote'], ['approved', 'Approved to share', 'verified']];
let showArchived = false;

async function testimonialsTab(body, sub, view, redraw) {
  const { testimonials, asks } = await api('GET', '/api/marketing/testimonials');
  if (!view.fresh()) return;
  const live = testimonials.filter(t => t.status !== 'archived');
  const archived = testimonials.filter(t => t.status === 'archived');
  const approved = live.filter(t => t.status === 'approved').length;
  sub.textContent = `${approved} ready to share · ${live.filter(t => t.status === 'received').length} awaiting consent · ${asks.length} suggested ask${asks.length === 1 ? '' : 's'}`;
  const askBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => pickClientThenAsk(redraw) }, icon('format_quote', 18), 'Ask for a testimonial');
  fill(body,
    h('div', { class: 'mk-toolbar' }, h('p', { class: 'small muted m0' }, 'Nothing is published by the app. Copy an approved quote to your site or socials yourself.'), askBtn),
    asks.length ? h('section', { class: 'mk-asks', 'aria-label': 'Suggested asks' }, asks.map(a => h('div', { class: 'mk-ask' },
      h('div', { class: 'mk-ask-score' }, h('b', { class: 't-num' }, String(a.score ?? '')), h('span', null, '/10')),
      h('div', { class: 'grow' }, h('div', { class: 'mk-ask-title' }, `Ask ${firstName(a.client.name)} for a testimonial`),
        h('div', { class: 'small muted' }, `Scored ${a.score} on the pulse survey ${fmtRelative(a.at)}. Happy clients say yes.`)),
      h('button', { type: 'button', class: 'btn small primary', onclick: () => askComposer(a.client, a.surveyId, redraw) }, 'Write the ask'),
      h('button', { type: 'button', class: 'btn small text', onclick: async () => { await api('POST', `/api/marketing/testimonials/asks/${enc(a.id)}/dismiss`); redraw(); } }, 'Not now')))) : null,
    h('div', { class: 'mk-tm-board' }, COLUMNS.map(([status, label, glyph]) => {
      const list = live.filter(t => t.status === status);
      return h('section', { class: `mk-tm-col mk-tm-${status}`, 'aria-label': label },
        h('header', { class: 'mk-tm-head' }, icon(glyph, 16), h('span', { class: 'grow' }, label), h('span', { class: 'ui-count' }, String(list.length))),
        list.length ? list.map(t => testimonialCard(t, redraw)) : h('p', { class: 'mk-tm-empty' }, { requested: 'No open asks.', received: 'Quotes land here when clients reply.', approved: 'Approve a quote once the client says yes to sharing it.' }[status]));
    })),
    archived.length ? h('div', { class: 'mk-archived' }, h('button', { type: 'button', class: 'btn small text', onclick: () => { showArchived = !showArchived; redraw(); } }, showArchived ? 'Hide archived' : `Show archived (${archived.length})`),
      showArchived ? h('div', { class: 'mk-tm-arch' }, archived.map(t => testimonialCard(t, redraw))) : null) : null);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const askId = q.get('ask');
  if (askId) { const a = asks.find(x => x.id === askId); if (a) askComposer(a.client, a.surveyId, redraw); }
  if (q.get('new') === '1') pickClientThenAsk(redraw);
}

function testimonialCard(t, redraw) {
  const patch = async (body, done) => { try { await api('PATCH', `/api/marketing/testimonials/${enc(t.id)}`, body); if (done) toast(done); redraw(); } catch (err) { toast(err.message, { error: true }); } };
  const quote = t.quote ? h('blockquote', { class: 'mk-quote' }, t.quote) : h('p', { class: 'mk-wait' }, `Waiting for ${firstName(t.client.name)}’s reply`);
  const actions = {
    requested: [h('button', { type: 'button', class: 'btn small', onclick: () => quoteSheet(t, redraw) }, icon('format_quote', 16), 'Add their words'),
      link(`/messages/${enc(t.client.id)}`, { class: 'btn small text' }, 'Open thread')],
    received: [h('button', { type: 'button', class: 'btn small primary', onclick: () => approveSheet(t, redraw) }, icon('verified', 16), 'Approve'),
      h('button', { type: 'button', class: 'btn small text', onclick: () => quoteSheet(t, redraw) }, 'Edit')],
    approved: [h('button', { type: 'button', class: 'btn small primary', onclick: () => copyText(`“${t.quote}”\n— ${t.attribution}`, 'Quote copied') }, icon('content_copy', 16), 'Copy'),
      h('button', { type: 'button', class: 'btn small text', onclick: () => approveSheet(t, redraw) }, 'Edit')],
    archived: [h('button', { type: 'button', class: 'btn small text', onclick: () => patch({ status: t.quote ? 'received' : 'requested' }, 'Restored') }, 'Restore')],
  }[t.status];
  return h('article', { class: `mk-tm mk-tm-is-${t.status}` },
    quote,
    h('div', { class: 'mk-tm-who' }, avatar(t.client.name, 26), h('div', { class: 'grow' }, h('div', { class: 'mk-attr' }, t.attribution || t.client.name),
      h('div', { class: 'tiny faint' }, `${t.source === 'nps' ? 'From a pulse score · ' : ''}${fmtRelative(t.updatedAt)}`))),
    t.status === 'approved' && t.evidence ? h('div', { class: 'mk-evidence' }, icon('verified', 14), h('span', null, 'Consent: “', h('i', null, t.evidence.text.slice(0, 90)), `” · ${fmtDay(londonParts(t.evidence.at).day)}`)) : null,
    h('div', { class: 'mk-tm-actions' }, actions, t.status !== 'archived' ? h('button', { type: 'button', class: 'ui-icon-btn small', 'aria-label': 'Archive', title: 'Archive', onclick: () => patch({ status: 'archived' }, 'Archived') }, icon('archive', 16)) : null));
}

/** The client's recent messages as pickable rows. */
function messagePicker(t, onPick, { label = 'Use a message from this thread' } = {}) {
  const box = h('div', { class: 'mk-msgs' }, skeleton('lines', { rows: 3 }));
  api('GET', `/api/marketing/testimonials/${enc(t.id)}/messages`).then(({ messages }) => {
    fill(box, messages.length ? [h('div', { class: 'mk-msgs-label' }, label), ...messages.slice(0, 12).map(m => h('button', { type: 'button', class: 'mk-msg', onclick: e => {
      for (const b of box.querySelectorAll('.mk-msg')) b.classList.toggle('on', b === e.currentTarget);
      onPick(m);
    } }, h('span', { class: 'mk-msg-text' }, m.text), h('span', { class: 'tiny faint' }, fmtRelative(m.at))))] : h('p', { class: 'small muted' }, `No messages from ${firstName(t.client.name)} yet.`));
  }).catch(err => fill(box, errorLine(err)));
  return box;
}

function quoteSheet(t, redraw) {
  return sheet(`${firstName(t.client.name)}’s words`, (body, close) => {
    const quote = h('textarea', { rows: '5', maxlength: '1500', placeholder: 'Paste or pick their reply' }, t.quote);
    const attribution = h('input', { type: 'text', maxlength: '80', value: t.attribution || firstName(t.client.name), placeholder: 'Priya, marathon runner' });
    const status = h('div');
    body.append(messagePicker(t, m => { quote.value = m.text; }), field('Quote', quote, 'Trim it to the part worth sharing; check the wording with them.'), field('Attribution', attribution), status);
    return h('div', { class: 'row end' }, button('Cancel', () => close()), button('Save', e => busy(e.currentTarget, status, async () => {
      await api('PATCH', `/api/marketing/testimonials/${enc(t.id)}`, { quote: quote.value, attribution: attribution.value });
      close(); toast('Saved'); redraw();
    }), { kind: 'primary' }));
  }, { wide: true });
}

function approveSheet(t, redraw) {
  return sheet('Consent to share', (body, close) => {
    let evidence = t.evidence?.id ?? null;
    const quote = h('textarea', { rows: '4', maxlength: '1500' }, t.quote);
    const attribution = h('input', { type: 'text', maxlength: '80', value: t.attribution });
    const consent = h('input', { type: 'checkbox', checked: t.consentPublish });
    const status = h('div');
    const evidenceLine = h('p', { class: 'small' });
    const showEvidence = m => fill(evidenceLine, m ? [icon('verified', 14), ` Evidence: “${m.text.slice(0, 120)}”`] : h('span', { class: 'tone-attention' }, 'Pick the message where they said yes.'));
    showEvidence(t.evidence);
    body.append(field('Quote', quote), field('Attribution', attribution),
      messagePicker(t, m => { evidence = m.id; showEvidence(m); }, { label: 'Which message is their yes?' }), evidenceLine,
      h('label', { class: 'mk-consent' }, consent, h('span', null, h('b', null, `${firstName(t.client.name)} said yes to sharing this`), h('span', { class: 'small muted' }, 'Only tick this with their explicit permission. The message above is kept as the record.'))),
      status);
    return h('div', { class: 'row end' }, button('Cancel', () => close()), button('Save', e => busy(e.currentTarget, status, async () => {
      const payload = { quote: quote.value, attribution: attribution.value };
      if (evidence) payload.evidenceMessageId = evidence;
      payload.consentPublish = consent.checked;
      await api('PATCH', `/api/marketing/testimonials/${enc(t.id)}`, payload);
      close(); toast(consent.checked ? 'Approved to share' : 'Saved'); redraw();
    }), { kind: 'primary' }));
  }, { wide: true });
}

/** The ask, in the composer: the coach edits it and presses Send (via coachAction); the row becomes requested. */
function askComposer(client, surveyId, redraw) {
  slideOver(`Ask ${firstName(client.name)} for a testimonial`, (body, close) => {
    const first = firstName(client.name);
    const c = composer({
      clientId: client.id, label: 'The ask', placeholder: 'Your message',
      initial: `Hi ${first}, thank you for the lovely feedback. Would you be happy to share a sentence or two about training together that I could use as a testimonial? Only with your OK, and I’ll check the wording with you first.`,
      onSend: async ({ text }) => {
        await api('POST', '/api/marketing/testimonials/ask', { clientId: client.id, text, ...(surveyId ? { surveyId } : {}) });
        close();
        toast(`Asked ${first}`);
        redraw();
      },
    });
    body.append(h('div', { class: 'mk-ask-who' }, avatar(client.name, 40), h('div', null, h('b', null, client.name), h('div', { class: 'small muted' }, 'This goes to their thread in the app, from you.'))),
      c.el, h('p', { class: 'tiny faint' }, 'When they reply, open Testimonials and pick their words from the thread.'));
    requestAnimationFrame(() => c.focus());
  });
}

function pickClientThenAsk(redraw) {
  return sheet('Who would you like to ask?', (body, close) => {
    const list = h('div', { class: 'ld-pick' }, skeleton('lines', { rows: 4 }));
    body.append(list);
    clients().then(all => fill(list, all.map(c => h('button', { type: 'button', class: 'ld-pick-row', onclick: () => { close(); askComposer(c, null, redraw); } },
      avatar(c.name, 32), h('span', { class: 'grow' }, h('b', null, c.name)), icon('chevron_right', 18))))).catch(err => fill(list, errorLine(err)));
    return h('div', { class: 'row end' }, button('Cancel', () => close()));
  });
}

// MARK: - Offers

async function offersTab(body, sub, view) {
  const { offers, formLive } = await api('GET', '/api/marketing/offers');
  if (!view.fresh()) return;
  const interest = offers.reduce((n, o) => n + o.interest, 0);
  sub.textContent = offers.length ? `${offers.length} public offer${offers.length === 1 ? '' : 's'} · ${interest} interested` : 'No public offers right now';
  const banner = formLive ? null : h('div', { class: 'mk-banner' }, icon('warning', 18), h('span', { class: 'grow' }, 'Your enquiry form is closed, so offers have no link yet.'), link('/account/enquiry-form', { class: 'btn small' }, 'Open the form settings'));
  if (!offers.length) {
    const hasCampaigns = await hasFeature('campaigns');
    const step = (n, glyph, title, line) => h('li', { class: 'mk-step' }, h('span', { class: 'mk-step-n' }, String(n)), icon(glyph, 20), h('b', null, title), h('span', null, line));
    fill(body, banner, emptyHero({ icon: 'storefront', title: 'No public offers yet', line: 'Mark a live campaign as a public offer (Campaigns › Settings) and it appears here with its own enquiry link, ready to share.',
      action: hasCampaigns ? { label: 'Open campaigns', path: '/campaigns' } : null }),
    h('ol', { class: 'mk-steps', 'aria-label': 'How offer links work' },
      step(1, 'rocket_launch', 'Make it public', 'A live campaign, like January Reset, marked as a public offer.'),
      step(2, 'link', 'Share the link', 'Its enquiry link shows the dates, the fee and a form to register interest.'),
      step(3, 'view_kanban', 'Interest lands here', 'Every sign-up is a lead in your Pipeline, tagged with the offer.')));
    return;
  }
  const when = c => (c.startsOn ? `${fmtDay(c.startsOn)}${c.endsOn ? ` – ${fmtDay(c.endsOn)}` : ''}` : c.lengthDays ? `${c.lengthDays} days, rolling start` : 'Rolling');
  fill(body, banner, h('div', { class: 'mk-offers' }, offers.map(({ campaign: c, link: url, interest: n }) => h('article', { class: 'mk-offer' },
    h('div', { class: 'mk-offer-eyebrow' }, icon('rocket_launch', 14), 'Public offer'),
    h('h2', { class: 'mk-offer-name' }, c.name),
    c.tagline ? h('p', { class: 'mk-offer-tag' }, c.tagline) : null,
    h('dl', { class: 'mk-offer-facts' },
      h('div', null, h('dt', null, 'Dates'), h('dd', null, when(c))),
      h('div', null, h('dt', null, 'Fee'), h('dd', { class: 't-num' }, c.feePence ? money(c.feePence) : 'Free')),
      c.placesLeft !== null && c.placesLeft !== undefined ? h('div', null, h('dt', null, 'Places left'), h('dd', { class: 't-num' }, String(c.placesLeft))) : null),
    h('div', { class: 'mk-offer-interest' }, h('b', { class: 't-num' }, String(n)), h('span', null, n === 1 ? 'person interested' : 'people interested'),
      n ? link('/pipeline', { class: 'mk-offer-pipe' }, 'See them', icon('chevron_right', 14)) : null),
    url ? h('div', { class: 'mk-offer-link' }, h('code', null, url),
      h('button', { type: 'button', class: 'btn small', onclick: () => copyText(url, 'Offer link copied') }, icon('content_copy', 16), 'Copy'),
      h('a', { class: 'btn small text', href: url, target: '_blank', rel: 'noopener noreferrer' }, icon('open_in_new', 16), 'Preview')) : null))));
}

