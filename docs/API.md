# JK Performance API (v1)

The contract between `server/` and the iPhone app. Change both sides together.

- Base URL: `https://jk.strangeramblings.com` (prod). Local preview: `http://100.83.68.108:5661`.
- JSON in and out, **camelCase**. Dates are `"YYYY-MM-DD"` (the client's local day). Instants are ISO 8601 UTC
  (`"2026-11-20T11:00:00.000Z"`). Ids are opaque strings.
- Auth: `Authorization: Bearer <token>` on every `/api/*` call except `/api/auth/*`, `/api/plans` and `/health`.
- Errors: non-2xx with `{"error": "human readable"}`. 401 = sign in again. 403 = role or membership doesn't allow it.
  404 = not found or not yours (never leaks existence).
- Roles: `client` | `coach`. A coach can act on any client by passing `clientId` where noted. A client never passes
  `clientId`; the server uses the caller.
- Membership gating is off while `GATE_SERVICES=false` (testing). When on, a client with `membership.plan == "none"`
  gets 403 `{"error":"membership_required"}` on service endpoints (workouts, habits, check-ins, bookings, messages).

## Auth & account

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/apple` | `{identityToken, fullName?: {givenName?, familyName?}}` | `Session` |
| POST | `/api/auth/code` | `{code}` (App Review demo / local testing; 404 when unset) | `Session` |
| POST | `/api/auth/logout` | – | `{ok:true}` |
| GET | `/api/me` | – | `Me` |
| PATCH | `/api/me` | `{name?}` | `Me` |
| DELETE | `/api/me` | – | `{ok:true}` (erases the account and all its data, photos included) |
| GET | `/api/me/export` | – | JSON download of everything stored about the caller |
| POST | `/api/me/membership` | `{plan}` (testing only, while `PAYMENTS=off`) | `Me` |
| GET | `/api/plans` | – | `{plans:[Plan]}` |

```jsonc
// Session
{"token":"…","me":Me}
// Me
{"id":"u_…","name":"Sam Carter","email":"…","role":"client","createdAt":"…",
 "membership":{"plan":"elite","planName":"Elite","since":"…","renewsOn":"2026-12-01","creditsLeft":3,"creditsTotal":4,"creditsResetOn":"2026-12-01"},  // null for a coach
 "coach":{"id":"u_…","name":"Coach JK"}}       // null for a coach
// Plan
{"id":"elite","name":"Elite","detail":"Weekly 1:1 sessions, nutrition, priority messaging",
 "monthlyPence":14900,"annualPence":152000,"credits":4}
```
Plans: `none` (free, info only), `foundation`, `performance`, `elite`.

## Exercises

| GET | `/api/exercises?q=&category=` | – | `{exercises:[Exercise]}` |
|---|---|---|---|
| POST | `/api/exercises` (coach) | `{name, equipment, pattern, category, videoUrl?}` | `Exercise` |

`Exercise`: `{id, name, equipment, pattern, category, videoUrl}`. ~60 seeded; ids like `ex_back-squat`. Categories: `Legs Push Pull Core Mobility Conditioning`.

## Workouts (plan → completion)

A workout is one dated session for one client. The coach writes it. It's invisible to the client until `published`;
the client logs sets against its items. A client may also create their own (always published, `createdBy` = them).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/workouts?from=&to=&clientId=` | – | `{workouts:[WorkoutSummary]}` |
| GET | `/api/workouts/:id` | – | `Workout` |
| POST | `/api/workouts` | `WorkoutInput` (+`clientId` for a coach) | `Workout` |
| PUT | `/api/workouts/:id` | `WorkoutInput` (replaces items; logged sets on kept item ids survive) | `Workout` |
| DELETE | `/api/workouts/:id` | – | `{ok:true}` |
| POST | `/api/workouts/:id/publish` (coach) | – | `Workout` |
| PUT | `/api/workouts/:id/items/:itemId/sets/:number` | `{load, reps, rpe?}` | `Workout` |
| DELETE | `/api/workouts/:id/items/:itemId/sets/:number` | – | `Workout` |
| POST | `/api/workouts/:id/complete` | `{note?}` | `Workout` |

```jsonc
// WorkoutInput
{"date":"2026-11-20","title":"Lower Body Strength","startsAt":"11:00","location":"Studio 2","notes":"",
 "items":[{"id":"optional-existing-id","exerciseId":"ex_…","sets":3,"reps":"10 / leg","load":"2×20 kg","rpe":"7–8","note":"…"}]}
// Workout
{"id":"w_…","clientId":"u_…","date":"2026-11-20","title":"…","startsAt":"11:00","location":"…","notes":"…",
 "published":true,"publishedAt":"…","editedAt":"…","editedBy":"coach","completedAt":null,"createdBy":"u_…",
 "items":[{"id":"i_…","order":0,"exercise":Exercise,"sets":3,"reps":"10 / leg","load":"2×20 kg","rpe":"7–8","note":"…",
           "logged":[{"number":1,"load":"2×20","reps":10,"rpe":null,"at":"…"}],
           "previous":"2×18 × 10"}]}       // last time this exercise was logged, best set; null if never
// WorkoutSummary = Workout without items, plus {"itemCount":5,"doneCount":2}
```

## Programs (coach templates)

| GET | `/api/programs` | – | `{programs:[Program]}` (+`clientCount`) |
|---|---|---|---|
| POST | `/api/programs` | `ProgramInput` | `Program` |
| PUT | `/api/programs/:id` | `ProgramInput` | `Program` |
| DELETE | `/api/programs/:id` | – | `{ok:true}` |
| POST | `/api/programs/:id/assign` | `{clientId, startDate}` | `{created: n}` (draft workouts; coach publishes) |

`ProgramInput`: `{name, detail, daysPerWeek, weeks, workouts:[{dayOffset, title, items:[WorkoutInput item]}]}`.

## Habits & nutrition

| GET | `/api/habits?date=&clientId=` | – | `{date, habits:[Habit], streak, nutrition:Nutrition}` |
|---|---|---|---|
| POST | `/api/habits` (coach) | `{clientId, name, kind, target, unit, icon}` | `Habit` |
| DELETE | `/api/habits/:id` (coach) | – | `{ok:true}` |
| PUT | `/api/habits/:id/days/:date` | `{value?, done?}` | `Habit` |
| PUT | `/api/nutrition/targets` (coach) | `{clientId, kcal, protein, carbs, fat}` | `Nutrition` |
| POST | `/api/nutrition/entries` | `{date, name, kcal, protein, carbs, fat}` | `Nutrition` |
| DELETE | `/api/nutrition/entries/:id` | – | `Nutrition` |

```jsonc
// Habit — kind "check" (target 1) or "count" (e.g. 3 L water, 10000 steps)
{"id":"h_…","name":"Water","kind":"count","target":3,"unit":"L","icon":"drop","healthKind":null,"value":2.1,"done":false,
 "source":"manual"}   // healthKind "steps"|"sleep" fills value from Apple Health (sleep in hours)   // "health" when filled from Apple Health (steps, sleep)
// Nutrition (for the date)
{"date":"…","targets":{"kcal":2500,"protein":170,"carbs":260,"fat":80},
 "totals":{"kcal":1720,"protein":128,"carbs":180,"fat":52},"entries":[{"id","name","kcal","protein","carbs","fat","at"}]}
```
`streak` = consecutive days, ending yesterday or today, with every habit done.

## Weekly check-ins

| GET | `/api/checkins?clientId=` | – | `{checkins:[CheckIn], dueWeek:"2026-11-16"}` |
|---|---|---|---|
| POST | `/api/checkins` | `{energy, sleep, pain:["Knee"], note}` | `CheckIn` (one per week; re-posting updates it. From Friday it's this week's, before that last week's = `dueWeek`) |
| POST | `/api/checkins/:id/review` (coach) | `{reply}` | `CheckIn` |

`CheckIn`: `{id, clientId, week, energy, sleep, pain, note, submittedAt, reviewedAt, reply}`. `week` = Monday's date.

## Messages

| GET | `/api/threads` (coach) | – | `{threads:[{client:{id,name}, last:Message, unread}]}` |
|---|---|---|---|
| GET | `/api/messages?clientId=&after=` | – | `{messages:[Message]}` (oldest first; marks read) |
| POST | `/api/messages` | `{text, clientId?, workoutId?}` | `Message` |

`Message`: `{id, clientId, fromId, fromRole, text, workoutId, at, readAt}`. A client's thread is always with the coach.
The app polls every 15 s while a thread is open (push comes later).

## Bookings & calendar

The coach sets weekly availability. The server cuts it into slots, less existing bookings. A 1:1 booking uses a credit,
and cancelling 24 h or more ahead refunds it. A group class is coach-created with a capacity, and clients join it free.

| GET | `/api/availability` (coach) | – | `{rules:[Rule]}` |
|---|---|---|---|
| PUT | `/api/availability` (coach) | `{rules:[Rule]}` | `{rules:[Rule]}` |
| GET | `/api/slots?from=&to=&kind=` | – | `{slots:[{start,end,kind,location,open}]}` |
| GET | `/api/bookings?from=&to=&clientId=` | – | `{bookings:[Booking]}` (coach: all clients unless filtered) |
| POST | `/api/bookings` | `{start, kind, clientId?}` | `Booking` |
| DELETE | `/api/bookings/:id` | – | `{ok:true, refunded:true}` |
| POST | `/api/classes` (coach) | `{title, start, end, capacity, location}` | `Booking` (kind `group`) |
| POST | `/api/classes/:id/join` / `leave` | – | `Booking` |

```jsonc
// Rule: weekday 1=Mon…7=Sun, local times
{"weekday":3,"start":"07:00","end":"19:00","kind":"inperson","slotMinutes":60,"location":"Studio 2"}
// Booking
{"id":"b_…","kind":"inperson|video|group","start":"…","end":"…","location":"Studio 2","title":"1:1 with Coach JK",
 "client":{"id","name"},"attendees":[{"id","name"}],"attendeeCount":0,"capacity":null,"usesCredit":true,
 "joined":true,"cancellable":true,"refundable":true}   // a client sees every group class of their coach; joined says if they're in it
```
Times are Europe/London. The server stores UTC and returns ISO instants.

## Progress

| GET | `/api/progress?range=3m|6m|all&clientId=` | – | `Progress` |
|---|---|---|---|
| POST | `/api/measurements` | `{date, kind, value}` | `Progress` |
| GET | `/api/photos?clientId=` | – | `{photos:[{id, date, url}]}` |
| POST | `/api/photos?date=` | raw `image/jpeg` body (≤ 8 MB) | `{id, date, url}` |
| GET | `/api/photos/:id` | – | JPEG bytes (auth required; client + their coach only) |
| DELETE | `/api/photos/:id` | – | `{ok:true}` |

```jsonc
// Progress. Measurement kinds: weight (kg), bodyFat (%), waist (cm), restingHr (bpm)
{"since":"2026-03-03","weight":{"latest":78.4,"delta":-4.1,"series":[{"date","value"}]},
 "stats":[{"kind":"bodyFat","latest":16.2,"delta":-2.4},{"kind":"waist",…},{"kind":"restingHr",…}],
 "records":[{"exercise":"Back Squat","kg":120,"gain":20,"date":"…"}]}   // best logged load per exercise; gain vs first
```

## Health (Apple Health; WHOOP/Oura/Garmin reach it through Apple Health)

| POST | `/api/health/samples` | `{samples:[{id, kind, start, end, value}]}` (idempotent on id) | `{stored:n}` |
|---|---|---|---|
| GET | `/api/health/summary?date=&clientId=` | – | `{date, steps, sleepMinutes, restingHr, activeKcal, weight, distanceKm}` |
| GET | `/api/health/devices` | – | `{appleHealth:bool, lastSampleAt}` |

Kinds: `steps` (count), `sleep` (minutes asleep), `restingHr` (bpm), `activeKcal`, `weight` (kg, also written as a
measurement), `distance` (km, walk/run/row; feeds challenges). The Steps and "Sleep 7h+" habits fill from these.

## Challenges

| GET | `/api/challenges` | – | `{challenges:[Challenge]}` |
|---|---|---|---|
| POST | `/api/challenges` (coach) | `{title, detail, metric:"distance", target, start, end}` | `Challenge` |
| POST | `/api/challenges/:id/join` | – | `Challenge` |

`Challenge`: `{id, title, detail, metric, target, start, end, daysLeft, members, joined, mine, leaderboard:[{rank, id, name, initials, value, isMe}], badges, streak}`. A client's leaderboard is the top 3 plus themselves.

## Coach

| GET | `/api/coach/today?date=` | – | `{date, sessions:[Booking], activeClients, totalClients, unread, tip:Guide}` |
|---|---|---|---|
| GET | `/api/coach/clients` | – | `{clients:[ClientSummary]}` |
| GET | `/api/coach/clients/:id` | – | `{client:ClientSummary, health, nextWorkout:Workout?}` |
| GET | `/api/coach/business?period=week|month` | – | `Business` |
| GET | `/api/guides` | – | `{featured:Guide, tips:[Guide]}` — `Guide`: `{id, title, minutes, tags, body}` |

```jsonc
// ClientSummary (adherence null when nothing was due)
{"id","name","initials","plan","since","adherence":86,"lastWorkoutAt":"…","checkinDue":false,
 "flags":["no-workout-9d","no-workout-yet","checkin-overdue"],"unread":1}
// Business
{"mrrPence":248600,"mrrDeltaPct":12,"series":[{"date","pence"}],"active":18,"new":2,"churned":1,"adherence":86,
 "attention":[{"client":{id,name,initials},"reason":"No workout logged in 9 days","kind":"inactive|checkin|payment"}],
 "plans":[{"id":"elite","name":"Elite","members":3}]}   // mrrDeltaPct and adherence may be null
```
Adherence = completed ÷ published workouts dated in the last 28 days, as a percentage.

## Demo accounts

`DEMO_CODE` signs in as the demo client "Sam Carter", and `DEMO_COACH_CODE` (local only) as the demo coach. Both live in a
separate demo world with five other clients and a few weeks of history. Demo accounts never appear in a real coach's lists.

## Pages (HTML)

`/` (what the app is), `/privacy`, `/support`, `/health` (liveness, JSON `{ok:true}`).
