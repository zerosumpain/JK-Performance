# Desk v2 feature modules

Every `*.mjs` file in this folder whose name matches `^[a-z0-9-]+\.mjs$` is a feature module. `server/features.mjs` imports them in
name order at start-up, validates each one and fills `server/registry.mjs`. A mistake stops the server at start-up. The contract is
`docs/design/desk-v2.md` section 3; this file is the quick reference.

## The rules

- Export exactly one `feature` object. Its `name` must equal the file name without `.mjs`.
- Import only `registry.mjs`, the foundation modules (`events.mjs`, `facts.mjs`, `ai.mjs`, `audio.mjs`, `notifications.mjs`, `templating.mjs`,
  `ratelimit.mjs`, `rng.mjs`) and existing server modules. **Never** import `app.mjs`, `main.mjs`, `features.mjs`, `demo.mjs`, `account.mjs` or
  another feature's file (`foundation.test.mjs` scans for it). Reach other features through events, actions, facts, variables and hooks.
- Every coach endpoint calls `requireCoach(ctx)` and scopes by `coach_id = ctx.user.id`; clients only through `clientFor(ctx, id)`; coach-owned
  rows through `ownRow(ctx, table, id)`. A foreign id is a 404, never a 403.
- Event handlers (`on`) are **synchronous**. Queue async work (AI, fetch, ffmpeg) in your own table and do it in a clock.
- Never `await` inside `tx()`. Do the network, AI and ffmpeg work first, then write in one short `tx`.
- Clocks take `now` from their argument, never `Date.now()`.
- Demo builders write rows directly and never call `emit`, `sendMessage`, `notifyCoach` or `notify`.

## The `feature` object

```js
export const feature = {
  name: 'billing',                       // = file name
  namespaces: ['invoice', 'payment'],    // id prefixes this feature owns (the name itself is NOT implied)
  exact: [],                             // single ids outside them, e.g. ['client.stageChanged']
  schema(db, { addColumn, tx }) {},      // idempotent DDL, run after the core schema
  routes(r) {},                          // r.add(method, path, handler, opts)
  clocks: [{ id: 'billing.recurring', everyMs: 60_000, run(db, config, now) {} }],
  on: { 'booking.created': (db, config, event) => {} },   // '*' subscribes to everything
  emits: { 'invoice.issued': { label: 'Invoice issued', payload: ['invoiceId'], aiDerived: false } },
  actions: { 'invoice.create': { label: 'Create an invoice', clientFacing: true, params: [/* ParamSpec */], options(db, coachId) {}, run(db, config, ctx) {} } },
  facts: { 'billing.balance': { label: 'Balance owed', type: 'money', compute(db, coachId, clientIds, today) {} } },
  variables: { balance: { label: 'Balance owed', value(db, coachId, client) {} } },
  needs, inbox, search, forecast, diary, timeline, exportFor, messageExtras, quiet, badges, meFeatures, renewals, offboarding, publicOffers,
  demo: { tables: { client: [], user: [], coach: [] }, media: [{ key, file, mime, durationSec }], build(db, ctx) {} },
};
```

Shapes the foundation fixes (the rest are in each feature's section of the spec):

| Piece | Shape |
|---|---|
| event passed to `on` handlers | `{seq, id, type, coachId, clientId, summary, payload, isDemo, at}` |
| `actions[id].run(db, config, ctx)` | `ctx = {coachId, client (row), params (checked), now, via?, event?, extra?, dedupe?}`; returns a short outcome string ("Sent", "Skipped: no form"). Runs inside the caller's `tx`. |
| `facts[id].compute(db, coachId, clientIds, today)` | returns a `Map` or a plain object keyed by client id; a missing key reads as `null` |
| `needs(db, coach, clients, today)` | `[{clientId, kind, text, at, rank 1-8, iconKey, action:{label, path}}]` |
| `search(db, coach, q, limit)` | `[{type, id, title, detail, path, icon, score 0-1, at}]` |
| `quiet(db, coachId, clientIds, sinceIso)` | a `Set` (or list) of booking ids that do not count as attended |
| `badges(db, coach)` | `{navId: count}` |
| `exportFor(db, user)` | an object, exported under `features.<name>` in `/api/me/export` |
| `demo.build(db, ctx)` | `ctx = {coach, clients (rows), byName (first name → row), today, rng, config, media(key)}`; `media` returns the fixture's media row, or `null` without a data dir |
| `demo.media[].file` | an absolute path, or a path relative to `server/` |

The loader throws on: an unknown key; a duplicate name; a name that is not the file name; an event, action or fact id outside the feature's
`namespaces` and `exact`; two features claiming one namespace or exact id; a feature claiming a foundation-reserved namespace or id; an
AI-derived variable; an async event handler or demo builder; a clock id used twice.

## Namespaces (docs/design/desk-v2.md 3.11)

Every event, action and fact id a feature declares starts with one of its namespaces (`<ns>.`) or is in its `exact` list.

| Feature file | `namespaces` | `exact` |
|---|---|---|
| *foundation (reserved)* | `core message checkin form workout membership letter commitment day tag coach program` | `client.joined client.tagged client.untagged booking.created booking.cancelled` |
| `command` | `inbox command` | — |
| `crm` | `crm lifecycle` | `client.stageChanged client.paused client.resumed client.offboarded` |
| `onboarding` | `onboarding` | — |
| `leads` | `lead` | — |
| `marketing` | `marketing testimonial` | — |
| `billing` | `invoice payment package billing refund` | — |
| `offers` | `offer referral` | — |
| `revenue` | `revenue` | — |
| `campaigns` | `campaign` | — |
| `guidebook` | `guide` | — |
| `automations` | `automation` | — |
| `templates` | `template` | — |
| `outreach` | `broadcast scheduled outreach` | — |
| `aireview` | `ai` | — |
| `voice` | `voice` | — |
| `calsync` | `calendar waitlist hold` | `booking.rescheduled booking.upcoming booking.series` |
| `diary` | `diary session` | `booking.attended booking.noShow booking.lateCancel` |
| `tasks` | `task` | — |
| `accountability` | `accountability` | — |
| `insights` | `pulse insights` | — |

Adding a namespace later is an edit to this table, to the spec's table and to the feature's own file, nothing else.

## Testing a feature

`server/test/helpers.mjs` loads every feature (or `FEATURES_DIR` when `NODE_ENV=test`) and gives `makeWorld()`:
`{db, config, base, call, ok, signIn, coach, client, settle, close, …}`. `settle()` drains events. See its header comment.
