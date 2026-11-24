/*
 * F24 The accountability board (docs/design/desk-v2.md, WP8): /accountability.
 * Who kept their word this week (commitments, day minimums, training, the
 * check-in), who is on a streak, and who needs a nudge; nudge or celebrate one
 * person or ten with a per-person preview. Also the Today widget
 * "accountability". Not to be confused with /account (Settings).
 *
 * Every piece of client data goes on the page through h() (textContent).
 */
import {
  addDays, api, avatar, clientById, fill, firstName, fmtDay, fmtRelative, fmtShort, foundationApi, h, hasFeature, icon, link, live, mondayOf,
  registerNav, registerWidget, route, setCrumbs, setHashQuery, sparkline, toast, todayLondon,
} from './core.js';
import { lineChart } from './charts.js';
import { composer } from './composer.js';
import { countUp, dataTable, emptyHero, pageHead, scoreRing, segmentedNav, skeleton, slideOver } from './ui.js';

const enc = encodeURIComponent;
const FILTERS = [['all', 'All'], ['missed', 'Missed something'], ['noCommitments', 'No commitments'], ['atRisk', 'Streak at risk'], ['topStreaks', 'Top streaks']];
const OUTCOME = {
  kept: { word: 'Kept', icon: 'check_circle', tone: 'ok' },
  mostly: { word: 'Mostly', icon: 'indeterminate_check_box', tone: 'data' },
  missed: { word: 'Missed', icon: 'close', tone: 'urgent' },
  open: { word: 'Open', icon: 'hourglass_empty', tone: 'muted' },
};
const DAY_WORD = { done: 'Met', missed: 'Missed', rest: 'Rest day', future: 'To come', today: 'Today, not yet', none: 'No habits' };
const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const PARTS = [['c', 'Commitments', 0.4], ['h', 'Day minimums', 0.3], ['t', 'Training', 0.2], ['k', 'Check-in', 0.1]];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

/** Ready-made lines when no templates of the category exist yet (WP5's templates join them when present). */
const SUGGEST = {
  nudge: [
    'Hey {first}, quick nudge from me. What’s one thing you can tick off today?',
    '{first}, your streak is at {streak} days. Ten minutes tonight keeps it alive.',
    'Morning {first}! Let’s set this week’s commitments together. What feels doable?',
  ],
  celebrate: [
    '{streak} days straight, {first}. That’s the work. Proud of you.',
    'Brilliant week, {first}. You kept your word every day. Keep going.',
    '{first}, that’s a {streak}-day streak. Quietly brilliant.',
  ],
};

// MARK: - Small pieces

function outcomeChip(c) {
  const o = OUTCOME[c.outcome] ?? OUTCOME.open;
  return h('span', { class: `ac-cm ac-${c.outcome}`, title: `${o.word}: ${c.text}` }, h('span', { class: `ac-cm-ic tone-${o.tone}` }, icon(o.icon, 14)), h('span', { class: 'ac-cm-t' }, c.text));
}

function dayDots(days) {
  return h('span', { class: 'ac-dots', role: 'img', 'aria-label': days.map((d, i) => `${LETTERS[i]} ${DAY_WORD[d.state] ?? d.state}`).join(', ') },
    days.map((d, i) => h('span', { class: `ac-dot s-${d.state}`, title: `${fmtDay(d.date)}: ${DAY_WORD[d.state] ?? d.state}` }, LETTERS[i])));
}

function streakChip(n, { big = false } = {}) {
  return h('span', { class: `ac-streak${n >= 7 ? ' hot' : ''}${big ? ' big' : ''}`, 'aria-label': `${plural(n, 'day')} streak` }, icon('local_fire_department', big ? 20 : 15, { filled: n >= 7 }), h('span', { class: 't-num' }, String(n)));
}

const weekLabel = week => `${fmtShort(week)} – ${fmtShort(addDays(week, 6))}`;

// MARK: - Nudge and celebrate

/**
 * The bulk composer: who it goes to, quick picks (templates of the category, or
 * suggestions), the message (one composer, so send guards run) and each
 * person's rendered preview. Sending goes through the outreach governor.
 */
export function nudgeSheet(people, { kind = 'nudge', onSent = null } = {}) {
  const celebrate = kind === 'celebrate';
  slideOver(celebrate ? `Celebrate ${people.length === 1 ? firstName(people[0].name) : plural(people.length, 'person', 'people')}` : `Nudge ${people.length === 1 ? firstName(people[0].name) : plural(people.length, 'person', 'people')}`, (body, close) => {
    const previews = h('ul', { class: 'ac-previews', 'aria-live': 'polite' });
    const picks = h('div', { class: 'ac-picks' });
    let seq = 0, timer = null;
    const ids = people.map(p => p.id);
    const drawPreview = async text => {
      const mine = ++seq;
      if (!text.trim()) { previews.replaceChildren(h('li', { class: 'muted small' }, 'Write a message, or pick one above. Each person sees it with their own name.')); return; }
      try {
        const out = await api('POST', '/api/accountability/preview', { clientIds: ids, text });
        if (mine !== seq) return;
        previews.replaceChildren(...out.previews.map(p => h('li', { class: 'ac-preview' }, avatar(p.name, 28),
          h('div', { class: 'grow' }, h('div', { class: 'ac-preview-name' }, p.name, p.missing.length ? h('span', { class: 'ac-warn' }, icon('warning', 14), `Unknown {${p.missing[0]}}`) : null),
            h('div', { class: 'ac-preview-text' }, p.text)))));
      } catch (err) { if (mine === seq) previews.replaceChildren(h('li', { class: 'error' }, err.message)); }
    };
    const c = composer({
      placeholder: celebrate ? 'Say well done… {first} and {streak} fill in per person' : 'A short nudge… {first} and {streak} fill in per person',
      draftKey: `accountability.${kind}`, label: 'Message',
      onSend: async ({ text }) => {
        const out = await api('POST', '/api/accountability/nudge', { clientIds: ids, text, kind });
        const bits = [out.sent ? `Sent ${out.sent}` : null, out.deferred ? `${out.deferred} held for the morning` : null,
          out.skipped.length ? `${out.skipped.length} skipped (${out.skipped[0].reason})` : null].filter(Boolean);
        toast(bits.join(' · ') || 'Nothing sent');
        onSent?.();
        close();
      },
    });
    const ta = c.el.querySelector('textarea');
    ta?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => drawPreview(c.getText()), 220); });
    const pick = text => { c.setText(text); c.focus(); drawPreview(text); };
    const drawPicks = list => fill(picks, list.slice(0, 5).map(t => h('button', { type: 'button', class: 'ac-pick', onclick: () => pick(t.body) }, h('b', null, t.name), h('span', null, t.body))));
    drawPicks(SUGGEST[kind].map((b, i) => ({ name: `Suggestion ${i + 1}`, body: b })));
    hasFeature('templates').then(on => (on ? foundationApi('GET', '/api/templates') : null)).then(out => {
      const mine = (out?.templates ?? []).filter(t => t.category === kind);
      if (mine.length) drawPicks([...mine.map(t => ({ name: t.name, body: t.body })), ...SUGGEST[kind].map((b, i) => ({ name: `Suggestion ${i + 1}`, body: b }))]);
    }).catch(() => {});
    body.append(
      h('div', { class: 'ac-to' }, h('span', { class: 'muted small' }, 'To'), h('div', { class: 'ac-to-list' }, people.map(p => h('span', { class: 'ac-to-chip' }, avatar(p.initials || p.name, 20), p.name)))),
      h('h3', { class: 'ac-sub' }, 'Quick picks'), picks,
      h('h3', { class: 'ac-sub' }, 'Message'), c.el,
      h('p', { class: 'muted small ac-govern' }, icon('schedule', 14), 'Sent as an automated nudge: quiet hours and the daily cap apply, and anyone with outreach paused is skipped.'),
      h('h3', { class: 'ac-sub' }, 'What each person gets'), previews);
    if (c.getText()) drawPreview(c.getText()); else drawPreview('');
    requestAnimationFrame(() => c.focus());
  }, { wide: true });
}

// MARK: - One person's weeks (slide-over)

function personPanel(row, week, reload) {
  const c = row.client;
  slideOver(c.name, (body, close) => {
    body.append(skeleton('chart'));
    api('GET', `/api/coach/clients/${enc(c.id)}/accountability?weeks=12`).then(d => {
      const cur = d.current;
      fill(body,
        h('div', { class: 'ac-p-head' }, scoreRing(row.score, { size: 72, label: 'Accountability' }),
          h('div', { class: 'grow' }, h('div', { class: 'ac-p-name' }, c.name), h('div', { class: 'muted small' }, `Week of ${weekLabel(week)}`),
            h('div', { class: 'ac-p-chips' }, streakChip(d.streak), row.flags.includes('noCommitments') ? h('span', { class: 'pill' }, icon('flag', 14), 'No commitments') : null))),
        h('h3', { class: 'ac-sub' }, 'How the score is made'),
        h('div', { class: 'ac-parts' }, PARTS.map(([k, label, w]) => {
          const v = row.parts[k];
          return h('div', { class: 'ac-part' }, h('div', { class: 'ac-part-top' }, h('span', null, label), h('span', { class: 'muted small' }, `${Math.round(w * 100)}%`), h('b', { class: 't-num' }, `${Math.round(v * 100)}`)),
            h('div', { class: 'ac-bar' }, h('div', { class: `ac-bar-fill ${v >= 0.8 ? 'bg-ok' : v >= 0.5 ? 'bg-accent' : 'bg-urgent'}`, style: { '--w': `${Math.round(v * 100)}%` } })));
        })),
        h('h3', { class: 'ac-sub' }, 'Twelve weeks'),
        d.weeks.length > 1 ? h('div', { class: 'ac-p-chart' }, lineChart({ series: [{ label: 'Score', tone: 1, points: d.weeks.map(w => ({ x: w.week, y: w.score })) }], area: true, height: 170, ariaLabel: `${c.name}: accountability score by week`, xFormat: x => fmtShort(x), goal: { value: 80, label: 'Strong' } }))
          : h('p', { class: 'muted small' }, 'A trend appears after their second week.'),
        h('h3', { class: 'ac-sub' }, 'This week'),
        h('ul', { class: 'ac-cm-list' }, cur.commitments.length ? cur.commitments.map(x => h('li', null, outcomeChip(x))) : h('li', { class: 'muted small' }, 'No commitments set this week.')),
        h('div', { class: 'ac-p-row' }, dayDots(cur.days), h('span', { class: 'muted small' }, `${cur.workouts.done} of ${cur.workouts.planned} workouts · check-in ${cur.checkin ? 'sent' : cur.checkinDue ? 'missing' : 'due Friday'}`)),
        d.nudges.length ? [h('h3', { class: 'ac-sub' }, 'Recent nudges'), h('ul', { class: 'ac-nudges' }, d.nudges.slice(0, 5).map(n => h('li', null, icon(n.kind === 'celebrate' ? 'celebration' : 'front_hand', 16), n.kind === 'celebrate' ? 'Celebrated' : 'Nudged', h('span', { class: 'muted' }, fmtRelative(n.at)))))] : null,
        h('div', { class: 'ac-p-actions' },
          h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); nudgeSheet([c], { kind: 'nudge', onSent: reload }); } }, icon('front_hand', 18), 'Nudge'),
          h('button', { type: 'button', class: 'btn', onclick: () => { close(); nudgeSheet([c], { kind: 'celebrate', onSent: reload }); } }, icon('celebration', 18), 'Celebrate'),
          link(`/clients/${enc(c.id)}`, { class: 'btn text', onclick: () => close() }, 'Open client', icon('chevron_right', 16))));
    }).catch(err => fill(body, h('p', { class: 'error' }, err.message)));
  }, { wide: true });
}

// MARK: - The board

route('/accountability', async (el, _params, view) => {
  setCrumbs([{ label: 'Clients' }, { label: 'Accountability', path: '/accountability' }]);
  const thisWeek = mondayOf(todayLondon());
  let week = view.query.get('week') && /^\d{4}-\d\d-\d\d$/.test(view.query.get('week')) ? mondayOf(view.query.get('week')) : thisWeek;
  if (week > thisWeek) week = thisWeek;
  let filter = 'all';
  let data = null;
  const sub = h('span');
  const weekText = h('span', { class: 'ac-week-text' });
  const prev = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Previous week', onclick: () => go(-7) }, icon('chevron_left', 18));
  const next = h('button', { type: 'button', class: 'ui-icon-btn', 'aria-label': 'Next week', onclick: () => go(7) }, icon('chevron_right', 18));
  const nowBtn = h('button', { type: 'button', class: 'btn small', onclick: () => { week = thisWeek; load(); } }, 'This week');
  const picker = h('div', { class: 'ac-picker', role: 'group', 'aria-label': 'Week' }, prev, weekText, next);
  el.append(pageHead({ eyebrow: 'Clients', title: 'Who kept their', accent: 'word', sub, actions: [picker, nowBtn] }));
  const stats = h('div', { class: 'ac-stats' });
  const streaks = h('section', { class: 'ac-streaks', 'aria-label': 'Streaks this week' });
  const filterBox = h('div', { class: 'ac-filters' });
  const tableBox = h('div', { class: 'ac-table' }, skeleton('table', { rows: 6 }));
  el.append(stats, streaks, filterBox, tableBox);

  function go(d) {
    const n = addDays(week, d);
    if (n > thisWeek) return;
    week = n;
    load();
  }

  function drawStats(s) {
    const cell = (label, value, detail, { ic, tone = null } = {}) => {
      const num = h('span', { class: 'ac-stat-v t-number' }, '–');
      const out = h('div', { class: 'ac-stat' }, h('div', { class: 'ac-stat-k' }, ic ? icon(ic, 16) : null, label), h('div', { class: 'ac-stat-row' }, num, detail ? h('span', { class: `ac-stat-d${tone ? ` tone-${tone}` : ''}` }, detail) : null));
      if (value === null || value === undefined) num.textContent = '–';
      else if (typeof value === 'number') countUp(num, value, { format: v => (Number.isInteger(value) ? String(Math.round(v)) : (Math.round(v * 2) / 2).toLocaleString('en-GB')) });
      else num.textContent = value;
      return out;
    };
    const met = pct(s.daysMet, s.daysElapsed);
    fill(stats,
      h('div', { class: 'ac-stat hero' }, scoreRing(s.avgScore, { size: 76, label: 'Average score' }),
        h('div', null, h('div', { class: 'ac-stat-k' }, 'Average score'), h('div', { class: 'ac-hero-line' }, `${plural(s.clients, 'client')} this week`))),
      cell('Commitments kept', s.commitmentsSet ? s.commitmentsKept : null, s.commitmentsSet ? `of ${s.commitmentsSet}${s.commitmentsOpen ? ` · ${s.commitmentsOpen} open` : ''}` : 'none set', { ic: 'handshake' }),
      cell('Day minimums met', met === null ? null : met, met === null ? 'nothing yet' : `% of ${plural(s.daysElapsed, 'day')}`, { ic: 'checklist' }),
      cell('Check-ins in', s.checkins, s.checkinsDue ? `of ${s.checkinsDue} due` : 'due Friday', { ic: 'how_to_reg' }),
      cell('Best streak', s.bestStreak, 'days', { ic: 'local_fire_department', tone: s.bestStreak >= 7 ? 'accent' : null }),
      cell('Nudges sent', s.nudges, 'this week', { ic: 'front_hand' }));
  }

  function drawStreaks(list) {
    if (!list.length) { streaks.replaceChildren(); return; }
    fill(streaks, h('div', { class: 'ac-streaks-head' }, h('h2', { class: 'ac-h2' }, icon('local_fire_department', 20, { filled: true }), 'Streaks this week'), h('span', { class: 'muted small' }, 'Milestones at 7, 14, 30, 60 and 100 days')),
      h('div', { class: 'ac-streak-cards' }, list.map(m => h('article', { class: `ac-ms${m.streak >= 30 ? ' gold' : ''}` },
        h('div', { class: 'ac-ms-n' }, h('span', { class: 't-num' }, String(m.streak)), h('span', null, 'days')),
        h('div', { class: 'ac-ms-who' }, avatar(m.client.initials, 30), h('div', null, h('div', { class: 'ac-ms-name' }, m.client.name), h('div', { class: 'muted small' }, m.reachedOn === todayLondon() ? 'Reached today' : `Reached ${fmtDay(m.reachedOn)}`))),
        m.celebratedAt ? h('span', { class: 'ac-ms-done' }, icon('done_all', 16), 'Congratulated')
          : h('button', { type: 'button', class: 'btn small', onclick: () => nudgeSheet([m.client], { kind: 'celebrate', onSent: load }) }, icon('celebration', 16), 'Send congrats')))));
  }

  function drawTable(rows) {
    const columns = [
      { key: 'name', label: 'Client', sort: true, render: r => h('span', { class: 'ac-who' }, avatar(r.client.initials, 30), h('span', null, h('span', { class: 'ac-who-n' }, r.client.name), r.flags.includes('atRisk') ? h('span', { class: 'ac-flag tone-attention' }, icon('alarm', 13), 'Streak at risk') : null)) },
      { key: 'score', label: 'Score', sort: true, align: 'center', render: r => scoreRing(r.score, { size: 40, label: `${r.client.name}: score` }) },
      { key: 'cms', label: 'Commitments', render: r => (r.commitments.length ? h('span', { class: 'ac-cms' }, r.commitments.map(outcomeChip)) : h('span', { class: 'ac-none' }, icon('flag', 14), 'None set')) },
      { key: 'days', label: 'Day minimum', render: r => dayDots(r.days) },
      { key: 'training', label: 'Training', align: 'center', sort: r => (r.workouts.planned ? r.workouts.done / r.workouts.planned : 1), render: r => h('span', { class: 't-num ac-train' }, h('b', null, String(r.workouts.done)), `/${r.workouts.planned}`) },
      { key: 'checkin', label: 'Check-in', align: 'center', sort: r => (r.checkin ? 1 : 0), render: r => (r.checkin ? h('span', { class: 'ac-ci tone-ok', title: 'Check-in sent' }, icon('check_circle', 18), h('span', { class: 'ui-sr' }, 'Yes'))
        : h('span', { class: `ac-ci ${r.checkinDue ? 'tone-urgent' : 'muted'}`, title: r.checkinDue ? 'Missing' : 'Due Friday' }, icon(r.checkinDue ? 'close' : 'hourglass_empty', 18), h('span', { class: 'ui-sr' }, r.checkinDue ? 'Missing' : 'Not due yet'))) },
      { key: 'streak', label: 'Streak', sort: true, align: 'center', render: r => streakChip(r.streak) },
      { key: 'trend', label: '8 weeks', render: r => h('span', { class: 'ac-spark' }, sparkline(r.trend, { width: 76, height: 26, label: `${r.client.name}: last 8 weeks ${r.trend.filter(v => v !== null).join(', ')}` })) },
      { key: 'act', label: '', align: 'right', render: r => h('span', { class: 'ac-act' },
        h('button', { type: 'button', class: 'ac-nudge' + (r.lastNudgeAt ? ' was' : ''), 'aria-label': `Nudge ${r.client.name}${r.lastNudgeAt ? `, last nudged ${fmtRelative(r.lastNudgeAt)}` : ''}`,
          title: r.lastNudgeAt ? `Nudge · last ${fmtRelative(r.lastNudgeAt)}` : 'Nudge', onclick: () => nudgeSheet([r.client], { onSent: load }) }, icon('front_hand', 18))) },
    ];
    const t = dataTable({
      columns, rows: rows.map(r => ({ ...r, id: r.client.id, name: r.client.name })), selectable: true, label: 'Accountability', initialSort: { key: 'score', dir: 1 },
      onRow: r => personPanel(r, week, load),
      empty: filter === 'all' ? 'No clients this week.' : 'Nobody here this week.',
      bulkActions: [
        { label: 'Nudge', icon: 'front_hand', run: sel => nudgeSheet(sel.map(r => r.client), { kind: 'nudge', onSent: load }) },
        { label: 'Celebrate', icon: 'celebration', run: sel => nudgeSheet(sel.map(r => r.client), { kind: 'celebrate', onSent: load }) },
      ],
    });
    tableBox.replaceChildren(t.el);
  }

  function draw() {
    const s = data.summary;
    fill(weekText, data.current ? 'This week' : weekLabel(week), h('span', { class: 'muted' }, data.current ? ` · ${weekLabel(week)}` : ''));
    next.disabled = data.current;
    nowBtn.hidden = data.current;
    fill(sub, data.current ? `Live · ${plural(data.counts.missed, 'person', 'people')} missed something · ${plural(data.counts.noCommitments, 'person', 'people')} with no commitments` : `Week of ${weekLabel(week)} · closed`);
    drawStats(s);
    drawStreaks(data.milestones);
    fill(filterBox, segmentedNav(FILTERS.map(([id, label]) => ({ id, label: data.counts[id] ? `${label} · ${data.counts[id]}` : label })), filter, v => { filter = v; load(); }, { label: 'Show' }),
      h('span', { class: 'muted small' }, 'Select people to nudge or celebrate them together.'));
    if (!data.summary.clients) { tableBox.replaceChildren(emptyHero({ icon: 'checklist', title: 'Nobody to hold to account yet.', line: 'Clients appear here from their first week.' })); return; }
    drawTable(data.rows);
  }

  let loading = 0;
  async function load() {
    const mine = ++loading;
    setHashQuery({ week: week === thisWeek ? null : week });
    try {
      const d = await api('GET', `/api/accountability?week=${week}&filter=${filter}`);
      if (mine !== loading || !view.fresh()) return;
      data = d;
      draw();
    } catch (err) { if (view.fresh()) tableBox.replaceChildren(h('p', { class: 'error' }, err.message)); }
  }
  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(load, 400); };
  const offs = ['commitment.reviewed', 'checkin.submitted', 'workout.completed', 'accountability.nudged', 'accountability.milestone'].map(type => live.on(type, soon));
  view.onLeave(() => { offs.forEach(off => off()); clearTimeout(t); });
  await load();
  // From a Needs-you "Celebrate" (or a streak notification): open the composer for that person.
  const who = view.query.get('celebrate');
  if (who && view.fresh()) {
    const r = data?.rows.find(x => x.client.id === who);
    const c = r?.client ?? clientById(who);
    if (c) nudgeSheet([c], { kind: 'celebrate', onSent: load });
    setHashQuery({ celebrate: null });
  }
}, { nav: 'accountability' });

// MARK: - Registrations

registerNav({ id: 'accountability', label: 'Accountability', icon: 'checklist', group: 'clients', order: 60 });

registerWidget({
  id: 'accountability', title: 'Accountability', icon: 'checklist', size: 'm', order: 75,
  async render(box, view) {
    const d = await api('GET', '/api/accountability');
    if (!view.fresh()) return;
    const low = [...d.rows].sort((a, b) => a.score - b.score).slice(0, 3);
    fill(box,
      h('div', { class: 'ac-w-top' }, scoreRing(d.summary.avgScore, { size: 64, label: 'Average score' }),
        h('div', { class: 'ac-w-k' }, h('div', null, h('b', null, String(d.counts.missed)), ' missed something'), h('div', null, h('b', null, String(d.counts.noCommitments)), ' no commitments'),
          d.milestones.length ? h('div', { class: 'tone-accent ac-w-fire' }, icon('local_fire_department', 14, { filled: true }), `${firstName(d.milestones[0].client.name)}: ${d.milestones[0].streak}-day streak`) : null)),
      low.length ? h('ul', { class: 'ac-w-list' }, low.map(r => h('li', null, avatar(r.client.initials, 24), h('span', { class: 'grow' }, r.client.name), h('span', { class: 't-num muted' }, String(r.score)),
        h('button', { type: 'button', class: 'btn small', onclick: () => nudgeSheet([r.client]) }, 'Nudge')))) : null,
      link('/accountability', { class: 'tk-w-more ac-w-more' }, 'The board', icon('chevron_right', 16)));
  },
});

