import { route, screenHeader, h } from './core.js';
// Placeholder: filled in by the messages slice.
route('/messages', el => { el.append(screenHeader(null, 'Messages'), h('p', { class: 'muted' }, 'Coming soon.')); });
