import { route, screenHeader, h } from './core.js';
// Placeholder: filled in by the today slice.
route('/today', el => { el.append(screenHeader(null, 'Today'), h('p', { class: 'muted' }, 'Coming soon.')); });
