# WP1: Command (F1 Command Centre, F2 palette and search, F3 default notifications, F4 Inbox)

Server: `server/features/command.mjs` (feature `command`, namespaces `inbox`, `command`). Desk: `server/desk/today.js` + `today.css`
(the Today screen), `f-command.js` (registrations), `f-command-core.js` (shared loads, the brief, London time), `f-command-widgets.js`
(the five tiles), `f-command-inbox.js` (`/inbox`), `f-command-search.js` (palette scorer and result rows), `f-command.css`.
Tests: `server/test/command.test.mjs`. Every endpoint is coach-only (`requireCoach`: a client gets 403) and reads only the coach's
**current** clients (a reassigned client's rows drop out at once).

## Endpoints

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/command/summary` | `?at=` (tests only) | `{needs, urgent, sessionsToday, sessionsDone, inbox, lettersDue, duePence}`; `needs`, `sessionsToday`, `lettersDue` are exactly the needs-you numbers; `duePence` is the sum of positive `billing.balance` facts, `null` while no feature declares that fact |
| GET | `/api/command/activity` | `?before=<seq or ISO>&limit=30 (≤100)` | `{items:[{seq, key, type, at, summary, label, icon, tone, client:{id,name,initials}\|null, path, history}], next}`; `next` is the cursor for the following page (`null` at the end) |
| POST | `/api/command/brief` | – | `{bullets:[5 strings], provider, model, at, title}`; `title` is `"[Stub] Brief"` for the stub. 429 over 12 a minute; AI errors keep their status (`AI limit reached for today`, …) |
| GET | `/api/command/notify-settings` | – | `{kinds:[{kind, label, detail, urgent, on}], pushUrgent, quietHours:{start,end}\|null}` |
| PUT | `/api/command/notify-settings` | `{kinds?:{kind: bool}, pushUrgent?: bool, quietHours?: {start, end} \| null}` | same as GET; 400 for an unknown kind or a bad time |
| GET | `/api/inbox` | `?filter=all\|<kind>\|snoozed\|done&limit=50 (≤200)` (`?at=` in tests) | `{items:[Item], counts:{all, message, voice, form, checkin, flag, draft, lead, waitlist, snoozed, done, …}}` |
| POST | `/api/inbox/state` | `{keys:[1–500], status:'done'\|'snoozed'\|'open', until?}` | `{ok}`. `until` (ISO, in the future) is required for `snoozed`. Every key must be an item this coach can see now: one unknown or foreign key is a 404 and writes nothing. `open` deletes the state. Emits `inbox.done` per key marked done |

```jsonc
// Inbox Item
{"key":"flag:checkin:c_…","kind":"flag","clientId":"u_…","client":{"id","name","initials"},"title":"Pain in a weekly check-in",
 "preview":"Sore: lower back · …","at":"…","icon":"healing","tone":"urgent","path":"/clients/u_…/checkins",
 "ref":{"type":"checkin","id":"c_…","week":"2026-11-16"},"actions":[{"id":"review","label":"Mark reviewed","method":"POST","url":"/api/checkins/c_…/review","body":{"reply":""}}],
 "source":"core","status":"open","snoozeUntil":null}
```

Open items sort urgent first, then newest. Snoozed sort by wake time, done by when they were done.

## The Inbox (F4)

Core providers (keys):

| Kind | Key | When |
|---|---|---|
| `message` / `voice` | `thread:<clientId>:<newest client message id>` | unread client messages (`voice` when the newest is a voice note) |
| `checkin` | `checkin:<id>` | a check-in not yet reviewed |
| `form` | `form:<requestId>` | submitted answers not yet reviewed |
| `flag` | `flag:thread:…`, `flag:checkin:<id>`, `flag:form:<id>` | the same three, when they carry pain: urgent words in an unread message (the needs-you word list), a sore area in a check-in, a "yes" on a flagged form question. A flag **replaces** the plain item, so nothing shows twice |

Feature providers (`inbox(db, coach, {now})` hook) follow the spec's shape. The aggregator drops an item whose `clientId` is not one of
this coach's clients, keeps at most 4 actions whose `url` starts with `/api/`, keeps the first item for a key seen twice, and logs and
skips a provider that throws. A new message gives a thread a new key, so a thread marked done comes back. Clock `inbox.prune` (6 h)
deletes state rows over 60 days old whose item is gone (a done row whose item still exists stays: it is what hides it).

## Events

| Event | Payload | aiDerived |
|---|---|---|
| `inbox.done` | `{key, kind}` (summary "Done: <title>") | no |

Consumed: `*` is read for the activity feed (not as a handler); handlers on `client.joined`, `booking.cancelled`, `form.submitted`, `checkin.submitted` (F3).

## Default notifications (F3)

Each is switched by coach prefs `notify.prefs = {kind: bool}` (default on) and only fires for the coach's current client:

| Event | Kind | Notification | Tone | Dedupe |
|---|---|---|---|---|
| `client.joined` | `newClient` | "New client: Ella Hughes" | ok | `joined:<client>` |
| `booking.cancelled`, `byRole=client` | `cancellation` | "Sam cancelled Tue 24 Nov 07:00 (late)" | attention when late, else data | `cancel:<booking>:<client>` |
| `form.submitted`, `flagged>0` | `healthFlag` | "Health flag on PAR-Q: Priya" | urgent | `formflag:<request>` |
| `checkin.submitted`, `pain` | `pain` | "Pain reported in check-in: Tom" (body: the sore areas) | urgent | `pain:<checkin>` |

Urgent ones push to the coach's phone through `notifyCoach` (prefs `notify.push.urgent`, `notify.quietHours`), set in Settings › Notifications.

## Facts, actions, variables

None.

## Hooks

- `search`: check-in notes, wins and struggles (`type:'checkin'`, path `/clients/<id>/checkins`, score ×0.75), LIKE-escaped, coach-scoped.
- `badges`: `{inbox: <open Inbox items>}`.
- `exportFor`: `features.command.inboxState` — for a client, the coach's done/snoozed rows about them (`key, status, snoozeUntil, updatedAt`); for a coach, their own rows (with `clientId`). Rows cascade on erasure (FK on `client_id` and `coach_id`).

## Table

`inbox_state` exactly as the spec (F4), plus index `inbox_state_client(client_id)`.

## Desk

- Nav: `today` (refined, mobile slot 10), `inbox` (`/inbox`, group command, order 20, mobile slot 20, badge, `badgeOn` message/check-in/form/inbox events,
  tabs Messages, Flags, Check-ins, Forms, Snoozed, Done for the palette's Jump to).
- Widgets (all via `registerWidget`): `needs` (l, tall, hero, order 10), `inbox` (s, 20), `letters` (s, 30), `today-sessions` (l, 40), `activity` (full, 900).
  Registrations may carry `hero`, `eyebrow` and `action: {label, path}`, which Today passes to `tile()`.
- Commands: `go-<navId>` for every nav item (kept in step through `onRegistryChange`; `g t`, `g i`, … as the keyboard map), `inbox-all-done`
  ("Mark all inbox done", with Undo), `brief-me`.
- Settings section `notifications` (order 30): a switch per kind, urgent push, quiet hours.
- Palette: `setClientScorer` (subsequence + word-start + run bonus, +0.4 for a recent pick; "sam inv" still finds Sam at ¾ score so the client actions
  show) and `registerSearchRenderer` rows (type chip and age) for the built-in and spec'd result types.
- Today: `widgetGrid(view, {all, editable})` is still exported (the kit harness uses it). Customise saves `desk.today.layout` (`[{id,size,hidden}]`);
  Reset clears it. Widgets with `defaultOn:false` start hidden; tiles the saved layout does not know keep their default place.
- Inbox keys: `j`/`k` (or arrows) move and preview, Enter opens, `e` done (or reopen on Snoozed/Done), `s` snooze (Later today, Tomorrow 07:00,
  Next Monday 07:00, Pick a date), `r` reply, `x` select (bulk bar: Mark done, Snooze). Moving through threads only previews them: opening a
  thread marks its messages read, which takes it out of the Inbox.

## Demo

`demo.build` (no events, no notify calls) makes Today busy on any day: three unread threads from yesterday evening (Alex, Tom, Rory; Rory's
snoozed until tomorrow 07:00), Leo's and Alex's latest check-ins back to unreviewed (Leo's has lower-back pain: a flag), Alex's and Priya's
latest weekly letters back to drafts (letters due), Tom's answered Monthly review, up to four more sessions today at times that do not
clash (Sam 06:30, Alex 12:15 planning, Strength Club 17:30 with four clients, Rory 19:15 review), Alex's cancelled session two days ago,
and three bell notifications (Leo's pain unread, Alex's cancellation unread, Tom joining read). It wipes its own `inbox_state` rows.

## Deviations from the spec

1. **Activity history.** The feed is the coach's events, then, older than the coach's first event, **history** rows built from the domain tables
   (messages, completed workouts, check-ins, form answers, published letters, joins; last 30 days; summaries only, never bodies; `seq: null`,
   `history: true`). Without it the tile is empty on a fresh deploy and in the demo world, whose builder may not emit. `before` takes a seq or an
   ISO instant and the reply carries `next`. The feed reads `events` directly rather than through `eventsFor`, to drop `day.started` and
   `inbox.done` and events about clients the coach no longer has.
2. **Flags replace their plain item** (see the table above) instead of duplicating it.
3. **Default sizes**: `today-sessions` is `l` and `activity` `full` (the spec says `m` and `m`), so WP1's five tiles pack into a gap-free
   12-column grid (6+3+3 / 6+6 / 12) before other packages add theirs. The coach can resize any tile.
4. **Summary extras**: `urgent`, `sessionsDone` and `duePence` (from `billing.balance`, when present) were added, so the greeting line can say
   "£360 due" once WP3 merges without WP3 touching `today.js`.
5. **Notification settings** have their own endpoint (`/api/command/notify-settings`) that validates, over the raw prefs routes.
6. **demo.tables is not used**: the foundation's wipe runs before any feature schema in older tests that build the demo on a bare store
   (`plans.test.mjs` and others), so `DELETE FROM inbox_state` would fail there. The builder creates the table (idempotent) and wipes its own rows.

## Integration requests

1. **WP-Z / WP0-S `demo.mjs`**: let `wipe()` skip a `demo.tables` entry whose table does not exist (or run `runFeatureSchemas` first). Any feature
   that lists tables there breaks `plans.test.mjs`, `par.test.mjs` and `webauth.test.mjs`, which build the demo before `createApp`.
2. **WP0-S `notifications.mjs`**: honour `notify.prefs[kind] === false` inside `notifyCoach`, so every package's kinds are switchable and
   Settings › Notifications can list every kind seen (WP1 lists only its own four today).
3. **WP2**: register `client` actions (`registerClientAction`) so the palette's "Message Sam / Invoice Sam" rows appear; the palette's Clients group
   could show lifecycle stage and health score from facts, which needs a `detail` hook in `palette.js` (WP0-D owns it).
4. **WP3**: nothing needed; the greeting shows "£… due" as soon as the `billing.balance` fact exists.
5. **WP7**: bookings may carry `conflict: true` (or a `calendar.conflict` fact per booking) and the Today sessions tile will badge them; today it badges
   locally overlapping sessions only.
6. **WP6**: the Inbox opens threads with `threadPane(el, clientId, view, {compact:true})` and a sub-view (its `onLeave` runs when another item opens).
   Keep that signature. Voice messages should keep `kind: 'voice'` so the Inbox files them under Voice.

## Parity gaps

- The coach's phone push for urgent notifications is proved with the test recorder only (no APNs/FCM locally).
- The brief is only ever the stub locally (no key); a fake `fetchImpl` test covers the OpenRouter path and the demo coach staying on the stub.

## Design notes

- The greeting uses `--t-display` (44 px Newsreader) on Today only, the hero screen; `--t-display-s` on phones.
- The Needs-you tile is the one `hero` tile (sheen). Urgent rows carry a 3 px urgent bar plus the word "Urgent" and a glyph; the urgent row's
  action is the screen's only primary button in the tile.
- The sessions tile draws the day as a rail (06:00–21:00, widened to fit) with kind colours from `--kind-*` and a champagne "now" needle.
- Inbox rows use `ib-row-<tone>` classes (not the global `tone-*`, which would recolour the whole row).
