/*
 * Charts for the desk (docs/design/desk-v2.md 2.4): hand-written SVG, no
 * library. Every chart takes {height, ariaLabel} and fills its container's
 * width (it redraws when that changes). Each carries <title>/<desc> and a
 * visually hidden data table, shows a crosshair and tooltip on hover, and
 * steps through its points with the arrow keys when focused.
 *
 * Colour never goes through an SVG presentation attribute (fill="var(--x)"
 * does not resolve) or a style attribute (the CSP blocks it): a group gets a
 * class (.ch-tone-1 … 6, .ch-heat-0 … 4) that sets `color`, and the marks
 * draw in currentColor. Sizes set from data go through the CSSOM.
 */
import { h, sparkline } from './core.js';

export { sparkline };

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const toneClass = (tone, i = 0) => `ch-tone-${/^[1-6]$/.test(String(tone ?? '')) ? tone : String(tone ?? '').replace(/^chart-/, '') || (i % 6) + 1}`;
const fmtDefault = v => (v === null || v === undefined ? '–' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: 1 }));
let seq = 0;

/** "Nice" axis steps: 1, 2 or 5 × 10^n. */
function ticks(lo, hi, count = 4) {
  if (lo === hi) { hi = lo + 1; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * mag).find(st => st >= raw) ?? raw;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  const out = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** The visually hidden data table every chart carries. */
function dataTable(caption, head, rows) {
  return h('table', { class: 'ui-sr' }, h('caption', null, caption),
    h('thead', null, h('tr', null, head.map(c => h('th', { scope: 'col' }, c)))),
    h('tbody', null, rows.map(r => h('tr', null, r.map((c, i) => h(i ? 'td' : 'th', i ? null : { scope: 'row' }, c))))));
}

/**
 * The shared frame: a figure that redraws its SVG at the container's width.
 * draw(width) returns the SVG; `table` is [head, rows] for the hidden table.
 */
function frame({ height, ariaLabel, desc = '', table, className, draw, interactive = null }) {
  const id = `ch${++seq}`;
  const tip = h('div', { class: 'ch-tip', role: 'status', hidden: true });
  const holder = h('div', { class: 'ch-svg', style: { height: `${height}px` } });
  const fig = h('figure', { class: `ch ${className}`, 'aria-label': ariaLabel }, holder, tip, table ? dataTable(ariaLabel, ...table) : null);
  let width = 0;
  let api = null;
  const render = () => {
    const w = Math.max(120, Math.round(holder.clientWidth || fig.clientWidth || 480));
    if (w === width && holder.firstChild) return;
    width = w;
    const svg = draw(w);
    svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(height));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-labelledby', `${id}-t ${id}-d`);
    svg.prepend(s('title', { id: `${id}-t` }, ariaLabel), s('desc', { id: `${id}-d` }, desc || ariaLabel));
    holder.replaceChildren(svg);
    api = interactive ? interactive(svg, tip, w) : null;
    requestAnimationFrame(() => fig.classList.add('ch-in'));
  };
  if (interactive) {
    fig.tabIndex = 0;
    fig.addEventListener('keydown', e => api?.key(e));
    fig.addEventListener('blur', () => api?.hide());
  }
  const ro = new ResizeObserver(() => render());
  ro.observe(holder);
  queueMicrotask(render);
  return fig;
}

/** Tooltip placement inside the figure, kept on screen. */
function showTip(tip, svg, x, y, lines) {
  tip.replaceChildren(...lines.map(l => (l instanceof Node ? l : h('div', null, l))));
  tip.hidden = false;
  const w = svg.clientWidth || 300;
  const left = Math.min(Math.max(8, x + 12), w - tip.offsetWidth - 8);
  tip.style.left = `${x + 12 + tip.offsetWidth > w ? Math.max(8, x - tip.offsetWidth - 12) : left}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
}

const xValue = x => (typeof x === 'number' ? x : x instanceof Date ? x.getTime() : Date.parse(x.length === 10 ? `${x}T12:00:00Z` : x));

/**
 * lineChart({series:[{label, tone, points:[{x, y}]}], yFormat, xFormat, area=false, goal, height=200, ariaLabel}).
 * x may be a number, a 'YYYY-MM-DD' day, an instant or a Date.
 */
export function lineChart({ series = [], yFormat = fmtDefault, xFormat = x => String(x), area = false, goal = null, height = 200, ariaLabel = 'Line chart', desc = '' }) {
  const xs = [...new Set(series.flatMap(sr => sr.points.map(p => p.x)))].sort((a, b) => xValue(a) - xValue(b));
  const ys = series.flatMap(sr => sr.points.map(p => p.y)).filter(v => v !== null && v !== undefined);
  if (goal !== null && goal !== undefined) ys.push(typeof goal === 'object' ? goal.value : goal);
  const yt = ticks(Math.min(0, ...ys), Math.max(1, ...ys));
  const lo = yt[0], hi = yt.at(-1);
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const table = [['', ...series.map(sr => sr.label)], xs.map(x => [xFormat(x), ...series.map(sr => yFormat(sr.points.find(p => p.x === x)?.y))])];
  let geo = null;
  return frame({
    height, ariaLabel, desc, table, className: 'ch-line',
    draw(w) {
      const X = i => pad.l + (xs.length < 2 ? (w - pad.l - pad.r) / 2 : (i / (xs.length - 1)) * (w - pad.l - pad.r));
      const Y = v => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (height - pad.t - pad.b);
      geo = { X, Y };
      const grid = s('g', { class: 'ch-grid' }, yt.map(v => [
        s('line', { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v) }),
        s('text', { x: pad.l - 8, y: Y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'ch-label' }, yFormat(v)),
      ]));
      const every = Math.max(1, Math.ceil(xs.length / Math.max(2, Math.floor((w - pad.l) / 90))));
      // The last label is always drawn (end-anchored), so a ticked label closer than `every` steps to it would collide and is dropped.
      const last = xs.length - 1;
      const xl = s('g', null, xs.map((x, i) => (i === last || (i % every === 0 && last - i >= every)) ? s('text', { x: X(i), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle', class: 'ch-label' }, xFormat(x)) : null));
      const lines = series.map((sr, si) => {
        const pts = xs.map((x, i) => [i, sr.points.find(p => p.x === x)?.y]).filter(([, v]) => v !== null && v !== undefined);
        if (!pts.length) return null;
        const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
        return s('g', { class: toneClass(sr.tone, si) },
          area && pts.length > 1 ? s('path', { class: 'ch-area', d: `${d}L${X(pts.at(-1)[0]).toFixed(1)},${Y(lo)}L${X(pts[0][0]).toFixed(1)},${Y(lo)}Z` }) : null,
          s('path', { class: 'ch-stroke', d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: 1 }),
          pts.length === 1 ? s('circle', { cx: X(pts[0][0]), cy: Y(pts[0][1]), r: 3, fill: 'currentColor' }) : null);
      });
      const g = goal === null || goal === undefined ? null : (() => {
        const v = typeof goal === 'object' ? goal.value : goal, label = typeof goal === 'object' ? goal.label : 'Goal';
        return s('g', { class: 'ch-goal' }, s('line', { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v) }), s('text', { x: w - pad.r, y: Y(v) - 5, 'text-anchor': 'end', class: 'ch-label' }, `${label} ${yFormat(v)}`));
      })();
      const cross = s('line', { class: 'ch-cross', x1: 0, x2: 0, y1: pad.t, y2: height - pad.b, visibility: 'hidden' });
      const dots = s('g', { class: 'ch-dots' });
      return s('svg', null, grid, xl, g, lines, cross, dots);
    },
    interactive(svg, tip) {
      let at = -1;
      const cross = svg.querySelector('.ch-cross'), dots = svg.querySelector('.ch-dots');
      const show = i => {
        if (!xs.length) return;
        at = Math.max(0, Math.min(xs.length - 1, i));
        const x = geo.X(at);
        cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
        dots.replaceChildren(...series.map((sr, si) => { const v = sr.points.find(p => p.x === xs[at])?.y; return v === null || v === undefined ? null : s('circle', { class: toneClass(sr.tone, si), cx: x, cy: geo.Y(v), r: 4, fill: 'currentColor' }); }).filter(Boolean));
        const top = Math.min(...series.map(sr => sr.points.find(p => p.x === xs[at])?.y).filter(v => v !== null && v !== undefined).map(geo.Y), height);
        showTip(tip, svg, x, top, [h('div', { class: 'ch-tip-x' }, xFormat(xs[at])), ...series.map((sr, si) => h('div', { class: `ch-tip-row ${toneClass(sr.tone, si)}` },
          h('span', { class: 'ch-key' }), h('span', { class: 'grow' }, sr.label), h('b', null, yFormat(sr.points.find(p => p.x === xs[at])?.y))))]);
      };
      const hide = () => { at = -1; cross.setAttribute('visibility', 'hidden'); dots.replaceChildren(); tip.hidden = true; };
      svg.addEventListener('pointermove', e => {
        const r = svg.getBoundingClientRect();
        const px = e.clientX - r.left;
        let best = 0;
        xs.forEach((_, i) => { if (Math.abs(geo.X(i) - px) < Math.abs(geo.X(best) - px)) best = i; });
        show(best);
      });
      svg.addEventListener('pointerleave', hide);
      return {
        hide,
        key(e) {
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(at < 0 ? (e.key === 'ArrowRight' ? 0 : xs.length - 1) : at + (e.key === 'ArrowRight' ? 1 : -1)); }
          else if (e.key === 'Home') { e.preventDefault(); show(0); }
          else if (e.key === 'End') { e.preventDefault(); show(xs.length - 1); }
          else if (e.key === 'Escape') hide();
        },
      };
    },
  });
}

/**
 * barChart({bars:[{label, value, tone}], stacked, yFormat, height=200, ariaLabel}).
 * With `stacked`, a bar is {label, parts:[{label, value, tone}]}.
 */
export function barChart({ bars = [], stacked = false, yFormat = fmtDefault, height = 200, ariaLabel = 'Bar chart', desc = '' }) {
  const totals = bars.map(b => (stacked ? (b.parts || []).reduce((n, p) => n + (p.value || 0), 0) : b.value || 0));
  const yt = ticks(0, Math.max(1, ...totals));
  const hi = yt.at(-1);
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const partLabels = stacked ? [...new Set(bars.flatMap(b => (b.parts || []).map(p => p.label)))] : [];
  const table = stacked
    ? [['', ...partLabels, 'Total'], bars.map((b, i) => [b.label, ...partLabels.map(l => yFormat(b.parts.find(p => p.label === l)?.value ?? 0)), yFormat(totals[i])])]
    : [['', 'Value'], bars.map(b => [b.label, yFormat(b.value)])];
  let geo = null;
  return frame({
    height, ariaLabel, desc, table, className: 'ch-bar',
    draw(w) {
      const n = Math.max(1, bars.length), band = (w - pad.l - pad.r) / n, bw = Math.max(4, Math.min(48, band * 0.62));
      const Y = v => pad.t + (1 - v / hi) * (height - pad.t - pad.b);
      geo = { band, bw, Y };
      const grid = s('g', { class: 'ch-grid' }, yt.map(v => [s('line', { x1: pad.l, x2: w - pad.r, y1: Y(v), y2: Y(v) }),
        s('text', { x: pad.l - 8, y: Y(v), 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'ch-label' }, yFormat(v))]));
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((w - pad.l) / 56))));
      const marks = bars.map((b, i) => {
        const x = pad.l + i * band + (band - bw) / 2;
        let base = 0;
        const rects = (stacked ? b.parts || [] : [b]).map((p, pi) => {
          const y0 = Y(base), y1 = Y(base + (p.value || 0));
          base += p.value || 0;
          return s('rect', { class: `ch-barrect ${toneClass(p.tone ?? (stacked ? pi + 1 : 1), pi)}`, x, y: y1, width: bw, height: Math.max(0, y0 - y1), rx: 3, fill: 'currentColor' });
        });
        return s('g', { 'data-i': i }, rects, i % every === 0 ? s('text', { x: x + bw / 2, y: height - 8, 'text-anchor': 'middle', class: 'ch-label' }, b.label) : null);
      });
      return s('svg', null, grid, marks, s('rect', { class: 'ch-hover', x: 0, y: pad.t, width: 0, height: height - pad.t - pad.b, visibility: 'hidden' }));
    },
    interactive(svg, tip) {
      let at = -1;
      const hover = svg.querySelector('.ch-hover');
      const show = i => {
        if (!bars.length) return;
        at = Math.max(0, Math.min(bars.length - 1, i));
        const x = pad.l + at * geo.band;
        hover.setAttribute('x', x); hover.setAttribute('width', geo.band); hover.setAttribute('visibility', 'visible');
        const b = bars[at];
        showTip(tip, svg, x + geo.band / 2, geo.Y(totals[at]), [h('div', { class: 'ch-tip-x' }, b.label),
          ...(stacked ? b.parts.map((p, pi) => h('div', { class: `ch-tip-row ${toneClass(p.tone ?? pi + 1, pi)}` }, h('span', { class: 'ch-key' }), h('span', { class: 'grow' }, p.label), h('b', null, yFormat(p.value)))) : [h('b', null, yFormat(b.value))])]);
      };
      const hide = () => { at = -1; hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
      svg.addEventListener('pointermove', e => { const r = svg.getBoundingClientRect(); show(Math.floor((e.clientX - r.left - pad.l) / geo.band)); });
      svg.addEventListener('pointerleave', hide);
      return { hide, key(e) { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); show(at < 0 ? 0 : at + d); } else if (e.key === 'Escape') hide(); } };
    },
  });
}

/** donut({parts:[{label, value, tone}], centre: text | {value, label}, size=160, ariaLabel}). */
export function donut({ parts = [], centre = null, size = 160, ariaLabel = 'Donut chart', desc = '', format = fmtDefault }) {
  const total = parts.reduce((n, p) => n + (p.value || 0), 0) || 1;
  const stroke = Math.round(size / 9), r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let acc = 0;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': ariaLabel },
    s('title', null, ariaLabel), desc ? s('desc', null, desc) : null,
    s('circle', { class: 'ch-track', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke }),
    parts.map((p, i) => {
      const len = (p.value || 0) / total * c;
      const gap = parts.length > 1 ? Math.min(2, len / 2) : 0;
      const el = s('circle', { class: `ch-seg ${toneClass(p.tone, i)}`, cx: size / 2, cy: size / 2, r, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke,
        'stroke-dasharray': `${Math.max(0, len - gap).toFixed(2)} ${c.toFixed(2)}`, 'stroke-dashoffset': (-acc).toFixed(2), transform: `rotate(-90 ${size / 2} ${size / 2})` },
      s('title', null, `${p.label}: ${format(p.value)}`));
      acc += len;
      return el;
    }));
  const mid = centre === null ? null : h('div', { class: 'ch-donut-mid' },
    typeof centre === 'object' ? [h('div', { class: 'ch-donut-v' }, centre.value), h('div', { class: 'ch-donut-k' }, centre.label)] : h('div', { class: 'ch-donut-v' }, centre));
  return h('figure', { class: 'ch ch-donut', 'aria-label': ariaLabel },
    h('div', { class: 'ch-donut-ring', style: { width: `${size}px`, height: `${size}px` } }, svg, mid),
    h('ul', { class: 'ch-legend' }, parts.map((p, i) => h('li', { class: toneClass(p.tone, i) }, h('span', { class: 'ch-key' }), h('span', { class: 'grow' }, p.label), h('b', null, format(p.value))))),
    dataTable(ariaLabel, ['', 'Value', 'Share'], parts.map(p => [p.label, format(p.value), `${Math.round((p.value || 0) / total * 100)}%`])));
}

/** Heat class 0–4 for a value against the max. */
const heatOf = (v, max) => (v === null || v === undefined || !max ? 0 : Math.min(4, Math.ceil((v / max) * 4)));

/** heatmap({rows:[label], cols:[label], values[r][c], format, ariaLabel}): cells in --heat-0..4. */
export function heatmap({ rows = [], cols = [], values = [], format = fmtDefault, ariaLabel = 'Heatmap' }) {
  const max = Math.max(0, ...values.flat().filter(v => typeof v === 'number'));
  const grid = h('div', { class: 'ch-heat', role: 'grid', 'aria-label': ariaLabel, style: { '--cols': String(cols.length) } },
    h('span', { class: 'ch-heat-corner' }),
    cols.map(c => h('span', { class: 'ch-heat-col', role: 'columnheader' }, c)),
    rows.map((r, ri) => [h('span', { class: 'ch-heat-row', role: 'rowheader' }, r),
      cols.map((c, ci) => { const v = values[ri]?.[ci]; return h('span', { class: `ch-cell ch-heat-${heatOf(v, max)}`, role: 'gridcell', tabindex: '-1', title: `${r} · ${c}: ${format(v)}`, 'aria-label': `${r}, ${c}: ${format(v)}` }); })]));
  grid.addEventListener('keydown', e => {
    const cells = [...grid.querySelectorAll('.ch-cell')];
    const i = cells.indexOf(document.activeElement);
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols.length, ArrowUp: -cols.length }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = cells[Math.max(0, Math.min(cells.length - 1, (i < 0 ? 0 : i + d)))];
    cells.forEach(x => { x.tabIndex = -1; });
    n.tabIndex = 0; n.focus();
  });
  const first = grid.querySelector('.ch-cell');
  if (first) first.tabIndex = 0;
  return h('figure', { class: 'ch ch-heatmap' }, grid,
    h('div', { class: 'ch-heat-scale', 'aria-hidden': 'true' }, 'Less', [0, 1, 2, 3, 4].map(i => h('span', { class: `ch-cell ch-heat-${i}` })), 'More'),
    dataTable(ariaLabel, ['', ...cols], rows.map((r, ri) => [r, ...cols.map((_, ci) => format(values[ri]?.[ci]))])));
}

/** cohortGrid({cohorts:[{label, size, values:[pct]}], periodLabel}): retention by cohort, shaded like the heatmap. */
export function cohortGrid({ cohorts = [], periodLabel = 'Month', ariaLabel = 'Cohort retention' }) {
  const n = Math.max(0, ...cohorts.map(c => c.values.length));
  const head = ['Cohort', 'Size', ...Array.from({ length: n }, (_, i) => `${periodLabel} ${i}`)];
  return h('figure', { class: 'ch ch-cohort' }, h('div', { class: 'ch-cohort-scroll' }, h('table', { class: 'ch-cohort-table', 'aria-label': ariaLabel },
    h('thead', null, h('tr', null, head.map(x => h('th', { scope: 'col' }, x)))),
    h('tbody', null, cohorts.map(c => h('tr', null, h('th', { scope: 'row' }, c.label), h('td', { class: 't-num' }, String(c.size)),
      Array.from({ length: n }, (_, i) => { const v = c.values[i]; return h('td', { class: v === undefined || v === null ? 'ch-none' : `ch-heat-${heatOf(v, 100)}` }, v === undefined || v === null ? '' : `${Math.round(v)}%`); })))))));
}

/** funnel({stages:[{label, value}], format}): bars narrowing stage by stage, with the step conversion. */
export function funnel({ stages = [], format = fmtDefault, ariaLabel = 'Funnel' }) {
  const top = Math.max(1, stages[0]?.value || 0);
  return h('figure', { class: 'ch ch-funnel', 'aria-label': ariaLabel },
    h('ol', { class: 'ch-funnel-list' }, stages.map((st, i) => h('li', null,
      h('div', { class: 'ch-funnel-text' }, h('span', null, st.label), h('b', { class: 't-num' }, format(st.value)),
        i ? h('span', { class: 'ch-funnel-conv' }, `${stages[i - 1].value ? Math.round(st.value / stages[i - 1].value * 100) : 0}%`) : null),
      h('div', { class: 'ch-funnel-track' }, h('div', { class: `ch-funnel-bar ${toneClass(1)}`, style: { '--w': `${Math.max(2, (st.value / top) * 100)}%` } }))))),
    dataTable(ariaLabel, ['Stage', 'Value'], stages.map(st => [st.label, format(st.value)])));
}

/**
 * gauge(score 0–100, {bands:[{to, tone, label}], label, size=180}): a half ring
 * in segments, a needle at the score and the band word.
 */
export function gauge(score, { bands = [{ to: 45, tone: 'urgent', label: 'At risk' }, { to: 70, tone: 'attention', label: 'Watch' }, { to: 100, tone: 'ok', label: 'Healthy' }], label = 'Score', size = 180 } = {}) {
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  const stroke = Math.round(size / 12), r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const pt = (p, rad = r) => { const a = Math.PI * (1 - p / 100); return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)]; };
  const arc = (a, b) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1.toFixed(1)},${y1.toFixed(1)}A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; };
  let from = 0;
  const band = bands.find(b => v <= b.to) || bands.at(-1);
  const [nx, ny] = pt(v, r - stroke * 1.4);
  const svg = s('svg', { viewBox: `0 0 ${size} ${size / 2 + stroke}`, width: size, height: size / 2 + stroke, role: 'img', 'aria-label': `${label}: ${Math.round(v)}, ${band.label}` },
    s('title', null, `${label}: ${Math.round(v)}, ${band.label}`),
    bands.map(b => { const d = arc(from + 0.8, b.to - 0.8); from = b.to; return s('path', { class: `ch-gauge-seg tone-${b.tone}${b === band ? ' on' : ''}`, d, fill: 'none', stroke: 'currentColor', 'stroke-width': stroke, 'stroke-linecap': 'round' }); }),
    s('line', { class: 'ch-needle', x1: cx, y1: cy, x2: nx.toFixed(1), y2: ny.toFixed(1), stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    s('circle', { class: 'ch-needle', cx, cy, r: 4, fill: 'currentColor' }));
  return h('figure', { class: 'ch ch-gauge' }, svg, h('div', { class: 'ch-gauge-v t-num' }, String(Math.round(v))), h('div', { class: `ch-gauge-k tone-${band.tone}` }, band.label));
}
