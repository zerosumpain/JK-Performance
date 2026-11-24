/*
 * WP3 Revenue (docs/design/desk-v2.md F26): /revenue with Overview, Forecast
 * and Clients, and the Today "revenue" widget. Collected money by month, the
 * target ring, billed and plan MRR, the mix, ARPC and LTV, a 90-day forecast
 * stacked by confidence (certain, likely, possible) from every feature's
 * forecast hook, and lifetime value by client.
 */
import { api, avatar, busy, button, errorLine, fill, fmtDay, go, h, hasFeature, icon, link, prefs, registerCommand, registerNav, registerWidget, route, setCrumbs, sheet, toast } from './core.js';
import { countUp, dataTable, emptyHero, moneyInput, pageHead, progressBar, scoreRing, skeleton, tabs, tile } from './ui.js';
import { barChart, donut, lineChart, sparkline } from './charts.js';
import { enc, money } from './f-billing-common.js';

registerNav({ id: 'revenue', label: 'Revenue', icon: 'trending_up', group: 'business', order: 30,
  tabs: [{ id: 'forecast', label: 'Forecast', path: '/revenue/forecast' }, { id: 'clients', label: 'Client value', path: '/revenue/clients' }] });
registerCommand({ id: 'go-revenue', label: 'Go to Revenue', group: 'Jump to', icon: 'trending_up', run: () => go('/revenue') });

const pounds = v => `£${Math.round(v).toLocaleString('en-GB')}`;
/** Whole pounds for summary tiles (the ledger keeps the pence). */
const roundMoney = p => money(Math.round((p ?? 0) / 100) * 100);
const compact = p => (Math.abs(p) >= 100_000 ? `£${(p / 100_000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k` : roundMoney(p));
const monthLabel = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const MIX = { recurring: ['Recurring', 1], packages: ['Packages', 2], campaigns: ['Campaigns', 3], other: ['Sessions and other', 6] };

registerWidget({
  id: 'revenue', title: 'Revenue', icon: 'trending_up', size: 's', order: 50,
  async render(box) {
    const s = await api('GET', '/api/revenue/summary?months=6');
    const n = h('div', { class: 'ui-tile-num' });
    const pct = s.target ? Math.min(100, Math.round((s.month.collectedPence / s.target) * 100)) : null;
    fill(box, n, h('div', { class: 'small muted' }, `collected this month${s.target ? ` · ${pct}% of ${money(s.target)}` : ''}`),
      s.target ? progressBar(pct, { tone: pct >= 100 ? 'ok' : 'accent' }) : null,
      h('div', { class: 'rv-w-spark' }, sparkline(s.collected.map(c => c.pence / 100), { width: 200, height: 34, label: 'Collected per month' })),
      link('/revenue', { class: 'ui-tile-action' }, 'Revenue', icon('chevron_right', 16)));
    countUp(n, s.month.collectedPence, { format: v => money(Math.round(v)) });
  },
});

const TABS = [['overview', 'Overview'], ['forecast', 'Forecast'], ['clients', 'Clients']];

route('/revenue/:tab?', async (el, params, view) => {
  const tab = TABS.some(t => t[0] === params.tab) ? params.tab : 'overview';
  if (tab !== 'overview') setCrumbs([{ label: 'Revenue', path: '/revenue' }, { label: TABS.find(t => t[0] === tab)[1] }]);
  const sub = h('p', { class: 'ui-head-sub' }, ' ');
  const head = pageHead({ eyebrow: 'Business', title: 'Revenue', accent: tab === 'forecast' ? 'ahead' : tab === 'clients' ? 'by client' : 'at a glance',
    actions: [link('/billing', { class: 'btn' }, icon('receipt_long', 18), 'Billing')] });
  head.querySelector('.ui-head-text').append(sub);
  const body = h('div', { class: 'rv-body' }, skeleton('chart'));
  el.append(head, tabs(TABS.map(([id, label]) => ({ id, label })), tab, id => go(id === 'overview' ? '/revenue' : `/revenue/${id}`), { label: 'Revenue sections' }), body);
  try {
    if (tab === 'overview') await overview(body, sub, view);
    else if (tab === 'forecast') await forecast(body, sub, view);
    else await clientsTab(body, sub, view);
  } catch (err) { if (view.fresh()) fill(body, errorLine(err)); }
}, { nav: 'revenue' });

// MARK: - Overview

async function overview(body, sub, view) {
  const [s, billing, sources] = await Promise.all([
    api('GET', '/api/revenue/summary?months=12'),
    api('GET', '/api/billing/overview'),
    hasFeature('marketing').then(on => (on ? api('GET', '/api/marketing/sources?days=365').catch(() => null) : null)),
  ]);
  if (!view.fresh()) return;
  const m = s.month;
  const monthName = new Date(`${m.day}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const delta = m.lastMonthToDatePence ? Math.round(((m.collectedPence - m.lastMonthToDatePence) / m.lastMonthToDatePence) * 100) : null;
  sub.textContent = `${roundMoney(s.totals.collectedPence)} collected over 12 months from ${s.totals.payingClients} client${s.totals.payingClients === 1 ? '' : 's'} · ${money(s.totals.billedMrrPence)} a month on schedule`;

  // Hero: this month against the target.
  const num = h('div', { class: 'rv-hero-n t-num' });
  countUp(num, m.collectedPence, { format: v => money(Math.round(v)) });
  const pct = s.target ? Math.round((m.collectedPence / s.target) * 100) : null;
  const pace = s.target ? Math.round((s.target * m.day.slice(8, 10)) / m.daysInMonth) : null;
  const setTarget = h('button', { type: 'button', class: 'btn small text', onclick: async () => { if (await targetSheet(s.target)) overview(body, sub, view); } }, icon('edit', 14), s.target ? 'Change target' : 'Set a monthly target');
  const hero = tile({ id: 'month', eyebrow: `Collected in ${monthName}`, icon: 'savings', size: 'l', tall: true, hero: true, body: [
    h('div', { class: 'rv-hero' },
      h('div', { class: 'rv-hero-main' }, num,
        h('div', { class: `rv-delta ${delta === null ? '' : delta >= 0 ? 'tone-ok' : 'tone-attention'}` }, delta === null ? 'No payments last month to compare' : [icon(delta >= 0 ? 'trending_up' : 'trending_down', 16), `${delta >= 0 ? '+' : ''}${delta}% on last month, same days`]),
        s.target ? h('div', { class: 'small muted' }, pct >= 100 ? 'Target reached. Lovely month.' : `${money(Math.max(0, s.target - m.collectedPence))} to go · on pace would be ${money(pace)} by today`) : null,
        setTarget),
      s.target ? h('div', { class: 'rv-ring' }, scoreRing(Math.min(100, pct), { size: 132, label: 'Monthly target', band: { word: `% of ${roundMoney(s.target)}`, tone: pct >= 100 ? 'ok' : pct * m.daysInMonth >= 100 * Number(m.day.slice(8, 10)) ? 'ok' : 'attention' } })) : null),
    h('div', { class: 'rv-hero-split' },
      h('div', null, h('div', { class: 'bl-k' }, 'Last month'), h('div', { class: 'bl-v t-num' }, roundMoney(m.lastMonthPence))),
      h('div', null, h('div', { class: 'bl-k' }, 'Billed MRR'), h('div', { class: 'bl-v t-num' }, money(s.totals.billedMrrPence))),
      h('div', null, h('div', { class: 'bl-k' }, 'Plan MRR'), h('div', { class: 'bl-v t-num' }, money(s.totals.planMrrPence)))),
  ] });

  const stat = (id, eyebrow, glyph, pence, line) => { const n = h('div', { class: 'ui-tile-num' }); countUp(n, pence, { format: v => roundMoney(v) }); return tile({ id, eyebrow, icon: glyph, size: 's', body: [n, h('div', { class: 'small muted' }, line)] }); };

  const chart = tile({ id: 'trend', eyebrow: '12 months', title: 'Collected, billed and plan MRR', icon: 'show_chart', size: 'full', body: [
    lineChart({ height: 240, area: true, ariaLabel: 'Collected per month with billed and plan MRR', yFormat: pounds, xFormat: x => monthLabel(String(x).slice(0, 7)),
      goal: s.target ? { value: s.target / 100, label: 'Target' } : null,
      series: [
        { label: 'Collected', tone: 1, points: s.collected.map(c => ({ x: `${c.month}-15`, y: c.pence / 100 })) },
        { label: 'Billed MRR', tone: 2, points: s.billedMrr.map(c => ({ x: `${c.month}-15`, y: c.pence / 100 })) },
        { label: 'Plan MRR', tone: 3, points: s.planMrr.map(c => ({ x: `${c.month}-15`, y: c.pence / 100 })) },
      ] }),
    h('ul', { class: 'rv-legend' }, [['Collected', 1], ['Billed MRR (schedules)', 2], ['Plan MRR (memberships)', 3]].map(([l, t]) => h('li', { class: `ch-tone-${t}` }, h('span', { class: 'rv-key' }), l))),
  ] });

  const mixTotal = s.mix.reduce((n, x) => n + x.pence, 0);
  const mix = tile({ id: 'mix', eyebrow: 'Where it comes from', title: 'Revenue mix, 12 months', icon: 'donut_large', size: 'l', body: mixTotal
    ? donut({ parts: s.mix.filter(x => x.pence).map(x => ({ label: MIX[x.source][0], value: x.pence, tone: MIX[x.source][1] })), centre: { value: compact(mixTotal), label: '12 months' }, format: roundMoney, ariaLabel: 'Revenue by source', size: 160 })
    : h('p', { class: 'muted' }, 'Record payments to see the mix.') });

  const agedTotal = Object.values(billing.aged).reduce((a, b) => a + b, 0);
  const bands = [['d30', '0–30', 'data'], ['d60', '31–60', 'attention'], ['d90', '61–90', 'attention'], ['older', '90+', 'urgent']];
  const aged = tile({ id: 'aged', eyebrow: 'Aged debt', title: money(agedTotal), icon: 'hourglass_empty', size: 'l', action: { label: 'Billing', path: '/billing' }, body: [
    h('div', { class: 'bl-aged-stack', role: 'img', 'aria-label': bands.map(([k, l]) => `${l} days: ${money(billing.aged[k])}`).join(', ') },
      bands.map(([k, , tone]) => (billing.aged[k] ? h('span', { class: `bl-aged-seg bg-${tone}`, style: { '--w': `${(billing.aged[k] / (agedTotal || 1)) * 100}%` } }) : null))),
    h('ul', { class: 'rv-aged' }, bands.map(([k, l, tone]) => h('li', null, h('span', { class: `bl-aged-dot bg-${tone}` }), h('span', { class: 'grow small muted' }, `${l} days`), h('b', { class: 't-num' }, money(billing.aged[k]))))),
  ] });

  const tiles = [hero,
    stat('arpc', 'ARPC', 'person', s.arpcPence, 'average per paying client, per month'),
    stat('ltv', 'Average LTV', 'workspace_premium', s.avgLtvPence, 'everything a client has paid, on average'),
    stat('recurring', 'On schedule', 'event_repeat', s.totals.billedMrrPence, 'billed every month automatically'),
    stat('year', '12 months', 'savings', s.totals.collectedPence, `from ${s.totals.payingClients} paying clients`),
    chart, mix, aged];
  if (sources?.sources?.length) {
    tiles.push(tile({ id: 'sources', eyebrow: 'By source', title: 'Which channels pay', icon: 'storefront', size: 'full', body: barChart({ height: 180, ariaLabel: 'Revenue over 12 months by lead source', yFormat: pounds,
      bars: sources.sources.map((x, i) => ({ label: x.source, value: (x.revenue12Pence ?? 0) / 100, tone: (i % 6) + 1 })) }) }));
  }
  fill(body, h('div', { class: 'ui-bento rv-bento' }, tiles));
}

function targetSheet(current) {
  return sheet('Monthly revenue target', (body, close) => {
    let v = current;
    const status = h('div', { role: 'status' });
    body.append(h('p', { class: 'small muted m0' }, 'The ring on Revenue and the Today tile measure each month against it.'), moneyInput({ value: current, label: 'Target per month', onChange: x => { v = x; } }), status);
    const save = button('Save target', () => busy(save, status, async () => { await api('PUT', '/api/revenue/target', { targetPence: v || null }); await prefs.set('revenue.target', v || null).catch(() => {}); toast('Target saved'); close(true); }), { kind: 'primary' });
    return h('div', { class: 'row end' }, button('Cancel', () => close()), save);
  });
}

// MARK: - Forecast

const CONF = { certain: ['Certain', 3, 'check_circle', 'ok'], likely: ['Likely', 1, 'trending_up', 'data'], possible: ['Possible', 4, 'help', 'quiet'] };

async function forecast(body, sub, view) {
  const f = await api('GET', '/api/revenue/forecast?days=90');
  if (!view.fresh()) return;
  const total = f.totals.certainPence + f.totals.likelyPence + f.totals.possiblePence;
  sub.textContent = `${money(total)} could come in over the next 90 days · ${money(f.totals.certainPence)} of it already scheduled`;
  // Running totals at the end of each week, stacked: each series is the sum of the bands below it,
  // so the areas read as "what could be in by then", certain at the bottom.
  const weeks = [];
  let c = 0, l = 0, p = 0;
  for (let w = 0; w < Math.ceil(f.days.length / 7); w++) {
    const part = f.days.slice(w * 7, w * 7 + 7);
    c += part.reduce((n, d) => n + d.certainPence, 0); l += part.reduce((n, d) => n + d.likelyPence, 0); p += part.reduce((n, d) => n + d.possiblePence, 0);
    weeks.push({ day: part.at(-1).day, c, l, p });
  }
  const chips = h('div', { class: 'rv-conf' }, Object.entries(CONF).map(([k, [label, tone, glyph]]) => h('div', { class: `rv-conf-chip ch-tone-${tone}` },
    h('span', { class: 'rv-key' }), h('div', null, h('div', { class: 'small muted row gap4' }, icon(glyph, 14), label), h('div', { class: 'rv-conf-n t-num' }, money(f.totals[`${k}Pence`]))))));
  const chart = lineChart({ height: 260, area: true, ariaLabel: 'Money expected by the end of each week for 90 days, stacked by confidence', yFormat: pounds, xFormat: d => fmtDay(d).slice(4),
    series: [
      { label: 'Possible (all)', tone: 4, points: weeks.map(w => ({ x: w.day, y: (w.c + w.l + w.p) / 100 })) },
      { label: 'Likely and certain', tone: 1, points: weeks.map(w => ({ x: w.day, y: (w.c + w.l) / 100 })) },
      { label: 'Certain', tone: 3, points: weeks.map(w => ({ x: w.day, y: w.c / 100 })) },
    ] });
  const table = dataTable({ label: 'Forecast lines', rows: f.lines.map((l, i) => ({ ...l, id: `${i}` })), initialSort: { key: 'day', dir: 1 }, empty: 'Nothing forecast: add recurring schedules, sell packages or run campaigns.',
    columns: [
      { key: 'day', label: 'When', sort: true, render: r => fmtDay(r.day) },
      { key: 'label', label: 'What', sort: true },
      { key: 'confidence', label: 'Confidence', sort: r => Object.keys(CONF).indexOf(r.confidence), render: r => h('span', { class: `bl-status bl-tone-${CONF[r.confidence][3]}` }, icon(CONF[r.confidence][2], 14), CONF[r.confidence][0]) },
      { key: 'source', label: 'From', render: r => h('span', { class: 'small muted' }, { 'billing.schedule': 'Schedule', 'billing.package': 'Package renewal' }[r.source] ?? r.source) },
      { key: 'pence', label: 'Amount', align: 'right', sort: true, render: r => h('b', { class: 't-num' }, money(r.pence)) },
    ] });
  fill(body,
    h('div', { class: 'ui-bento rv-bento' },
      tile({ id: 'fc', eyebrow: 'Next 90 days', title: 'Expected in, week by week', icon: 'monitoring', size: 'full', hero: true, body: [chips, chart,
        h('p', { class: 'small muted' }, 'Certain: recurring schedules. Likely: packages about to run out (at half their last price) and campaign fees. Possible: the weighted pipeline.')] }),
      tile({ id: 'lines', eyebrow: 'Contributing lines', icon: 'format_list_bulleted', size: 'full', body: table.el })));
}

// MARK: - Clients

async function clientsTab(body, sub, view) {
  const { clients } = await api('GET', '/api/revenue/clients');
  if (!view.fresh()) return;
  const paying = clients.filter(c => c.ltvPence > 0);
  sub.textContent = paying.length ? `${paying.length} paying client${paying.length === 1 ? '' : 's'} · top client ${money(paying[0]?.ltvPence ?? 0)} lifetime` : 'No payments recorded yet.';
  if (!clients.length) { fill(body, emptyHero({ icon: 'group', title: 'No clients yet.', line: 'Lifetime value appears here as payments are recorded.' })); return; }
  const top = paying.slice(0, 10);
  const months = days => (days < 60 ? `${days} days` : `${Math.round(days / 30.4)} months`);
  fill(body, h('div', { class: 'ui-bento rv-bento' },
    tile({ id: 'top', eyebrow: 'Top 10', title: 'Lifetime value', icon: 'bar_chart', size: 'full', body: top.length ? barChart({ height: 220, ariaLabel: 'Top clients by lifetime value', yFormat: pounds,
      bars: top.map((c, i) => ({ label: c.client.name.split(' ')[0], value: c.ltvPence / 100, tone: i === 0 ? 1 : 2 })) }) : h('p', { class: 'muted' }, 'No payments yet.') }),
    tile({ id: 'table', eyebrow: 'Every client', icon: 'group', size: 'full', body: dataTable({ label: 'Client value', rows: clients.map(c => ({ ...c, id: c.client.id, name: c.client.name })), initialSort: { key: 'ltv', dir: -1 },
      onRow: r => go(`/clients/${enc(r.client.id)}/billing`),
      columns: [
        { key: 'name', label: 'Client', sort: true, render: r => h('span', { class: 'bl-client' }, avatar(r.client.initials, 24), h('span', null, r.client.name)) },
        { key: 'ltv', label: 'Lifetime', align: 'right', sort: r => r.ltvPence, render: r => h('b', { class: 't-num' }, money(r.ltvPence)) },
        { key: 'paid12', label: 'Last 12 months', align: 'right', sort: r => r.paid12Pence, render: r => h('span', { class: 't-num' }, money(r.paid12Pence)) },
        { key: 'balance', label: 'Balance', align: 'right', sort: r => r.balancePence, render: r => h('span', { class: `t-num ${r.balancePence > 0 ? 'tone-attention' : r.balancePence < 0 ? 'tone-ok' : 'muted'}` }, r.balancePence < 0 ? `${money(-r.balancePence)} credit` : money(r.balancePence)) },
        { key: 'months', label: 'Months paid', align: 'right', sort: r => r.monthsActive, render: r => h('span', { class: 't-num' }, String(r.monthsActive)) },
        { key: 'tenure', label: 'With you', align: 'right', sort: r => r.tenureDays, render: r => h('span', { class: 'muted' }, months(r.tenureDays)) },
      ] }).el })));
}
