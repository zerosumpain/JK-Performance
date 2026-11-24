# WP0-S: the server foundation

What `desk-v2-foundation-server` adds (docs/design/desk-v2.md 3.1–3.8, 3.10, 3.11, 3.13–3.15). Everything here is coach-only
(`requireCoach`, so a client gets 403) unless marked, and a foreign or missing id is a 404.

## Endpoints

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/coach/capabilities` | – | `{features:[name], ai:{provider:'stub'\|'openrouter'\|'off'}}` |
| GET | `/api/coach/badges` | – | `{badges:{[navId]: n}}`, the sum of every feature's `badges` hook |
| GET | `/api/coach/stream` | – | `text/event-stream` (below) |
| GET | `/api/notifications` | `?before=<iso>&limit=30&unread=1` | `{items:[Notification], unread}` newest first |
| GET | `/api/notifications/count` | – | `{unread}` |
| POST | `/api/notifications/read` | `{ids:[…]}` or `{all:true}` | `{unread}`; one foreign id is a 404 and marks nothing |
| GET | `/api/facts` | – | `{facts:[{id, label, type, options?, feature, aiDerived?}]}` |
| GET | `/api/facts/clients/:id` | – | `{facts:{[factId]: value}}` (every fact, `core.segments` included) |
| GET | `/api/tags` | – | `{tags:[{id, name, color, count}]}` |
| POST | `/api/tags` | `{name ≤40, color?: 'chart-1'…'chart-6'}` | `{tag}`; 409 for a name in use |
| PATCH | `/api/tags/:id` | `{name?, color?}` | `{tag}` |
| DELETE | `/api/tags/:id` | – | `{ok}` |
| PUT | `/api/coach/clients/:id/tags` | `{tagIds:[…]}` (the full set) | `{tags:[…]}`; emits `client.tagged` / `client.untagged` per change |
| POST | `/api/coach/clients/tags` | `{clientIds, add?:[tagId], remove?:[tagId]}` | `{changed}`; one foreign client or tag is a 404 and writes nothing |
| GET | `/api/segments` | – | `{segments:[{id, name, description, rules, pinned, count, updatedAt}]}` pinned first |
| POST | `/api/segments` | `{name, description?, rules, pinned?}` | `{segment}`; rules may not use `core.segments` |
| PUT | `/api/segments/:id` | same | `{segment}` |
| DELETE | `/api/segments/:id` | – | `{ok}` |
| POST | `/api/segments/preview` | `{rules}` or `{audience}` | `{count, clients:[{id, name, initials}] (≤50)}` |
| GET | `/api/coach/prefs/:key` | key `^[a-zA-Z0-9.-]{1,64}$` | `{value}` (`null` if unset) |
| PUT | `/api/coach/prefs/:key` | `{value}` (any JSON ≤ 16 KB) | `{ok}`; 413 over 16 KB, or a new key past 200 per coach (demo rebuilds keep the 40 newest `desk.*`) |
| GET / PUT | `/api/coach/clients/:id/outreach` | `{paused?, noBroadcasts?, note?}` | `{outreach:{paused, noBroadcasts, note, sentToday, cap}}` |
| GET | `/api/search` | `?q=(≥2, ≤100)&types=client,message,…&limit=20 (≤50)` | `{results:[{type, id, title, detail, path, icon, score, at}]}` |
| GET | `/api/ai/status` | – | `{provider, model, audio, reason, reviewMode, enabled, transcribe, analyse, drafts, usedToday:{calls, audioSeconds} (calls that reached the provider, failed ones included; quota refusals never count), limits:{dailyCalls, dailyAudioSeconds, clientDailyNotes, clientDailyAudioSeconds}}` |
| PUT | `/api/ai/settings` | `{enabled?, reviewMode?: off\|ask\|always, transcribe?, analyse?, drafts?}` | the settings |

Changed existing endpoints:
- `GET /api/messages` (client or coach) gains `since=<iso>`: the reply adds `updated:[Message]` (rows with `COALESCE(updated_at, at) ≥ since`)
  and always carries `cursor` (the greatest such time in the thread, read before the list). Old apps ignore both.
- `GET /api/coach/needs-you`: an item's `reasons` include feature reasons (`feature`, `action:{label, path}`); when one is on top,
  `primaryAction` is `{kind:'feature', label, path}`.
- `GET /api/me/export` (any user) adds `tags`, `outreach`, `heldMessages` and `features.<name>` from every `exportFor` hook.

```jsonc
// Notification
{"id":"nt_…","kind":"pain","title":"Pain reported in check-in: Tom","body":"","path":"/clients/u_…","icon":"warning",
 "tone":"urgent|attention|ok|data","client":{"id","name","initials"}|null,"readAt":null,"at":"…"}
```

### The live stream

`GET /api/coach/stream` answers `content-type: text/event-stream`, `cache-control: no-cache`, `x-accel-buffering: no`. It writes
`: connected` at once, `: ping` every 25 s, and for each of the coach's events and notifications:

```
event: message.received
data: {"seq":123,"type":"message.received","clientId":"u_…","summary":"Voice note · 0:42"}

event: notification
data: Notification
```

Events are streamed only after they commit (from `drainEvents`); summaries only, never bodies. At most 4 streams per coach (a fifth closes the
oldest). The desk must read it with `fetch()` and a reader (EventSource cannot send the Bearer header).

## Events the foundation emits

| Event | From | Payload | Summary |
|---|---|---|---|
| `client.joined` | `auth.mjs` sign-up (not `setUpClient`) | `{email}` | "Joined" |
| `client.tagged` / `client.untagged` | tag routes and `tag.*` actions | `{tagId, by: coach\|automation}` | "Tagged VIP" |
| `message.sent` | `POST /api/messages` (coach, `via:'desk'`) and `sendMessage` | `{messageId, kind, mediaId, via}` | "Message sent" |
| `message.received` | `POST /api/messages` (client) | `{messageId, kind, mediaId}` | "Voice note · 0:42" or "Message" |
| `checkin.submitted` | every check-in submit (also re-submits) | `{checkinId, week, pain:bool}` | "Weekly check-in" |
| `form.sent` | `POST /api/forms/:id/send` and the `form.send` action (not autoflows) | `{requestId, formId}` | "Sent PAR-Q" |
| `form.submitted` | a client's answers | `{requestId, formId, flagged:n}` | "Answered Monthly review" |
| `booking.created` | 1:1 booking, new class (`clientId` null), joining a class | `{bookingId, kind, start, purpose, byRole, late:false, refunded:false}` | "Booked Tue 4 Nov 07:00" |
| `booking.cancelled` | cancelling a 1:1, leaving a class | same, `late` = not refunded | "Cancelled Tue 4 Nov 07:00 (late)" |
| `workout.completed` | completing a workout | `{workoutId, feel}` | "Finished Lower A" |
| `membership.changed` | `POST /api/me/membership` | `{from, to}` | "Plan: Elite" |
| `letter.published` | first publish of a letter | `{reportId, kind}` | "Letter published" |
| `letter.delivered` | `deliverDue` | `{reportId, kind}` | "Letter delivered" |
| `commitment.reviewed` | a client sets an outcome | `{commitmentId, outcome}` | "Commitment kept" |
| `day.started` | clock, once per coach per London day after 05:00 | `{day}` | "" |

None is `aiDerived`. The event object a handler receives: `{seq, id, type, coachId, clientId, summary, payload, isDemo, at}`.

## Built-in facts, actions and variables

Facts (`core.*`): `plan` (enum), `daysSinceJoined`, `daysQuiet` (messages, sets, workouts, check-ins, habit ticks **and attended sessions**;
from `created_at` when there is none), `sessionsAttended14`, `anniversaryInDays`, `outreachPaused`, `daysSinceWorkout` (null if never),
`adherence28` (null when nothing was due), `unread`, `pain14` (check-in pain, urgent words in client messages, flagged forms), `nextSessionDays`
(null if none), `onboarded`, `tags`, `segments` (only when asked for).

Actions (`ctx = {coachId, client, params, now, via?, extra?, dedupe?}`, outcome string):

| Action | Params | clientFacing | Outcome |
|---|---|---|---|
| `message.send` | `text:template` | yes | "Sent", "Deferred to 07:30" / "Deferred to tomorrow 07:30", "Skipped: outreach paused" |
| `form.send` | `formId:form` | yes | "Sent", "Skipped: no form" |
| `program.assign` | `programId:program`, `start:enum(nextMonday,today)` | yes | "Laid 8 workouts from 2026-11-30" |
| `tag.add` / `tag.remove` | `tagId:tag` | no | "Tagged", "Already tagged" / "Untagged", "Not tagged" |
| `coach.notify` | `title:text`, `body:template` | no | "Notified", "Skipped: already notified" |

Variables: `{first} {name} {coach} {coachFirst} {plan} {nextSession} {nextSessionDay} {daysQuiet} {streak} {today} {yearsCoached}`.

## JS API for packages

| Module | Exports |
|---|---|
| `registry.mjs` | `FEATURES`, `hooks(name)`, `allFacts()`, `allActions()`, `allEvents()`, `allVariables()`, `featureNames()` |
| `features.mjs` (entry points only) | `runFeatureSchemas(db)`, `startClocks(db, config)` → `stop()`, `tickClock(db, config, id, now)`, `validateFeatures(list)` |
| `events.mjs` | `emit(db, type, {coachId, clientId, summary, ...payload})`, `drainEvents(db, config)`, `eventsFor(db, {coachId, clientId, before, limit, types})` |
| `notifications.mjs` | `notifyCoach(db, config, coachId, {clientId, kind, title, body, path, icon, tone, dedupe, now})` → row or null; `quietWindow`, `inWindow`, `windowEnd`, `nextClock` |
| `messages.mjs` | `sendMessage(db, config, {coachId, clientId, text, kind, mediaId, via, now})` → `{message, deferredUntil, skipped}`; `VIA_CLASS`, `outreachOf`, `outreachSettings`, `cappedSentToday` |
| `facts.mjs` | `clientFacts`, `attendedSessions`, `evaluate`, `validateRules`, `factsIn`, `resolveAudience` (array + `.skipped`), `setClientTag`, `ownClients(ctx, ids)`, `runAction`, `checkParams`, `actionCatalogue`, `factCatalogue`, `foundationLookups` |
| `templating.mjs` | `render(db, coachId, client, text, {extra, now})` → `{text, missing, empty}`, `variableCatalogue()` |
| `ai.mjs` | `aiInfo`, `complete`, `listen`, `redactForAi`, `surnameOf`, `AiError`, `withinBudget`, `usedToday`, `clientAudioToday`, `aiSettings`, `parseJsonLoose` |
| `audio.mjs` | `sniffAudio`, `ftypBrand`, `ffmpegAvailable(config)`, `probe(config, path, fmt)`, `toM4a(config, in, out, {fmt, capSec})`, `toModelMp3(config, in, {fmt})`, `convertUpload(config, bytes, {capSec, tooLong})`, `audioJob(fn)`, `AudioError` |
| `store.mjs` | `afterCommit(fn)`, `inTx()`, `addColumn`, `coachPref(db, coachId, key, fallback)`, `setCoachPref` |
| `access.mjs` | `ownRow(ctx, table, id)`, `isDemo(ctx)`, `requestNow(ctx)` |
| `media.mjs` | `writeMediaFile(config, {bytes, mime})`, `insertMediaRow(db, file, {...})`, `mediaFilePath(config, m)` (`storeMedia` unchanged) |
| `search.mjs` | `searchAll`, `likeAny(q)`, `matchScore(text, q)` |
| `ratelimit.mjs`, `rng.mjs` | `limit(key, {max, perMs})`; `rng(seed)` with `.int`, `.pick`, `.chance` |

Preference keys the foundation reads: `outreach.dailyCap` (default 3), `outreach.quietHours` (default `{start:'21:00', end:'07:30'}`),
`notify.push.urgent` (default true), `notify.quietHours` (default `{start:'22:00', end:'06:30'}`). A quiet-hours value is `{start, end}`, a
string `"21:00-07:30"`, or `null` / `"off"` for none.

## Deviations from the spec

1. **Pref keys allow capitals** (`^[a-zA-Z0-9.-]{1,64}$`): the spec's own keys (`outreach.quietHours`, `notify.quietHours`) do not match its
   lower-case pattern.
2. **`automation.test.mjs` set-up line.** Autoflow messages now go through the governor (3.5), so with the default 21:00–07:30 quiet hours the
   existing join-autoflow test failed whenever it ran at night. Its `before` now sets the test coach's `outreach.quietHours` to `null`. No
   assertion changed.
3. **`audio.mjs` functions take `config` first** (`probe(config, path, fmt)`, `toModelMp3(config, in, {fmt})`), since the ffmpeg path lives in config.
4. **Two extra `AiError` kinds**: `upstream` (any other HTTP or network failure) and `off` (the coach turned AI off, 409). The privacy message is
   kept for real privacy failures only.
5. **`render` also returns `empty`**: a known variable with no value (no session booked) becomes empty text and is listed there, instead of
   being left as `{nextSession}` in a client's message.
6. **Foundation tables live in `store.mjs`** (`foundationSchema`, run by `openStore`), so every test that opens a store has them. Feature tables
   stay in features.
7. `GET /api/notifications` also takes `unread=1`.

## Integration requests

- **WP6**: `messageOut(m, {coachView})` and the `messageExtras` aggregation are left to WP6 with `messages.mjs` (F19). `settings.mjs`
  `featuresOf` does not merge `hooks('meFeatures')` yet (WP6 owns `settings.mjs` in wave 1).
- **WP2**: F5's timeline is a new endpoint, `GET /api/coach/clients/:id/timeline`, served by `features/crm.mjs`, which merges
  `eventsFor(db, {clientId})` and iterates `hooks('timeline')` itself (3.7). `server/timeline.mjs` (WP6) is not involved.
- **WP1**: needs reasons from features reach Today as `primaryAction: {kind: 'feature', label, path}`; the wave-0 `today.js` renders
  them as a link to `path`. Keep that when WP1 rewrites `today.js`.
- `core.pain14` does not include voice flags; WP6 can expose a `voice.flagged14` fact or WP-Z can extend `core.pain14` with a hook.

## Parity gaps

- Urgent pushes to the coach's phone are proved with the recorder transport only (no APNs/FCM in the local stack).
- Real OpenRouter calls are never made locally (no key, by rule); a fake `fetchImpl` covers the request shape, the downgrade and the privacy failure.

## Design notes

None: WP0-S adds no desk files.
