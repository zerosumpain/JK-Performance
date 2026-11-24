/*
 * F25 Engagement insights (docs/design/desk-v2.md, WP8): /insights/:tab?
 * with three tabs. Engagement: the London weekday × hour heatmap, daily active
 * clients, the activity mix, the most engaged and the quietest, health bands.
 * Retention: the cohort grid by join month, lifetime and survival. Pulse & NPS:
 * the score, its trend, what clients said, and the surveys that ask them.
 *
 * Every piece of client data goes on the page through h() (textContent).
 */
import { api, avatar, button, confirmBox, fill, firstName, fmtDay, fmtRelative, fmtShort, h, icon, registerNav, route, setCrumbs, toast } from './core.js';
import { barChart, cohortGrid, donut, heatmap, lineChart } from './charts.js';
import { bento, countUp, dataTable, emptyHero, menu, pageHead, segmentedNav, skeleton, slideOver, tabs, tile } from './ui.js';

const enc = encodeURIComponent;
const TABS = [{ id: 'engagement', label: 'Engagement' }, { id: 'cohorts', label: 'Retention cohorts' }, { id: 'nps', label: 'Pulse & NPS' }];
const KIND_TONE = { message: 2, sets: 1, workout: 3, checkin: 4, habit: 5, session: 6 };
const BAND_TONE = { thriving: 3, steady: 2, watch: 5, atRisk: 6, none: 6 };
const CADENCE = { once: 'Once', monthly: 'Monthly', quarterly: 'Quarterly', afterDays: 'After joining' };
const CAT = { promoter: { word: 'Promoter', tone: 'ok' }, passive: { word: 'Passive', tone: 'data' }, detractor: { word: 'Detractor', tone: 'urgent' } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = n => String(n).padStart(2, '0');
const monthShort = m => fmtShort(`${m}-01`).split(' ')[1];
const signed = n => (n === null || n === undefined ? '–' : n > 0 ? `+${n}` : String(n));

function bigNumber(value, { format = v => String(Math.round(v)), suffix = null, label = null, tone = null } = {}) {
  const n = h('span', { class: `in-big${tone ? ` tone-${tone}` : ''}` }, '–');
  if (typeof value === 'number') countUp(n, value, { format }); else n.textContent = value ?? '–';
  return h('div', { class: 'in-kpi' }, h('div', { class: 'in-kpi-v' }, n, suffix ? h('span', { class: 'in-kpi-suffix' }, suffix) : null), label ? h('div', { class: 'in-kpi-k' }, label) : null);
}

const person = p => h('span', { class: 'in-who' }, avatar(p.client.initials, 26), h('span', null, p.client.name));

// MARK: - Engagement

async function engagementTab(box, ctx) {
  let days = ctx.days ?? 90;
  const head = h('div', { class: 'in-bar' },
    h('p', { class: 'muted small in-note' }, 'Client activity: messages, training logged, workouts done, check-ins, habit days and sessions attended. Times are London.'),
    segmentedNav([[30, '30 days'], [90, '90 days'], [365, 'A year']].map(([id, label]) => ({ id, label })), days, v => { days = v; ctx.days = v; load(); }, { label: 'Range' }));
  const grid = h('div', { class: 'in-grid' });
  box.append(head, grid);
  async function load() {
    fill(grid, h('div', { class: 'in-loading' }, skeleton('chart'), skeleton('table', { rows: 4 })));
    const d = await api('GET', `/api/insights/engagement?days=${days}`);
    if (!grid.isConnected) return;
    ctx.setSub(`${plural(d.summary.clients, 'client')} · ${d.summary.peak ? `busiest ${d.summary.peak.weekday} around ${pad(d.summary.peak.hour)}:00` : 'no activity yet'}`);
    if (!d.summary.events) { fill(grid, emptyHero({ icon: 'monitoring', title: 'Nothing to chart yet.', line: 'As clients message, train and check in, their rhythm shows here.' })); return; }
    const mixTotal = d.mix.reduce((s, m) => s + m.n, 0);
    const hours = Array.from({ length: 24 }, (_, i) => pad(i));
    const tiles = [
      tile({ id: 'kpi-active', size: 's', hero: true, eyebrow: 'Active this week', body: bigNumber(d.summary.activeWeek, { suffix: `/ ${d.summary.clients}`, label: 'clients did something' }) }),
      tile({ id: 'kpi-daily', size: 's', eyebrow: 'Daily active', body: bigNumber(d.summary.avgDailyWeek, { format: v => v.toFixed(1), label: `a day this week · ${d.summary.avgDaily.toFixed(1)} over ${d.days} days` }) }),
      tile({ id: 'kpi-events', size: 's', eyebrow: 'Activity', body: bigNumber(d.summary.events, { format: v => Math.round(v).toLocaleString('en-GB'), label: `things clients did in ${d.days} days` }) }),
      tile({ id: 'kpi-peak', size: 's', eyebrow: 'Busiest hour', body: bigNumber(d.summary.peak ? `${d.summary.peak.weekday} ${pad(d.summary.peak.hour)}:00` : '–', { label: d.summary.peak ? `${plural(d.summary.peak.n, 'thing')} in that hour` : '' }) }),
      tile({ id: 'heat', size: 'xl', title: 'When clients are active', icon: 'grid_view',
        body: h('div', { class: 'in-heat' }, heatmap({ rows: d.rows, cols: hours, values: d.heatmap, ariaLabel: 'Client activity by London weekday and hour', format: v => plural(v ?? 0, 'thing') })) }),
      tile({ id: 'mix', size: 'm', title: 'What they do', icon: 'donut_large',
        body: donut({ parts: d.mix.filter(m => m.n).map(m => ({ label: m.label, value: m.n, tone: KIND_TONE[m.kind] })), centre: { value: mixTotal.toLocaleString('en-GB'), label: 'in total' }, size: 150, ariaLabel: 'Activity by kind' }) }),
      tile({ id: 'daily', size: 'xl', title: 'Daily active clients', icon: 'trending_up',
        body: lineChart({ series: [{ label: 'Active clients', tone: 1, points: d.daily.map(x => ({ x: x.day, y: x.active })) }], area: true, height: 190, ariaLabel: 'Active clients per day', xFormat: x => fmtShort(x), yFormat: v => String(Math.round(v ?? 0)) }) }),
      d.bands ? tile({ id: 'bands', size: 'm', title: d.bands.source === 'crm' ? 'Health bands' : 'Adherence bands', icon: 'monitor_heart',
        body: [barChart({ bars: d.bands.items.map(b => ({ label: b.label.replace(' and up', '+'), value: b.n, tone: BAND_TONE[b.band] ?? 6 })), height: 170, ariaLabel: d.bands.label, yFormat: v => String(Math.round(v ?? 0)) }),
          h('p', { class: 'muted small in-cap' }, d.bands.source === 'crm' ? 'From each client’s health score.' : 'Workouts done of those due, last 28 days.')] }) : null,
      tile({ id: 'top', size: 'l', title: 'Most engaged', icon: 'star', body: rankTable(d.top, 'top', d.days) }),
      tile({ id: 'quiet', size: 'l', title: 'Quietest', icon: 'hourglass_empty', body: rankTable(d.quiet, 'quiet', d.days) }),
    ].filter(Boolean);
    grid.replaceChildren();
    bento(grid, tiles);
  }
  await load();
}

function rankTable(rows, kind, days) {
  return dataTable({
    rows: rows.map(r => ({ ...r, id: r.client.id, name: r.client.name })), filter: false, label: kind === 'top' ? 'Most engaged clients' : 'Quietest clients',
    onRow: r => { location.hash = `#/clients/${enc(r.client.id)}`; },
    empty: 'Nobody yet.',
    columns: [
      { key: 'name', label: 'Client', render: person },
      { key: 'activeDays', label: 'Active days', align: 'right', render: r => h('span', { class: 'in-days' }, h('span', { class: 'in-mini' }, h('span', { class: 'in-mini-fill', style: { '--w': `${Math.min(100, Math.round((r.activeDays / days) * 100))}%` } })), h('b', { class: 't-num' }, String(r.activeDays))) },
      { key: 'last', label: 'Last active', align: 'right', render: r => h('span', { class: `small ${kind === 'quiet' && (r.daysQuiet ?? 99) >= 7 ? 'tone-attention' : 'muted'}` }, r.lastActive ? (r.daysQuiet === 0 ? 'Today' : r.daysQuiet === 1 ? 'Yesterday' : `${r.daysQuiet} days ago`) : 'Never') },
    ],
  }).el;
}

// MARK: - Cohorts

async function cohortsTab(box, ctx) {
  const grid = h('div', { class: 'in-grid' }, skeleton('chart'));
  box.append(grid);
  const d = await api('GET', '/api/insights/cohorts?months=12');
  if (!grid.isConnected) return;
  const size = d.cohorts.reduce((s, c) => s + c.size, 0);
  ctx.setSub(`${plural(d.cohorts.length, 'cohort')} · ${plural(size, 'client')} who joined in the last ${d.months} months`);
  if (!d.cohorts.length) { fill(grid, emptyHero({ icon: 'grid_view', title: 'No cohorts yet.', line: 'Clients are grouped by the month they joined.' })); return; }
  const at3 = d.survival.find(x => x.month === 3);
  const latest = [...d.cohorts].reverse().find(c => c.retained.length >= 2);
  const tiles = [
    tile({ id: 'life', size: 's', hero: true, eyebrow: 'Average lifetime', body: bigNumber(d.avgLifetimeMonths, { format: v => v.toFixed(1), suffix: 'months', label: 'from joining to their last active month' }) }),
    tile({ id: 'at3', size: 's', eyebrow: 'Still active at 3 months', body: bigNumber(at3 ? at3.pct : null, { suffix: at3 ? '%' : null, label: at3 ? `of ${plural(at3.of, 'client')} old enough to tell` : 'Not enough history yet' }) }),
    tile({ id: 'count', size: 's', eyebrow: 'Cohorts', body: bigNumber(d.cohorts.length, { label: `${plural(size, 'client')} in all` }) }),
    tile({ id: 'second', size: 's', eyebrow: 'Second month', body: bigNumber(latest ? latest.retained[1] : null, { suffix: latest ? '%' : null, label: latest ? `of the ${latest.label} cohort came back` : '' }) }),
    tile({ id: 'grid', size: 'full', title: 'Retention by join month', icon: 'grid_view',
      body: [h('div', { class: 'in-cohort' }, cohortGrid({ cohorts: d.cohorts.map(c => ({ label: c.label, size: c.size, values: c.retained })), periodLabel: 'Month', ariaLabel: 'Share of each cohort active, by months since joining' })),
        h('p', { class: 'muted small in-cap' }, 'Active means anything from the client that month, or a paid plan with activity in the last 30 days of it. Month 0 is the month they joined.')] }),
    tile({ id: 'survival', size: 'xl', title: 'Survival', icon: 'trending_down',
      body: lineChart({ series: [{ label: 'Still active', tone: 1, points: d.survival.map(s => ({ x: s.month, y: s.pct })) }], area: true, height: 200, ariaLabel: 'Share of clients still active, by months since joining', xFormat: x => `Month ${x}`, yFormat: v => `${Math.round(v ?? 0)}%` }) }),
    tile({ id: 'sizes', size: 'm', title: 'Who joined when', icon: 'bar_chart',
      body: barChart({ bars: d.cohorts.map(c => ({ label: monthShort(c.month), value: c.size, tone: 2 })), height: 200, ariaLabel: 'Clients joined per month', yFormat: v => String(Math.round(v ?? 0)) }) }),
  ];
  grid.replaceChildren();
  bento(grid, tiles);
}

// MARK: - Pulse and NPS

function npsBar(d) {
  const total = d.responses || 1;
  const seg = (n, cls, label) => h('div', { class: `in-npsbar-seg ${cls}`, style: { '--w': `${(n / total) * 100}%` }, title: `${label}: ${n}` });
  return h('div', { class: 'in-npsbar-wrap' },
    h('div', { class: 'in-npsbar', role: 'img', 'aria-label': `${d.promoters} promoters, ${d.passives} passives, ${d.detractors} detractors` },
      seg(d.promoters, 'bg-ok', 'Promoters'), seg(d.passives, 'in-passive', 'Passives'), seg(d.detractors, 'bg-urgent', 'Detractors')),
    h('ul', { class: 'in-npsleg' },
      [['bg-ok', 'Promoters', '9–10', d.promoters], ['in-passive', 'Passives', '7–8', d.passives], ['bg-urgent', 'Detractors', '0–6', d.detractors]].map(([cls, label, range, n]) =>
        h('li', null, h('span', { class: `in-key ${cls}` }), h('span', { class: 'grow' }, label, h('span', { class: 'muted' }, ` ${range}`)), h('b', { class: 't-num' }, String(n))))));
}

function surveyRow(s, reload) {
  const status = s.status === 'active' ? h('span', { class: 'pill' }, h('span', { class: 'dot bg-ok', 'aria-hidden': 'true' }), 'Active') : h('span', { class: 'pill' }, h('span', { class: 'dot bg-data', 'aria-hidden': 'true' }), 'Paused');
  const more = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': `More for ${s.name}`, onclick: e => menu(e.currentTarget, [
    { label: 'Send now to whoever is due', icon: 'send', onclick: async () => { try { const r = await api('POST', `/api/insights/surveys/${enc(s.id)}/send`, {}); toast(r.sent ? `Sent to ${plural(r.sent, 'client')}` : 'Everyone has had this one already'); reload(); } catch (err) { toast(err.message, { error: true }); } } },
    { label: s.status === 'active' ? 'Pause' : 'Resume', icon: s.status === 'active' ? 'pause_circle' : 'play_arrow', onclick: async () => { await api('PATCH', `/api/insights/surveys/${enc(s.id)}`, { status: s.status === 'active' ? 'paused' : 'active' }); reload(); } },
    'sep',
    { label: 'Delete', icon: 'delete', danger: true, onclick: async () => {
      if (!await confirmBox(`Delete “${s.name}”?`, { ok: 'Delete', danger: true, detail: 'It stops sending and leaves Insights. Answers stay on each client’s record.' })) return;
      await api('DELETE', `/api/insights/surveys/${enc(s.id)}`); reload();
    } },
  ], { label: 'Survey' }) }, icon('more_horiz', 18));
  return h('li', { class: 'in-survey' },
    h('span', { class: `in-survey-ic ${s.kind}` }, icon(s.kind === 'nps' ? 'sentiment_satisfied' : 'monitor_heart', 20)),
    h('div', { class: 'grow' },
      h('div', { class: 'in-survey-name' }, s.name, status),
      h('div', { class: 'muted small' }, [s.kind === 'nps' ? 'NPS' : `Pulse · ${plural(s.questions.length, 'question')}`, s.cadence === 'afterDays' ? `${s.afterDays} days after joining` : CADENCE[s.cadence],
        `${s.answered} of ${s.sent} answered`, s.lastSentAt ? `last sent ${fmtRelative(s.lastSentAt)}` : 'not sent yet'].join(' · '))),
    s.score !== null ? h('span', { class: 'in-survey-score t-num', title: s.kind === 'nps' ? 'NPS' : 'Average out of 5' }, s.kind === 'nps' ? signed(s.score) : `${s.score}/5`) : null,
    more);
}

function newSurvey(reload) {
  slideOver('New survey', (body, close) => {
    const state = { kind: 'nps', cadence: 'monthly', afterDays: 30, segmentId: '', questions: ['How energised do you feel this week?', '', ''] };
    const form = h('div', { class: 'in-form' });
    let segments = [];
    const draw = () => {
      const qBox = state.kind === 'pulse' ? h('div', { class: 'in-field' }, h('label', null, 'Questions (1 to 5 scale, up to three)'),
        state.questions.map((q, i) => { const inp = h('input', { type: 'text', maxlength: '200', value: q, placeholder: i ? 'Optional' : 'Required', 'aria-label': `Question ${i + 1}` }); inp.addEventListener('input', () => { state.questions[i] = inp.value; }); return inp; })) :
        h('div', { class: 'in-preview' }, h('div', { class: 'in-preview-q' }, 'How likely are you to recommend JK to a friend? (0–10)'),
          h('div', { class: 'in-preview-scale', 'aria-hidden': 'true' }, Array.from({ length: 11 }, (_, i) => h('span', null, String(i)))), h('div', { class: 'in-preview-q small' }, 'What’s the main reason?'));
      const after = h('input', { type: 'number', min: '1', max: '730', value: String(state.afterDays), 'aria-label': 'Days after joining' });
      after.addEventListener('input', () => { state.afterDays = Number(after.value); });
      const seg = h('select', { 'aria-label': 'Who gets it', onchange: e => { state.segmentId = e.target.value; } }, h('option', { value: '' }, 'Every client'), segments.map(s => h('option', { value: s.id, selected: s.id === state.segmentId }, s.name)));
      fill(form,
        h('div', { class: 'in-field' }, h('label', null, 'Kind'), segmentedNav([['nps', 'NPS'], ['pulse', 'Pulse']], state.kind, v => { state.kind = v; draw(); }, { label: 'Kind' })),
        qBox,
        h('div', { class: 'in-field' }, h('label', null, 'How often'), segmentedNav(Object.entries(CADENCE), state.cadence, v => { state.cadence = v; draw(); }, { label: 'How often' }),
          state.cadence === 'afterDays' ? h('div', { class: 'in-after' }, after, h('span', { class: 'muted small' }, 'days after a client joins, once')) : null),
        h('div', { class: 'in-field' }, h('label', null, 'Who gets it'), seg),
        h('p', { class: 'muted small' }, 'Sent at 10:00 through Forms, so it arrives in the client’s app like any form. Nobody gets the same survey twice in a period; clients in their first two weeks and anyone with outreach paused are skipped.'));
    };
    api('GET', '/api/segments').then(d => { segments = d.segments ?? []; draw(); }).catch(() => {});
    draw();
    body.append(form);
    return h('div', { class: 'row end' }, button('Cancel', () => close()), h('button', { type: 'button', class: 'btn primary', onclick: async e => {
      e.currentTarget.disabled = true;
      try {
        const payload = { kind: state.kind, cadence: state.cadence, audience: state.segmentId ? { segmentId: state.segmentId } : {} };
        if (state.cadence === 'afterDays') payload.afterDays = state.afterDays;
        if (state.kind === 'pulse') payload.questions = state.questions.map(q => q.trim()).filter(Boolean);
        await api('POST', '/api/insights/surveys', payload);
        toast('Survey ready. It goes out at 10:00.');
        close(); reload();
      } catch (err) { toast(err.message, { error: true }); e.currentTarget.disabled = false; }
    } }, 'Create survey'));
  });
}

async function npsTab(box, ctx) {
  const grid = h('div', { class: 'in-grid' }, skeleton('chart'));
  box.append(grid);
  const load = async () => {
    const [d, s] = await Promise.all([api('GET', '/api/insights/nps?months=12'), api('GET', '/api/insights/surveys')]);
    if (!grid.isConnected) return;
    ctx.setSub(d.responses ? `NPS ${signed(d.nps)} from ${plural(d.responses, 'answer')} in 12 months` : 'Ask clients how it’s going, automatically');
    const surveys = h('ul', { class: 'in-surveys' }, s.surveys.length ? s.surveys.map(x => surveyRow(x, load)) : h('li', { class: 'muted small' }, 'No surveys yet. An NPS a month is a good start.'));
    const months = d.trend.filter(t => t.responses);
    const tiles = [
      tile({ id: 'nps', size: 'm', tall: true, hero: true, eyebrow: 'Net promoter score', body: d.responses ? [
        h('div', { class: 'in-nps' }, h('span', { class: `in-nps-n ${d.nps >= 30 ? 'tone-ok' : d.nps >= 0 ? 'tone-accent' : 'tone-urgent'}` }, signed(d.nps)), h('span', { class: 'in-nps-word' }, d.nps >= 50 ? 'Excellent' : d.nps >= 30 ? 'Great' : d.nps >= 0 ? 'Good' : 'Needs work')),
        h('p', { class: 'muted small' }, `${plural(d.responses, 'answer')} over 12 months`), npsBar(d)] : emptyHero({ icon: 'sentiment_satisfied', title: 'No answers yet.', line: 'Create an NPS survey and the score appears here.' }) }),
      tile({ id: 'trend', size: 'xl', title: 'By month', icon: 'trending_up', body: months.length > 1
        ? lineChart({ series: [{ label: 'NPS', tone: 1, points: months.map(t => ({ x: `${t.month}-01`, y: t.nps })) }], height: 200, goal: { value: 30, label: 'Great' }, ariaLabel: 'NPS by month', xFormat: x => monthShort(x.slice(0, 7)), yFormat: v => signed(Math.round(v ?? 0)) })
        : h('p', { class: 'muted' }, 'A trend appears after two months of answers.') }),
      tile({ id: 'comments', size: 'xl', title: 'What they said', icon: 'format_quote', body: d.comments.length
        ? h('ul', { class: 'in-comments' }, d.comments.slice(0, 6).map(c => h('li', { class: 'in-comment' },
          h('div', { class: 'in-comment-head' }, avatar(c.client.initials, 26), h('span', { class: 'in-comment-name' }, firstName(c.client.name)),
            h('span', { class: `in-score tone-${CAT[c.category].tone}`, title: CAT[c.category].word }, String(c.score)), h('span', { class: 'muted small grow' }, CAT[c.category].word), h('span', { class: 'muted small' }, fmtDay(c.at.slice(0, 10)))),
          h('blockquote', { class: 'in-quote' }, c.text))))
        : h('p', { class: 'muted' }, 'Reasons clients give show here (only you see them).') }),
      tile({ id: 'surveys', size: 'full', title: 'Surveys', icon: 'description', action: { label: 'New survey', onclick: () => newSurvey(load) }, body: surveys }),
    ];
    grid.replaceChildren();
    bento(grid, tiles);
  };
  await load();
}

// MARK: - The screen

route('/insights/:tab?', async (el, params, view) => {
  let tab = TABS.some(t => t.id === params.tab) ? params.tab : 'engagement';
  const sub = h('span', null, ' ');
  const body = h('div', { class: 'in-body' });
  const ctx = { setSub: text => { sub.textContent = text; }, days: 90 };
  const crumbs = () => setCrumbs([{ label: 'Business' }, { label: 'Insights', path: '/insights' }, { label: TABS.find(t => t.id === tab).label }]);
  const show = async () => {
    crumbs();
    body.replaceChildren();
    try {
      if (tab === 'cohorts') await cohortsTab(body, ctx);
      else if (tab === 'nps') await npsTab(body, ctx);
      else await engagementTab(body, ctx);
    } catch (err) { if (view.fresh()) body.replaceChildren(h('p', { class: 'error' }, err.message)); }
  };
  el.append(pageHead({ eyebrow: 'Business', title: 'Client', accent: 'insights', sub }),
    tabs(TABS, tab, id => { tab = id; history.replaceState(history.state, '', `#/insights/${id}`); show(); }, { label: 'Insights' }), body);
  await show();
}, { nav: 'insights' });

registerNav({
  id: 'insights', label: 'Insights', icon: 'monitoring', group: 'business', order: 40, path: '/insights',
  tabs: TABS.map(t => ({ id: t.id, label: t.label, path: `/insights/${t.id}` })),
});

