import { route, screenHeader, h } from './core.js';
// Placeholder: filled in by the schedule slice.
route('/schedule', el => { el.append(screenHeader(null, 'Schedule'), h('p', { class: 'muted' }, 'Coming soon.')); });
