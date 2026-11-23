# Plan. Act. Review. (client app v2)

Owner brief, 23 November 2026: "Change the client view of the app to mimic this flow in this picture. I want beautiful
sleek minimalist." The picture is `docs/design/plan-act-review-board.png`. It is the authority for look, layout and copy.
This document turns it into tokens, screens, data and an API contract so server, iOS and Android can be built in parallel.

It supersedes the client half of `atelier-spec.md` (tabs Today/Progress/JK, champagne accent). The coach phone app keeps
its Atelier screens and simply inherits the new tokens. The web desk keeps its own tokens and gains the editors below.

## The idea

Coaching runs in one rhythm, and the client app is built around it:

- **Plan**: set direction together. A planning session with JK decides what matters this season. The plan is a few
  sentences and three priorities, not a table. The client prepares honest thoughts beforehand.
- **Act**: do the work. Today's session and the habits between sessions, one thing on screen at a time, JK's cues in his
  own words. Progress is quiet rings and lines, not tables.
- **Review**: be accountable. A weekly accountability session with JK. The client looks back first (how it felt, what
  was kept, what slipped), then they agree a few commitments for the week ahead.

## Look

Monochrome silver on near-black. No champagne, no colour on client screens at all. Sleek, sparse, lots of black space.

Tokens (dark only; light mode is out of scope for this batch):

| Token | Value | Use |
|---|---|---|
| bg | #0A0A0A | screens |
| surface | #121212 | cards |
| raised | #1A1A1A | pressed cards, inputs |
| hairline | #262626 | card borders (1pt), dividers, underlines of text fields |
| track | rgba(255,255,255,0.10) | empty ring/rule track |
| trackStrong | #5C5C5C | idle ring that carries meaning (missed, not yet), the week-line rule |
| text | #F2F2F2 | primary text |
| textSecondary | #A3A3A3 | body copy, captions |
| textTertiary | #8A8A8A | tracked labels, meta (never below 4.5:1 on surface) |
| silver | #D9D9D9 | filled ring progress, done marks, selected dot |
| chromeTop / chromeMid / chromeBottom | #FAFAFA / #BEBEBE / #E8E8E8 | primary button: a vertical-ish linear gradient, plus a 1pt top highlight #FFFFFF at 60% |
| onChrome | #0A0A0A | primary button label |

Run `scripts/contrast-check.mjs` and `scripts/lint-design.sh` against the new values; update them (and the old champagne
rules) so CI enforces this palette instead.

Type:

- **Display serif**: Newsreader (already bundled), regular, with one word in italic for emphasis, exactly as the board:
  "Good morning, *Sam.*", "Today's *work.*", "How did the week *feel?*", "Come with a few *honest thoughts.*",
  "Plan. *Act.* Review.". Sizes: title 30/36, card title 18/24, quote 24/30. Exercise name 34/40 ("Goblet *squat*").
- **Label**: system sans 11pt semibold, uppercase, tracking +1.6, textTertiary. "MONDAY 23 NOVEMBER", "PLAN · THIS
  SEASON", "WHAT MATTERS MOST". Two parts are joined with " · ".
- **Body**: system sans 15/21 textSecondary; card meta 12/16 textTertiary.
- **Annotation**: Newsreader italic 13, textTertiary, right-aligned on a label row ("early days, building",
  "the work between sessions", "trending steadier").
- Dynamic Type / font scale must still work: labels and titles wrap rather than truncate.

Shapes and components:

- Cards: surface fill, 1pt hairline border, radius 16, padding 16. No shadows.
- PrimaryButton ("Begin today →", "Share with JK", "Start session", "Set done", "I'm in"): chrome gradient capsule,
  height 52, label 16 semibold onChrome, optional trailing arrow glyph. One per screen.
- SecondaryButton ("Continue with a code", "Message JK", "Prepare →"): transparent capsule with 1pt #3A3A3A border,
  text label. "Prepare →" is the small variant (height 32, 13pt).
- Ring: 1.5pt stroke, track underneath, silver progress arc starting at 12 o'clock, round caps. Sizes 28 (card icon),
  44 (habit/priority), 56 (commitment). Done = full ring with a check glyph inside; missed = dashed trackStrong ring.
- Week dots: 7 small dots (5pt); filled silver = done, trackStrong outline = not done, today slightly larger.
- Tab bar: no icons. Three words PLAN · ACT · REVIEW, label style; selected = text colour plus a 4pt silver dot beneath;
  unselected = textTertiary. No bar background, no top border; sits above the home indicator.
- Top bar on the three tab roots: small JK. mark at the left (28pt rounded square, 1pt hairline border, "JK." 10pt bold)
  and JK's avatar at the right (30pt circle, portrait or initials; a small silver dot when there is something unread).
- Background texture: very faint concentric circles (white at 3 to 4% opacity, 1pt) centred behind the hero element on
  Welcome, Your direction, In the session and Before the session. Decorative, hidden from accessibility.
- Dial: a 200° arc gauge (hairline track, tick marks, one silver knob) with the current word in Newsreader italic
  in the middle and the two end words in meta style below each end. Drag or tap to set; VoiceOver/TalkBack adjustable.
- Icons: SF Symbols / Material Symbols Rounded weight 300 only where the board shows them (chevrons, arrow, check, close,
  Apple logo). Plan cards use a diamond outline, review cards a dotted-centre circle, act uses a ring: draw them.
- Motion: 200 ms ease-out fades; ring fills animate 400 ms; respect Reduce Motion.

Copy rules stay: British English, plain, warm, no exclamation marks, no red, no "failed", no confetti.

## The mark and icon

The final mark is the silver "JK." badge: `docs/design/brand/jk-mark-silver-1024.png` (RGB, no alpha, 1024²; source
`docs/design/brand/mark/mark.html`, render with `mark/render.mjs`). It replaces the app icon on iOS and Android (Android
adaptive icon: use the same art, foreground scaled to the safe zone on a #0A0A0A background) and is drawn in-app on
Welcome (120pt) and as the small top-left mark. The in-app large mark may be the bundled image.

## Navigation

Three tabs, default **Act**.

- **Plan** → Your direction → (Prepare) Before the session.
- **Act** → This week → (Begin today) Today's work → (Start session) In the session.
- **Review** → Look back. After a review session, when JK has published notes or agreed commitments that the client has
  not accepted yet, Review opens on Accountability session instead, with Look back reachable once accepted.
- **Avatar (top right) → JK sheet**: the message thread with JK (the existing thread, restyled) and below it a quiet list
  "More": Progress, Your week (programme, bookings, calendar feed, booking), Guides, Nutrition (when included), Past
  letters, Account (membership, health, notifications, data, privacy, sign out, delete). These are the existing screens
  with the new tokens; nothing a paid plan promises may become unreachable.
- Deep links: `today`/`home`/`plan`(old) → Act; `messages`/`jk` → open JK sheet; `account` → JK sheet › Account;
  `checkin`/`review` → Review; `letter` → Review (Accountability session if it is the latest).
- Free plan (no 'programme'/'progress'/'checkin'): keep the three tabs; a tab whose feature is missing shows one quiet
  card in board style ("Plan with JK" / "Review with JK", one line, SecondaryButton "See what coaching includes" →
  Account › Membership). Never a 403.
- If `/api/me` has no `features` (old server) show everything.

## Screens

Copy in quotes is literal unless it is data. Data fields refer to the API below.

1. **Welcome** (signed out). Faint rings, the silver mark 120pt, "Plan. *Act.* Review." (display 34), "One-to-one
   coaching with JK, in a simple rhythm you can keep." (body, centred). Bottom: PrimaryButton "Sign in with Apple" on iOS
   (Apple glyph) / "Continue with Google" on Android, SecondaryButton "Continue with a code" (the existing code flow).
   Android keeps Apple-web sign-in as a text button if it is configured. Onboarding questions stay as they are, restyled.
2. **This week** (Act root, `GET /api/week`). Label `dateLabel`; title "Good morning,\n*Sam.*" (`greeting`, `firstName`).
   Week line: labels TODAY / PLAN / REVIEW above the days they mark, a hairline rule with 7 nodes: today = filled dot with
   a ring, plan day = diamond, review day = dotted circle, others small dots (done days silver, others trackStrong);
   day letters M T W T F S S beneath, today's in text colour. Card "TODAY" with an act ring (progress = `today.progress`)
   and `today.title` serif ("Lower body strength, and three habits."). Two half cards: PLAN (diamond) `plan.title` serif
   + `plan.when` meta; REVIEW (dotted circle) `review.title` + `review.when`. A missing session shows "Not booked yet"
   and the card opens the JK sheet. PrimaryButton "Begin today →" → Today's work. On a rest day the TODAY card reads
   `today.title` (e.g. "Rest, and three habits.") and the button still opens Today's work.
3. **Today's work** (pushed, `GET /api/week` again or passed through). Label "ACT · MONDAY", title "Today's *work.*".
   Session card: label "SESSION · ABOUT 45 MINUTES", serif title, a strip of block segments (each a 2pt rule, silver when
   that block is done) with block labels beneath, PrimaryButton "Start session" (or "Continue" / "Done today" disabled
   when complete). Without a workout: card "Rest day" with one line from JK if any. Label row "HABITS" with annotation
   "the work between sessions"; up to 3 habit cards in a row (more scroll horizontally): ring (progress, check when done),
   name (13pt), 7 week dots. Tap toggles a yes/no habit (existing `PUT /api/habits/:id/days/:date`), opens the existing
   habit sheet for counted habits (long press always opens it). Footer: a hairline with `footer` in annotation style
   ("Planning with JK on Thursday").
4. **In the session** (full-screen cover over the existing workout logger data, `GET /api/workouts/:id`). Close ✕ top
   left, label = workout title, a progress strip of one segment per exercise. Then one exercise at a time: label "NEXT"
   (or "NOW" once a set is logged), exercise name display ("Goblet *squat*": last word italic), "Three sets of eight"
   (sets and reps in words, load in meta beneath if set), one circle per set (filled with a check when logged, the next
   one outlined in text colour, later ones trackStrong). Tempo line when the item has `tempo` ("3-1-1" = down-pause-drive):
   a drawn polyline with italic labels "slow down", "pause", "drive". JK's cue when the item has a note: a quote with a
   left hairline, Newsreader italic 17, "JK's cue" meta. PrimaryButton "Set done" logs the next set with the prescribed
   reps and load (long press or tap a set circle to edit reps/load in the existing editor); after the last set of the last
   exercise the button reads "Finish session" and runs the existing complete flow (rating/note) restyled. Under the
   button: "Rest as long as you need" (meta). Swipe left/right moves between exercises. Offline logging stays working.
5. **Your direction** (Plan root, `GET /api/direction`). Label "PLAN · THIS SEASON", the aim as a serif quote with
   curly quotes (24/30, last phrase italic is optional; render plain if unsure), meta "Planned together with JK, 4
   November". Label row "THE SEASON" + annotation `season.phaseWord`. Season line: start diamond, today dot, next planning
   diamond, end diamond, with dates beneath (today's date in text colour). Label "WHAT MATTERS MOST", three priority cards
   in a row: ring (progress by status: notyet 0, settling 0.33, building 0.66, strong 1), title serif 15, status word
   meta. Bottom card: label "PLANNING SESSION WITH JK", serif `planning.when`, small SecondaryButton "Prepare →". No aim
   yet: quote reads "Your direction is set together with JK at your first planning session." and the season line and
   priorities are hidden.
6. **Before the session** (pushed from Prepare, `GET/PUT /api/direction/prep`). Back chevron, "Saved" meta at top right
   after each autosave (debounced 800 ms). Label "PLAN · BEFORE THURSDAY", title "Come with a few *honest thoughts.*",
   label "HOW HAS THIS MONTH FELT?", Dial 0-100 with words Hard going / Up and down / Okay / Mostly good / Flowing (ends
   "Hard going", "Flowing"). Label "WHAT FELT EASIER?" multi-line underlined field; label "WHAT KEEPS GETTING IN THE
   WAY?" field. PrimaryButton "Share with JK" (sets shared; then the button reads "Shared with JK", disabled, and edits
   still save).
7. **Look back** (Review root, `GET /api/review`, `POST /api/review/reflection`). Label "REVIEW · BEFORE YOUR SESSION"
   (or "REVIEW · THIS WEEK" when no review session is booked), title "How did the week *feel?*", Dial with 5 stops Flat /
   Stretched / Steady / Good / Strong (ends "Flat", "Strong"). Label "WHAT YOU SAID YOU'D DO": one 56pt ring per
   commitment with the text under it and the outcome word beneath in tracked meta (KEPT / MOSTLY / MISSED); tapping cycles
   none → kept → mostly → missed. Ring: kept = full silver with check, mostly = 70% arc, missed = dashed trackStrong.
   No commitments: hide the section. Label "ONE THING YOU NOTICED", underlined field. PrimaryButton "Share with JK". Once
   shared the button reads "Shared with JK" and edits re-share on tap.
8. **Accountability session** (Review, `GET /api/review` `session`). Back chevron (to Look back). Header row: JK avatar
   32pt, "Accountability session" 15 semibold, "With JK · Sunday, 6pm" meta. Label "JK'S NOTES", the notes in serif 19/27,
   text colour, with the last sentence(s) after the first two in textSecondary (as the board). Label row "THE SHAPE OF
   YOUR MONTH" + annotation `shape.trend` ("trending steadier"). A card with one vertical capsule bar per week (up to 4),
   height by feeling 1-5, latest week bright, word under each in italic meta. Label "AGREED IN THE SESSION": up to 3
   small cards, roman numeral in italic meta (i, ii, iii), text serif 15. Bottom: SecondaryButton "Message JK" (opens the
   JK sheet composer) and PrimaryButton "I'm in" (accepts; then the screen returns to Look back and the commitments show
   there next week). If the client's plan has no messaging, hide "Message JK".
9. **JK sheet**: grabber, JK portrait 56pt, name, reply line; the existing message timeline and composer, restyled
   (bubbles: client = raised, JK = surface with hairline, serif for JK's letters); then the More list (see Navigation).

## Data model (server)

All migrations are additive and idempotent (`addColumn`, `CREATE TABLE IF NOT EXISTS`) in `server/store.mjs`.

1. `bookings.purpose TEXT` nullable, values `'planning' | 'review'`. Validated in create; new coach
   `PATCH /api/bookings/:id` field `purpose` (coach only, own booking). Included in every booking output as `purpose`.
2. `priorities` table: `id TEXT PK, client_id, position INTEGER (0..2), title TEXT, status TEXT CHECK in
   ('notyet','settling','building','strong'), created_at, updated_at`. At most 3 per client.
3. `goals.aim TEXT` nullable (the season sentence, max 140 chars) and `goals.planned_on TEXT` (YYYY-MM-DD). The aim
   falls back to the goal title.
4. `preps` table: `id, client_id, booking_id NULL, feeling INTEGER NULL (0..100), easier TEXT, in_the_way TEXT,
   shared_at NULL, created_at, updated_at`. One open prep per upcoming planning booking (or one with booking_id NULL when
   none is booked); a prep belongs to the next planning session.
5. `checkins.feeling INTEGER NULL (1..5)` and `checkins.noticed TEXT NULL`. A reflection is a check-in: when written
   through the new endpoint, `energy = sleep = feeling`, `pain = ''`, `note = noticed` so every existing coach view keeps
   working. The week is the same week the existing check-in logic would use (`feedbackWeek`-style: the week being looked
   back on).
6. `commitments` table: `id, client_id, week TEXT (Monday of the week it applies to), position INTEGER (0..2), text TEXT,
   outcome TEXT NULL CHECK in ('kept','mostly','missed'), created_by, created_at, accepted_at NULL, updated_at`.
7. `workout_items.tempo TEXT NULL` (pattern `^\d-\d-\d(-\d)?$`), editable wherever items are written (programs and
   workouts); returned on items as `tempo`.

Feature gates: direction needs 'progress' (else `{locked:true}`), review needs 'checkin' (else `{locked:true}`), week
always works (habits only with 'habits', workout only with 'programme'). Locked responses are 200 with
`{ locked: true, feature }`, never 403, for clients.

## API contract (client)

Times are ISO strings in UTC; dates `YYYY-MM-DD` in Europe/London. Words are produced server side so both apps agree.

`GET /api/week`
```json
{
  "date": "2026-11-23", "dateLabel": "Monday 23 November", "dayName": "Monday",
  "greeting": "Good morning", "firstName": "Sam",
  "days": [{ "date": "2026-11-23", "letter": "M", "today": true, "mark": "today", "done": false }],
  "today": {
    "title": "Lower body strength, and three habits.", "progress": 0.25,
    "workout": { "id": "w_1", "title": "Lower body strength", "minutes": 45, "completed": false,
      "blocks": [{ "itemId": "wi_1", "label": "Squat", "done": true }] },
    "habits": [{ "id": "h_1", "name": "Protein at every meal", "iconKey": "fuel", "kind": "check",
      "doneToday": false, "progress": 0.6, "target": 1, "value": 0, "unit": "", "week": [true, false, null, null, null, null, null] }],
    "restDay": false, "coachLine": null
  },
  "plan": { "bookingId": "b_1", "title": "Plan December with JK", "when": "Thursday, 7:30am", "start": "…", "dayIndex": 3 },
  "review": { "bookingId": "b_2", "title": "Accountability with JK", "when": "Sunday, 6pm", "start": "…", "dayIndex": 6 },
  "footer": "Planning with JK on Thursday",
  "unread": 0
}
```
- `mark` is one of `today | plan | review | null` (today wins if a session is today; then the card label still says it).
- `days[].done`: the day's minimum habits met or the day's workout completed.
- `plan`/`review` are the next not-cancelled booking with that purpose in the next 14 days, else `null`. Titles: the
  booking title if the coach set one, else "Plan {Month} with JK" / "Accountability with JK".
- `today.progress`: (completed workout ? 1 : logged sets / prescribed sets) weighted 50/50 with habits done / habits; with
  only one of the two, that one.
- `habits[].week`: Monday..Sunday, `true` done, `false` not done (past), `null` future or before the habit existed.
- `footer`: next planning session ("Planning with JK on Thursday"), else next review ("Reviewing with JK on Sunday"),
  else null.

`GET /api/direction`
```json
{
  "locked": false,
  "aim": "Get strong enough that the hills stop mattering.", "plannedOn": "2026-11-04",
  "plannedLabel": "Planned together with JK, 4 November",
  "season": { "start": "2026-11-04", "end": "2027-01-31", "today": "2026-11-23", "next": "2026-11-26",
    "labels": { "start": "4 Nov", "next": "26 Nov", "end": "Jan" }, "progress": 0.22, "phaseWord": "early days, building" },
  "priorities": [{ "id": "p_1", "title": "Strength", "status": "building", "statusWord": "Building", "progress": 0.66 }],
  "planning": { "bookingId": "b_1", "when": "Thursday, 7:30am", "whenShort": "Thursday", "start": "…" },
  "prep": { "id": "pr_1", "feeling": 70, "feelingWord": "Mostly good", "easier": "…", "inTheWay": "…", "sharedAt": null }
}
```
- `season`: from the active goal: start = `planned_on` ?? `start_date`, end = `target_date`; `null` if either is missing.
  phaseWord by progress: < 0.34 "early days, building", < 0.67 "finding the rhythm", else "the home stretch".
- statusWord: Not yet / Settling in / Building / Strong. progress 0 / 0.33 / 0.66 / 1.
- `prep` is the prep for `planning` (or null if none started).

`PUT /api/direction/prep` body `{ feeling?, easier?, inTheWay?, share? }` → the `prep` object. Creates the prep on first
write. `share: true` sets `shared_at` (and posts nothing to the thread; the coach sees it on the desk and in Needs you).
Feeling words: 0-19 Hard going, 20-39 Up and down, 40-59 Okay, 60-79 Mostly good, 80-100 Flowing.

`GET /api/review`
```json
{
  "locked": false,
  "week": "2026-11-16", "label": "REVIEW · BEFORE YOUR SESSION",
  "booking": { "bookingId": "b_2", "when": "Sunday, 6pm", "start": "…" },
  "reflection": { "feeling": 3, "feelingWord": "Steady", "noticed": "…", "sharedAt": null },
  "commitments": [{ "id": "c_1", "text": "Three sessions", "outcome": "kept" }],
  "session": {
    "pending": true, "with": "With JK · Sunday, 6pm",
    "notes": "Steady is exactly right, Sam. …", "letterId": "r_1",
    "shape": { "weeks": [{ "week": "2026-10-26", "feeling": 1, "word": "Flat" }], "trend": "trending steadier" },
    "agreed": [{ "id": "c_9", "text": "Walk after lunch, every weekday" }], "agreedWeek": "2026-11-23", "acceptedAt": null
  }
}
```
- `commitments`: the commitments for the week being looked back on, with the client's outcomes.
- `session`: present when JK has published a letter or agreed commitments since the last review booking (or in the
  last 7 days); `pending` = commitments exist for the coming week with `accepted_at` null. `notes` = the latest
  published letter's text (headline + summary; empty string if none). `shape.weeks` = up to the last 4 weeks with a
  feeling (old check-ins map energy 1-5 to feeling). trend: compare the last two: "trending steadier" (up), "holding
  steady" (same), "a harder stretch" (down); null with fewer than two.
- Feeling words 1-5: Flat, Stretched, Steady, Good, Strong.

`POST /api/review/reflection` body `{ feeling?, noticed?, outcomes?: { [commitmentId]: "kept"|"mostly"|"missed"|null },
share?: true }` → the `GET /api/review` payload. Saves partial input (autosave-friendly); `share` marks the check-in
submitted (sets `submitted_at` now and notifies the coach as a submitted check-in does today).

`POST /api/review/accept` body `{ week }` → the `GET /api/review` payload; sets `accepted_at` on that week's commitments.

Workout items gain `tempo`. Bookings gain `purpose`.

## API contract (coach, web desk)

- `GET /api/coach/clients/:id/par` → `{ aim, plannedOn, season, priorities, prep (latest, any state), reflection (latest
  week's), commitments: { current: [...], next: [...] }, planning, review }`.
- `PUT /api/coach/clients/:id/aim` `{ aim, plannedOn }` (writes the active goal; 404 with a clear message if none).
- `PUT /api/coach/clients/:id/priorities` `{ priorities: [{ title, status }] }` (0-3, replaces all).
- `PUT /api/coach/clients/:id/commitments` `{ week, items: [string] }` (0-3, replaces that week's; keeps outcomes of
  unchanged texts).
- Bookings: `purpose` on create and `PATCH`.
- Needs you (`/api/coach/needs-you`): add reasons "Shared thoughts for planning" (prep shared since last planning
  booking, not yet seen) and treat a shared reflection like a submitted check-in (it already is one).

Desk UI: on the client Overview, a "Plan · Act · Review" card: aim + planned date (edit), three priorities (title + status
select), this week's commitments with the client's outcomes, next week's commitments (edit, "Agreed in session"), the
latest prep and reflection read-only. In the booking dialog (schedule), a "Purpose" select: None / Planning session /
Accountability session. Item editors (programs and workout builder) gain a "Tempo" field.

## Demo data

`buildPerson()` (testclients.mjs) and the nightly demo (demo.mjs) must make Sam Carter look like the board: aim "Get
strong enough that the hills stop mattering.", planned 4 November (relative: about 19 days ago), target end about 10
weeks out; priorities Strength/building, Sleep/settling, Joyful runs/notyet; a planning booking this Thursday 07:30 and a
review booking this Sunday 18:00 (both relative to today), previous weekly review bookings; four weeks of reflections
with feelings Flat, Stretched, Steady, Steady; last week's commitments "Three sessions" kept, "Lights out by eleven"
mostly, "A run for joy" missed; this week's agreed commitments "Walk after lunch, every weekday" and "Twenty minute run,
any pace" not yet accepted; the latest letter notes "Steady is exactly right, Sam. You spotted the link between the walk
and your sleep yourself. The run slipped again, so we've made it smaller."; a prep draft (feeling 70, "The mornings.
Getting to sessions is a habit now.", "Late nights at work midweek"); today's workout "Lower body strength" with items
Warm-up, Goblet squat (3×8, tempo 3-1-1, note "Sit into the bottom and breathe before you stand."), Romanian deadlift
(hinge), Farmer's carry, Ease-out; habits "Protein at every meal", "A walk after lunch", "Lights out by eleven".
Block labels come from a short label: use the exercise's last word unless the server has a better short name
(Warm-up → "Warm", Ease-out → "Ease").

## Out of scope

Coach phone screens (they only inherit tokens; booking purpose shows as a word in the agenda if trivial), light mode,
new auth providers (no email sign-in: "Continue with a code" is the existing code flow), Phase 4 of the Atelier spec.
