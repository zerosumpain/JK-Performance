import { route, screenHeader, h } from './core.js';
// Placeholder: filled in by the programs slice.
route('/programs', el => { el.append(screenHeader(null, 'Programs'), h('p', { class: 'muted' }, 'Coming soon.')); });
