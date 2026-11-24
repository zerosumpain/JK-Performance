/*
 * Command (WP1): registrations. The Today and Inbox nav items, the go-to
 * commands for every nav item, "Mark all inbox done", "Brief me", and
 * Settings › Notifications (F3). The tiles are in f-command-widgets.js, the
 * Inbox screen in f-command-inbox.js and the palette scorer in f-command-search.js.
 */
import {
  api, confirmBox, fill, go, h, icon, onRegistryChange, refreshBadges, registerCommand, registerNav, registerSettingsSection,
  registered, switchRow, toast,
} from './core.js';
import { invalidate, openBrief } from './f-command-core.js';
import { skeleton, timeField } from './ui.js';

registerNav({ id: 'today', label: 'Today', icon: 'space_dashboard', group: 'command', order: 10, mobile: 10 });
registerNav({
  id: 'inbox', label: 'Inbox', icon: 'inbox', group: 'command', order: 20, mobile: 20, path: '/inbox', badge: true,
  badgeOn: ['message.received', 'checkin.submitted', 'form.submitted', 'inbox.done', 'lead.created', 'voice.flagged', 'waitlist.joined'],
  tabs: [['message', 'Messages'], ['flag', 'Flags'], ['checkin', 'Check-ins'], ['form', 'Forms'], ['snoozed', 'Snoozed'], ['done', 'Done']]
    .map(([id, label]) => ({ id, label, path: `/inbox/${id}` })),
});

// MARK: - Commands

const GO_KEYS = { today: 'g t', inbox: 'g i', clients: 'g c', pipeline: 'g p', messages: 'g m', schedule: 'g s', diary: 'g d', billing: 'g b', automations: 'g a', tasks: 'g k' };
const navPath = n => n.path || `/${n.id}`;
/** One "Go to …" command per nav item, kept in step as packages register theirs. */
function syncGoTo() {
  for (const n of registered.nav()) {
    registerCommand({ id: `go-${n.id}`, label: `Go to ${n.label}`, group: 'Go to', icon: n.icon || 'chevron_right', keys: GO_KEYS[n.id] ?? null, run: () => go(navPath(n)) });
  }
}
onRegistryChange(kind => { if (kind === 'nav') syncGoTo(); });
syncGoTo();

registerCommand({
  id: 'brief-me', label: 'Brief me: the morning brief', icon: 'auto_awesome', group: 'Actions',
  run: () => { if (!location.hash.startsWith('#/today')) go('/today'); openBrief(); },
});

/** Mark every open Inbox item done, with Undo. */
export async function markAllDone() {
  const out = await api('GET', '/api/inbox?filter=all&limit=200');
  const keys = out.items.map(i => i.key);
  if (!keys.length) { toast('Inbox zero already.'); return; }
  if (!(await confirmBox(`Mark all ${keys.length} items done?`, { ok: 'Mark done', detail: 'They come back if something new arrives. You can undo this.' }))) return;
  await api('POST', '/api/inbox/state', { keys, status: 'done' });
  invalidate();
  refreshBadges();
  window.dispatchEvent(new CustomEvent('jk:inbox-changed'));
  toast(`${keys.length} ${keys.length === 1 ? 'item' : 'items'} marked done`, {
    undo: async () => {
      await api('POST', '/api/inbox/state', { keys, status: 'open' });
      invalidate();
      refreshBadges();
      window.dispatchEvent(new CustomEvent('jk:inbox-changed'));
    },
  });
}
registerCommand({ id: 'inbox-all-done', label: 'Mark all inbox done', icon: 'done_all', group: 'Actions', run: () => markAllDone().catch(err => toast(err.message, { error: true })) });

// MARK: - Settings › Notifications (F3)

async function notificationsSection(box) {
  const body = h('div', null, skeleton('lines', { rows: 5 }));
  box.append(
    h('h2', { class: 'set-h' }, 'Notifications'),
    h('p', { class: 'small muted' }, 'What rings the bell in the desk. Urgent ones (pain and health flags) can also reach your phone, outside your quiet hours.'),
    body);
  let s;
  try { s = await api('GET', '/api/command/notify-settings'); } catch (err) { fill(body, h('p', { class: 'error' }, err.message)); return; }
  const save = async (patch, input) => {
    try {
      s = await api('PUT', '/api/command/notify-settings', patch);
      toast('Saved');
    } catch (err) {
      if (input) input.checked = !input.checked;
      toast(err.message, { error: true });
    }
  };
  const quiet = s.quietHours || { start: '22:00', end: '06:30' };
  let quietOn = !!s.quietHours;
  const start = timeField({ value: quiet.start, label: 'Quiet from', onChange: v => { quiet.start = v; if (quietOn) save({ quietHours: { ...quiet } }); } });
  const end = timeField({ value: quiet.end, label: 'Quiet until', onChange: v => { quiet.end = v; if (quietOn) save({ quietHours: { ...quiet } }); } });
  const times = h('div', { class: 'cmd-quiet-times', hidden: !quietOn }, h('label', null, 'From', start), h('label', null, 'until', end), h('span', { class: 'tiny faint' }, 'London time'));
  fill(body,
    h('div', { class: 'card flush cmd-set-card' },
      s.kinds.map(k => switchRow(h('span', { class: 'row gap4' }, k.label, k.urgent ? h('span', { class: 'pill cmd-pill-urgent' }, h('span', { class: 'dot bg-urgent', 'aria-hidden': 'true' }), 'Urgent') : null),
        k.on, (on, input) => save({ kinds: { [k.kind]: on } }, input), { detail: k.detail }))),
    h('h3', { class: 'cmd-set-h' }, 'Your phone'),
    h('div', { class: 'card flush cmd-set-card' },
      switchRow('Push urgent notifications to my phone', s.pushUrgent, (on, input) => save({ pushUrgent: on }, input),
        { detail: 'Pain in a check-in, a health flag on a form, and other urgent flags. Everything else stays in the desk.' }),
      switchRow('Quiet hours', quietOn, (on, input) => { quietOn = on; times.hidden = !on; save({ quietHours: on ? { ...quiet } : null }, input); },
        { detail: 'Urgent pushes wait until quiet hours end, and are dropped if you have read them by then.' }),
      times),
    h('p', { class: 'tiny faint row gap4' }, icon('notifications', 14), 'The demo account never pushes.'));
}
registerSettingsSection({ id: 'notifications', label: 'Notifications', icon: 'notifications', order: 30, render: notificationsSection });
