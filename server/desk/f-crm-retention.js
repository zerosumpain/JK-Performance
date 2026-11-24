/*
 * WP2 Retention (docs/design/desk-v2.md F8): /retention/:tab? with Radar
 * (Watch, At risk, Churn suggested), Renewals (what runs out in 30 days, plus
 * upgrade candidates) and Ended (the last 12 months: reasons, churn by month,
 * saves, and Win back). Every play opens a flow the coach finishes by hand.
 */
import {
  api, avatar, errorLine, fill, firstName, fmtRelative, fmtShort, go, h, hasFeature, icon, link, londonParts, route, setCrumbs, sparkline,
} from './core.js';
import { barChart, donut } from './charts.js';
import { emptyHero, menu, pageHead, skeleton, tabs } from './ui.js';
import { BAND, EXIT, exitTone, healthRing, inDays, openEnd, openMessage, openPause, stagePill, trendChip } from './f-crm.js';

const enc = encodeURIComponent;
const TABS = [{ id: 'radar', label: 'Radar' }, { id: 'renewals', label: 'Renewals' }, { id: 'ended', label: 'Ended' }];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

route('/retention/:tab?', async (el, params, view) => {
  const tab = TABS.some(t => t.id === params.tab) ? params.tab : 'radar';
  setCrumbs([{ label: 'Clients', path: '/clients' }, { label: 'Retention', path: '/retention' }, ...(tab === 'radar' ? [] : [{ label: TABS.find(t => t.id === tab).label }])]);
  const sub = h('span', null, 'Who is slipping, what is running out, and who has left.');
  const body = h('div', { class: 'rt-body' });
  el.append(
    pageHead({ eyebrow: 'Clients', title: 'Retention', accent: 'radar', sub, actions: [link('/segments', { class: 'btn' }, icon('filter_alt', 18), 'Segments')] }),
    tabs(TABS, tab, id => go(`/retention/${id}`), { label: 'Retention' }),
    body);
  if (tab === 'radar') await radar(body, view, sub);
  else if (tab === 'renewals') await renewals(body, view);
  else await ended(body, view);
});

// MARK: - Radar

const COLUMNS = [
  { key: 'watch', label: 'Watch', tone: 'attention', icon: 'visibility', empty: 'Nobody drifting into Watch.' },
  { key: 'atRisk', label: 'At risk', tone: 'urgent', icon: 'warning', empty: 'Nobody at risk right now.' },
  { key: 'suggested', label: 'Churn suggested', tone: 'data', icon: 'heart_broken', empty: 'No one looks like they have stopped.' },
];

async function radar(box, view, sub) {
  fill(box, h('div', { class: 'rt-cols' }, COLUMNS.map(() => h('div', { class: 'rt-col' }, skeleton('card'), skeleton('card')))));
  let r;
  try { r = await api('GET', '/api/retention'); } catch (err) { if (view.fresh()) fill(box, errorLine(err)); return; }
  if (!view.fresh()) return;
  const offer = await hasFeature('offers');
  const total = r.watch.length + r.atRisk.length + r.suggested.length;
  fill(sub, total ? `${r.watch.length} to watch · ${r.atRisk.length} at risk · ${r.suggested.length} may have stopped. ${r.stats.saves90 ? `${r.stats.saves90} saved in the last 90 days.` : ''}` : 'Everyone is on track. Nothing to rescue today.');
  const reload = () => radar(box, view, sub);
  fill(box,
    h('div', { class: 'rt-kpis' },
      kpi(String(r.atRisk.length + r.suggested.length), 'need you now', 'urgent'),
      kpi(String(r.watch.length), 'to watch', 'attention'),
      kpi(String(r.stats.saves90), 'saves · 90 days', 'ok'),
      kpi(String(r.stats.ended12), 'left · 12 months', 'data')),
    h('div', { class: 'rt-cols' }, COLUMNS.map(col => h('section', { class: `rt-col rt-${col.key}`, 'aria-label': col.label },
      h('header', { class: 'rt-col-head' }, h('span', { class: `rt-col-icon tone-${col.tone}` }, icon(col.icon, 18)), h('h2', null, col.label), h('span', { class: 'ui-count' }, String(r[col.key].length))),
      r[col.key].length ? r[col.key].map(c => radarCard(c, { offer, reload })) : h('p', { class: 'rt-empty small muted' }, col.empty)))));
}

const kpi = (n, label, tone) => h('div', { class: 'rt-kpi' }, h('span', { class: `rt-kpi-dot bg-${tone}`, 'aria-hidden': 'true' }), h('span', { class: 'rt-kpi-n t-num' }, n), h('span', { class: 'small muted' }, label));

function radarCard(c, { offer, reload }) {
  const client = c.client;
  const play = c.play;
  const run = kind => {
    if (kind === 'checkIn') return openMessage(client, { category: 'winback', title: `Check in with ${firstName(client.name)}` });
    if (kind === 'pause') return openPause(client).then(done => done && reload());
    if (kind === 'end') return openEnd(client, { onDone: reload });
    if (kind === 'offer') return go(`/offers?client=${enc(client.id)}`);
    return null;
  };
  const moreBtn = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': `More for ${client.name}`, 'aria-haspopup': 'menu', onclick: e => menu(e.currentTarget, [
    { label: 'Check in', icon: 'chat_bubble', onclick: () => run('checkIn') },
    offer ? { label: 'Offer', icon: 'sell', onclick: () => run('offer') } : null,
    { label: 'Pause', icon: 'pause_circle', onclick: () => run('pause') },
    { label: 'End coaching', icon: 'logout', onclick: () => run('end') },
    'sep',
    { label: 'Open client', icon: 'chevron_right', onclick: () => go(`/clients/${enc(client.id)}`) },
  ], { label: `Plays for ${client.name}` }) }, icon('more_horiz', 18));
  const tone = BAND[c.band]?.tone ?? 'data';
  return h('article', { class: 'rt-card' },
    h('div', { class: 'rt-card-top' },
      link(`/clients/${enc(client.id)}`, { class: 'rt-who' }, avatar(client.initials || client.name, 36),
        h('div', { class: 'grow' }, h('div', { class: 'strong clamp1' }, client.name), h('div', { class: 'row gap4' }, stagePill(c.stage, { small: true })))),
      healthRing(c.health, c.band, { size: 46 })),
    h('div', { class: 'rt-spark' }, h('span', { class: `tone-${tone}` }, sparkline(c.series, { width: 200, height: 34, label: `Health over 30 days, now ${c.health ?? 'unknown'}` })), trendChip(c.trend)),
    c.suggested && c.why ? h('p', { class: 'rt-why' }, icon('heart_broken', 16), `Looks like ${firstName(client.name)} has stopped: ${c.why}.`) : null,
    c.reasons.length ? h('ul', { class: 'rt-reasons' }, c.reasons.map(t => h('li', null, t))) : null,
    h('div', { class: 'rt-meta tiny muted' },
      h('span', null, 'Last word from you'),
      h('span', null, c.lastContactAt ? fmtRelative(c.lastContactAt) : 'Not yet')),
    h('div', { class: 'rt-plays' },
      h('button', { type: 'button', class: 'btn small' + (play.kind === 'end' ? '' : ' primary'), onclick: () => run(play.kind) }, icon(play.kind === 'end' ? 'logout' : play.kind === 'pause' ? 'pause_circle' : play.kind === 'offer' ? 'sell' : 'chat_bubble', 16), play.label),
      play.kind === 'end' ? h('button', { type: 'button', class: 'btn small primary', onclick: () => run('checkIn') }, icon('chat_bubble', 16), 'Check in') : null,
      h('span', { class: 'grow' }), moreBtn));
}

// MARK: - Renewals

const KIND = {
  package: { word: 'Package', icon: 'inventory_2', tone: 'accent' }, schedule: { word: 'Billing', icon: 'event_repeat', tone: 'data' },
  campaign: { word: 'Campaign', icon: 'rocket_launch', tone: 'ok' }, upgrade: { word: 'Upgrade', icon: 'workspace_premium', tone: 'accent' },
};

async function renewals(box, view) {
  fill(box, skeleton('table', { rows: 5 }));
  let items;
  try { ({ items } = await api('GET', '/api/retention/renewals?days=30')); } catch (err) { if (view.fresh()) fill(box, errorLine(err)); return; }
  if (!view.fresh()) return;
  const upgrades = items.filter(i => i.kind === 'upgrade');
  const due = items.filter(i => i.kind !== 'upgrade');
  const offer = await hasFeature('offers');
  const play = i => (i.kind === 'upgrade'
    ? openMessage(i.client, { category: 'upgrade', title: `Offer ${firstName(i.client.name)} the next plan` })
    : openMessage(i.client, { category: 'billing', title: `Renew with ${firstName(i.client.name)}` }));
  fill(box,
    h('section', { class: 'rt-sec' },
      h('div', { class: 'rt-sec-head' }, h('h2', null, 'Running out'), h('span', { class: 'small muted' }, 'Packages, billing and campaigns ending in the next 30 days, soonest first')),
      due.length ? h('ol', { class: 'rt-renew' }, due.map(i => {
        const k = KIND[i.kind] ?? { word: i.kind, icon: 'event', tone: 'data' };
        const day = i.on ? londonParts(`${i.on}T12:00:00Z`).day : null;
        return h('li', { class: 'rt-renew-row' },
          h('div', { class: 'rt-date' }, day ? [h('span', { class: 'rt-date-m' }, MONTH[Number(day.slice(5, 7)) - 1]), h('span', { class: 'rt-date-d t-num' }, String(Number(day.slice(8))))] : h('span', { class: 'rt-date-d' }, '—')),
          avatar(i.client.initials || i.client.name, 34),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, link(`/clients/${enc(i.client.id)}`, null, i.client.name), ' · ', h('span', { class: 'muted' }, i.label)),
            h('div', { class: 'small muted' }, [i.detail, day ? inDays(day) : null].filter(Boolean).join(' · '))),
          h('span', { class: 'pill small rt-kind' }, h('span', { class: `tone-${k.tone}` }, icon(k.icon, 14)), k.word),
          h('button', { type: 'button', class: 'btn small', onclick: () => play(i) }, icon('event_repeat', 16), 'Renew'),
          offer ? h('button', { type: 'button', class: 'btn small text', onclick: () => go(`/offers?client=${enc(i.client.id)}`) }, 'Offer') : null);
      })) : emptyHero({ icon: 'event_available', title: 'Nothing runs out soon', line: 'Packages, recurring billing and campaign places ending in the next 30 days show here, once billing and campaigns are in use.' })),
    h('section', { class: 'rt-sec' },
      h('div', { class: 'rt-sec-head' }, h('h2', null, 'Upgrade candidates'), h('span', { class: 'small muted' }, 'Adherence 80%+ and health 75+, ready for more support')),
      upgrades.length ? h('div', { class: 'rt-upgrades' }, upgrades.map(i => h('article', { class: 'rt-up' },
        h('div', { class: 'row gap8' }, avatar(i.client.initials || i.client.name, 40), h('div', { class: 'grow' }, h('div', { class: 'strong' }, i.client.name), h('div', { class: 'small tone-accent' }, i.label))),
        h('div', { class: 'small muted' }, i.detail),
        h('div', { class: 'row gap4' }, h('button', { type: 'button', class: 'btn small primary', onclick: () => play(i) }, icon('workspace_premium', 16), 'Suggest it'),
          link(`/clients/${enc(i.client.id)}`, { class: 'btn small text' }, 'Open'))))) : h('p', { class: 'small muted' }, 'No one fits yet. Foundation and Performance clients with adherence over 80% and health over 75 appear here.')));
}

// MARK: - Ended

async function ended(box, view) {
  fill(box, skeleton('chart'));
  let list, r;
  try { [{ clients: list }, r] = await Promise.all([api('GET', '/api/retention/ended?months=12'), api('GET', '/api/retention')]); } catch (err) { if (view.fresh()) fill(box, errorLine(err)); return; }
  if (!view.fresh()) return;
  const months = r.stats.churn.map(m => ({ label: MONTH[Number(m.month.slice(5)) - 1], value: m.n, tone: 1 }));
  const reasons = r.stats.reasons.map(x => ({ label: x.label, value: x.n, tone: exitTone(x.reason) }));
  fill(box,
    h('div', { class: 'rt-ended-top' },
      h('section', { class: 'rt-panel' }, h('div', { class: 'ui-eyebrow' }, 'Why people left'),
        reasons.length ? donut({ parts: reasons, centre: { value: String(list.length), label: 'in 12 months' }, size: 150, ariaLabel: 'Exit reasons, last 12 months' }) : h('p', { class: 'small muted' }, 'Nobody has left in the last year.')),
      h('section', { class: 'rt-panel rt-panel-wide' }, h('div', { class: 'spread' }, h('div', { class: 'ui-eyebrow' }, 'Churn by month'), h('span', { class: 'small muted' }, `${r.stats.saves90} saved in 90 days`)),
        barChart({ bars: months, height: 180, ariaLabel: 'Clients who left, by month', yFormat: v => String(Math.round(v)) }))),
    h('section', { class: 'rt-sec' },
      h('div', { class: 'rt-sec-head' }, h('h2', null, 'Ended in the last 12 months'), h('span', { class: 'small muted' }, 'A warm word from you now and then is the best win-back there is')),
      list.length ? h('ol', { class: 'rt-ended' }, list.map(x => h('li', { class: 'rt-ended-row' },
        avatar(x.client.initials || x.client.name, 36),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, link(`/clients/${enc(x.client.id)}`, null, x.client.name)),
          h('div', { class: 'small muted clamp2' }, [`Ended ${fmtShort(londonParts(x.endedAt).day)}`, x.exitNote].filter(Boolean).join(' · '))),
        stagePill(x.stage, { small: true }),
        h('span', { class: 'pill small rt-reason' }, h('span', { class: `ch-key ch-tone-${exitTone(x.exitReason)}` }), EXIT[x.exitReason] ?? x.exitReason),
        h('button', { type: 'button', class: 'btn small', onclick: () => openMessage(x.client, { category: 'winback', title: `Win back ${firstName(x.client.name)}` }) }, icon('favorite', 16), 'Win back')))) :
        emptyHero({ icon: 'celebration', title: 'Nobody has left', line: 'Clients you end coaching with show here, with why they left.' })));
}
