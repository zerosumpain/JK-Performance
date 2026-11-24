# WP2: Clients and lifecycle (F5, F7, F8, F27)

Two feature files: `server/features/crm.mjs` (health score, Client 360 data, timeline, notes, lifecycle, retention, pause, End coaching) and
`server/features/onboarding.mjs` (the checklist). Every route is coach-only (`requireCoach`: a client gets 403); a foreign or missing client is a 404;
client-linked rows are always reached through `clientFor` (the client's **current** coach), never a stored `coach_id`.

## Endpoints

### crm

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/crm/clients` | `?at=` (tests) | `{clients:[{id, name, initials, plan, planName, stage, manual, pausedUntil, churnSuggested, health, band, trend, lastActiveAt, nextSessionAt, tags:[{id,name,color}], onboardingPct, balancePence?, daysQuiet, unread, since}]}` (`balancePence` only when `billing.balance` exists) |
| GET | `/api/crm/stages` | – | `{counts:{onboarding, active, atRisk, paused, churned, alumni}}` |
| GET | `/api/coach/clients/:id/score` | – | `{health, score (= health, for WP6), band, trend, factors:{engagement, adherence, consistency, wellbeing, notes:[…]}, series:[{day, health}] (90 d)}`. Computes today's score on demand and stores it (not for paused or ended clients). |
| GET | `/api/coach/clients/:id/timeline` | `?before=<iso>&limit=50 (≤100)&kinds=message,session,…` | `{items:[{at, kind, icon, tone, title, detail, path}], next}` (`next` = the `before` for the next page, or null) |
| GET / POST | `/api/coach/clients/:id/notes` | `{body ≤4000, pinned?}` | `{notes}` (pinned first, newest first) / `{note:{id (nb_…), body, pinned, createdAt, updatedAt}}` |
| PATCH / DELETE | `/api/coach/clients/:id/notes/:noteId` | `{body?, pinned?}` | `{note}` / `{ok}` |
| GET | `/api/coach/clients/:id/lifecycle` | – | `{stage, since, manual, computed, pausedUntil, pauseReason, pausedAt, exitReason, exitNote, endedAt, birthday, churnSuggestedAt, history:[{stage, at, reason}]}` (`computed: true` when no row is stored yet: the rules' answer) |
| PUT | `/api/coach/clients/:id/lifecycle` | `{stage?, manual?:bool, exitReason?, exitNote?, birthday?:'MM-DD'\|null}` | same. `stage` sets a manual override (`churned` → 400 "Use End coaching", `paused` → 400 "Use Pause"); `{manual:false}` clears it and reruns the rules; a stage change from churned/alumni is "Restart coaching". |
| POST | `/api/coach/clients/:id/pause` | `{weeks 2–12, reason?}` | `{lifecycle}`; 409 when coaching has ended. Re-pausing extends. |
| POST | `/api/coach/clients/:id/resume` | – | `{lifecycle}`; 409 when not paused |
| GET | `/api/coach/clients/:id/offboarding` | – | merged `hooks('offboarding')` objects (arrays under the same key are concatenated), plus `balancePence` from `billing.balance` when that fact exists |
| POST | `/api/coach/clients/:id/end` | `{exitReason (required: cost time injury results moved coachFit goalReached other), exitNote?, money: invoice\|writeOff\|leave, keepChasing?, packages: expire\|refund, survey?}` | `{lifecycle, survey: "Sent"\|null}`; 409 if already ended. Stage `churned` (or `alumni` for goalReached), emits `client.offboarded`. `keepChasing` is only true with `money:'leave'`. The farewell message is sent by the desk through `POST /api/messages` after this call. |
| GET | `/api/retention` | – | `{watch:[card], atRisk:[card], suggested:[card], stats:{saves90, churn:[{month:'YYYY-MM', n}] (12), reasons:[{reason, label, n}], ended12}}` |
| GET | `/api/retention/renewals` | `?days=30 (≤90)` | `{items:[{client, kind:'package'\|'schedule'\|'campaign'\|'upgrade'\|…, label, on, detail, path, feature?}]}` soonest first, undated last |
| GET | `/api/retention/ended` | `?months=12 (≤36)` | `{clients:[{client, endedAt, exitReason, exitLabel, exitNote, stage}]}` |

Radar card: `{client:{id,name,initials,plan}, stage, health, band, trend, series:[health] (30 d), reasons:[2 notes], daysQuiet, lastContactAt, suggested, suggestedAt, why?, play:{kind:'checkIn'|'offer'|'pause'|'end', label}}`.
Columns: `suggested` (churn suggestion) first, then band `atRisk`, band `watch`, then stage `atRisk` with a healthier band. Paused and ended clients are never on the radar. `offer` only appears when an `offer.issue` action exists (WP3).

### onboarding

| Method | Path | Body | Response |
|---|---|---|---|
| GET / PUT | `/api/onboarding/template` | `{steps:[{key, label, kind:'event'\|'fact'\|'manual', event?, also?:[event], ref?, fact?, op?, value?}] (1–12), stallDays 1–60}` | `{template:{steps (each with `hidden`), stallDays, updatedAt, isDefault}}`; unknown kinds, events or facts are 400; a `ref` that is not the coach's form is 404 |
| GET | `/api/coach/clients/:id/onboarding` | – | `{started, startedAt, completedAt, pct, done, total, nextStep:{key, label, nudge}, stuckDays, stalled, steps:[{key, label, kind, done, doneAt, by}]}` |
| POST | `/api/coach/clients/:id/onboarding` | `{start:true}` or `{step, done:bool}` | same; 409 to start twice, or to tick before starting |
| GET | `/api/onboarding` | – | `{clients:[{client, pct, done, total, stuckDays, stalled, nextStep, startedAt}]}` (open checklists only) |

## Events

| Event | Payload | aiDerived | When |
|---|---|---|---|
| `crm.bandChanged` | `{from, to, health}` | no | nightly, when today's band differs from yesterday's (once per move; never for paused or ended clients) |
| `client.stageChanged` | `{from, to, manual}` | no | any stage change **except** a client's first recorded stage (the initial classification after deploy never triggers automations) |
| `client.paused` | `{until, reason, days}` | no | pause (also `lifecycle.pause`) |
| `client.resumed` | `{pausedDays}` | no | manual resume, or the `crm.resume` clock / nightly run once `paused_until` ≤ today |
| `client.offboarded` | `{exitReason, money, keepChasing, packages, at}` | no | End coaching. WP3/WP4/WP5 consume it; WP2 writes none of their tables. |
| `onboarding.stepDone` | `{step}` | no | a step ticks (auto or coach) |
| `onboarding.completed` | `{}` | no | once, when every visible step is done; crm moves Onboarding → Active at once |
| `onboarding.stalled` | `{days, nextStep}` | no | nightly, once per stall (again only after new progress and a new stall) |

Consumed: `day.started` (crm: scores, lifecycle, churn suggestions, due resumes, pruning; onboarding: fact steps, completion, stalls),
`onboarding.completed` (crm), `client.joined` (onboarding starts a checklist), `*` (onboarding: event and fact steps for open checklists).

## Actions

| Action | Params | clientFacing | Outcome |
|---|---|---|---|
| `lifecycle.set` | `stage: enum(onboarding, active, atRisk, alumni)` (churned refused) | no | "Stage: At risk", "Already there", "Skipped: paused", "Skipped: coaching has ended" |
| `lifecycle.pause` | `weeks: number (2–12)`, `reason: text` | no | "Paused until 2026-12-22", "Skipped: coaching has ended" |

## Facts

`crm.health` (number), `crm.band` (enum thriving/steady/watch/atRisk), `crm.trend` (number), `crm.stage` (enum), `crm.daysInStage` (days),
`crm.birthdayInDays` (days, null if none), `crm.daysSinceEnded` (days, null unless churned/alumni);
`onboarding.pct` (number, null with no checklist), `onboarding.stuckDays` (days, null when complete), `onboarding.hasGoal`, `onboarding.hasProgram`,
`onboarding.notificationsOn` (bool). None is AI-derived.

## Variables

`{birthdayDay}` → "Fri 12 Dec" (the next birthday; empty when none is set).

## Hooks provided

`needs` (crm: churn suggestion rank 6 "Looks like Tom has stopped: quiet 34 days. End coaching or check in?", band into At risk within 7 days rank 6
"Health dropped to 28 (At risk)"; onboarding: stalled rank 5 "Onboarding stuck 6 days: waiting on health questionnaire returned"),
`diary` (birthdays `cake`, coaching anniversaries `celebration`), `badges` (`{retention: churn suggestions}`), `exportFor` (crm: `notes`, `scores`,
`lifecycle`, `lifecycleHistory`; onboarding: `checklist`, `steps`), `demo.build` (both).
Aggregated: `timeline`, `renewals`, `offboarding` (each provider is try/caught and logged).

## Desk

Owned and rewritten: `clients.js` (the clients list and Client 360), `overview.js` (a bento top row: health, onboarding, pinned notes, the AI brief), `clients.css`.
New: `f-crm.js` (shared pieces, flows, registrations), `f-crm-retention.js` (`/retention/:tab?`), `f-crm-segments.js` (`/segments`, `/segments/:id`),
`f-onboard.js`, `f-crm.css`, `f-onboard.css`.

Registers: nav `segments`, `retention` (badge); client tabs `timeline` (20), `notes` (80) (the six built-in tabs still register from `clients.js`);
client actions `message` 10, `book` 20 (in `clients.js`), `note` 40, `tag` 45, `pause` 70 (resumes when paused), `end` 95; bulk actions `tag`, `export-csv`
(client-side Blob, spreadsheet formulas neutralised); widgets `at-risk`, `renewals`, `onboarding`; settings `tags`, `onboarding`; panels `client`
(richer quick view) and `end` (deep link `?panel=end:<id>` reopens End coaching). The Client 360 hero shows the first five client actions and puts the rest
under More (WP4's phone-squeeze note). Every play opens a composer or a flow; nothing sends without the coach pressing Send.

## Integration requests

1. **`demo.mjs`: run feature schemas before the wipe** (same as WP6 #2). Tests build the demo before `createApp`, so `demo.tables` would hit missing
   tables. crm and onboarding therefore declare no `demo.tables`: each builder runs its own idempotent `schema` and wipes its own rows. Once `buildDemo`
   runs schemas first, both can move to `demo.tables`.
2. **`needs.mjs`**: the core reasons (quiet, no training, letters due) still list paused and ended clients (Today shows "Quiet for 47 days" for Marcus, who
   left). Skip clients whose `crm.stage` is `paused`, `churned` or `alumni` (one `clientFacts(... only:['crm.stage'])` call when the fact exists).
   The same applies to `reports.mjs` letters-due and WP8's accountability board.
3. **WP5 templates**: the plays ask `GET /api/templates?category=winback|billing|upgrade|onboarding|farewell` and read `{templates:[{name, body}]}`
   (falling back to built-in words). If WP5's shape differs, align either side.
4. **WP3 Offer play**: the radar's Offer goes to `/offers?client=<id>`; WP3 may prefer opening `offer.issue` directly.
5. **WP6**: `consentChip` and `briefBody` are honoured: the hero draws the consent chip from `/ai-consent` (only when the `voice` feature is present) and the
   Overview loads `f-ai.js` `briefBody` dynamically (only when `aireview` is present), so the worktree without them logs no 404.
6. **`desk.mjs`** caches desk files at start-up: a restart is needed to see desk edits (worth a note in `docs/api/README.md`).

## Parity gaps

- Renewals from billing schedules, packages and campaigns come from WP3/WP4 hooks, which are not in this worktree: the local Renewals tab shows only
  upgrade candidates (none in the demo today), and the demo's "package at 1 credit, schedule ending in 3 weeks" are WP3's to seed.
- End coaching's money, schedules, packages, enrolments and runs steps are driven by WP3/WP4/WP5's `offboarding` hooks and `client.offboarded`
  handlers; here the wizard shows "Billing is not set up" and "Nothing else is running". The cross-package checks (no recurring invoice, no dunning,
  no nudge, no run after `client.offboarded`) can only be proved after WP-Z's merge.
- The checklist's billing and guide steps are hidden here (no billing or guidebook events), so the demo reads 6/7 and 3/7 instead of 6/9 and 3/9.
- The spec's "nightly at 04:30" runs on `day.started` (after 05:00 London), the foundation's daily clock.

## Design notes

- **The timeline reads the domain tables** (messages, workouts, check-ins, bookings, letters, forms, membership, lifecycle history) for the core kinds,
  and the events log only for everything else, so history from before the event bus (and the demo world, whose builders never emit) shows. Covered
  event types are skipped to avoid duplicates.
- **Paused and ended clients are not scored nightly**: a pause would read as a collapse and trip At risk on return. A paused client shows the last
  score from before the pause; an ended one shows none.
- **Goal set** ticks on an `active` or `reached` goal: every client gets a `draft` goal when they finish the app's first run. **Notifications on**
  needs `notifications_on` **and** a registered device (the column defaults to 1 for everyone).
- **Demo extras**: four demo-only former/at-risk clients (Hannah, alumni; Marcus, churned; Dan, churn suggested; Ellie, watch), created by the crm builder
  with `apple_sub` `demo-crm-*` and deleted and recreated on every rebuild, so whatever any feature wrote for them cascades away. Their ids change nightly.
- Stage pills pair a glyph, a word and a colour; manual overrides carry a small pencil. The hero's left rail takes the stage colour.
- `crm.mjs` and `onboarding.mjs` also export `_test` (and crm `bandOf`, `scoreFrom`) for their own tests only; no feature imports them.
