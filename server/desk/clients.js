import { route, screenHeader, h } from './core.js';
// Placeholder: filled in by the clients slice.
route('/clients', el => { el.append(screenHeader(null, 'Clients'), h('p', { class: 'muted' }, 'Coming soon.')); });
