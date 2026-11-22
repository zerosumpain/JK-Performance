# JK Performance API (v1)

The contract between `server/` and the iPhone app. Change both sides together.

- Base URL: `https://jk.strangeramblings.com` (prod). Local preview: `http://100.83.68.108:5671`.
- JSON in and out, **camelCase**. Dates are `"YYYY-MM-DD"` (the client's local day). Instants are ISO 8601 UTC
  (`"2026-11-20T11:00:00.000Z"`). Ids are opaque strings.
- Auth: `Authorization: Bearer <token>` on every `/api/*` call except `/api/auth/*`, `/api/plans` and `/health`.
- Ranges: `from`/`to` are dates, both inclusive.
- Errors: non-2xx with `{"error": "human readable"}`. 401 = sign in again. 403 = role or membership doesn't allow it.
  404 = not found or not yours (never leaks existence).
- Roles: `client` | `coach`. A coach can act on any client by passing `clientId` where noted. A client never passes
  `clientId`; the server uses the caller.
- Membership gating is off while `GATE_SERVICES=false` (testing). When on, a client with `membership.plan == "none"`
  gets 403 `{"error":"membership_required"}` on service endpoints (workouts, habits, check-ins, bookings, messages).

## Auth & account

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/auth/apple` | `{identityToken, authorizationCode?, fullName?: {givenName?, familyName?}}` | `Session`. The code is swapped for an Apple refresh token, kept only to revoke on deletion |
| POST | `/api/auth/google` | `{idToken}` (Android: a Google ID token for one of `GOOGLE_CLIENT_IDS`) | `Session`. A verified email that matches an existing account joins it, so the coach and anyone moving from iPhone keep their account |
| GET | `/api/auth/apple/web?state=` | – | 302 to Apple (Sign in with Apple on Android and the coach web app, Services ID `APPLE_SERVICES_ID`). A state starting `web-` comes back to `/desk#state=…&code=…` (coaches only) |
| POST | `/api/auth/apple/callback` | Apple's form post | an HTML page that opens `jkperformance://auth?code=…&state=…` (or `?error=…`) |
| POST | `/api/auth/apple/finish` | `{code, web?}` (single use, 2 minutes) | `Session`; `web: true` (the coach web app) gives a 30-day web session, coaches only (403) |
| GET | `/api/auth/web/config` | – | `{google, googleClientId, apple, demo}`: which ways in the coach web app shows |
| POST | `/api/auth/web/google` | `{idToken}` (Google Identity Services, audience a `GOOGLE_CLIENT_IDS` web client) | `Session` (web). Coaches only: 403 for a client, and an unknown non-coach identity gets no account |
| POST | `/api/auth/web/code` | `{code}` | `Session` (web) as the demo coach for `DEMO_COACH_CODE`; 403 for the client code, 401 otherwise, 429 after 30 failures in 10 min |
| GET | `/api/android/config` | – | `{google, googleClientId, apple}`: which sign-in buttons the Android app shows |
| POST | `/api/auth/code` | `{code}` (App Review demo / local testing; 404 when unset) | `Session` |
| POST | `/api/auth/logout` | `{pushToken?}` (that phone's push token is removed too) | `{ok:true}` |
| POST | `/api/auth/demo-client` (coach) | – | `Session` as the demo client (preview the client side) |
| POST | `/api/auth/link-code` (coach) | – | `{code:"ABCD-EFGH", expiresAt, url}`: one use, 10 minutes, for the web desk |
| GET / DELETE | `/api/auth/web-sessions` | – | `{count, latestSignIn}` / `{count:0, ended}`: the caller's desk browsers, or sign them all out |
| POST | `/api/auth/link` | `{code}` (any case, dash optional) | `Session` with a 30-day web session; 401 bad/used/expired, 429 after 30 failures in 10 min |
| GET | `/api/me` | – | `Me` |
| PATCH | `/api/me` | `{name?}` | `Me` |
| DELETE | `/api/me` | – | `{ok:true, appleRevoked}` (erases the account and all its data, photos included, then revokes Sign in with Apple) |
| GET | `/api/me/export` | – | JSON download of everything stored about the caller |
| POST | `/api/me/membership` | `{plan}` (testing only, while `PAYMENTS=off`) | `Me` |
| GET | `/api/plans` | – | `{plans:[Plan]}` |

```jsonc
// Session
{"token":"…","me":Me}
// Me
{"id":"u_…","name":"Sam Carter","email":"…","role":"client","createdAt":"…",
 "membership":{"plan":"elite","planName":"Elite","since":"…","renewsOn":"2026-12-01","creditsLeft":3,"creditsTotal":4,"creditsResetOn":"2026-12-01"},  // null for a coach
 "coach":{"id":"u_…","name":"Coach JK"},       // null for a coach
 "isDemo":false, "healthSharing":true}          // healthSharing: clients only (null for a coach)
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
| PUT | `/api/workouts/:id/items/:itemId/sets/:number` | `{load, reps, rpe?}` (`rpe` a number 1–10) | `Workout` |
| DELETE | `/api/workouts/:id/items/:itemId/sets/:number` | – | `Workout` |
| POST | `/api/workouts/:id/complete` | `{note?}` | `Workout` |

```jsonc
// WorkoutInput
{"date":"2026-11-20","title":"Lower Body Strength","startsAt":"11:00","location":"Studio 2","notes":"",
 "items":[{"id":"optional-existing-id","exerciseId":"ex_…","sets":3,"reps":"10 / leg","load":"2×20 kg","rpe":"7–8","note":"…"}]}
// Workout
{"id":"w_…","clientId":"u_…","date":"2026-11-20","title":"…","startsAt":"11:00","location":"…","notes":"…",
 "published":true,"publishedAt":"…","editedAt":"…","editedBy":"coach","completedAt":null,"completionNote":null,"createdBy":"u_…",
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
`Program` = the same plus `{id, clientCount, updatedAt}`, and each item also carries `exercise` (an `Exercise`).

## Habits & nutrition

| GET | `/api/habits?date=&clientId=` | – | `{date, habits:[Habit], streak, nutrition:Nutrition}` |
|---|---|---|---|
| POST | `/api/habits` (coach) | `{clientId, name, kind, target, unit, icon, healthKind?}` | `Habit` |
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
`icon` is an SF Symbol name. `healthKind` (`steps` | `sleep` | null) makes the habit fill from Apple Health: it's done once the
value reaches `target`, whatever the kind. So "Sleep 7h+" is kind `check`, target 7, unit `h`. A plain `check` habit has target 1.
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
| GET | `/api/messages?clientId=&after=` | – | `{messages:[Message]}` (oldest first; marks read). `after` = the last message's `at` (ISO instant, exclusive) |
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
| POST | `/api/health/activities` | `{activities:[Activity]}` (≤500, idempotent on id) | `{stored:n}` |
| GET | `/api/health/activities?clientId=&from=&to=` | – | `{activities:[Activity]}` (default the last 28 days) |
| GET | `/api/health/summary?date=&clientId=` | – | `{date, steps, sleepMinutes, restingHr, activeKcal, weight, distanceKm}` |
| GET | `/api/health/week?clientId=&to=` | – | `{shared, sharedSince, days:[summary ×7], activities:[Activity]}`; not shared: `{shared:false, days:[], activities:[]}` |
| GET | `/api/health/devices` | – | `{appleHealth, lastSampleAt, activityCount, lastActivityAt, sharing, sharingSince}` |
| PUT | `/api/health/sharing` (client) | `{share:bool}` | as devices |
| DELETE | `/api/health/data` | – | as devices: erases every sample and activity, sharing off |

Kinds: `steps` (count), `sleep` (minutes asleep), `restingHr` (bpm), `activeKcal`, `weight` (kg; also written as a
progress measurement, but only while sharing is on), `distance` (km, walk/run/row; feeds challenges). The Steps and
"Sleep 7h+" habits fill from these.

`Activity` (an Apple Health workout): `{id (HealthKit UUID), type:"Running", date, start, end, minutes, kcal?, distanceKm?, avgHr?, source?}`.

**Consent.** Health is the client's. The client always sees their own. Their coach sees it (summary, week, activities,
Health-filled habit values, the Health line in a client's detail) only while `sharing` is on: otherwise those return
403 `health_not_shared`, `shared:false`, or nulls. `GET /api/coach/clients/:id` carries `healthShared`.

## Challenges

| GET | `/api/challenges` | – | `{challenges:[Challenge]}` |
|---|---|---|---|
| POST | `/api/challenges` (coach) | `{title, detail, metric:"distance", target, start, end}` | `Challenge` |
| POST | `/api/challenges/:id/join` | – | `Challenge` |

`Challenge`: `{id, title, detail, metric, target, start, end, daysLeft, members, joined, mine, leaderboard:[{rank, id, name, initials, value, isMe}], badges, streak}`. A client's leaderboard is the top 3 plus themselves.

## Coach

| GET | `/api/coach/today?date=` | – | `{date, sessions:[Booking], activeClients, totalClients, unread, tip:Guide, feedbackDue:{week, dueBy, clients:[PersonRef]}, checkinsToReview, checkinClients:[PersonRef+at], formsToReview, formClients:[PersonRef+at], unreadClients:[PersonRef+at], urgent:[AttentionItem], quiet:[PersonRef+days], upcoming:[{client, date, autoflow, action}], sessionsLeftThisWeek, attention:[AttentionItem ≤5]}` |
|---|---|---|---|
| GET | `/api/coach/clients` | – | `{clients:[ClientSummary]}`, most in need first (see `demand`) |
| GET | `/api/coach/clients/:id` | – | `{client:ClientSummary, health, nextWorkout:Workout?}` |
| GET | `/api/coach/business?period=week|month` | – | `Business` |
| GET | `/api/guides` | – | `{featured:Guide, tips:[Guide]}` — `Guide`: `{id, title, minutes, tags, body}` |

```jsonc
// ClientSummary (adherence null when nothing was due)
{"id","name","initials","plan","since","adherence":86,"lastWorkoutAt":"…","checkinDue":false,
 "flags":["no-workout-9d","no-workout-yet","checkin-overdue"],"unread":1,"lastMessageAt","lastMessageFrom":"client|coach",
 "demand":{"kind":"urgent|message|form|checkin|quiet|inactive|ok","reason":"Mentions pain in a message","at":"…",
           "urgent":["…every urgent reason"],"lastContactAt":"…","quietDays":12,"rank":5}}
// urgent = an unread message mentioning pain/injury, a check-in with pain AND energy ≤ 2, or a form "yes" to a flagged question.
// Order: urgent, unread message (newest first), form to read, check-in to reply to, no coach contact (message or
// check-in reply) in 7+ days (longest first), no workout lately, then everyone else.
// Business
{"mrrPence":248600,"mrrDeltaPct":12,"series":[{"date","pence"}],"active":18,"new":2,"churned":1,"adherence":86,
 "attention":[{"client":{id,name,initials},"reason":"No workout logged in 9 days","kind":"inactive|checkin|payment"}],
 "plans":[{"id":"elite","name":"Elite","members":3}]}   // mrrDeltaPct and adherence may be null
```
Adherence = completed ÷ published workouts dated in the last 28 days, as a percentage.

## Forms

| | | | |
|---|---|---|---|
| GET | `/api/forms` | coach | `{forms:[Form], templates:[{name,intro,questions}]}` — templates are ready-made starting points |
| POST · PUT | `/api/forms` · `/api/forms/:id` | coach | `{name, intro?, questions:[Question]}` → `Form` |
| DELETE | `/api/forms/:id` | coach | sent copies stay with clients |
| POST | `/api/forms/:id/send` | coach | `{clientId}` → `FormRequest`; pushes the client |
| GET | `/api/form-requests?clientId=` | both | `{requests:[FormRequest]}` — a coach naming no client gets every answered, unread one |
| GET | `/api/form-requests/:id` | both | `FormRequest` |
| POST | `/api/form-requests/:id/answers` | client | `{answers:{questionId: value}}` once; 409 after; pushes the coach |
| POST | `/api/form-requests/:id/review` | coach | marks read |
| DELETE | `/api/form-requests/:id` | coach | withdraw an unanswered one (409 once answered) |

```jsonc
// Question: kind text (≤300) | long (≤4000) | scale (1–5) | yesno (bool) | choice (one of options)
{"id":"joint","kind":"yesno","label":"…","flag":true,"required":false,"options":["…"]}
// Form
{"id","name","intro","questions":[Question],"sent":4,"waiting":1,"toReview":1,"updatedAt"}
// FormRequest: its own copy of the questions, so later edits never change it. flagged = labels answered yes on flag questions.
{"id","formId","name","intro","questions","client":PersonRef,"sentAt","answers":{…}|null,"submittedAt","reviewedAt","flagged":["…"],"fromAutoflow":true}
```

## Autoflows

Steps run on day N after the start (0 = the day itself): `message` (`{first}` becomes the client's first name),
`form`, or `program` (laid from the next Monday and **published**). A `join` flow starts when a client signs up to the
coach; `manual` ones when the coach enrols someone. The server runs due steps on enrolment and every 5 minutes, once each.

| | | | |
|---|---|---|---|
| GET | `/api/autoflows` | coach | `{autoflows:[Autoflow]}` |
| POST · PUT | `/api/autoflows` · `/api/autoflows/:id` | coach | `{name, trigger:'join'|'manual', active?, steps:[{id?, day, action, text?|formId?|programId?}]}` |
| DELETE | `/api/autoflows/:id` | coach | |
| POST | `/api/autoflows/:id/enrol` | coach | `{clientId, startDate?}` → `Run`; 409 if already in it |
| DELETE | `/api/autoflows/:id/runs/:runId` | coach | stop a client's run |
| GET | `/api/coach/clients/:id/autoflows` | coach | `{runs:[Run]}` |

```jsonc
// Autoflow
{"id","name","trigger","active":true,"steps":[{"id","day","action","text"|"formId"|"programId","label":"Form · Intake"}],"runs":[Run]}
// Run
{"id","autoflowId","autoflowName","client":PersonRef,"startDay","stepsDone":2,"steps":5,"stoppedAt":null,
 "next":{"day":7,"date":"2026-11-28","label":"Message · First week done…"}|null,"log":[{"stepId","label","at","outcome"}]}
```

## Weekly feedback

A coach's write-up of one client's week (Monday `week` to Sunday). Drafts are the coach's; publishing shows it to the
client and, the first time, posts a message to their thread. Written from the app or the web desk (`/desk`).

| GET | `/api/reports?clientId=` | – | `{reports:[Report], unread, suggestedWeek}` (client: published only) |
|---|---|---|---|
| GET | `/api/reports/week/:monday?clientId=` (coach) | – | `Report` with stats and plan (`id:null` when not written) |
| PUT | `/api/reports` (coach) | `{clientId, week, summary, wins, focus, status:"draft"\|"published"}` | full `Report` |
| GET | `/api/reports/:id` | – | full `Report`; a client reading marks it read |
| DELETE | `/api/reports/:id` (coach) | – | `{ok:true}` |

```jsonc
// Report (list items omit stats and plan)
{"id":"r_…","clientId","week":"2026-11-16","weekEnd":"2026-11-22","summary","wins","focus",
 "status":"published","publishedAt","readAt","updatedAt","coachName":"Coach JK",
 "stats":{"workoutsPlanned":2,"workoutsDone":2,"setsLogged":31,"habitsPct":71,"checkin":{energy,sleep,pain,note,submittedAt}|null,
          "weightStart":79.1,"weightEnd":78.8,"healthShared":true,"avgSteps":9120,"avgSleepMinutes":431,
          "activities":{"count":3,"minutes":128,"types":["Running","Cycling"]}},   // health figures null unless shared
 "plan":{"from","to","workouts":[WorkoutSummary]}}   // the following week; drafts appear for the coach only
```
`suggestedWeek`: last week's Monday until Friday, then this week's.

## Calendar feed

| GET | `/api/calendar/feed` | – | `{active}` |
|---|---|---|---|
| POST | `/api/calendar/feed` | – | `{active:true, url, webcal}`: a new private URL; the old one stops |
| DELETE | `/api/calendar/feed` | – | `{active:false}` |
| GET | `/cal/<token>.ics` (no auth) | – | iCalendar: the person's bookings, joined classes and timed workouts (a coach: all their bookings), 30 days back onwards |

Only the token's hash is stored. Single events are added on the phone with EventKit and need no server call.

## Push notifications

| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/api/push/token` | `{token, platform?: "ios"\|"android", env?: "production"\|"sandbox"}`: an APNs token in hex, or an FCM registration token (case kept) | `{ok:true, enabled}` (`enabled` false when the server can't push to that platform) |
| DELETE | `/api/push/token?token=` | – | `{ok:true}`; no `token` removes all of the caller's phones |

Sent (never to demo accounts; never waits on Apple): a message → the other side; first publish of weekly feedback → the client;
first check-in of the week → the coach; a 1:1 booked or cancelled → the other side. Payload: `aps.alert {title, body}`,
`kind` (`message`/`report`/`checkin`/`booking`), `id?`, `clientId?`. Apple's 410 / BadDeviceToken drops the token.

Server env: `APPLE_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_FILE` (the .p8, mounted read-only). Without them push is off and
deletion skips the Apple revoke. Android goes through Firebase Cloud Messaging (HTTP v1): `FCM_SERVICE_ACCOUNT_FILE` (the
Firebase service account JSON, mounted read-only); the same payload arrives as a notification plus `data {kind, id?, clientId?}`.
FCM's 404 / UNREGISTERED drops the token.

## Demo accounts

`DEMO_CODE` signs in as the demo client "Sam Carter", and `DEMO_COACH_CODE` as the demo coach (also on the coach web app). Both live in a
separate demo world with five other clients and a few weeks of history. Demo accounts never appear in a real coach's lists.

## Pages (HTML)

`/android/<ANDROID_DOWNLOAD_TOKEN>` (private download page for the Android APK while there's no Play Store listing; the
file is `<DATA_DIR>/android/jk-performance.apk` + `version.json`, put there by `scripts/android-publish.sh`),
`/` (what the app is), `/privacy`, `/support`, `/health` (liveness, JSON `{ok:true}`), `/desk` (the coach web app:
everything the coach can do in the apps, over this API; sign in with Google, Apple, a link code from the app or the demo
coach code; `/login` redirects there). Its files are the ES modules and stylesheets in `server/desk/`.
