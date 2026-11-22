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
| PUT | `/api/me/onboarding` | `{goals?:[Goal], experience?, daysPerWeek?, preferredTime?, injuries?, done?}` (clients) | `Me` |
| GET | `/api/plans` | – | `{plans:[Plan], features:[Feature]}` (public; signed in: your coach's prices, or a coach's own) |

```jsonc
// Session
{"token":"…","me":Me}
// Me
{"id":"u_…","name":"Sam Carter","email":"…","role":"client","createdAt":"…",
 "membership":{"plan":"elite","planName":"Elite","since":"…","renewsOn":"2026-12-01","creditsLeft":3,"creditsTotal":4,"creditsResetOn":"2026-12-01"},  // null for a coach
 "coach":{"id":"u_…","name":"Coach JK"},       // null for a coach
 "isDemo":false, "healthSharing":true,          // healthSharing: clients only (null for a coach)
 "onboarded":true,                               // false: a new client who hasn't answered the first-run questions (show onboarding)
 "profile":Profile}                              // clients only; null until answered (and when every question was skipped)
// Profile (every field may be null / empty: each question can be skipped)
{"goals":["strength","muscle"],"experience":"new|some|experienced","daysPerWeek":4,
 "preferredTime":"morning|midday|evening|varies","injuries":"Left knee","answeredAt":"…"}
// Goal: strength | muscle | fatloss | fitness | performance | mobility | health
// Plan
{"id":"elite","name":"Elite","detail":"Weekly 1:1 sessions, nutrition, priority messaging",
 "pitch":"The full service: …","monthlyPence":14900,"annualPence":152000,"credits":4,
 "featured":false,                               // the one "most popular" plan
 "features":["programme","messaging",…],          // Feature ids, catalogue order
 "updatedAt":"…"}                                 // only once the coach has changed it
// Feature (fixed catalogue; the apps draw each with its own icon and preview)
{"id":"sessions","title":"1:1 sessions","detail":"Book sessions with your coach…","points":["Session credits every month",…]}
// ids: programme, messaging, habits, progress, checkin, sessions, nutrition, priority, guides
```
Plans: `none` (free, info only), `foundation`, `performance`, `elite`. The ids are fixed; each coach sets the name,
prices, credits, features and wording for their own clients (`PUT /api/coach/plans/:id`). PUT `/api/me/onboarding`
with `done:false` saves answers without finishing.

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
| GET | `/api/coach/clients/:id` | – | `{client:ClientSummary, profile:Profile?, health, nextWorkout:Workout?}` |
| GET | `/api/coach/business?period=week|month` | – | `Business` |
| GET | `/api/guides` | – | `{featured:Guide, tips:[Guide]}` — `Guide`: `{id, title, minutes, tags, body}` |
| PUT | `/api/coach/plans/:id` | any of `{name, detail, pitch, monthlyPence, annualPence, credits, featured, features}` | `{plans, features}` |
| POST | `/api/coach/plans/reset` | – | `{plans, features}` (every plan back to the defaults) |

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
 "plans":[{"id":"elite","name":"Elite","monthlyPence":14900,"members":3}]}   // every plan, Free ("none") included; mrrDeltaPct and adherence may be null
```
Plan edits: the free plan (`none`) has no price or credits; a plan with `sessions` needs credits ≥ 1; one plan is
`featured` at a time (featuring one un-features the rest). A price change applies from now: MRR for earlier days uses
the price of that day. While `PAYMENTS=off` nobody is charged; with App Store billing, the App Store Connect price is
what is charged and must be changed there too.
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
coach code; `/login` redirects there). Its files are the ES modules and stylesheets in `server/desk/`, plus the
self-hosted Newsreader serif at `/desk/fonts/<name>.woff2` (SIL OFL 1.1, text in `server/desk/fonts/OFL-Newsreader.txt`).
Icons are Material Symbols Rounded (Apache 2.0) drawn inline from `server/desk/symbols.js`.

## Atelier redesign additions

Everything below is additive (docs/design/atelier-spec.md, "Server and data changes"). Old fields and endpoints keep
working for old app builds. New client routes are never gated in a way that 403s what Today or the JK tab call: those
return a reduced payload instead. Other new client routes use one helper (`requireFeature`, settings.mjs): like
`requireMember` it is off while `GATE_SERVICES=false`; when on, a client whose plan lacks the feature gets 403
`{"error":"feature_not_in_plan"}`. It guards `/api/habits/week` and `/api/habits/history` ('habits'),
`/api/checkins/draft` and `POST /api/reports/:id/answer` ('checkin').

### Features, coach, preferences on `Me` (items 1, 15, 17; phase 5)

`GET /api/me` gains:

```jsonc
"features": {            // every key always present; a coach gets true for every plan feature
  "programme":true,"messaging":true,"habits":true,"progress":true,"checkin":true,"sessions":true,
  "nutrition":true,"priority":true,"guides":true,
  "formChecks":false,"mealPhotos":false,"challenges":false,   // coach toggles, not plan features
  "hasMacroTargets":true                                      // the Fuel ring needs targets; logging food does not
},
"coach": {               // clients only (null for a coach), as before plus:
  "id":"u_…","name":"Coach JK",
  "avatarMediaId":"md_…"|null, "avatarUrl":"/api/media/md_…"|null,        // JK's portrait (fetch with the bearer token)
  "signatureMediaId":null, "signatureUrl":null,
  "replyExpectation":{"standard":"JK replies most evenings","priority":"Same-day replies"},
  "replyLine":"Same-day replies"                                          // the one this client sees (priority plans get priority)
},
"preferences": {"notificationsOn":true,"eveningReminderTime":"20:30"|null},
"coachSettings": CoachSettings | null   // a coach's own settings; null for clients
```

If `features` is missing (an older server) the apps show everything as before.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / PUT | `/api/me/preferences` | `{notificationsOn?, eveningReminderTime?: "HH:MM"\|null}` | `{notificationsOn, eveningReminderTime}` |
| GET | `/api/coach/settings` (coach) | – | `CoachSettings` |
| PATCH | `/api/coach/settings` (coach) | any subset of `CoachSettings` | `CoachSettings` |
| PATCH | `/api/coach/clients/:id/settings` (coach) | `{dayMinimum?: 1–5\|null, letterRhythm?: "weekly"\|"fortnightly"\|"none"\|null, coachLine?: text\|null}` | `ClientSettings` |

```jsonc
// CoachSettings (defaults shown)
{"studioTools":false,          // show Programs, Forms, Autoflows, Plans & prices, Business, availability on the phone
 "formChecks":false,"mealPhotos":false,"challenges":false,
 "replyExpectation":{"standard":"JK replies most evenings","priority":"Same-day replies"},
 "defaultMeetingUrl":null,     // video bookings without their own link use this (https only)
 "avatarMediaId":null,"signatureMediaId":null,   // ids of images the coach uploaded with POST /api/media
 "letterRhythm":{"elite":{"every":"weekly","media":true},"performance":{"every":"weekly","media":false},
                 "foundation":{"every":"none","media":false},"none":{"every":"none","media":false}}}
// ClientSettings
{"dayMinimum":3,"dayMinimumIsDefault":true,
 "letterRhythm":{"every":"weekly","days":7,"media":true,"overridden":false},"letterRhythmOverride":null,
 "coachLine":{"text":"Easy week: walk, sleep, eat well.","setAt":"…"}|null}   // an occasional line for the client's Today
```

### Guides for clients (item 2)

| GET | `/api/client/guides` | – | `{guides:[{id, title, summary, minutes, tags}]}` |
|---|---|---|---|
| GET | `/api/client/guides/:id` | – | `{id, title, summary, minutes, tags, body}` (body: paragraphs split by `\n\n`) |

Any signed-in user whose plan includes `guides` (every default plan, Free included); never `requireMember`. A plan
without guides gets `{guides:[]}`, never a 403. `GET /api/guides` stays the coach's tips.

### Habits: IconKey, step, the day rule, rest days (items 3, 5, 6)

`Habit` gains `iconKey` (closed catalogue: `water sleep steps protein supplement energy mobility mindfulness reading
sunlight custom`), `step` (the +/- increment for count habits; the coach's, or a default from the target), `introducedAt`,
`position`. `icon` (the SF name) stays for old builds and is derived from `iconKey` when only that is sent. Existing
habits were mapped from their SF names (`drop`→water, `moon`→sleep, `shoeprints.fill`→steps, `bolt`→energy, …;
anything unknown → custom).

**The day rule.** A day is done when the client's minimum is met: the coach's `dayMinimum`, or ceil(60%) of the habits
that existed that day (3 of 5). A rest day JK granted is neither done nor missed. Future days are never done.

`GET /api/habits` gains (the old `streak`, every habit every day, stays for one release):

```jsonc
"dayDone":false, "doneCount":2, "dayMinimum":3,
"rest":{"date":"2026-11-22","reason":"Travelling"}|null,   // today is a rest day JK granted
"consistency":{"done":22,"days":27,"rest":1,"window":28},   // "22 of the last 27 days": the 28 days ending today,
                                                            // today counted only once done, rest days in neither
"missedYesterday":true                                      // "Yesterday slipped. Today keeps it going."
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/habits/week?from=&to=&clientId=` | – | `{from, to, dayMinimum, days:[DayState]}`; default this Monday to Sunday |
| GET | `/api/habits/history?from=&to=&clientId=` | – | `HabitHistory`; default the last 28 days (≤ 92) |
| POST | `/api/habits` (coach) | `{clientId, name, kind, target, unit, iconKey?, icon?, step?, healthKind?}` | `Habit`; 409 when the client already has 5 |
| PATCH | `/api/habits/:id` (coach) | any of `{name, kind, target, unit, iconKey, icon, step, healthKind, position}` | `Habit` |
| GET | `/api/clients/:id/rest-days?from=&to=` (coach) | – | `{restDays:[{date, reason, grantedAt}]}` |
| POST | `/api/clients/:id/rest-days` (coach) | `{date, reason?}` | `{date, reason}` (re-posting updates the reason) |
| DELETE | `/api/clients/:id/rest-days/:date` (coach) | – | `{ok:true}` |

```jsonc
// DayState
{"date":"2026-11-17","done":true,"rest":false,"restReason":null,"doneCount":4,"total":5,"minimum":3,"today":false,"future":false}
// HabitHistory
{"from","to",
 "habits":[Habit + {"days":[{"date","value","done","source":"manual|health","rest":false}],
                    "rate7":0.86,"rate7Prev":0.71,"rate28":0.79}],   // fractions of non-rest days done; null with none
 "days":[{"date","dayDone","rest","restReason","doneCount","total","minimum"}],
 "consistency":{"done","days","rest","window"}}
```

`GET /api/coach/clients`: each `ClientSummary` gains `habitWeek: [{date, state:"done"|"notDone"|"rest"} ×7]`, the
seven days ending today, so the list needs no per-client calls.

### Goals (item 4)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/goal?clientId=` | – | `{goal: Goal\|null, pending}`: the client's active goal (plans with `progress`; otherwise `{goal:null, pending:false}`, never 403). `pending` true = "JK will set your goal with you this week." |
| GET | `/api/goals?clientId=` (coach) | – | `{goals:[Goal]}`: active first, then drafts, then the rest |
| POST | `/api/goals` (coach) | `{clientId, title, metric, exerciseId?, measureKey?, habitId?, unit?, baseline?, target?, currentValue?, startDate?, targetDate?, why?, status?, chapterName?}` | `Goal` (status default `active`; activating one pauses the client's other active goal) |
| PATCH | `/api/goals/:id` (coach) | any of the above | `Goal` |
| DELETE | `/api/goals/:id` (coach) | – | `{ok:true}` |

```jsonc
// Goal. metric: weight | waist | measurement (with measureKey: weight|bodyFat|waist|restingHr) | record (exerciseId) | habit (habitId) | custom (currentValue set by JK)
{"id":"g_…","clientId":"u_…","title":"Down to 75 kg by March","metric":"weight","exerciseId":null,"exerciseName":null,
 "measureKey":null,"habitId":null,"unit":"kg","baseline":84.6,"target":75,"startDate":"2026-07-27","targetDate":"2027-03-01",
 "why":"To feel strong again after two years off.","status":"active",       // draft | active | reached | paused
 "chapterName":null,                       // written by JK only; shown on Progress, never on Today
 "suggestion":null,                        // drafts: "Fat loss" from onboarding ("Suggested from onboarding: Fat loss. Set the goal.")
 "updatedAt":"…",
 // derived by the server:
 "current":79.8,"delta":-4.8,"progressPct":50,"remaining":4.8,"reached":false,"remainingLabel":"4.8 kg to go",
 "weekOf":{"week":17,"weeks":31},          // null without both dates
 "onTrack":true,                           // progress within 10 points of where the dates say it should be; null if unknown
 "sourceLabel":"From your weigh-ins, 7-day average"}
```
Every client without a goal got a **draft** when the server first started with these changes (from `profile.goals` and
the Intake form's goal answer), and answering onboarding creates one. JK sets goals in bulk on the desk.

### GET /api/today (item 7)

The one payload the client's Today renders. Never 403; a Free client gets the reduced shape (every key present, empty).
Workouts, the client's own 1:1s and video calls, and the classes they joined are merged into one agenda. Calling it
also delivers any letters whose time has come.

```jsonc
{"date":"2026-11-22","firstName":"Sam","plan":"elite",
 "features":{…same as Me.features…},
 "goal":Goal|null,                 // plans with 'progress'
 "goalPending":false,              // 'progress' but no active goal: "JK will set your goal with you this week."
 "coachLine":{                     // From JK; null on Free, with nothing yet, or when stale
   "text":"This week: protein at breakfast, and lights out by 10:30.",
   "source":"letter",              // letter | message | override
   "letterId":"r_…","messageId":null,
   "unread":true,                  // the 6pt champagne dot
   "at":"2026-11-16T07:00:00.000Z",
   "caption":"JK · Monday's letter",   // "JK · Tuesday" for a message, "JK · Today", "JK · A letter" (milestone), "JK" (override)
   "staleAfterDays":10},           // the plan rhythm (7 or 14) plus three; the server already hides older lines
 "habits":[Habit…],                // with today's value, done, source, iconKey, step (plans with 'habits')
 "dayDone":true,"doneCount":4,"dayMinimum":3,
 "rest":null,                      // {"date","reason"} when JK made today a rest day
 "consistency":{"done":26,"days":27,"rest":1,"window":28},
 "missedYesterday":false,
 "week":[{"date":"2026-11-16","done":true,"rest":false,"restReason":null,"today":false,"future":false}, …7, Monday first],
 "next":{
   "kind":"form",                  // session | videoCall | checkin | form | workout | booking | rest | membership
   "title":"Monthly review · 4 questions",
   "detail":null,                  // a second line, used for "Your first workout" / "Your welcome session"
   "buttonLabel":"Fill in",        // Start session | Join | Details | Begin check-in | Fill in | View session | See your week | Have a look
   "action":"form",                // startSession | join | details | checkin | form | viewSession | yourWeek | membership
   "item":{"formRequestId":"fr_…"},// workoutId/bookingId/date/start/meetingUrl, week (checkin), formRequestId (form)
   "alsoDue":[{"kind":"checkin","label":"Check-in"}]},   // "Also due: Check-in" caption, never a second button
 "unreadMessages":0}
```

Next, in order: (1) a session within 3 hours (workout with a time: Start session; video call: Join when a meeting link
resolves, else Details; 1:1 or class: Details); (2) the check-in (plans with 'checkin', Friday to Monday while this
`dueWeek`'s is missing) or a form JK sent; (3) today's workout later in the day; (4) the next booking, on a training day;
(5) a rest day: "Rest day. Next: Lower Strength, Monday 07:00." Free: `membership` ("See what coaching includes").
A client who has never trained or met JK sees "Your welcome session" (plans with 'sessions') or "Your first workout".
The From JK line: plans with 'checkin' use the latest delivered letter (its headline on its delivery day while unread,
otherwise JK's `focusOverride` or Adjust line), falling back to JK's latest message; plans with 'messaging' only use the
first line of JK's latest message; a line JK sets per client (`coachLine` in the client settings) wins when newer.
A coach may call `GET /api/today?clientId=` to preview a client's Today.

### Letters (item 8; extends weekly feedback)

`Report` gains the letter. The old `summary`/`wins`/`focus` stay as aliases (old builds keep working):

```jsonc
{…Report…,
 "kind":"weekly",                  // weekly | milestone
 "letterStatus":"published",       // draft | scheduled (published, deliverAt still ahead) | published (delivered)
 "headline":"Strongest week yet.","keep":"Squat 102.5 kg for 5…","adjust":"This week: protein at breakfast…",
 "question":"How did the knee feel on Wednesday?","answer":null,"answeredAt":null,
 "mediaId":null,"mediaKind":null,"mediaUrl":null,"durationSec":null,   // voice or video note, ≤ 90 s
 "goalId":null,"deliverAt":"2026-11-16T07:00:00.000Z","deliveredAt":"…",
 "focusOverride":null,             // an occasional coach override of the Today line
 "todayLine":"This week: protein at breakfast…",   // what Today shows from this letter
 "milestoneKey":null,
 // full reads (GET /api/reports/:id, /week/:monday, PUT) also carry:
 "weekDots":[{"date","done","rest","future"}×7],
 "scoreTrio":[{"key":"sessions","label":"Sessions","value":"3 of 3","source":"Workouts JK planned…"},
              {"key":"days","label":"Days done","value":"6 of 7","source":"…"},
              {"key":"steps","label":"Steps","value":"9,840","source":"…"}],   // "sets" when Health is not shared
 "context":{"checkin":CheckIn|null,"week":CheckinDraft,"goal":Goal|null,"rhythm":{…},
            "milestones":[{"key","reason","suggestedHeadline"}],"suggestedDeliverAt":"…"}}   // coach only: the composer's pinned context
```

| Method | Path | Body | Returns |
|---|---|---|---|
| PUT | `/api/reports` (coach) | `{clientId, week?, id?, kind?, headline?, keep?, adjust?, question?, mediaId?, goalId?, focusOverride?, milestoneKey?, status, deliverAt?: "now"\|ISO}` (+ old `summary, wins, focus`) | full `Report` |
| GET | `/api/reports?clientId=&kind=` | – | as before; clients see delivered letters only |
| POST | `/api/reports/:id/read` (client) | – | `{ok:true, readAt}` |
| POST | `/api/reports/:id/answer` (client) | `{answer}` | full `Report`; the answer also goes into the thread (`Message.kind "answer"`, `reportId`) |

Publishing: with any letter field in the body, `status:"published"` schedules delivery for **Monday 07:00 Europe/London**
(the next one), or `deliverAt:"now"` / an instant. A body with only the old fields (old builds) publishes at once, as
before. A weekly letter is one per client and week; a milestone letter is new each time unless `id` names it (milestone
`week` defaults to this Monday). Publishing marks that week's check-in replied. Delivery (on a one-minute clock and
before any client read) drops a note in the thread (`Message.kind "letter"`, which the timeline hides because the
letter is its own item) and pushes `kind:"report"`. A delivered letter cannot go back to draft (409). "Reply to JK" is
`POST /api/messages {text, reportId}`.

Rhythm: per plan in `CoachSettings.letterRhythm` (Elite weekly with a voice or video note, Performance weekly
written), per client override `letterRhythm: "fortnightly"` in the client settings. Plans without 'checkin' have none.

### Check-ins (item 9)

`POST /api/checkins` also takes `stress` (1–5), `win`, `struggle` (≤ 500) and `photoIds` (≤ 6, the client's photo or
image media ids); `CheckIn` returns them. A check-in is shown in the timeline as `kind:"checkin"`.

| GET | `/api/checkins/draft?week=&clientId=` | – | `CheckinDraft` (default `dueWeek`) |
|---|---|---|---|

```jsonc
// CheckinDraft: the read-only figures on the check-in's Body card and in the letter composer
{"week":"2026-11-16","weekEnd":"2026-11-22","avgSteps":9120,"avgSleepMinutes":431,"healthShared":true,
 "habits":{"done":5,"days":6,"rest":1,"window":7},"sessionsDone":3,"sessionsPlanned":3,
 "feel":[{"workoutId":"w_…","title":"Lower Strength","date":"2026-11-16","feel":3,"word":"Hard"}]}
```

### Media (item 10)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/media?purpose=&clientId=&durationSec=` | raw body; `Content-Type` `image/jpeg`, `image/png`, `image/heic`, `audio/mp4` (m4a), `video/mp4` | `Media` |
| GET | `/api/media/:id` | – | the bytes; `Range: bytes=…` gives 206 with `Content-Range` (416 when unsatisfiable); `Accept-Ranges: bytes` |
| DELETE | `/api/media/:id` | – | `{ok:true}` (only who uploaded it) |

Limits: 10 MB for images and audio, 60 MB for video (a 90-second 720p clip); `durationSec` ≤ 90. `purpose`: `letter`,
`formCheck`, `mealPhoto`, `checkin`, `avatar`, `signature`, `other`; a coach uploading `avatar`/`signature` also sets it
in their settings. Who may fetch: the uploader; the client it belongs to (`clientId`, or the uploading client) and their
coach; and a coach's own images with no client (portrait, signature) are visible to that coach's clients. Others get
404. Stored beside the progress photos (`<DATA_DIR>/media`), listed in `/api/me/export` (`media`), erased with the account.

```jsonc
// Media
{"id":"md_…","kind":"image|audio|video","mime":"image/jpeg","bytes":48211,"durationSec":null,"purpose":"avatar","clientId":null,"createdAt":"…","url":"/api/media/md_…"}
```
The coach's portrait: `Me.coach.avatarMediaId` / `avatarUrl` (fetch with the bearer token). Operators set it with
`node server/admin.mjs coach-portrait <email-or-user-id> <file>`; the demo coach's comes from `DEMO_COACH_PORTRAIT_FILE`.
No portrait: the apps fall back to the JK monogram.

### Timeline (item 11)

| GET | `/api/timeline?before=&limit=&clientId=` | – | `{items:[TimelineItem], nextBefore}` (newest first; `limit` ≤ 200, default 50; `before` = `nextBefore` for the next page) |
|---|---|---|---|

```jsonc
// TimelineItem: {kind, id, at} plus one payload named after the kind
{"kind":"message","id":"m_…","at":"…","message":Message}          // 'messaging'; includes answers, form checks, meal photos
{"kind":"letter","id":"r_…","at":"…","letter":Report}             // 'checkin'; delivered letters only (list shape, no stats)
{"kind":"checkin","id":"c_…","at":"…","checkin":CheckIn}          // 'checkin'; the stored check-in confirmation
{"kind":"form","id":"fr_…","at":"…","form":{"id","name","questionCount","submittedAt"}}
{"kind":"planUpdate","id":"pu_2026-11-15","at":"…","planUpdate":{"from":"2026-11-23","to":"2026-11-29","count":3,"text":"JK updated next week"}}   // 'programme'
```
Free (no 'messaging', no 'checkin') gets `{items:[], nextBefore:null}`, never 403. Opening the first page marks the
other side's messages read.

### Session feel, form checks, meal photos (item 12)

`POST /api/workouts/:id/complete` takes `feel` (1–5); `Workout` returns `feel` and `feelWord` (Easy, Steady, Hard,
Very hard, Max). `POST /api/messages` takes `reportId?`, `exerciseId?`, `mediaId?`, `kind?` (`formCheck` |
`mealPhoto`; inferred from a media id: with an exercise a form check, else a meal photo). Clients need the coach toggle
on (`features.formChecks` / `features.mealPhotos`), else 403 `not_enabled`. `Message` gains `kind` (`text`, `letter`,
`answer`, `formCheck`, `mealPhoto`), `reportId`, `exerciseId`, `mediaId`, `mediaUrl`.

### Bookings (item 13)

`Booking` gains `meetingUrl`: the booking's own link, else (video calls) the coach's `defaultMeetingUrl`, else null
(show "Details", not "Join"); only the people in the booking see it. `PATCH /api/bookings/:id` (coach)
`{meetingUrl: "https://…"|null}` sets one.

### Coach: needs you, client overview, records (items 16, 4, 6)

| GET | `/api/coach/needs-you` (coach) | – | `NeedsYou` |
|---|---|---|---|

```jsonc
// NeedsYou
{"date":"2026-11-22",
 "sessionsToday":{"total":5,"done":3,"next":Booking|null},        // "Next: Sam · 07:00 · Studio", "3 of 5 sessions today"
 "lettersDue":{"week":"2026-11-16","count":4,"estMinutes":30,     // "Letters due: 4 · about 30 min" (6 min written, 8 with media)
               "clients":[{"id","name","initials","media":true,"every":"weekly"}]},
 "items":[{
   "client":{"id":"u_…","name":"Sam Carter","firstName":"Sam","initials":"SC","plan":"elite","planName":"Elite"},
   "rank":1,                       // the top reason's severity, 1 = most urgent
   "priority":true,                // the plan includes 'priority'
   "reasons":[                     // every reason that applies, most severe first (one row per client)
     {"kind":"pain","text":"Checked in Friday · knee sore","at":"…","rank":1,"iconKey":"pain","source":"checkin"},
     {"kind":"milestone","text":"Sam: twelve weeks on plan","at":null,"rank":8,"iconKey":"milestone",
      "milestoneKey":"twelveWeeks","suggestedHeadline":"Twelve weeks. You train like an athlete now."}],
   "reasonLine":"Checked in Friday · knee sore · Sam: twelve weeks on plan",
   "primaryAction":{"kind":"writeLetter","label":"Write letter"}}],   // reply | writeLetter | nudge | readAnswers
 "allCaughtUp":false}
```
Reason kinds by rank: 1 `pain` (an unread message mentioning pain or injury, a check-in listing pain, a "yes" to a
flagged form question), 2 `priorityUnread` ("Elite · same-day reply"), 3 `unread`, 4 `checkinLetterDue`, 5
`formAnswers`, 6 `quiet` (nothing from the client for 4+ days: message, set, workout or check-in), 7 `noTraining`
(7+ days), 8 `milestone` (goal reached, a first personal best, four weeks at the minimum, twelve weeks on plan; only on
plans with 'checkin', each key suggested until a letter with that `milestoneKey` exists). Within a rank, whoever has
waited longest comes first. `GET /api/coach/today` is unchanged for old builds.

`GET /api/coach/clients/:id` gains `goals` (active then drafts), `settings` (`ClientSettings`), `restDays` (from a week
ago on), `latestCheckin` (`CheckIn` plus `week: CheckinDraft` with session ratings) and `nextBooking`.
`Progress.records[]` gains `isNewThisWeek`. The challenge `streak` now counts days done under the minimum rule (rest
days skipped).

### Autoflows (item 16, phase 5)

The engine keeps running existing runs. The phones hide the builders behind `CoachSettings.studioTools` (default off);
the desk keeps them.
