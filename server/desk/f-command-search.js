/*
 * Command (WP1, F2): the palette's local client scorer and its result rows.
 *
 * clientScore(client, query) = subsequence match + word-start bonus + recency
 * bonus. "sam inv" still finds Sam (the trailing words are for the actions:
 * "Invoice · Sam Carter"), at a lower score than a full match.
 */
import { fmtRelative, h, icon, registerSearchRenderer } from './core.js';
import { setClientScorer } from './palette.js';

const RECENT_KEY = 'jk.desk.palette.recent'; // palette.js keeps the last five picks here
const recentClients = () => {
  try { return new Set((JSON.parse(localStorage.getItem(RECENT_KEY)) || []).map(r => r.key).filter(k => k?.startsWith('client:')).map(k => k.slice(7))); } catch { return new Set(); }
};

/** 0 (no match) … ~3: how well `q` matches `text` as a subsequence, favouring word starts and runs. */
export function subsequenceScore(text, q) {
  const t = String(text || '').toLowerCase(), s = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return 1;
  if (t === s) return 3;
  if (t.startsWith(s)) return 2.6;
  if (t.split(/[\s-]+/).some(w => w.startsWith(s))) return 2.2;
  if (t.includes(s)) return 1.6;
  let i = 0, score = 0, run = 0, last = -2;
  for (let j = 0; j < t.length && i < s.length; j++) {
    if (s[i] === ' ') { i++; j--; continue; }
    if (t[j] !== s[i]) continue;
    const wordStart = j === 0 || t[j - 1] === ' ' || t[j - 1] === '-';
    run = j === last + 1 ? run + 1 : 0;
    score += 0.1 + (wordStart ? 0.25 : 0) + run * 0.05;
    last = j;
    i++;
  }
  return i === s.length ? Math.min(1.5, 0.3 + score / s.length) : 0;
}

let recent = null, recentAt = 0;
/** The scorer the palette uses for its Clients group. */
export function clientScore(client, q) {
  if (Date.now() - recentAt > 2000) { recent = recentClients(); recentAt = Date.now(); }
  const words = String(q || '').trim().split(/\s+/).filter(Boolean);
  let best = 0;
  // The whole query, then fewer words from the front ("sam inv" → "sam").
  for (let n = words.length; n >= 1 && !best; n--) {
    const part = words.slice(0, n).join(' ');
    const s = Math.max(subsequenceScore(client.name, part), subsequenceScore(client.email, part) * 0.7);
    if (s) best = s * (n === words.length ? 1 : 0.75);
  }
  if (!best) return 0;
  return best + (recent.has(client.id) ? 0.4 : 0);
}
setClientScorer(clientScore);

// MARK: - Result rows (Results group)

const TYPE_LABEL = {
  client: 'Client', message: 'Message', program: 'Program', form: 'Form', checkin: 'Check-in', invoice: 'Invoice', lead: 'Lead',
  campaign: 'Campaign', task: 'Task', note: 'Note', diary: 'Diary', transcript: 'Transcript', guide: 'Guide', template: 'Template',
  automation: 'Automation', broadcast: 'Broadcast', segment: 'Segment', testimonial: 'Testimonial',
};
function resultRow(r) {
  return [
    h('span', { class: 'pal-icon' }, icon(r.icon || 'search', 18)),
    h('span', { class: 'pal-label' }, r.title, r.detail ? h('span', { class: 'pal-detail' }, r.detail) : null),
    h('span', { class: 'cmd-pal-meta' }, h('span', { class: 'cmd-pal-type' }, TYPE_LABEL[r.type] || r.type), r.at ? h('span', { class: 'cmd-pal-age' }, fmtRelative(r.at)) : null),
  ];
}
// palette.js puts a custom row's nodes inside its own option element.
const asFragment = r => { const f = document.createDocumentFragment(); f.append(...resultRow(r)); return f; };
for (const type of Object.keys(TYPE_LABEL)) registerSearchRenderer(type, asFragment);
