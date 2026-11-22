import { route, screenHeader, h } from './core.js';
// Placeholder: filled in by the guides slice.
route('/guides', el => { el.append(screenHeader(null, 'Guides'), h('p', { class: 'muted' }, 'Coming soon.')); });
route('/account', el => { el.append(screenHeader(null, 'Account')); });
