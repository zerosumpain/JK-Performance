# WP8: Tasks, accountability and insights (F23, F24, F25)

What `desk-v2-wp8` adds (docs/design/desk-v2.md F23–F25). Three feature files, `server/features/tasks.mjs`, `accountability.mjs` and
`insights.mjs`; desk files `server/desk/f-tasks.{js,css}`, `f-account.{js,css}` and `f-insights.{js,css}`. Every endpoint is coach-only
(`requireCoach`, so a client gets 403) and a foreign or missing id is a 404. Days are London `YYYY-MM-DD`; instants UTC ISO. Routes that read
`requestNow(ctx)` take `?at=<iso>` in tests.

## F23 Coach tasks

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/tasks` | `?status=open\|done\|all&clientId=&bucket=overdue\|today\|week\|later\|none\|done` | `{today, weekEnd, counts:{overdue,today,week,later,none,done}, tasks:[Task]}`. No `status`: open tasks plus those done this week. |
| POST | `/api/tasks` | `{title ≤200, notes?, clientId?, dueOn?, dueAt?, dueTime?, priority?: low\|normal\|high, tags?:[≤10], source?: manual\|automation\|voice\|ai\|dunning, sourceRef?}` | `{task}`; emits `task.created` |
| POST | `/api/tasks/parse` | `{text ≤400}` | `{title, dueOn, dueAt, dueTime, clientId, clientName, tags, priority}` (no side effects) |
| GET | `/api/tasks/:id` | – | `{task}` |
| PATCH | `/api/tasks/:id` | any of `title notes clientId dueOn dueAt dueTime priority tags position` (`null` clears client or date) | `{task}`. Moving `dueOn` keeps the time of day. |
| POST | `/api/tasks/:id/done` · `/reopen` | – | `{task}`; done emits `task.done` once |
| POST | `/api/tasks/:id/snooze` | `{until: day \| instant}` (future) | `{task}`: the due moves there and the due notice re-arms |
| DELETE | `/api/tasks/:id` | – | `{ok}` |

```jsonc
// Task
{"id":"tk_…","title":"Call Sam about his left knee","notes":"","client":{"id","name","initials"}|null,"dueOn":"2026-11-25","dueAt":"…"|null,
 "dueTime":"09:00"|null,"priority":"high","tags":["injury"],"status":"open|done","snoozedUntil":null,"source":"voice","sourceRef":"m_…",
 "sourcePath":"/messages/u_…"|null,"createdAt":"…","doneAt":null,"position":-3,"bucket":"overdue|today|week|later|none|done|null"}
```

**Parsing** (server-side so the apps can reuse it): dates `today`, `tonight` (19:00), `tomorrow`, weekday names and `this fri` (the next one,
today included), `next mon` (that weekday in next London week), `next week` (next Monday), `in 3 days`, `in 2 weeks`, `15 Dec`, `Dec 15th`,
`2026-12-15` (this year, else next year once passed; impossible dates are left as text); times `9am`, `5:30pm`, `14:30`, `noon`. A time with no
date is today if still ahead, else tomorrow. `#tag`, `!high` / `!low`. A client is a full name, or a first name only one client has, matched
case-insensitively on word boundaries; the name stays in the title.

**Buckets** (London): overdue (due before today), today, week (after today up to Sunday of this Monday–Sunday week), later, none (no date),
done (finished since Monday 00:00 London).

**Clock** `tasks.due` (60 s): an open task falls due at `dueAt`, or 08:00 London on `dueOn`; it emits `task.due` and `notifyCoach` (kind
`task`, path `/tasks?panel=task:<id>`, tone `attention` for high priority) exactly once per due moment (claimed in `due_notified` first). A task
made already overdue, or a notice more than 36 h late, is marked without a notice.

**Action** `task.create` (`clientFacing: false`): `title:template` (required), `notes:template`, `dueInDays:number` (default 0),
`priority:enum`. Source is `voice`, `ai` or `dunning` when the triggering event is `voice.*`, `ai.*` or `invoice.*`/`billing.*`/`payment.*`
(with the message or invoice id as `sourceRef`), else `automation`. Outcome "Created task".

**Hooks**: `diary` (tasks due that day: `{at, day, kind:'task', icon, title, detail, path, tone}`), `search` (type `task`), `timeline`
(added / done for the client), `badges` (`{tasks: overdue + due today}`), `exportFor` (client: the tasks about them; coach: their own list).

Events: `task.created {taskId, source}`, `task.done {taskId}`, `task.due {taskId}`. None AI-derived.

## F24 Accountability board

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/accountability` | `?week=<any day of the week>&filter=all\|missed\|noCommitments\|atRisk\|topStreaks` | `{week, weekEnd, today, current, filter, rows:[Row], milestones:[{client, streak, reachedOn, celebratedAt}], counts:{[filter]: n}, summary}` |
| POST | `/api/accountability/preview` | `{clientIds, text}` | `{previews:[{clientId, name, text, missing, empty}]}` (rendered, no side effects) |
| POST | `/api/accountability/nudge` | `{clientIds, text (template), kind?: nudge\|celebrate}` | `{sent, deferred, skipped:[{clientId, reason}]}`; one foreign id or an unknown `{variable}` → 404 / 400 and nothing is sent |
| GET | `/api/coach/clients/:id/accountability` | `?weeks=12` (≤52) | `{weeks:[{week, score, parts, live}], streak, current, nudges, milestones}` oldest first |

Row: `{client, score, parts:{c,h,t,k}, commitments:[{text, outcome: kept|mostly|missed|open}] (≤3), minimumDays:[bool×7], days:[{date, state:
done|missed|rest|future|today|none}], workouts:{done, planned}, checkin, checkinDue, streak, trend:[8 scores, null before joining], flags:[missed,
noCommitments, atRisk, topStreak], lastNudgeAt, daysMet, daysElapsed}`. Summary: `{clients, avgScore, commitmentsSet, commitmentsKept,
commitmentsOpen, daysMet, daysElapsed, checkins, checkinsDue, nudges, bestStreak}`.

**Score** = round(100 × (0.4·C + 0.3·H + 0.2·T + 0.1·K)), from existing tables only (no writes to them):
- C: kept 1, mostly .5, missed 0 over the commitments counted; an open one counts (as 0) once the week has ended. None set → .5 and
  `noCommitments`. All still open mid-week → 1 (not yet applicable, like T and K).
- H: days the minimum was met / days elapsed (today only once met; rest days and days with no habits are neither; nothing elapsed → 1).
- T: workouts completed / due (published, dated before today, or already done); none due → 1.
- K: 1 with this week's check-in; else 0 from the Friday of the week (when the check-in falls due), 1 before.
- `atRisk`: the current week, after 18:00 London, today's minimum not met, and a streak above 0. A past week is judged closed.
- Lapsed clients (plan `none` and nothing for four weeks, `core.daysQuiet` > 28) are left off the board.

Nudges go through `sendMessage` with `via:'nudge'` (automated: daily cap, quiet hours, paused clients skipped) and are logged in
`accountability_nudges`; each emits `accountability.nudged {kind, messageId, deferred}`.

**Snapshots**: clock `accountability.weekClose` (15 min) writes `accountability_weeks` for the last closed week (Monday 05:00 London closes the
week before), once per client (`INSERT OR IGNORE`). `commitment.reviewed` on a closed week rewrites that week's snapshot.

**Milestones** (7, 14, 30, 60, 100 days of the day minimum): on `day.started`, each client's streak is compared with the last one seen
(`accountability_streaks`); each milestone crossed fires once (`accountability_milestones` row, `accountability.milestone {streak}`, a tone-`ok`
notification). The first sighting of a client only records the streak, so a deploy never floods.

Action `accountability.nudge` (`clientFacing: true`): `text:template` → "Sent", "Deferred", "Skipped: outreach paused". Facts
`accountability.score` (number, this week, live) and `accountability.streak` (days). Needs hook: a milestone reached in the last 7 days and not
yet celebrated → `{kind:'streak', text:'14-day streak', rank:8, iconKey:'local_fire_department', action:{label:'Celebrate', path:'/accountability?celebrate=<id>'}}`.
Timeline: nudges and milestones. Export (client): `weeks`, `nudges`, `milestones`.

## F25 Engagement insights

| Method | Path | Response |
|---|---|---|
| GET | `/api/insights/engagement?days=90` (7–365) | `{days, from, to, rows:[Mon…Sun], heatmap:[[n×24]×7], daily:[{day, active}], mix:[{kind, label, n}], top:[Person×10], quiet:[Person×10], bands:{source:'crm'\|'adherence', label, items:[{band, label, n}]}, summary:{clients, lapsed, activeWeek, avgDaily, avgDailyWeek, events, peak:{weekday, hour, n}}}` |
| GET | `/api/insights/cohorts?months=12` (1–36) | `{months, current, cohorts:[{month, label, size, retained:[pct]}], survival:[{month, pct, of}], avgLifetimeMonths}` |
| GET | `/api/insights/nps?months=12` | `{nps, promoters, passives, detractors, responses, months, trend:[{month, label, nps, responses}], comments:[{client, score, category, text, at}]}` |
| GET | `/api/insights/surveys` | `{surveys:[Survey]}` |
| POST | `/api/insights/surveys` | `{kind: nps\|pulse, cadence: once\|monthly\|quarterly\|afterDays, afterDays?, audience?:{clientIds?, segmentId?, rules?}, questions?:[1–3 strings], name?}` → `{survey}` (makes the form) |
| PATCH | `/api/insights/surveys/:id` | `{status?: active\|paused, cadence?, afterDays?, audience?}` → `{survey}` |
| DELETE | `/api/insights/surveys/:id` | `{ok}`: stops it and drops it from Insights; the form and each client's answers stay on their record |
| POST | `/api/insights/surveys/:id/send` | `{clientIds?}` → `{sent, skipped}`: sends now to whoever is due this period |

Person: `{client, activeDays, events, lastActive, daysQuiet, share}`. Survey: `{id, kind, cadence, afterDays, audience, status, formId, name,
questions, createdAt, sent, answered, lastSentAt, score}` (NPS, or the pulse average out of 5).

- **Activity** is client-originated: messages from the client, training logged (one per workout with sets), workouts completed, check-ins,
  habit days and attended sessions (`attendedSessions`, so no-shows do not count). Habit ticks have a day but no time: they count in the daily
  line, the mix and the rankings, not in the hour heatmap. Hours and weekdays are London wall-clock, correct across BST.
- **Rankings** leave out lapsed clients (no plan, quiet four weeks); the heatmap and daily line keep them.
- **Bands** come from `crm.band` when WP2's fact is loaded, otherwise from `core.adherence28` (labelled "Training adherence (28 days)").
- **Cohorts** group by the London month of `users.created_at`. Active in a month = any activity that month, or a plan other than `none`
  (from `membership_events`) with activity in the 30 days before the month's end (today for the current month).
- **NPS**: a `choice` question `nps` ("0"…"10", "How likely are you to recommend JK to a friend? (0–10)") and an optional `long` question `why`.
  0–6 detractor, 7–8 passive, 9–10 promoter. A pulse is 1–3 `scale` questions `q1…q3`.
- **Sending**: clock `insights.pulse` (10 min, from 10:00 London) runs every active survey through `sendForm` (emit on), claiming
  `pulse_sends (survey, client, period)` before the send in one transaction, so a period sends once (periods `once`, `2026-11`, `2026-Q4`,
  `after`). Outreach-paused clients are skipped (`resolveAudience` purpose `automated`). Recurring surveys skip clients in their first 14 days;
  `afterDays` sends on the day a client reaches N days, and never to someone who passed it more than a week before the survey existed.
- `form.submitted` on a survey's form emits `pulse.answered {surveyId, kind, score, requestId}`; an NPS score ≤ 6 notifies the coach
  (kind `detractor`, tone `urgent`, so it pushes outside quiet hours). WP11 can use `pulse.answered` with `score ≥ 9` (F28).
- Action `pulse.send` (`clientFacing: true`): `surveyId` (type `text`; the action's `options(db, coachId)` lists `{value, label}`) → "Sent",
  "Skipped: already sent", "Skipped: outreach paused". Events `pulse.sent {surveyId, kind, requestId}`, `pulse.answered`. Export (client):
  `surveys` (period, request id, kind).

## Desk

- `/tasks`: a kanban (Overdue, Today, This week, Later on top; No date and Done this week below), the natural quick-add with a live parse preview
  (removable client chip), filters, the week's progress ring, keys `e` done, `s` snooze, `j`/`k` move, Space/arrows to move a card. The task
  slide-over is a registered panel (`#/tasks?panel=task:<id>`). Registrations: nav `tasks` (Schedule, badge), quick-create `task`, command
  "New task", client action `add-task`, client tab `tasks` (order 85), widget `tasks` (s).
- `/accountability`: week picker, numbers strip, "Streaks this week" with Send congrats, filters with counts, the board table (selectable; bulk
  Nudge and Celebrate), a per-person slide-over (12-week chart, the score's parts). The nudge composer uses `composer()` so send guards run, offers
  WP5 templates of the category when the `templates` feature is there (suggestions otherwise) and shows each person's rendered message.
  `?celebrate=<clientId>` opens the composer (the Needs-you action). Nav `accountability` (Clients), widget `accountability` (m).
- `/insights/:tab?` (engagement, cohorts, nps), nav `insights` (Business) with palette tabs.

## Deviations from the spec

1. `tasks` has an extra column `due_notified` (the due moment already notified, the clock's claim) and an index on `client_id`.
2. A task about a client belongs to that client's **current** coach (6.1); a task with no client to its writer. A reassigned client's open tasks
   move with them.
3. Extra endpoints: `GET /api/tasks/:id`, `POST /api/accountability/preview`, `POST /api/insights/surveys/:id/send`; `dueTime` on task writes.
4. Two extra tables: `accountability_milestones` (once per crossing) and `accountability_streaks` (the streak last seen).
5. Score choices the spec leaves open: all-open commitments mid-week → C = 1; today counts for H only once met; T counts workouts due so far.
6. Lapsed clients are left off the board and the engagement rankings.
7. Attended sessions count as activity (3.4's rule); habit ticks are not in the hour heatmap (no time is recorded for them).
8. The NPS reason is optional; recurring surveys skip a client's first 14 days; DELETE keeps the form and answers.
9. **Demo cohorts.** Cohorts come from `created_at` (unchanged for the base six). When the demo world has fewer than six join months in the last
   eight, `insights` adds lapsed "alumni" demo clients (`apple_sub` `demo-ins-*`, rebuilt nightly) to fill the missing months. With WP2's extra
   demo clients (`demo-crm-*`, joined 125–230 days ago) merged there are already six or more months and none are added.

## Integration requests (WP-Z)

1. **`ui.css` `.ui-sr` on a `<table>`**: tables ignore `width` and `overflow`, so every chart's visually hidden data table still stretches the
   page (Insights was 2,800 px too tall). Suggest `table.ui-sr{display:block;clip-path:inset(50%)}` in `ui.css`. Scoped workarounds in
   `f-insights.css` (`.in-body table.ui-sr`) and `f-account.css` (`.ac-p-chart table.ui-sr`) can then go.
2. **`dataTable` and absolutely positioned cells**: a `.ui-sr` span in a cell is positioned against `.ui-table-wrap`, outside the
   `.ui-table-scroll` clip, so on a phone the whole page scrolls sideways. Suggest `.ui-table-scroll{position:relative}`. Workaround: `.ac-ci{position:relative}`.
3. **Widget hosts render before the tile is in the document** (`today.js widgetGrid`): a widget that checks `box.isConnected` draws nothing.
   Worth a line in the kit docs.
4. **ParamSpec has no `survey` type**: `pulse.send` declares `surveyId` as `text` and supplies `options(db, coachId)`; WP5's builder should draw
   a select from it.
5. `docs/api/README.md` lists `wp8-tasks.md`; the file is `wp8-tasks-insights.md` (the name in spec section 5).
6. WP7's diary should merge `hooks('diary')` (tasks due that day); WP2's timeline `hooks('timeline')` (tasks, nudges, milestones).
7. Needs-you lists lapsed clients (no plan, months quiet) as "No training in 140 days". Only visible here with the demo alumni (point 9 above);
   if WP2's churned extras show the same, core `needs.mjs` could skip plan-`none` clients quiet for 28+ days.

## Parity gaps

- The coach's phone push for a detractor (urgent) is proved through `notifyCoach` and the recorder in the foundation tests; no APNs/FCM locally.
- Mouse drag on the kanban was not driven in a browser; the keyboard move (Space, arrow, Space) was, against the running server.
- Nudges sent while testing at night are held by quiet hours ("held for the morning"), as designed.

## Design notes

- Tasks: the quick-add line is the screen's hero; cards carry a round check, client chip, due (red when late), source glyph and a 2 px attention
  bar for high priority. The six buckets sit as four day columns over two wide ones, so the whole week fits at 1360 px without sideways scroll.
- Accountability: the hero tile uses `--sheen`; streak milestones are serif numerals in champagne; day dots are lettered (M T W…) with state in
  fill and border plus a title, never colour alone.
- Insights: bento tiles with serif key numbers; on phones the small tiles pair up two by two.
