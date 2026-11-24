# WP7: Calendar and diary (F20, F21, F22)

What `desk-v2-wp7` adds (docs/design/desk-v2.md F20–F22). Server: `server/features/calsync.mjs`, `server/features/diary.mjs`, and edits to the
owned `server/bookings.mjs` and `server/calendar.mjs`. Desk: `server/desk/schedule.js|css` (rewritten), `f-calendar.js|css`,
`f-calendar-lib.js`, `f-diary.js|css`. Tests: `server/test/calsync.test.mjs`, `ics.test.mjs`, `diary.test.mjs`.

Everything is coach-only (`requireCoach`, a client gets 403) unless marked **client**; a foreign or missing id is a 404. Days are London
`YYYY-MM-DD`, instants UTC ISO, money integer pence.

## Endpoints

### Calendar sources, busy time, rules and time off (F20, `calsync`)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/calendar/sources` | – | `{sources:[Source]}` |
| POST | `/api/calendar/sources` | `{label ≤60, url ≤2000, color?: chart-1…6 (chart-4), showTitles?: false}` | `{source}`; fetches once first: 400 with the reason ("Could not read that calendar: …", "That address points inside a private network", "Only https:// (or webcal://) …"); 403 for a demo coach; 409 past 10 sources |
| PATCH | `/api/calendar/sources/:id` | `{label?, color?, showTitles?, active?}` | `{source}`. Titles off forgets stored titles at once; titles on fetches again (titles are only kept from a fetch) |
| DELETE | `/api/calendar/sources/:id` | – | `{ok}` (its busy blocks cascade) |
| POST | `/api/calendar/sources/:id/sync` | – | `{source}` (fetches without the stored etag); 403 for a demo coach |
| GET | `/api/calendar/busy` | `?from=&to=` (days, ≤ 92) | `{blocks:[{id, sourceId, start, end, allDay, title\|null, color, label}], timeOff:[TimeOff], holds:[Hold]}` (`holds` is an addition) |
| GET | `/api/calendar/prefs` | – | `{prefs: Prefs, defaults}` |
| PUT | `/api/calendar/prefs` | any `Prefs` fields | `{prefs}` |
| GET | `/api/calendar/time-off` | – | `{items:[TimeOff]}` (from 30 days ago) |
| POST | `/api/calendar/time-off` | `{start, end, reason? ≤80, allDay?: true}`: days (end inclusive) when `allDay`, else instants; ≤ a year | `{item, conflicts:[{bookingId, start, end, kind, title}]}` (bookings inside: a warning, nothing is moved) |
| DELETE | `/api/calendar/time-off/:id` | – | `{ok}` |
| POST | `/api/calendar/time-off/bank-holidays` | `{years:[2026, 2027]}` (≤3, 2000–2100) | `{added}` (England and Wales; a day already there is skipped) |

`Source = {id, label, urlHint, color, showTitles, active, lastSyncedAt, lastError, ok, eventCount, nextSyncAt}`. `urlHint` is
`host/…/<last path part>`; **the address itself is never returned** (stored AES-256-GCM, key `<DATA_DIR>/secrets/calendar.key`, 0600 in a 0700 dir).
`ok` is false while the last fetch failed; `lastError` also carries warnings ("Some repeating events were simplified", an unknown zone).

`Prefs = {bufferBefore, bufferAfter, minNoticeHours, maxPerDay|null, travelGap, cancelNoticeHours, cancelForfeitCredit, cancelFeePence, noShowFeePence, configured, updatedAt}`.

`TimeOff = {id, start, end, allDay, reason, startDay, endDay}` (`endDay` inclusive).

### Conflicts and holds (F20, `calsync`)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/calendar/conflicts` | `?from=&to=` (days, ≤ 92; default today + 27) | `{conflicts:[Conflict], ignored:[key]}` |
| POST | `/api/calendar/conflicts/ignore` | `{key}` | `{ok}` |
| GET | `/api/calendar/holds` | `?from=&to=` | `{holds:[Hold]}` |
| POST | `/api/calendar/holds` | `{kind: consult\|trial\|admin, title? ≤80 (default "Consult"/"Trial"/"Admin"), start, end (≤12 h), leadId?}` | `{hold}`; 409 when it overlaps a booking. Emits `hold.created` |
| PATCH | `/api/calendar/holds/:id` | `{title?, start?, end?}` | `{hold}` (409 on a booking) |
| DELETE | `/api/calendar/holds/:id` | – | `{ok}` |
| POST | `/api/calendar/holds/:id/convert` | `{clientId, kind?: inperson\|video}` | `{booking}`: a **trial** hold (400 otherwise) becomes one 1:1 at the same time, the hold is deleted, `booking.created` is emitted |

`Hold = {id, kind, title, start, end, leadId, createdAt}`.

`Conflict = {key, kind: overlap|buffer|external|timeOff|capacity|travel, severity: high|medium, a:{type, id, key?, start, end, title, …}, b:{…}, text}`.
Pairs: booking × booking (overlap: high; inside a buffer: medium; an in-person session less than `travelGap` after a video call: `travel`, medium),
booking × busy block (high; all-day busy: medium), booking × time off (high), booking × hold (overlap, high), hold × busy block (high; all-day medium),
hold × time off (medium), and a day over `maxPerDay` (`capacity`, medium, `a.type='day'`). `key` is the kind plus the sorted stable ids; a busy
block's stable id is `x<hash(source, UID, start)>`, because its row id changes on every sync.

### Slot finder, standing sessions, reschedule, waitlist (F21)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/calendar/find` | `?clientId=&kind=&minutes=&from=&to=(≤62 days)&prefer=any\|morning\|midday\|evening` | `{suggestions:[{start, end, kind, location, score, reasons:[string]}]}` (top 8; no `clientId` = hold mode) |
| POST | `/api/bookings/series` | `{clientId, kind, start, minutes (15–240), weeks (2–26), purpose?, location?}` | `{seriesId, booked:[Booking], skipped:[{start, reason}]}`; emits `booking.created` per booking and `booking.series {seriesId, count}` |
| POST | `/api/bookings/series/:seriesId/cancel` | `{from?: start}` (default now) | `{cancelled}` ("this and following"; a future session only) |
| POST | `/api/bookings/:id/reschedule` | `{start, message?}` | `{booking}`. **Coach**: any own booking, to any free time (409 "That time is not free: …"). **Client**: own 1:1, at least `cancelNoticeHours` before the current start (else 400), to an open slot (400 not a slot, 409 taken). Emits `booking.rescheduled`; pushes the other side; the coach's `message` is sent as a message (`via: coachAction`) |
| GET | `/api/waitlist` | – | `{items:[Wait]}` (the client's **current** coach sees the entry) |
| POST | `/api/waitlist` | **client or coach**: `{clientId (coach only), kind?: inperson\|video\|any, fromDay, toDay (≤92 days), prefer?, note? ≤280}` | `{item}`; 409 past 5 open entries |
| POST | `/api/waitlist/:id/offer` | `{start, text?}` | `{item, messageId}`: one message (`via: coachAction`), status `offered`. **Never books for the client** |
| DELETE | `/api/waitlist/:id` | **client or coach** | `{ok}` |

`Wait = {id, clientId, client:{id, name, initials}, kind, fromDay, toDay, prefer, note, status, offeredStart, matchStart, createdAt, updatedAt}`.

Scoring (deterministic, ties to the sooner slot): +3 matches the client's most common weekday and hour over their last 12 bookings (needs 2 or more),
+2 matches their onboarding `preferredTime` (morning before 10:00, midday to 15:00, evening after), +1 next to another session (within buffer + 20 min),
−2 the last slot of that day, −1 per day out.

### Diary and session notes (F22, `diary`)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/diary/:day` | – | `{day, agenda:[Item], entry:{day, body, mood, tags, updatedAt, words}\|null}` |
| PUT | `/api/diary/:day` | `{body ≤20000, mood?: 1–5\|null, tags?: [≤10 words ≤24]}` | `{entry}` (one per coach and day; a missing `mood`/`tags` keeps the stored one). `diary.written` once a day, when the page first has words |
| GET | `/api/diary` | `?from=&to=` (≤ a year; default the last 90 days) | `{days:[{day, words, mood}]}` |
| GET | `/api/sessions/:bookingId/notes` | – | `{booking, notes:[Note]}`: one per person on it (a class's attendees), blanks included |
| PUT | `/api/sessions/:bookingId/notes` | `{clientId, attendance?: attended\|late\|noShow\|lateCancel\|null, focus?, did?, wins?, next?, privateNote?}` | `{note}`; attendance other than `lateCancel` needs the session to have started (400). The client must be on the booking and still the coach's (404) |
| POST | `/api/sessions/:bookingId/notes/share` | `{clientId}` | `{messageId}`: exactly one message, "Session recap · Tue 4 Nov" with Focus, Wins and Next time (never `did` or the private note); 400 when all three are empty |
| GET | `/api/coach/clients/:id/attendance` | – | `{rate|null, attended, late, noShow, lateCancel, total, sessions:[{bookingId, kind, start, end, title, attendance, marked, note:{focus, did, wins, next, hasPrivate}|null, shared}]}` (last 180 days; late counts as attended) |

`Item` (the diary hook contract) = `{at|null, end?, day, kind, icon, title, detail, path, tone, source}`; session items add
`{bookingId, bookingKind, attendance, marked, people:[{id, name, attendance}], noteFocus}`. All-day items (`at: null`) sort first.

### Changed existing endpoints (owned files)

- `GET /api/slots`: busy is now bookings and holds (widened by the buffers, both ways), busy blocks and time off; plus `maxPerDay`, the travel gap and,
  **for clients only**, the minimum notice. A closed slot carries `reason` ("time off", "clash with Dentist (Personal)", "too close to … (buffer)",
  "no travel gap after …", "already 6 sessions that day", "too soon", "passed"). Apps ignore the extra key.
- `POST /api/bookings`: re-checks with the same function: 409 "That time has just gone" (400 when not a slot at all, as before).
  When the coach books a client in, the client's push carries the cancellation policy in one line ("Free to cancel up to 24 h before; later uses the session").
- `DELETE /api/bookings/:id`: "late" now means inside `cancelNoticeHours` (default 24, as before). A late client cancel keeps the credit only when
  `cancelForfeitCredit` is off. The `booking.cancelled` payload of a late cancel carries `policy:{forfeitCredit, feePence}`. The reply adds `late`.
- Bookings (`bookingOut`) gain `seriesId`; `refundable` uses the coach's notice.
- The coach's outbound feed `/cal/<token>.ics` adds time off ("Time off", all-day as DATE values) and holds ("Consult", "Trial", or an admin hold's own
  title). A lead's name never leaves in the feed.

## Events

| Event | Feature | Payload | `aiDerived` |
|---|---|---|---|
| `calendar.conflict` | calsync | `{key, kind, severity}` (new high-severity clash after a sync; once per key) | no |
| `hold.created` | calsync | `{holdId, kind, start, leadId}` | no |
| `waitlist.matched` | calsync | `{waitlistId, start, kind}` (per matching entry, clientId set) | no |
| `booking.series` | calsync (emitted in bookings.mjs) | `{seriesId, count}` | no |
| `booking.rescheduled` | calsync (emitted in bookings.mjs) | `{bookingId, from, to, byRole}` | no |
| `booking.upcoming` | calsync | `{bookingId, hoursBefore: 24\|2}` (per client on the session) | no |
| `booking.attended` / `booking.noShow` / `booking.lateCancel` | diary | `{bookingId, attendance, late, policy:{forfeitCredit, feePence}}` (`late` arrival is `booking.attended` with `late:true`; `feePence` is the no-show fee, the late-cancel fee, or 0) | no |
| `diary.written` | diary | `{day, words}` (never text) | no |
| `session.recapShared` | diary | `{bookingId, messageId}` | no |

Consumed: `booking.cancelled` (a freed 1:1 in the future is matched against waiting entries; the coach is notified "Slot freed Tue 07:00: 2 on the
waitlist", dedupe per booking), `lead.deleted` (holds lose `lead_id`; a consult or trial hold's title becomes "Consult"/"Trial").

## Clocks

- `calendar.sync` (60 s): up to 3 due, active, non-demo sources, one at a time. Due = `next_sync_at` passed: 15 min after a success (staggered by
  0–2 min per source), 60 min after an error. Network first, then one short transaction. After each sync, new high-severity clashes in the next 14 days
  notify (tone **urgent**, so they push outside quiet hours) and emit `calendar.conflict`, once per key (`calendar_conflicts_seen`, kept 30 days).
- `calendar.reminders` (5 min): a push at 24 h and at 2 h before each session, per client on it, once (`booking_reminders` is claimed first). Skips
  demo coaches and clients, skips the push (not the row) for `notifications_on = 0`, skips a threshold that had passed when the session was booked,
  and skips the 24 h one when the 2 h one is already due. Emits `booking.upcoming`.

## Facts, hooks

- Facts: `diary.noShows90` (number), `diary.attendance90` (0–100, null without sessions).
- Hooks: `inbox` (calsync: `waitlist:<id>:<start>` items while the freed slot is still free, with an "Offer this slot" action), `diary` (calsync: holds,
  busy blocks, time off; diary: sessions with attendance, letters landing that day), `quiet` (diary: no-show and late-cancel booking ids),
  `badges` (calsync: `{schedule: unignored clashes in the next 14 days}`), `search` (diary: journal text), `timeline` (diary: session notes),
  `exportFor` (below).

## Tables

`calendar_sources` (+ `sync_failed`, `next_sync_at`), `busy_blocks` (+ `ext_key`), `time_off`, `calendar_prefs`, `calendar_holds`, `conflict_ignores`,
`calendar_conflicts_seen` (new: which clashes were already notified), `waitlist` (+ `match_start`, `match_kind`), `booking_reminders`, `diary_entries`,
`session_notes`, and `bookings.series_id` (addColumn). All additive; every personal row has an `ON DELETE CASCADE` foreign key to `users`.

## Privacy, export and erasure

- Coach export: `features.calsync = {calendars (label, url_hint, … never the address), timeOff, holds, calendarRules}`, `features.diary = {diary}`.
- Client export: `features.calsync = {waitlist, sessionReminders}`, `features.diary = {sessionNotes}` **with `private_note`**, as the desk says
  ("Private: not shown in the app (but included if the client asks for their data)").
- Erasure is the foreign-key cascade (tests run `assertNoRowsFor` after `DELETE /api/me`).
- Reassignment: session notes and waitlist entries follow the client's **current** coach (tests move a client and check 404 / empty lists).

## Desk

- Nav: `schedule` (refined: badge from conflicts, `badgeOn` booking and calendar events), `diary` (Schedule group).
- Routes: `/schedule` (week and day grid, `?day=` jumps), `/schedule/waitlist`, `/schedule/class/:id/:day?`, `/diary/:day?`.
- Panels (deep links): `session:<bookingId>`, `notes:<bookingId>`, `finder:<clientId|any>`, `conflicts:open`.
- Widgets: `diary` (m), `conflicts` (s). Client action: `book` (slot finder). Commands: Find a slot for…, Hold time, Show calendar clashes, Add time off.
  Quick-create: booking (refined to the booking panel), hold. Settings: `calendars`, `availability`. Client tab: `sessions` (replaces the built-in one,
  see Design notes).
- Keyboard: on `/diary`, `[` and `]` move a day, `t` today. On the grid every session is a focusable button (Enter opens its panel, whose **Move**
  is the keyboard alternative to dragging).

## Deviations from the spec (the code wins)

1. **No saved rules = today's behaviour.** A coach without a `calendar_prefs` row gets no buffers, no notice and no travel gap (the table defaults,
   10 min / 12 h / 15 min, apply once they save). Turning this on in production therefore moves none of JK's bookable times until he chooses; the
   settings page says so and suggests the defaults.
2. **Minimum notice applies to clients only.** The coach can still book a client into a slot in two hours.
3. **Buffers apply both ways** (their buffer around an existing session, and the new session's own), so a slot never creates a buffer clash.
4. **Coach bookings in a standing series and coach reschedules may sit off the weekly-hours grid**, as long as nothing clashes. Client bookings and
   client reschedules still need an open slot.
5. **A converted trial hold is deleted** (as the API row says); `calendar_holds.booking_id` is kept in the schema but unused.
6. **`profile.preferredTime`** is the field the apps write (the spec says `profile.time`).
7. **Demo builders wipe their own tables** instead of declaring `demo.tables`: `demo.mjs`'s wipe throws on a database where feature schemas have not
   run yet, which is what `par.test.mjs` does (it builds the demo before `createApp`). See Integration requests.
8. `GET /api/calendar/busy` also returns `holds`; `GET /api/calendar/prefs` also returns `defaults`.
9. Waitlist offer text is a built-in sentence (the `reschedule` / waitlist templates belong to WP5's template feature); the desk prefills the reschedule
   message the same way and the coach can edit it.
10. Session reminders are pushes only (as the spec says), so they are not governed by the outreach caps.

## Integration requests

1. `server/demo.mjs` `wipe()`: skip `demo.tables` entries whose table does not exist yet (or run feature schemas first in `par.test.mjs`), so features
   can declare `demo.tables` again. Until then calsync and diary wipe their own demo rows inside `demo.build`.
2. `server/desk/today.css` styles the bare class `.today{max-width:780px}`; any element elsewhere with a `today` class is squeezed (the grid used one).
   Suggest renaming it to `.today-screen` in WP1's rewrite. WP7 now uses `cal-today`.
3. WP2 (clients.js): the Sessions tab is re-registered by `f-diary.js` (`registerClientTab({key: 'sessions'})`, no fallback) to show notes and the
   attendance ring. Keep `sessions` in the built-in list but let a registered render win, or drop the built-in one at merge.
4. WP1 (F1 `today-sessions` tile): conflict badges can come from `GET /api/calendar/conflicts` (or the `badges` count).
5. WP3 (F10): `booking.noShow` / `booking.lateCancel` carry `policy.feePence`; a late `booking.cancelled` carries `policy`. Nothing else to wire.
6. WP5: a `reschedule` template and a `waitlist` template would let `confirmMove` and the waitlist offer use the coach's own wording.
7. Glyphs: none missing.

## Parity gaps

- Real iCal addresses are not fetched in tests (`config.calFetch` fake). One manual fetch was run from this worktree on 2026-11-24:
  `https://www.gov.uk/bank-holidays/england-and-wales.ics` → 200, 18,186 bytes, an etag, 16 events for 2026–27 (matching the computed bank holidays),
  no warnings. A hostname that does not resolve fails cleanly. No personal calendar was fetched.
- The demo coach cannot sync (by design), so the demo calendar's status is the seeded "Synced 6 min ago".
- Session reminder pushes are proved with the recorder transport in tests; no device push in the local stack.
- The drag-to-move uses pointer events; it was exercised in headless Chromium (desktop). Touch drag on a phone is not offered: phones get the
  agenda list, and the session panel's Move.

## Design notes

- The grid draws busy time as hatched bands in the source's chart token, holds as dashed muted bands, time off as a full-height attention-tinted band,
  buffers as faint accent tails, and a warning glyph (urgent or attention, always with a word in the tooltip and the conflicts panel) on every clash.
- The journal is Newsreader on `--paper` with the hero `--sheen`; the history strip uses `--heat-0..4` (24 weeks).
- Only one primary button per region: Book on the header, the best suggestion's Book in the finder, Connect in Calendars.
