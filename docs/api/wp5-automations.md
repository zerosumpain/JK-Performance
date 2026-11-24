# WP5: Automations and outreach (F15, F16, F17)

What `desk-v2-wp5` adds (docs/design/desk-v2.md F15–F17). Three feature files: `server/features/automations.mjs`, `templates.mjs`,
`outreach.mjs`; desk files `server/desk/f-auto*.{js,css}`, `f-templates.{js,css}`, `f-outreach.{js,css}`. Every endpoint is coach-only
(`requireCoach`, so a client gets 403); a foreign or missing id is a 404, and a bulk body with one foreign id fails whole and writes nothing.
Tests may move time with `?at=<iso>` on routes that read `requestNow(ctx)` (marked †).

## F15 Automations

### Endpoints

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/automations/catalogue` | – | `{events:[{type, label, payload, feature, aiDerived?}], actions:[{id, label, params, clientFacing, feature, aiSafe, critical?}], facts, variables, lookups:{forms, programs, tags, segments, campaigns?, packages?, discounts?}, features}` (lookups are `[{value, label}]`) |
| GET | `/api/automations/recipes` | – | `{recipes:[{id, name, description, icon, aiDerived, available, needs:[label], missing:[id], automation}]}` (18) |
| GET | `/api/automations` † | – | `{automations:[Automation]}` live first |
| POST | `/api/automations` | `{name, description?, trigger, conditions?, steps?, settings?}` or `{recipe}` (+ overrides) | `{automation}` (always a draft); 409 for a recipe whose feature is missing |
| GET / PUT / DELETE | `/api/automations/:id` | PUT: any of the POST fields | `{automation}` / `{ok}`; a PUT on a live one is validated as for turning on |
| POST | `/api/automations/:id/status` † | `{status: live\|paused\|draft}` | `{automation}`; `live` checks every action, param, event and stopOn exists and at least one action; `draft` stops running clients |
| POST | `/api/automations/:id/test` † | `{clientId, event?:{type, payload}}` | `{willRun, reason?, timeline:[{at, stepId, description, kind, rendered?, missing?, note?, skipped?}]}`; **reads only** |
| POST | `/api/automations/:id/enrol` † | `{clientIds}` (manual trigger, live) | `{started, skipped:[{clientId, name, reason}]}`; due steps run at once |
| GET | `/api/automations/:id/runs` | `?status=active\|done\|stopped\|failed` | `{runs:[Run]}` (current owner join, 300 newest) |
| POST | `/api/automations/runs/:runId/stop` † | – | `{run}` |
| POST | `/api/automations/from-autoflow/:autoflowId` | – | `{automation}` (a draft: join → `client.joined`, manual → manual; each later day → a wait at 09:00 plus the action) |
| GET | `/api/coach/clients/:id/automations` | – | `{runs:[Run + automation:{id, name}]}` (a client's runs) |

```jsonc
// Automation
{"id":"au_…","name":"Late-cancel follow-up","description":"…","status":"draft|live|paused",
 "trigger":{"type":"event","event":"booking.cancelled","where":{"late":true,"byRole":"client"}}
         | {"type":"schedule","days":[1],"at":"08:00","audience":{"everyone":true}|{"segmentId"}|{"tagIds":[…]}}
         | {"type":"enters","rules":Rules} | {"type":"manual"},
 "conditions":Rules|null,
 "steps":[{"id":"s1","type":"wait","days":0,"hours":1,"at":null},
          {"id":"s2","type":"action","action":"message.send","params":{"text":"Hi {first}…"},"if":Rules?,"critical":true?}],
 "settings":{"reentry":"never"|"always"|{"cooldownDays":14},"quietHours":true,"stopOn":["message.received"],"maxPerDay":50},
 "recipe":"late-cancel"|null,"fromAutoflowId":null,"createdAt","updatedAt","liveAt",
 "sentence":"When … : wait 1 hour, then send a message: “…”.","triggerWords":"…","stepWords":{"s1":"Wait 1 hour"},
 "aiDerived":false,"missing":["task.create"],"needs":["Tasks"],
 "stats":{"runs30":9,"active":0,"errors30":0,"lastRunAt":"…","daily":[14 numbers]}}
// Run
{"id":"aur_…","automationId","client":{"id","name","initials"},"status":"active|done|stopped|failed","startedAt","finishedAt","nextAt",
 "stepIndex":2,"steps":3,"current":{"id","description","waiting":true}|null,"log":[{"stepId","at","outcome","step":{"index","description"}|null}],"failed":false}
```

### Engine

- Event triggers: `on['*']`. For each live event automation of the event's coach whose `where` keys all equal the payload, the client (the
  coach's, current owner) starts a run if: no active run of it, re-entry allows (`never`: never before; cooldown: none started in N days),
  outreach not paused (only when the automation has a client-facing step), conditions match, and under `maxPerDay` (overflow is dropped and the
  coach is notified once a day, dedupe `automation.cap:<id>:<day>`). `automation.*` events never trigger, and an automation's own
  `message.sent` (`via:'automation'`) never starts another (no loops).
- `stopOn` events for the client stop its active runs; `client.offboarded` stops every active run ("Stopped: coaching ended").
- With `settings.quietHours` (default on), a run started inside the coach's outreach quiet hours waits until they end before its first step.
- Clocks: `automations.advance` (30 s, due runs of live automations, 100 at a time, each step in its own tx with its log line);
  `automations.enters` (15 min; the first look after going live only records membership in `automation_state`, a later false→true starts a run);
  `automations.schedule` (1 min; once per slot through `automation_slots`, never for a slot before `live_at`, and not more than 12 h late).
- Waits: `days` London calendar days at the same wall-clock time (DST-safe), plus `hours`; with `at`, on that day at that London time (days 0:
  the next time the clock reads `at`).
- Action steps: `if` is checked at run time (false → "Skipped: condition not met"); paused clients (`crm.stage = paused`, when that fact exists)
  defer every step but `coach.notify` and `task.create` (re-checked every 6 h); a missing action logs `failed: … is not available`; a throw logs
  `failed: <reason>` and carries on unless the step (or action) is `critical`, which fails the run. Message steps go through `sendMessage`
  (`via:'automation'`), so the governor's outcome is logged ("Deferred to tomorrow 07:30", "Skipped: outreach paused").
- AI guard (6.3): an automation whose trigger event, `enters` rules, conditions, step `if`s or schedule segment use anything `aiDerived` may only
  contain `coach.notify`, `task.create`, `tag.add`, `tag.remove`, `ai.draft`. Save, PUT and turning on give 400 "Steps that message clients
  can't run on AI judgements"; the engine re-checks and logs `refused: aiDerived`.

### Events

| Event | Payload | aiDerived |
|---|---|---|
| `automation.started` | `{automationId, runId}` | no |
| `automation.finished` | `{automationId, runId}` | no |
| `automation.failed` | `{automationId, runId}` | no |

No actions, facts or variables. Hooks: `timeline` (runs), `offboarding` (`{runs:[{id, automation, nextAt}]}`), `exportFor` (a client's runs
with logs; a coach's automations), `search` (automations by name).

### Tables

As the spec, plus two columns on `automations` (a new table, so additive): `live_at` (when it last went live: schedules ignore earlier slots)
and `evaluated_at` (when an enters trigger last looked; NULL means the next look only records).

## F16 Templates

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/templates` | – | `{templates:[Template], categories}` |
| POST | `/api/templates` | `{name ≤80, body ≤4000, category?, shortcut?}` | `{template}`; 409 for a shortcut in use by this coach |
| GET / PUT / DELETE | `/api/templates/:id` | PUT: any field | `{template}` / `{ok}` |
| POST | `/api/templates/render` † | `{templateId? \| text?, clientId}` | `{text, missing, empty}` (foundation `render`; no side effects) |
| POST | `/api/templates/:id/used` | – | `{template}` (uses + 1, `lastUsedAt`) |
| GET | `/api/templates/variables` | – | `{variables:[{name, label, example, feature}]}` (a feature variable may carry `example`) |

`Template`: `{id, name, body, category, shortcut, uses, lastUsedAt, variables:[names used], createdAt, updatedAt}`. A shortcut is stored
lower-case without the slash (`/CheckIn` → `checkin`, `^[a-z0-9][a-z0-9-]{0,23}$`). Hooks: `search`, `exportFor` (a coach's templates).

## F17 Scheduled messages and broadcasts

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/scheduled-messages` | `?clientId=&status=a,b&oneOff=1` | `{items:[Scheduled]}` |
| POST | `/api/scheduled-messages` † | `{clientId, text, mediaId?, sendAt}` (future, ≤ 180 days) | `{item}`; 429 past 50 waiting for one client |
| PATCH | `/api/scheduled-messages/:id` † | `{text?, sendAt?}` (only while scheduled, else 409) | `{item}` |
| DELETE | `/api/scheduled-messages/:id` | – | `{ok}` (cancels; 409 once sent) |
| GET | `/api/broadcasts` | – | `{broadcasts:[Broadcast + faces]}` |
| POST | `/api/broadcasts` | `{name, body (may be empty in a draft), audience}` | `{broadcast}` |
| GET | `/api/broadcasts/:id` | – | `{broadcast (+ people:[{client, status, outcome, delivered, deliveredAt, readAt, repliedAt}]), stats}` |
| PUT | `/api/broadcasts/:id` | any field (draft only, else 409) | `{broadcast}` (unknown client ids are stripped) |
| DELETE | `/api/broadcasts/:id` | – | draft or cancelled: deleted; scheduled: cancelled with its rows; sent: 409 |
| POST | `/api/broadcasts/preview` † | `{audience, body}` | `{count, skipped:{outreachPaused, noBroadcasts}, max:300, unknown:[names], people:[≤40], samples:[{client, text, missing, empty}] (5)}` |
| POST | `/api/broadcasts/:id/send` † | `{sendAt?}` | `{broadcast, skipped}`; 400 empty body, unknown `{variable}`, nobody, > 300; 429 one per coach per minute |
| GET | `/api/outreach/summary` † | – | `{settings:{dailyCap, quietHours, customised}, scheduled, held, atCap, upcoming:[Scheduled ≤6], broadcasts:[≤3]}` |

Audience: `{everyone?, clientIds?, segmentId?, tagIds?, rules?}`, the union; always the coach's own clients of the same demo-ness, resolved with
purpose `broadcast` (drops paused and "no broadcasts"; refuses AI-derived rules with 400). Recipients are frozen into `scheduled_messages`
rows (`broadcast_id`) when it is sent or scheduled. The `outreach.send` clock (20 s) claims each due row (`scheduled → sending`), renders it, sends
through `sendMessage` (`via:'scheduled'` for a one-off, exactly then; `'broadcast'` governed) and marks it in the same transaction. A
governor hold records the `deferred_messages` id, so stats follow the message when it goes. A broadcast with no row left pending becomes
`sent` and emits `broadcast.sent`. A row whose client changed coach fails with "no longer your client"; `client.offboarded` cancels the
client's queued rows (`error='coaching ended'`).

Stats: delivered (a message exists), read (`messages.read_at`), replied (a client message within 72 h), held, skipped; `readPct` and
`replyPct` of delivered.

| Event | Payload | aiDerived |
|---|---|---|
| `scheduled.sent` | `{scheduledId, messageId}` | no |
| `broadcast.sent` | `{broadcastId, recipients}` | no |

Hooks: `timeline` ("Scheduled · Tue 07:00"), `offboarding` (`{scheduled:[{id, sendAt, text}]}`), `exportFor` (a client's queued messages;
a coach's broadcasts). Extra columns on the new tables: `scheduled_messages.deferred_id`, `.outcome`; `broadcasts.queued_at`, `.updated_at`.

## Desk

- Nav: Automations (`bolt`), Broadcasts (`campaign`), Templates (`description`) in Engage. Palette: `g a`, "New automation", "New broadcast",
  "New template". + New: Automation, Broadcast.
- `/automations` (tabs Automations, Recipes, Sequences (legacy)), `/automations/:id/:tab?` (Build, Runs): the visual builder, Test on…, Runs.
- `/broadcasts`, `/broadcasts/new`, `/broadcasts/:id` (the wizard for a draft, the report once sent or scheduled). `/templates`.
- Composer tools: Templates (10), Schedule (40); a slash item per template shortcut (loaded the first time a composer is focused).
- Bulk actions: Message (a broadcast draft for the selection), Start automation. Client action: Start an automation.
- Today widget `scheduled`; Settings › Outreach (daily cap, quiet hours, via `outreach.dailyCap` / `outreach.quietHours` prefs).

## Integration requests

1. **Demo wipe and feature tables (foundation, `demo.mjs`).** Older tests build the demo before `createApp` runs feature schemas, so a
   `demo.tables` entry makes `wipe()` fail with "no such table". WP5 (like WP4) declares no `demo.tables`; each builder runs its own
   idempotent schema and clears the demo accounts' rows itself. WP-Z: either have `wipe()` skip missing tables (or call `runFeatureSchemas`
   first), then WP5's builders can list `demo.tables` again.
2. **Thread extras (WP6, `messages.js` `threadPane`).** Scheduled messages show as ghost bubbles above the thread's composer. With no hook, a
   MutationObserver in `f-outreach.js` finds each `.thread-compose` and reads the client id from the pane's `data-client-id` (preferred) or
   its `#/clients/<id>` link. Please set `data-client-id` on the thread pane element (or add a `registerThreadExtra` hook) so the redesigned
   thread keeps them.
3. **Slash menu rows (WP0-D, `composer.css`).** A slash item with a long `detail` overlaps its label in `.cmp-slash-item`; WP5 now registers
   template shortcuts without a detail. A `min-width:0` / grid fix there would let it show a preview line.
4. **F5 timeline / F8 offboarding (WP2).** `automations` and `outreach` provide `timeline` and `offboarding` hooks in the shapes WP2's
   `crm.mjs` aggregates (`runs`, `scheduled`).
5. **Recipes waiting on other packages.** 14 of the 18 recipes need ids from WP2 (`client.stageChanged`, `onboarding.stalled`,
   `crm.birthdayInDays`, `crm.daysSinceEnded`), WP3 (`payment.recorded`, `package.low`, `billing.*`, `offer.issue`), WP4 (`campaign.*`),
   WP6 (`voice.flagged`), WP7 (`booking.noShow`, `booking.upcoming`) and WP8 (`task.create`, `pulse.send`). Recipe params assumed for
   them: `task.create {title}`, `offer.issue {}` (the coach picks the offer), `pulse.send {}`. WP-Z: check `task.create`'s ParamSpec has a
   `title` key; if not, adjust `RECIPES` in `automations.mjs`.
6. **No glyphs requested**: every icon used is already in `symbols.js`.

## Parity gaps

- The demo's live automations that trigger on events from packages not in this worktree (At-risk alert, Session reminder, Birthday
  message) show "Needs …" and cannot fire here; they will once WP2/WP7 merge. Their historical runs are seeded rows.
- `task.create` is absent in this worktree, so the demo's task steps fall back to `coach.notify` (the builder adapts to what exists at
  build time). Tests use a stand-in `tasks` feature.
- Real pushes are not exercised (recorder transport only, as everywhere).

## Design notes

- The builder canvas is a plain `--surface`/`--bg` mix rather than a dotted grid: gradients are allowed only as `--sheen`/`--shimmer` (2.1).
  The trigger node and the sentence banner use `--sheen` (hero tiles); only the dragged node carries `--shadow-drag`.
- Every node is a single button (Enter opens its inspector); each step's drag handle also moves it with the arrow keys, and its menu has
  Move up / Move down, so drag and drop has a keyboard alternative.
- `{variables}` are drawn as small accent chips in sentences, nodes, previews and bubbles (text nodes only).
- Broadcast read/reply bars use `--data` (read) and `--accent` (replied), always with the number beside them.
