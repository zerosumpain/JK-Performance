# JK Performance: Atelier, the final client and coach redesign (one page a day, one letter a week)

## Principles

- If JK did not assign it, the plan does not include it, or nothing is due, the client does not see it. Every feature the plan promises has exactly one home; other places may deep-link to that home but never host a second flow.
- Today answers three questions, in this order, on one screen: what am I working towards (goal), how am I doing today (habits), what did my coach say (JK).
- Hard ceilings: at most 10 client destinations, at most 3 visual parts per Today block, one visual form per block (content changes, the form does not).
- One primary action per screen. It is an ivory button, never gold and never a gradient.
- Champagne means achievement and JK, and nothing else. Its uses are listed exactly in the tokens. It never appears on buttons, tabs, warnings or status.
- Serif means JK. The serif is reserved for JK's words, the goal sentence, letter headlines and empty-state lines. Everything else is the system sans.
- The brand is JK, not a palette: the monogram, the 2pt rule and JK's portrait carry identity, so the app cannot read as a skin of another product.
- Feedback is a correspondence, not an archive: a letter at the rhythm the plan buys, answered with a real reply, plus small touches in one JK timeline.
- One habit rule: a day is done when JK's minimum is met. A miss lowers a count; it never wipes it out. Rest days are JK's to grant, not an allowance for the client to manage.
- Kind by design. No red, no 'failed', no countdowns, no confetti, no traffic lights on client screens; status is a word.
- Restraint is the luxury signal. One serif, one accent, one icon weight, no boxed icons, no shadows, no gradients.
- Numbers show distance remaining, and every summary figure says what it is made from.
- The coach's voice is the product: no client-selectable tone, and nothing JK said more than one rhythm ago is shown as if it were current.
- The phone is the floor and the web desk is the studio. The coach triages, replies and writes letters on the phone, and builds programmes, forms and prices on the desk.
- Accessible by construction: every text pair at 4.5:1 or better in both modes, every state-bearing graphic at 3:1 and carrying a shape difference, every size scaling with Dynamic Type or font scale.
- Tokens first, both platforms together. Literal sizes, radii, heights and colours in screen files fail CI.

## Review

- Nothing tells a client what they are working towards. The goals asked for in onboarding (OnboardingView.swift:109-126, sent at :399) never appear again. No screen shows a goal, target, date or distance left.
- Habits, the daily heartbeat of coaching, are a passive tile ("1 of 4 today", ClientHomeView.swift:46). Ticking one takes two taps plus a scroll past a nutrition card that fills the top half of Daily habits (:309). The streak is a 3pt bar in 38% white at the very bottom (:318-327). Taps on health-synced habits are ignored silently (:380).
- JK's voice, which is the product, is spread across five places: the Messages tab, a New-feedback card, a Feedback tile, a check-in reply placed below the Send button (ProgressViews.swift:586-589), and forms. Feedback is an archive of near-identical "Good week, Sam..." rows, not a moment.
- Home has no hierarchy. Up to nine identical hairline cards (jkCard is called 115 times) and a 2x2 tile grid compete equally. The same feedback item appears twice. Admin nudges (form, tour, Health prompt) sit above training.
- Five tabs split one idea, "my week", into Plan and Calendar, and the two disagree. On Sat 21 Nov, Home says "Rest day" while Calendar shows Conditioning at 08:00. Account, a once-a-month destination, takes a permanent tab.
- The look is a developer's dark theme, not a boutique brand. It is pure black and white. The silver chrome gradient does 8 or more jobs, including every client message bubble, so it means nothing. The five meaning colours are borrowed iOS system brights. A done habit and an undone one look almost identical.
- Legibility fails. Tertiary text (white at 38%) measures 3.0 to 3.4:1, which fails WCAG AA, and every eyebrow uses it. There are 102 literal font sizes, many at 8 to 10pt, 11 literal radii and 17 padding values.
- The coach phone is a back office squeezed onto a handset: five tabs, a 9-card Today grid, and Programs, Autoflows, Forms and Plans & prices editors that the web desk already does better. Meanwhile it lacks the coach's view of what the owner cares about: no measurable goal, no habit week, and three overlapping feedback channels.
- There are fake and ambiguous affordances. "Snap a meal" and "Log food" open the same form. The Plan "+" opens an exercise library. The Home "JK" monogram does nothing. Calendar actions are hidden behind long-press and explained in a paragraph. Paid promises are also unreachable: Guides (the only Free feature) has no client endpoint, and the calendar feed lives only inside the Calendar tab.
- Strengths worth keeping: a dark ground (right for this category), hairline restraint, a good weekly report data model (summary, wins, focus, stats), Health auto-fill for steps and sleep, and one-to-one parity in naming between iOS and Android.
- BEFORE AND AFTER (client), with hard ceilings the build must not exceed:
  | Measure | Before | After (ceiling) |
  | Tabs | 5 (Home, Plan, Calendar, Messages, Account) | 3 (Today, Progress, JK) |
  | Home/Today blocks | up to 9 cards plus a 2x2 tile grid | 5 blocks, at most 3 visual parts each, one visual form each |
  | Client destinations | about 21 views (Home, Daily habits, Food log, Plan, Exercises, Exercise picker, Logger, Calendar, Book session, Add to calendar, Form fill, Messages, Feedback list, Report detail, Progress, Challenges, Check-in, Plan tour, Account, Health devices, Membership) | 10 (Today, Habit sheet, Your week, Session, Check-in, Progress, JK, Letter, Guides, Account sheet); onboarding is one-time and outside the count |
  | Settings | an Account tab plus Health devices and Membership sub-screens and reminder toggles | one sheet of 8 rows; notifications are on/off plus one time |
  | Concepts a client must learn | habits, streak, adherence, feedback, reports, check-in, plan versus calendar, credits, challenges | four: your goal, today's habits (a day is done when JK's minimum is met), JK's letter, your week |
  | Taps to tick a habit | 2 taps plus a scroll | 1 tap |
  | Places JK's voice appears | 5 | 2 (the JK tab and one Today block) |
  | Meaning colours on client screens | chrome plus 5 iOS brights | 1 accent; status words in text tones |
  | Literal font sizes | 102 | 11 type tokens |

## Information architecture

CLIENT: 3 tabs (today: Home, Plan, Calendar, Messages, Account), named in JK's own vocabulary: Today, Progress, JK.

THE TEN CLIENT DESTINATIONS (ceiling; onboarding is one-time and outside the count)
1. Today
2. Habit sheet (today's habits in detail; for the Fuel habit it holds the nutrition view)
3. Your week (programme, bookings and classes; booking; calendar feed)
4. Session (workout detail, logger and the session-complete page, as one flow)
5. Check-in (only on plans with 'checkin')
6. Progress (three levels of detail inside one destination)
7. JK (the coach timeline; Past letters is a filter of it)
8. Letter (weekly letters and milestone letters)
9. Guides (all plans include 'guides')
10. Account sheet

TABS
1. Today. iOS sun.max / Android sunny. The single daily page, built only from what JK has assigned and the plan includes (Everfit, Trainerize).
   - Pushes Your week, a single chronological list (this week first, earlier weeks below) that merges the programmed workout, 1:1s, classes, video calls and rest days from one source, with a month-grid toggle. It replaces both the Plan and Calendar tabs. It is reached from the week dots on Today (scrolled to the tapped day) and from the Next card. Booking lives here and only here ("Book a session", shown when the plan includes 'sessions'), and so does the calendar feed ("Calendar feed", shown with 'sessions').
   - Pushes Session (detail, logger, complete).
   - The exercise library is reached from inside an exercise ("How to do this"). The Plan header "+" is removed.
2. Progress. chart.line.uptrend.xyaxis / trending_up (replaces the downtrend glyph). Shown when the plan includes 'progress'. Three levels of detail, as WHOOP does it.
   - Level 1: GoalHero, then three tiles: Goal, Consistency, Strength (or Body for fat-loss goals).
   - Level 2: tap a tile for an 8-week trend.
   - Level 3: habit history, Your best lifts, measurements, progress photos ("Private to you and JK"), and Challenges (only when JK turns challenges on, as one row at the bottom).
3. JK. Tab icon: JK's portrait in a 26pt circle with a 1.5pt champagne ring; fallback is the JK monogram vector, then bubble.left / chat_bubble. Accessibility label "JK, your coach", with the bubble.left glyph as the large-content image.
   - Header: JK's name, a reply line chosen by plan ("JK replies most evenings", or "Same-day replies" on plans with 'priority'), and two quiet links: "Past letters" (only with 'checkin') and "Guides".
   - Pinned card: the latest letter (only with 'checkin').
   - One timeline holding messages, letters, check-in confirmations, form requests, plan updates and form-check videos.
   - Composer (only with 'messaging'), with the "Ask JK" row beneath it holding only what JK has switched on: Send a form check, Send a meal photo. Booking is not here; it lives in Your week.
   - Free variant (no 'messaging'): JK's portrait, name and a line ("New guides from JK appear here"), the Guides list inline, and "See what coaching includes", which deep-links to Membership in the Account sheet. No composer, no timeline, so no 403s.

ACCOUNT SHEET
Account is no longer a tab. It is reached from the 36pt avatar at the top right of Today and opens one inset grouped list of eight rows:
- Name
- Membership (the plan, what it includes, JK's rhythm for this plan, the plan tour, change plan). This is the only home of Membership and the plan tour.
- Apple Health / Health Connect
- Notifications (on/off plus an evening reminder time)
- Your data (download a copy)
- Privacy (with Acknowledgements, including the serif's licence, as a footer link)
- Sign out
- Delete account

Check-in: a 60-second sheet, opened from the Next card when it is due, or from the check-in card in the JK timeline. Plans with 'checkin' only.
Nutrition: lives in the Habit sheet under the Fuel habit, on plans with 'nutrition'. The Fuel habit's ring of progress shows on Today only when JK has set macro targets; before that the Habit sheet says "JK will set your targets" and "Log food" stays available.

Fallback: if usage shows training-heavy clients hunting for the programme, Your week is promoted to a fourth tab (calendar / calendar_month). The IA leaves room for it.

Deep links: TabRouter.Client (Net/Push.swift:13, and its Android twin in net/Push.kt) maps the old cases as follows:
- home → today
- plan → today, then pushes Your week
- calendar → today, then pushes Your week
- messages → jk
- account → today, then opens the Account sheet
So existing push payloads keep working.

COACH PHONE: 3 tabs (today: Today, Clients, Schedule, Messages, Guides)
1. Today. tray.full / inbox.
   - A thin strip: next session time and "3 of 5 sessions today". It opens a day agenda, which replaces the Schedule grid; swipe between days, with a "Book" button.
   - One ranked "Needs you" list. Each client appears once with combined reason glyphs and one action: Reply, Write letter or Nudge. Unread messages from clients on a plan with 'priority' rank above other unread messages. "Letters due: 6 · about 40 min" heads the list.
   - Empty categories are hidden. The list ends with "All caught up".
2. Clients. person.2 / group. Search, then three groups: Needs you, Check in with, On track. The client page:
   - Opens on an Overview with no segments: GoalCard (editable), HabitWeekGrid, the latest check-in with session ratings and the primary "Write this week's letter" (plans with 'checkin'), the next session, and three health numbers with sparklines.
   - Rows below link to: Plan (view the week, swap an exercise, add a note), Sessions, Letters, Give a rest day, and the forms actions (Assign programme, Send a form, Read answers).
   - The title is the client's first name. At most two status pills.
3. Messages. bubble.left / chat_bubble.

Coach Account sits behind the avatar at the top right: Open the web desk, Preview as client, notifications, letter rhythm per plan, the two reply lines (standard and priority), portrait and signature upload, and a one-line pulse ("12 active · £x a month").

Web desk only (server/desk already has most of these): Programs editor, Forms editor and response archive, Autoflows (replaced by a toggleable "Week 1 onboarding" sequence, shown on the phone as one status line), Plans & prices, Business/MRR, availability rules, class creation, the long-form workout builder, the Guides library, per-client habit setup (cap, minimum, macro targets) and the meeting-room link.

## Client screens

1. TODAY. Five blocks, fixed order; empty or plan-excluded blocks do not render. Each block has at most 3 visual parts and one visual form. 20pt gutter, 32pt between sections. Only the Next card has a border. At default text size it must fit a 6.1-inch iPhone and a Pixel 8; check on device in phase 2, and if it does not fit, From JK may sit just below the fold.
   a. Header (3 parts).
      - Date in caption 13, textSecondary ("Sunday 22 November").
      - Greeting in sans display Light 34/40 ("Evening, Sam"). Sans, so that serif keeps meaning JK.
      - A 36pt avatar at the right (initials on raised), which opens the Account sheet.
   b. Goal (3 parts). Plans with 'progress'.
      - The goal sentence in the serif, title 22/28: "Down to 75 kg by March".
      - A full-width 2pt champagne rule on track, filled baseline to target.
      - "4.8 kg to go" in sans tabular numberTile 28/32. No chapter caption on Today; week counts and any chapter name JK writes live on Progress.
      - Tap opens Progress at the GoalHero.
      - No goal yet: "JK will set your goal with you this week." in quote italic 19.
   c. Habits (3 parts). Plans with 'habits'.
      - Part 1, the header, a visible link: "Habits" (headline 17 Semibold) and "3 of 5" tabular with a chevron. It opens the Habit sheet. When JK's minimum is met it reads "Day done · 4 of 5", with "Day done" in champagne. The morning after a miss it reads "Yesterday slipped. Today keeps it going."
      - Part 2, the habit row: 3 to 5 HabitMarks spread evenly over one shared 2pt rule. Each mark is a 24pt glyph in a 56pt touch target with a caption 13 label beneath (Water, Sleep, Steps, Creatine, Protein). The rule under the row is split into one segment per habit; a segment fills champagne as its habit is done (partially for count habits). A done glyph switches to its filled variant in champagne, so done differs by shape as well as colour. This replaces a row of Streaks-style rings with something quieter.
      - Part 3, the week dots: 7 day columns, each a 6pt dot over a day letter. Three states only: done (champagne fill), not done (1.5pt trackStrong outline, no fill), today (1.5pt bone outline around the dot). A JK-granted rest day shows the day letter with no dot. No training glyphs on Today. Tapping a dot opens Your week scrolled to that day. Each dot has an accessibility value ("Tuesday, done").
      - Tap a glyph: tick it, or add one step for count habits. Tap a done glyph: untick, with an "Untick Water?" toast and Undo. A Health-synced glyph carries a 10pt heart badge, and a tap shows the "Updates from Apple Health" toast. Long-press a glyph is a shortcut to that habit in the Habit sheet; the header link is the visible route.
   d. Next (one form: a bordered card on surface with one PrimaryButton; an optional "Also due" caption is its third part). Priority order:
      1. A session within 3 hours: "Lower Strength · 07:00 · Studio", button "Start session". Elite video call: "Video call with JK · 18:00", button "Join" when the booking has a meeting link, "Details" until then.
      2. Check-in due (plans with 'checkin'): "A minute on your week", button "Begin check-in".
      3. A form from JK: "Monthly review · 4 questions", button "Fill in".
      4. Today's workout later in the day: button "View session".
      5. The next booking: button "See your week".
      6. Rest day: "Rest day. Next: Lower Strength, Monday 07:00.", button "See your week". Booking happens there, not here.
      Anything else due shows as an "Also due: Check-in" caption under the card, never as a second button.
   e. From JK (3 parts, one form).
      - JK's 32pt portrait with a 1.5pt champagne ring and a caption ("JK · Monday's letter", or "JK · Tuesday"), with a 6pt champagne dot if unread.
      - One line in quote italic 19/28, at most 2 lines. Its source: on plans with 'checkin', the latest letter's Adjust line ("This week: protein at breakfast, and lights out by 10:30."), or on Monday while the letter is unread, the letter's headline; on Foundation, the first line of JK's latest message; occasionally a line JK sets from the desk.
      - A "Reply" text button. Tapping the line opens the letter, or the thread if it came from a message.
      - Stale rule: if nothing new has come from JK for the plan's rhythm plus three days (10 days on a weekly rhythm, 17 on fortnightly), the block hides rather than repeat an old line.
      - Free plan: hidden.
   States:
      - New client: JK's welcome message in From JK, and Next shows "Your welcome session" (plans with 'sessions') or "Your first workout".
      - Free plan: Header, then Next as "See what coaching includes" (button "Have a look"), which deep-links to Membership. Goal, Habits and From JK are hidden.
   Accessibility sizes (dynamicTypeSize.isAccessibilitySize on iOS; fontScale of 1.5 or more on Android):
      - The one-screen promise is dropped; the fixed order stays.
      - The habit row becomes a vertical list: glyph, label, value, with the rule segment as a leading bar.
      - Week dots drop the day letters and keep the dots in a single "Mon to Sun" row with accessibility values.
      - display, numberHero and numberTile cap at accessibility1, with the Large Content Viewer for capped text.
      - Touch targets scale with @ScaledMetric from 56pt up to 72pt.

2. HABIT SHEET. Opened from the Habits header link (or a long-press shortcut on a glyph). One row per habit: glyph, name, today's value with a stepper or exact value for count habits, 7 dots, and the one consistency figure ("22 of the last 28 days"). A rest day JK has granted shows as "JK gave you today off". "Ask JK for a rest day" opens the composer (plans with 'messaging').
   - Fuel (plans with 'nutrition'): the Fuel row expands to the nutrition view: kcal ring, three macro bars, today's food list and "Log food". Over target reads "Over by 120 kcal" in textSecondary, never red. Before JK sets targets: "JK will set your targets", with "Log food" still available. "Snap a meal" is removed.

3. YOUR WEEK (pushed). A day-by-day list, this week first, scrolled to the requested day. Each item has a kind glyph, title, time, place and visible buttons (Start, Join or Details, Cancel, Add to calendar). JK-granted rest days appear as a one-line row. A month-grid toggle sits at the top right. The foot holds "Book a session" (plans with 'sessions', showing credits left) and "Calendar feed" (plans with 'sessions'; subscribes to the /cal/<token>.ics feed). The gesture paragraph is gone.

4. SESSION (workout detail, logger and complete, one flow; behaviour of detail and logger unchanged, restyled).
   - Inside each exercise: "How to do this" and a "Send form check" camera button (when JK has form checks on).
   - Selection uses ivory outline, not chrome.
   - Complete, the most considered page:
     - Serif letterHeadline 30: "Done. Lower Strength."
     - Sets, volume and duration in tabular figures.
     - PR chips: hairline pill, champagne text "New best · Squat 102.5 kg".
     - "How did that feel?": one quiet segmented row of five words, Easy, Steady, Hard, Very hard, Max, each segment at least 44pt high. No numbers, no emoji, no animation.
     - An optional one-line note.
     - Footer caption: "JK will see this."
     - PrimaryButton: "Done".

5. CHECK-IN SHEET (plans with 'checkin'). Three paged cards.
   - Card 1: "How did the week feel?" Energy 1 to 5 and stress 1 to 5, with a word on every option.
   - Card 2: Body. Sleep quality 1 to 5 and pain chips. Steps, sleep average, habit consistency and session ratings are prefilled and read-only.
   - Card 3: one win, one struggle, photos inline.
   - Button "Send to JK". Confirmation: "Sent to JK. Your letter arrives Monday morning." It appears as a card in the JK timeline.

6. PROGRESS (plans with 'progress').
   - GoalHero: the goal sentence in serif title 22; a 120pt open 300-degree Ring, 8pt stroke, champagne on track; numberHero Light 48 tabular "−4.2 kg"; start, now and target in caption; week line "Week 9 of 16" (plus a chapter name only if JK wrote one); source line "From your weigh-ins, 7-day average".
   - Three MetricTiles (no border, on surface), numberTile 28:
     - Goal: "4.8 kg to go"
     - Consistency: "22 of the last 28 days", with a status word in textSecondary (On track, Steady or Worth a look) and a trend glyph. No status colour on client screens.
     - Strength: "+12% since July" (or Body: "Waist −3 cm")
   - Tap a tile for its TrendChart: slate line, dashed bone target, 8 weeks, and one "made from" line.
   - Level 3: Habit history (one row per habit with 7 dots, the consistency figure and the change on last week), Your best lifts, Measurements (an "Add measurement" text button) and Photos.
   - The Challenges row appears only when JK has turned challenges on.

7. JK. Described under IA.
   - JK's bubbles sit on surface, with a 1.5pt champagne-ringed avatar.
   - Client bubbles are raised #211F1C with bone text.
   - Thread cards: LetterCard (headline, not "Week of…"), CheckInCard, FormRequestCard, PlanUpdateCard ("JK updated next week"), FormCheckVideoCard.
   - Past letters filters the timeline to letters, each headed by its headline with the date in caption.

8. LETTER. Full-screen reading view on paper: dark #1A1815 with 1pt champagne rules; light #FBF6EC with ink and accent rules.
   - JK portrait and date caption.
   - Headline in serif letterHeadline 30/36: "Strongest week yet."
   - WeekDots.
   - ScoreTrio, three tabular numbers with their source on tap.
   - Keep: one win, with its number.
   - Adjust: one change, which becomes the line on Today.
   - Optional voice or video, 30 to 90 seconds, with JK's portrait as the poster (standard on Elite, optional on Performance).
   - One question with an inline answer ("What got in the way on Thursday?").
   - Signature: the monogram in champagne.
   - PrimaryButton: "Reply to JK", which opens the composer quoting the letter, so the client's response is a real conversation.
   - Open: 280ms fade and an 8pt rise.
   - Milestone letters use the same view. When the server spots a milestone (goal reached, first PR, four weeks at the minimum, twelve weeks on plan) it suggests one to JK; JK writes it ("Twelve weeks. You train like an athlete now."), and it arrives in the timeline like any letter. No takeover screen, no confetti, no badges.

9. GUIDES (all plans). A list of JK's guides with title, a one-line summary and reading time. A guide opens on paper with the serif headline and sans body. For Free clients this is the main thing the app offers, reached from the JK tab.

10. ACCOUNT SHEET. Eight rows, described under IA. All toggles .tint(JK.accentControl), which is bone in dark and ink in light; the red heart is gone. Membership states JK's rhythm for the plan in one quiet line: Elite "A weekly letter from JK, with a voice or video note", Performance "A weekly written letter from JK", Foundation "Messages with JK, any day", Free "Guides from JK".

ONBOARDING (one-time, outside the destination count). The same 7 steps, restyled.
   - The goals step becomes a draft for JK: "JK will turn this into your goal at your first session."
   - The plan tour sits at the end only; the Health prompt is here and in Account.

## Coach screens

1. TODAY (coach)
- A strip with the next session ("Next: Sam · 07:00 · Studio") and "3 of 5 sessions today". Tap opens the DayAgenda: a time column with a row per session showing avatar, name, kind glyph and place. Swipe between days. A "Book" action (client and time).
- "Letters due: 6 · about 40 min" (a one-line header, tappable, filters the list). Counts only clients on plans with 'checkin', at each client's rhythm.
- Needs-you list, ranked by severity:
  1. Pain flagged
  2. Unread message from a client on a plan with 'priority' (reason line "Elite · same-day reply")
  3. Other unread message older than the reply expectation
  4. Check-in in, letter due
  5. Form answers to read
  6. Gone quiet 4+ days
  7. No training 7+ days
  8. Milestone reached, letter suggested ("Sam: twelve weeks on plan")
- Each NeedsYouRow has an avatar, reason glyphs, a one-line reason ("Checked in Sunday · knee sore") and one action button (Write letter / Reply / Nudge). Each client appears once.
- Ends "All caught up" in quote italic 19 with the brand rule.
- Removed: the 8 SummaryCards, the duplicate "No training lately" list and the Autoflows card.

2. CLIENTS
- Search, then three groups (Needs you / Check in with / On track).
- Each row shows the avatar, name, plan and a 7-dot habit week (done, not done, rest gap) instead of "adherence 81%". The dots come from habitWeek in the clients list, not one call per client.
- The Programs header button is removed.

3. CLIENT OVERVIEW
- Title: first name. At most 2 StatusPills (for example "Pain flagged", "Check-in in"), each a word plus a dot.
- GoalCard:
  - The sentence.
  - Start, now and target in tabular figures, weeks left, and a 44pt arc.
  - Edit in place (title, metric, baseline, target, date, and an optional chapter name JK writes himself).
  - Draft state: "Suggested from onboarding: Fat loss. Set the goal."
- HabitWeekGrid:
  - One row per habit: glyph, name, 7 dots, the week's consistency, and the change on last week (▲/▼ glyph, no red).
  - Rest days and reasons inline ("Travelling Tue to Thu").
  - "Edit habits" sheet: up to 5 habits, glyph from the catalogue, name, target and step, the day minimum, and macro targets (plans with 'nutrition').
  - "Give a rest day" (date plus optional reason).
- Latest check-in (plans with 'checkin'): energy, stress, win, struggle, photos and session ratings. PrimaryButton "Write this week's letter".
- Next session.
- Health: steps, sleep and resting HR, each with a 7-day sparkline in slate.
- Rows: Plan (this week read-only, swap exercise, add note), Sessions, Letters, Assign programme (picker plus start date), Send a form (picker), Read answers, and the "Week 1 onboarding" status line for new clients.

4. LETTER COMPOSER
- Pinned context at the top (collapsible): check-in answers, session ratings, HabitWeekGrid, goal delta and the autofilled ScoreTrio.
- Fields: Headline (one line), Keep (one line), Adjust (one line, which becomes the client's Today line), Question (one line), Record voice or video (90s cap; prompted for Elite).
- Kind: Weekly, or Milestone (prefilled from the server's suggestion).
- "Publish now" / "Schedule for Monday 07:00". Publishing marks the check-in replied.
- Quick path: voice note plus headline only.
- The per-check-in reply boxes are removed.

5. MESSAGES: the thread list, restyled. Priority-plan threads carry a small "Priority" word. Form-check videos show the exercise name.

6. ACCOUNT (coach): Open the web desk, Preview as client, notifications, letter rhythm per plan (defaults: Elite weekly with media, Performance weekly; overridable per client to fortnightly), the two reply lines (standard, and priority for plans with 'priority'), portrait and signature upload, pulse line.

Desk (server/desk) gains the same Overview layout (goal, habit week, latest check-in, letter composer), so the coach's mental model is the same everywhere. Desk status colours use the light-mode pairs when the desk is light.

## Removed or moved

CLIENT, REMOVED
- Calendar tab (merged into Your week)
- Plan tab (becomes Your week)
- Account tab (moved to the avatar sheet)
- 2x2 HomeTile grid
- Duplicate "New feedback" card and Feedback tile
- Separate Feedback list destination (becomes the Past letters filter in JK)
- DailyHabitsView as a destination (glyph row on Today, plus the Habit sheet)
- Nutrition card at the top of Habits (folded into the Fuel row of the Habit sheet)
- Separate Day sheet (Your week scrolls to the day instead)
- Full-screen milestone takeover (milestones are letters)
- "Snap a meal" (until recognition exists)
- Plan header "+" (library reached inside the exercise)
- Decorative Home "JK" monogram (the avatar takes its place)
- Plan-tour card on Home (moved to Membership in the Account sheet and the end of onboarding)
- "Your plan" link in the JK header (Membership lives in Account only)
- Book from the Ask JK row and from the rest-day line (booking lives in Your week only)
- Health prompt on Home (moved to onboarding and Account)
- Calendar gesture paragraph (replaced by visible buttons)
- "Add weekly photos" that pushed the whole ProgressScreen (photos now inline in the check-in)
- Coach reply under the check-in Send button (the reply arrives as the letter)
- Hard-coded "Usually replies within an hour" (now a per-plan coach setting)
- Chrome-filled client bubbles
- Eyebrows on every block (at most one label per screen; none on Today)
- Trophy glyph for records (medal)
- Downtrend glyph for Progress
- Literal 8 to 10pt text
- The Monday expanded From JK card (one form; Monday shows the letter headline)
- Training glyphs above the Today week dots (kept in Your week)

CLIENT, NOT INTRODUCED (considered and dropped)
- Flame streak countdowns
- "I'm in for this week" commitment button (replaced by "Reply to JK")
- Client-selectable nudge tone and nudge frequency
- Streaks-style row of icon rings
- Five-state week dots and a bone "minimum met" colour
- A notScheduled habit state (habits have no schedule data)
- Auto-generated chapter names

LATER OPTIONS (not in v1; added only if testers miss them, decided after phase 3)
- Votes window and the 9-week bedding-in arc
- Habit pillars and identity lines
- "When… I will…" anchors and anchor-timed reminders
- A client-managed rest allowance per tier
- Per-client nudge tone set by JK on the desk
- Habit-to-outcome insight lines

CLIENT, PLAN-GATED, NOT DELETED (gates use the plans.mjs feature ids)
- Food logging and the Fuel view ('nutrition'; the ring needs macro targets, logging does not)
- Check-in, letters, Past letters and the letter line on Today ('checkin')
- Composer and the timeline ('messaging')
- Habits block and Habit sheet ('habits')
- Progress tab and the Goal block ('progress')
- Booking, credits and the calendar feed ('sessions')
- Same-day reply line and priority ranking ('priority')
- Guides (every plan, 'guides')
- Challenges, form checks and meal photos (coach toggles, not plan features)

COACH PHONE, MOVED TO THE DESK ONLY
- Programs editor (ProgramsView, ProgramEditorSheet, CoachViews.swift:485-860)
- Autoflows builder and run management (AutomationViews.swift:1-350). Replaced by a toggleable Week 1 onboarding sequence; existing runs kept.
- Forms editor (AutomationViews.swift:587-720)
- Plans & prices (PlanEditorViews.swift, PlansPricesLink at CoachViews.swift:226 and :1036)
- Business/MRR (CoachViews.swift:200-303, the unlabelled "JK" box)
- Availability rules (ScheduleViews.swift:299-396)
- Class creation
- Long-form workout builder (ClientDetailViews.swift:158-360)
- Guides tab (CoachViews.swift:862-1005)
- The meeting-room link setting

COACH PHONE, REMOVED
- Today SummaryCard grid
- Third "Needs attention" list in Business
- Five-segment client page and its 10-chip header
- Schedule 7-column grid (now the DayAgenda)

COACH PHONE, KEPT AS ONE-TAP ACTIONS
- Assign programme
- Send a form
- Read answers
- Swap exercise / add note
- Give a rest day
- The per-client macro targets (now in the Edit habits sheet)

Two-release removal so the coach can object first.

VISUAL, RETIRED
- Chrome gradient everywhere except BrandIntro (the launch plate) and the app icon, kept as heritage pending the owner's call
- iOS-bright slot colours on client screens
- Status colours on client screens (status is a word)
- .tint(.green)
- The red heart
- IconTile boxes
- ThinBar
- CheckCircle as a habit control
- jkCard as the universal container
- Inline Circle().trim rings
- The desk's separate #f4f4f4 to #bdbdbd chrome

## Tokens

COLOUR: semantic dark and light pairs.
- Dark is the signature and ships first. Light ("paper") mode is defined now, with every pair measured, and offered later as a pure token swap.
- iOS: colour sets in Assets.xcassets, exposed through JK.* in Design/Tokens.swift.
- Android: darkColorScheme/lightColorScheme plus a JKColors object in design/Tokens.kt.
- Desk: CSS custom properties in server/desk/app.css.
- Ratios below are WCAG contrast on bg / surface / raised / paper unless stated. The contrast-check script asserts every one of them in both modes.

Surfaces (elevation comes from surface steps only):
- bg: dark #0E0D0C (replaces Color.black) | light #F5F0E8
- surface: dark #171614 (replaces white 0.07) | light #FBF8F3
- raised: dark #211F1C (replaces white 0.12) | light #EDE6DA
- paper (letter, guide): dark #1A1815 | light #FBF6EC (distinct from light bg)
- hairline: dark #2E2B27 | light #DDD5C8. Decorative only: dividers and the Next card border. Never an input boundary or a state.
- inputBorder: dark #6B655C (3.4 / 3.1:1 on bg / surface) | light #8F887E (3.3 / 3.1:1 on surface / bg). Text fields, steppers and outline buttons.
- track: dark rgba(242,238,231,0.10) | light rgba(28,26,23,0.08). The background of a ring or rule only; it never carries state on its own.
- trackStrong: dark rgba(242,238,231,0.40), composited #696764 (3.4 / 3.2:1 on bg / surface) | light #86817A (3.4 / 3.7 / 3.1 / 3.6). The not-done week dot outline and idle states that carry meaning (WCAG 1.4.11).
- scrim: rgba(14,13,12,0.60)

Text:
- text (bone): dark #F2EEE7, 16.8 / 15.6 / 14.2 | light ink #1C1A17, 15.3 / 16.4 / 14.0 / 16.1
- textSecondary (stone): dark #A39D94, 7.2 / 6.7 / 6.1 | light #5E5950, 6.1 / 6.6 / 5.6 / 6.5
- textTertiary: dark #8A847B, 5.2 / 4.9 / (4.4, so never on raised) / 4.8 | light #66615A, 5.4 / 5.8 / 5.0 / 5.7. The "never on raised" rule applies in both modes and is enforced by lint.
- Replaces white at 60% and 38%. The 38% tone failed at 3.0 to 3.4:1.

Accent (exactly one): achievement and JK.
- accent (champagne): dark #C8A970, 8.7 / 8.1 / 7.3 / 7.9 | light #7A5C2C, 5.45 / 5.84 / 4.99 / 5.74 (replaces #8A6A35, which measured 4.41 on bg and 4.04 on raised)
- accentPressed: dark #B08F52 | light #664C22
- accentWash: dark rgba(200,169,112,0.16), composited #2C261C, accent text on it 6.7:1 | light rgba(122,92,44,0.10), composited #E9E1D5, accent text on it 4.8:1. The goal target band only.
- accentControl (toggles, selection tint): dark bone #F2EEE7 | light ink #1C1A17. Toggles are not achievement, so they are not champagne.
- Allowed uses of accent, the complete list:
  - Achievement: done habit glyphs (filled variant) and their rule segments, done week dots, the "Day done" label, the goal rule on Today, the GoalHero arc, "New best" PR text.
  - JK: JK's avatar ring, the unread dot, letter rules, the signature monogram, the brand rule in empty states.
- Never on buttons, tabs, toggles, body text, status or warnings.

Actions:
- PrimaryButton: fill #F2EEE7, label #0E0D0C (16.8:1), pressed #DCD6CC. Light theme: fill #1C1A17, label #FBF8F3, pressed #3A3631. Minimum height 52, radius 12, full width, 17 Semibold, vertical padding 14; labels may wrap to two lines at accessibility sizes. One per screen.
- SecondaryButton: transparent, 1pt inputBorder outline, text label, same minimum height.
- TextButton: text colour, 15 Medium, 44pt minimum target.
- Selected tab: text glyph and label. Unselected: textSecondary.

Status (coach app, desk and Progress level 2 charts only; always paired with a word and a glyph; never on client Today, habit marks or tiles):
- onTrack (sage): dark #9FB39A, 8.7 / 8.1 / 7.4 | light #4F6B4A, 5.2 / 5.6 / 4.8 / 5.5
- attention: dark #D98E5B (terracotta, 7.4 / 6.9 / 6.2), moved off the gold hue so it cannot be read as champagne; still only with the word "Worth a look" and a glyph | light #9A5530, 5.0 / 5.3 / 4.6 / 5.3. Replaces waiting #FFC25C. Coach only.
- data (slate): dark #8FA3B3, 7.5 / 6.9 / 6.3 | light #4A6072, 5.8 / 6.2 / 5.3 / 6.1. Value-free numbers and chart lines.
- error (clay): dark #C9735F, 5.6 / 5.3 / 4.8 | light #9A4632, 5.6 / 6.0 / 5.1 / 5.9. System errors only.
- urgent: dark #E8816F, 7.2 / 6.7 / 6.1 | light #A8432F, 5.3 / 5.7 / 4.8 / 5.6. Coach app and desk only (replaces #FF6B61).
- Booking kinds use glyphs and labels first. Muted dots appear only in the month grid and coach agenda: dark in person #8FA3B3, video #A898C4, group #9FB39A | light in person #4A6072, video #6A5A8E, group #4F6B4A (all 5.2:1 or better on light bg).
- Client Progress status words (On track, Steady, Worth a look) are textSecondary with a trend glyph.

TYPE: two families, no Inter, no SF Rounded.
- Serif: Newsreader by Production Type (SIL Open Font License 1.1), variable (opsz 6 to 72, wght 200 to 800) with true italics, as the zero-cost default; a licensed face is an open question for the owner.
  - iOS: the roman and italic variable .ttf files are added as resources and registered through UIAppFonts in ios/project.yml info.properties (Info.plist is generated by XcodeGen). Confirm CoreText applies automatic optical sizing to the bundled variable font; if it does not, set kCTFontOpticalSizeAttribute per token.
  - Android (minSdk 28): res/font/newsreader_roman.ttf and newsreader_italic.ttf, declared per token in Type.kt as Font(R.font.newsreader_roman, variationSettings = FontVariation.Settings(FontVariation.weight(400), FontVariation.Setting("opsz", size))). If variable rendering misbehaves on any tested device, ship static instances at opsz 18 and 36 instead.
  - Desk: self-hosted woff2 with font-variation-settings.
  - Subset to Latin, about 300 to 400 KB.
  - The OFL text is bundled with the app and shown under Privacy > Acknowledgements.
  - Used only for JK's words, the goal sentence, letter and guide headlines and empty-state lines. Never below 17pt.
  - Accessibility fallback: at AX3 and larger (iOS) or fontScale 1.75 and above (Android, LocalDensity.current.fontScale), italic quotes switch to the sans italic.
- Sans: system SF Pro (iOS) and system Roboto (Android). Keeps Dynamic Type and font scaling working.
- Numbers: the sans with tabular figures, .monospacedDigit() on iOS and fontFeatureSettings = "tnum" on Android.

How the scale is built:
- iOS sans tokens: Font.system(size: UIFontMetrics(forTextStyle: style).scaledValue(for: base), weight:) inside Design/Type.swift (or the nearest text style with .weight() where sizes match, for example body = .body, headline = .headline, caption = .footnote.weight(.medium)). Font.custom cannot address SF, so it is used only for the serif.
- iOS serif tokens: Font.custom(name, size:, relativeTo:) with relativeTo set explicitly per token, as listed below.
- Android: sp throughout, so font scale (including Android 14 non-linear scaling) applies.
- Literal sizes are allowed only in Design/Type.swift and design/Type.kt.

Scale (size/line height, iOS text style for scaling):
- display: sans Light 34/40, tracking −0.4 (greeting, screen titles), scales with .largeTitle, capped at accessibility1
- letterHeadline: serif Regular 30/36, opsz 30, relativeTo .title
- title: serif Regular 22/28, relativeTo .title2 (goal sentence, letter section heads)
- quote: serif Italic 19/28, relativeTo .title3 (JK's line); 17/24 inside sheets, relativeTo .body
- headline: sans Semibold 17/24 (.headline)
- body: sans Regular 17/24 (.body)
- callout: sans Medium 15/20 (.callout; buttons, row labels)
- caption: sans Medium 13/18, +0.2 tracking (.footnote)
- label: sans Semibold 11/14, uppercase, +1.2 tracking, scales with .caption2; switches to sentence case and drops tracking at accessibility sizes. At most one per screen, none on Today, textSecondary. It is the only exception to the 13pt floor.
- numberHero: sans Light 48/52 tabular, scales with .largeTitle, capped at accessibility1 with the Large Content Viewer
- numberTile: sans Regular 28/32 tabular, scales with .title, capped at accessibility1
- Client screen floor: 13pt (11pt only for the single label).

SPACING: 4pt scale, tokens space.xs 4, s 8, m 12, l 16, xl 20, xxl 24, xxxl 32, huge 48.
- Screen gutter 20 (16 on widths under 375).
- Card padding 20.
- Between sections 32.
- Between rows in a group 12.
- Minimum touch target 44pt (iOS) and 48dp (Android). Habit marks are 56pt, scaling with @ScaledMetric to at most 72pt.

SIZES: heights are minimums, never fixed, on anything that holds text: frame(minHeight:) on iOS and heightIn(min = ...) on Android. Avatars are fixed circles (36 and 32); their initials scale with the avatar diameter (40% of it), not with the text size.

RADII: chip 8, control/input 10, button 12, card 12, sheet top 20, pill 999. Rings, dots and avatars are circles. Continuous corners on iOS. The 11 literal radii go.

ELEVATION: none. No shadows, no gradients. Hierarchy has three levels:
- hero: no container, directly on bg
- grouped list: an inset surface with hairline dividers
- the Next card: the only bordered card on Today
Sheets are raised with the scrim.

MOTION:
- Standard: 240ms, cubic-bezier(0.2, 0, 0, 1).
- Habit tick: the glyph cross-fades to its filled variant and its rule segment fills over 360ms ease-out, with a light haptic (UIImpactFeedbackGenerator(.light); HapticFeedbackConstants.CONFIRM).
- Untick: same curve, with a toast "Untick Water?" and Undo.
- Day done: success haptic (UINotificationFeedbackGenerator .success; HapticFeedbackConstants.CONFIRM) and a 600ms fill of today's dot.
- Number roll-up on Progress: 400ms.
- Letter open: 280ms fade and 8pt rise.
- Material FILL 0 to 1 cross-fade: 240ms.
- No springs with overshoot, no sheen, no confetti, no pulsing badges.
- Reduce Motion (iOS) or animator scale 0 (Android): instant cross-fades. BrandIntro already honours this.

## Iconography

FAMILIES
- iOS: SF Symbols at Regular weight, medium scale, set through .font() so each icon matches its label's weight. Default rendering is .hierarchical, tinted textSecondary. Done or selected states use the .fill variant, tinted accent on habits and text colour on tabs. Never use multicolour.
- Android: Material Symbols Rounded with wght 300, GRAD −25 on dark (0 on light), and opsz matched to the rendered size (24 in the tab bar, 20 inline, 24 in habit marks). Ship each glyph as a vector drawable exported in FILL 0 and FILL 1 variants and cross-fade between them over 240ms. Apache 2.0 licence. Keep the export script at scripts/export-symbols.mjs and commit its glyph list. Do not mix in the Icons.Outlined, Filled or AutoMirrored sets.
- Desk: the Material Symbols Rounded webfont, self-hosted.
- No third-party icon set. Lucide reads as SaaS, and Phosphor has no first-party Android package.
- One bespoke glyph: the JK monogram as a single vector, exported both as an SF custom symbol and as an Android vector. Use it only for the JK tab fallback, the letter signature, milestone letters and empty states. The brand device that goes with it is a 2pt champagne rule. Together with JK's portrait these carry the brand, so the app does not depend on its palette for identity.

RULES
- Every glyph comes from one IconKey enum, defined in Design/Icons.swift and design/Icons.kt and capped at about 40 keys. The server stores IconKey names for habits rather than free-form SF strings, which ends the silent CheckCircle fallback in Theme.kt sfIcon.
- Glyphs are unboxed; IconTile is removed. A habit glyph sits above its rule segment, not in a ring.
- Filled variants are used only for done or selected states, so state is carried by shape as well as colour.
- Lists never repeat the same icon on every row.
- Sizes: 22pt tab bar, 20pt inline, 24pt habit marks, 10pt badges.
- Accessibility: every glyph that carries meaning has a label; the custom JK tab image sets accessibilityLabel("JK, your coach") and a large-content image (bubble.left) so the Large Content Viewer works at accessibility sizes; Android sets contentDescription on every meaningful icon.

MAP (IconKey: SF Symbol / Material Symbol)

Tabs
- today: sun.max / sunny
- progress: chart.line.uptrend.xyaxis / trending_up
- jk: JK portrait, falling back to the monogram, then bubble.left / chat_bubble
- coachToday: tray.full / inbox
- clients: person.2 / group
- messages: bubble.left / chat_bubble

Goals and progress
- goal: flag / flag
- milestone: flag.checkered / sports_score (milestone letter cards)
- record: medal / military_tech
- photos: photo.on.rectangle / photo_library
- measurement: ruler / straighten
- week: calendar / calendar_month
- calendarFeed: calendar.badge.clock / event_repeat

Habits (closed catalogue the coach picks from)
- water: drop / water_drop
- sleep: moon / bedtime
- steps: figure.walk / directions_walk
- protein (Fuel): fork.knife / restaurant
- supplement: pills / pill
- energy or creatine: bolt / bolt
- mobility: figure.flexibility / self_improvement
- mindfulness: leaf / spa
- reading: book / menu_book
- sunlight: sunrise / wb_twilight
- custom: checkmark.circle / check_circle

Habit states and badges
- fromHealth badge: heart.fill / favorite, 10pt, in textSecondary (never red)
- rest (JK-granted): moon.zzz / bedtime_off, in the Habit sheet and Your week only

Sessions
- workout: figure.strengthtraining.traditional / fitness_center
- one-to-one: person.fill / person
- video: video / videocam
- group: person.3 / groups
- book: calendar.badge.plus / event_available

Coach and feedback
- letter: envelope.open / drafts
- checkIn: heart.text.square / monitor_heart
- form: doc.text / description
- voiceNote: waveform / graphic_eq
- play: play.circle.fill / play_circle
- formCheck: video.badge.plus / video_call
- mealPhoto: camera / photo_camera
- guide: book.closed / auto_stories
- reply: arrowshape.turn.up.left / reply

Coach reasons
- pain: bandage / healing
- unread: bubble.left / chat_bubble
- priority: arrow.up.circle / arrow_circle_up
- quiet: moon.zzz / bedtime_off
- noTraining: figure.strengthtraining.traditional / fitness_center

Utility
- done: checkmark / check
- chevron: chevron.right / chevron_right
- add: plus / add
- trendUp: arrow.up.right / north_east
- trendFlat: arrow.right / east
- trendDown: arrow.down.right / south_east (in slate or textSecondary, never red)
- lock: lock / lock (privacy only)
- settings: gearshape / settings

## Components

The system moves out of screen files. On iOS: Design/Tokens.swift, Design/Type.swift, Design/Icons.swift and Design/Components/*.swift. Android mirrors this file for file in design/Tokens.kt, Type.kt, Icons.kt and design/components/*.kt, so Theme.kt (1,191 lines) stops being a catch-all. The desk app.css takes the same tokens. Components keep the same names on all platforms.

PRIMITIVES
- Ring: the shared progress arc, with a start angle, sweep (360 or 300), stroke and fill. Used for the GoalHero, the coach GoalCard arc and the Fuel kcal ring. It replaces the inline Circle().trim code at ClientHomeView.swift:421 and TrainingViews.swift:751, and Android's ProgressRing.
- Surface: variants hero (no container), group (inset with dividers), card (surface, radius 12, no border), next (surface, 1pt hairline) and paper.
- PrimaryButton, SecondaryButton, TextButton, all with minimum (not fixed) heights. ChromeButton is kept only inside BrandIntro.
- Avatar (photo or initials scaled to diameter) and CoachAvatar (1.5pt accent ring).
- Label: the one-per-screen label, scaling with .caption2, sentence case at accessibility sizes. It replaces Eyebrow.
- StatusPill: a word plus a dot. Coach screens only, at most two.
- Toast: used for the untick undo and the "Updates from Apple Health" message.
- EmptyState: brand rule plus one serif italic line, for example "Nothing due. Enjoy the evening."
- AdaptiveStack: switches a horizontal arrangement to vertical at accessibility sizes (iOS ViewThatFits or dynamicTypeSize check; Android fontScale ≥ 1.5).

TODAY
- TodayHeader: date caption, sans greeting, avatar button.
- GoalLine: serif sentence, 2pt accent rule, tabular "x to go". States: set, notSet, reached ("Reached. JK will set the next one with you").
- HabitMark: a 24pt glyph in a 56pt (scaled, up to 72pt) touch target with a caption label.
  - States: idle (outline glyph, textSecondary); partial (rule segment filled proportionally); done (filled glyph in accent, segment filled); rest (JK-granted: glyph dimmed, no segment, label "Rest"); health (10pt heart badge; a tap shows the toast).
  - Tap ticks or adds one step. Tapping a done mark unticks it with an undo toast. Long press is a shortcut to the habit in HabitSheet.
  - Accessibility value, for example "Water, 2 of 3 glasses".
- HabitRule: the shared 2pt rule under the row, split into one segment per habit.
- HabitRow: header link ("Habits · 3 of 5 ›", or "Day done · 4 of 5"), HabitMarks over a HabitRule, WeekDots. Vertical list at accessibility sizes.
- WeekDots: 7 columns with a 6pt dot. States: done (accent fill), notDone (1.5pt trackStrong outline), today (1.5pt text-colour ring), rest (no dot). Tapping a dot opens YourWeek at that day. Shared with the letter and the coach grid.
- NextCard: one item, one PrimaryButton and an optional alsoDue caption. One visual form; content kinds: session, call, checkIn, form, workout, booking, rest, membership (Free).
- CoachNote: CoachAvatar with caption and unread dot, serif quote of at most 2 lines, Reply. One form; hides under the stale rule.

HABIT SHEET AND WEEK
- HabitSheet: rows of glyph, name, value or stepper, 7 dots and the consistency figure; FuelPanel for plans with 'nutrition'.
- FuelPanel: kcal Ring, three macro bars, food list, "Log food"; the "JK will set your targets" state.
- YourWeek: day sections, WeekItemRow with visible buttons, month toggle, BookSessionRow and CalendarFeedRow at the foot.

PROGRESS
- GoalHero: 120pt Ring at a 300-degree sweep, numberHero, start, now and target, week line, source line.
- MetricTile: label, numberTile, status word in textSecondary, trend glyph and source line.
- TrendChart: Swift Charts on iOS, Compose Canvas on Android. Slate line, dashed bone target, single baseline, no fill.
- ConsistencyLabel: "22 of the last 28 days".

FEEDBACK
- LetterView: paper, headline, WeekDots, ScoreTrio, KeepBlock, AdjustBlock, MediaNote, InlineQuestion, Signature, "Reply to JK". Kinds: weekly, milestone.
- ScoreTrio: three tabular numbers, each with its source on tap. Shared by the letter and the composer.
- CheckInSheet: three pages with read-only prefilled facts.
- SessionComplete: summary, PRChip, FeelRow (five words in a segmented row), note.
- ThreadCards: LetterCard, CheckInCard, FormRequestCard, PlanUpdateCard, FormCheckVideoCard, MessageBubble (client bubbles raised, JK bubbles surface with CoachAvatar).
- AskJKRow: Form check and Meal photo, each shown only if JK has it on.
- GuidesList and GuideView.
- JKHeader: name, plan reply line, Past letters and Guides links; FreeJKView variant.

COACH
- NeedsYouRow (with a priority reason).
- DayAgendaRow.
- HabitWeekGrid.
- GoalCard (editable).
- LetterComposer (weekly and milestone).
- LettersDueHeader.
- RestDaySheet.

RETIRED: ChromeButton (outside BrandIntro), GhostButton, chrome SmallPill, IconTile, HomeTile, ThinBar, CheckCircle as a habit control, StatTile in reports, the per-block Eyebrow, the DayStrip duplicates, DaySheet, MilestoneMoment, HabitRing as a ring row, and generic jkCard use. Its 115 calls map to Surface variants.

GOVERNANCE: scripts/lint-design.sh fails on these in Client/ and Coach/ screen files (iOS) and client/ and coach/ (Android):
- .font(.system(size: and Font.custom outside Design/Type.swift
- cornerRadius: with a number
- Color.black or Color.white
- .tint(.green)
- .foregroundStyle(.red)
- frame(height: and .frame(width:height:) on Button, Text or a text-bearing control (minHeight is allowed)
- textTertiary used on a raised surface (by component wrapper, not by regex where possible)
- Kotlin fontSize = N.sp, RoundedCornerShape(N.dp), Color(0x...) outside design/, and Modifier.height(N.dp) on text-bearing controls (heightIn(min = ...) is allowed)
- Desk: hex colours in server/desk/*.css outside the token block
scripts/contrast-check.mjs asserts every text-on-surface pair above, accent on accentWash, trackStrong and inputBorder at 3:1, and the status and kind pairs, in both modes.
CI: both scripts are wired into check.yml (ios/**), android.yml (android/**) and server.yml (server/desk/**), and each workflow's paths also include scripts/lint-design.sh and scripts/contrast-check.mjs.

## Server and data changes

Server: Node with node:sqlite (server/store.mjs). Every change is additive and optional. Apply these rules to all of them:
- Ship the server first, before any app that depends on it.
- Older app builds ignore unknown keys: Codable and kotlinx with ignoreUnknownKeys. Check net/Json.kt.
- Update docs/API.md and server/test/api.test.mjs in the same change.
- There is no Postgres grant step, because the database is SQLite.
- Back up the database file before each migration.
- Every new client route checks plan features through the same helper, and Free (plan 'none') clients never receive a 403 from anything Today or the JK tab calls.

1. Features (phase 2, needed for every gate)
   - /api/me gains features: the ids from planOf(db, user).features in server/plans.mjs: programme, messaging, habits, progress, checkin, sessions, nutrition, priority, guides. Plus coach extras, which are toggles, not plan features: formChecks, mealPhotos, challenges. Plus hasMacroTargets.
   - Gates: habits block and Habit sheet on 'habits'; Goal block and Progress on 'progress'; check-in, letters, Past letters and the letter line on 'checkin'; composer and timeline on 'messaging'; booking, credits and the calendar feed on 'sessions'; Fuel and food logging on 'nutrition' (the Fuel ring additionally on hasMacroTargets); same-day reply line and priority ranking on 'priority'; Guides on 'guides'.
   - If the features object is missing (an older server), the client shows what it shows today, so nothing a client pays for disappears by accident.

2. Guides for clients (phase 2)
   - GET /api/guides calls requireCoach today (server/coach.mjs:223-225). Add GET /api/client/guides and GET /api/client/guides/:id, allowed for any client whose plan includes 'guides' (including Free), exempt from requireMember.

3. Habit week, early (phase 2)
   - GET /api/habits/week?from=&to= (client) returns per day: done (using the current all-habits rule until item 6 lands) and rest. One call for the WeekDots.
   - GET /api/coach/clients: ClientSummary gains habitWeek (7 day states: done, notDone, rest) so the Clients list needs no per-client calls.

4. Goal (phase 3; new table `goals`, new server/goals.mjs)
   - Fields: {id, clientId, title, metric: weight|waist|measurement|record|habit|custom, exerciseId?, measureKey?, habitId?, unit, baseline, target, startDate, targetDate, why?, status: draft|active|reached|paused, chapterName? (written by JK only), updatedAt}.
   - The server derives current, progressPct, remaining, weekOf {week, weeks} and sourceLabel (for example "From your weigh-ins, 7-day average") from data already stored in progress.mjs.
   - Endpoints: GET /api/goal (client, own active goal; plans with 'progress'); GET /api/goals?clientId= (coach); POST /api/goals, PATCH /api/goals/:id, DELETE /api/goals/:id (coach).
   - Migration: create a draft per client from Profile.goals tags plus the Intake free text (forms.mjs answers, seeded in testclients.mjs). Profile.goals stays for segmentation.

5. Habit fields (phase 3; habits table, store.mjs:55-59)
   - iconKey: closed enum. Validate it server-side and map existing SF names to keys.
   - step: increment for count habits.
   - introducedAt.
   - Ordering reuses the existing `position` column; no sortOrder is added.
   - No weekday schedule is added, so there is no notScheduled state.
   - The server rejects a sixth active habit. Clients who already have more than five keep them until JK chooses; the desk flags those clients.

6. The day rule (phase 3; server/daily.mjs:32 habitStreak)
   - dayMinimum per client (default ceil(60% of active habits), JK can edit).
   - A day is done when the minimum is met. A day JK has granted as rest is neither done nor missed.
   - Rest days: new table rest_days {clientId, date, reason?, grantedBy}. POST /api/clients/:id/rest-days and DELETE (coach only).
   - Returned on /api/habits and /api/today: dayDone, consistency {done, window: 28}, missedYesterday.
   - Callers of habitStreak and what each uses afterwards:
     - daily.mjs:67, the /api/habits route's `streak` field: keeps the old all-habits computation for one release for old builds; new builds read dayDone and consistency.
     - progress.mjs:137, the challenge streak in challengeOut: switches to consecutive days done under the new minimum rule, with rest days skipped rather than breaking it.
     - coach.mjs:16 adherence (used at :80 in the clients list and :212 in Business) is a separate function and is unchanged; the coach list shows habitWeek instead.
   - Recompute on migration, and say so in the first letter after release.
   - GET /api/habits/history?from=&to= (phase 3, for Progress level 3 and the coach grid): per habit daily {value, done, source}, rate7, rate28; per day dayDone and rest.

7. GET /api/today (phase 3; new server/today.mjs)
   - Returns: {goal summary, coachLine {text, source: letter|message|override, letterId?, messageId?, unread, staleAfterDays}, habits with today's values and states, dayDone, week [7 days: done, rest, today], next {kind, item, alsoDue[]}, features}.
   - Merges workouts (training.mjs), own bookings and joined classes (bookings.mjs) into one source, so Today cannot say "Rest day" while a class is booked.
   - coachLine source: the latest letter's Adjust line (or headline while unread on its delivery day) for plans with 'checkin'; the first line of JK's latest message for plans with 'messaging' but not 'checkin'; an override when JK sets one. Omitted when older than the plan rhythm plus three days, and for Free.
   - Next priority: a session within 3h, then check-in (only with 'checkin') or form due, then today's workout, then the next booking, then rest. For Free: kind membership.
   - It never calls member-only routes on behalf of a Free client; it returns a reduced payload instead.
   - Both apps render only this payload from phase 3.

8. Letters (phase 3; extend reports, server/reports.mjs; plans with 'checkin')
   - New fields: kind weekly|milestone, headline, keep, adjust, question, answer?, answeredAt?, mediaId?, mediaKind audio|video, durationSec (≤ 90), readAt, goalId?, deliverAt (default Monday 07:00 Europe/London), focusOverride? (an occasional coach override of the Today line).
   - New endpoints: POST /api/reports/:id/read and POST /api/reports/:id/answer. The answer also posts to the thread. "Reply to JK" uses the normal message endpoint with a reportId reference.
   - Publishing sets reviewedAt on the matching check-in.
   - Map old reports: headline = first sentence of summary, keep = wins, adjust = focus. Keep the old fields as aliases.
   - Rhythm: per-plan default set by the coach (Elite weekly with media, Performance weekly written), with a per-client override to fortnightly. Foundation and Free have no letters because the plan does not include 'checkin'.

9. Check-ins (phase 3; plans with 'checkin')
   - Add stress (1-5), win, struggle and photoIds.
   - GET /api/checkins/draft returns the week's steps and sleep averages, habit consistency, sessions done/planned and feel ratings.

10. Media (phase 3, before the LetterComposer and the form-check camera)
   - POST /api/media: audio/mp4 (m4a), video/mp4 and image/jpeg|png|heic; caps of 10 MB for images and audio and 60 MB for a 90-second 720p video; the same auth rule as photos (the owner, plus the coach of the client).
   - GET /api/media/:id, streamed with range support.
   - Stored beside photos with the same backup coverage. Included in /api/me/export and erased in DELETE /api/me alongside erasePhotos.
   - Letters, messages (form checks and meal photos) and the coach portrait and signature reference media by id.

11. Timeline (phase 3)
   - GET /api/timeline?before=&limit= merges messages, letters, check-ins, form requests and published plan updates, each item with a `kind`.
   - The check-in confirmation is stored as a timeline item.
   - Until then (phase 2) the apps merge four calls client-side and show the check-in confirmation as a synthetic card that is not stored.

12. Session feel and form checks (phase 3)
   - The workout completion gains feel (1-5, shown as words) alongside the existing completionNote.
   - Messages gain exerciseId? and mediaId for form checks and meal photos. workoutId already exists.

13. Bookings (phase 3)
   - Bookings gain meetingUrl?; the coach profile gains defaultMeetingUrl, used for video bookings without their own. The Next card shows "Join" only when one resolves, otherwise "Details".

14. Calendar feed: no server change. The existing /cal/<token>.ics feed gets its entry point in Your week (plans with 'sessions').

15. Coach profile (phase 3)
   - Me.coach gains avatarMediaId, signatureMediaId and replyExpectation {standard ("JK replies most evenings"), priority ("Same-day replies")}. Clients see the priority line when their plan includes 'priority'.

16. Coach needs-you (phase 3)
   - GET /api/coach/needs-you returns one ranked, de-duplicated list per client with reasons[], primaryAction and lettersDue {count, estMinutes}.
   - Unread messages from clients on a plan with 'priority' rank above other unread messages, with "priority" in reasons.
   - Milestone suggestions (goal reached, first PR, four weeks at the minimum, twelve weeks on plan) appear as a low-ranked reason; they become letters only when JK writes them.
   - Records gain isNewThisWeek.
   - Autoflows: the engine stays for existing runs. The phone stops exposing it, and the desk offers a toggleable Week 1 sequence.

17. Preferences (phase 3)
   - notificationsOn and eveningReminderTime only. Never use countdown copy.

LATER OPTIONS (only if the owner approves after testing phase 3): habit pillars, identity lines and anchors; a client-managed rest allowance; a votes window and bedding-in arc; per-client nudge tone set by JK; habit-to-outcome insights (computed only with at least 5 days on each side, offered on the letter draft for JK to include or not); an intro-call booking kind for Free (a requireMember exemption plus a non-credit slot).

## Implementation plan

General rules:
- iOS and Android change together in every phase, keeping the same view names.
- The server ships before the apps.
- Each phase goes to the owner on TestFlight first (and an internal Android build) before family or clients. A merge to main pushes the build to the family's ad-hoc copy, so the owner tests branch builds first.
- The desk is previewed locally and bound to porkserv's Tailscale IP (100.83.68.108), never 127.0.0.1.
- Validation for every phase: node --test server/test, both app builds, scripts/lint-design.sh, scripts/contrast-check.mjs, a check at default and accessibility text sizes, and screenshots refreshed in android/screens/.
- Order: the owner sees the simplified app after phase 2, decides after phase 3 whether any later options are wanted, and phase 4 runs only if he says yes.

PHASE 1: Tokens and components, with no visible behaviour change (about 1 to 1.5 weeks)
- iOS: split Design/Theme.swift into Design/Tokens.swift (JK colours as asset-catalogue pairs in Assets.xcassets), Design/Type.swift (the scale above: UIFontMetrics-scaled sans, serif via Font.custom relativeTo:), Design/Icons.swift (IconKey) and Design/Components/:
  - Ring, Surface, Buttons (minimum heights), Avatar, Label, StatusPill, Toast, EmptyState, AdaptiveStack
  - Moved from screen files: DayStrip (TrainingViews.swift), UpcomingRow, HomeTile and MacroRow (ClientHomeView.swift), StatTile, DeltaBadge and RatingCard (ProgressViews.swift)
- Fonts: add the Newsreader roman and italic variable .ttf files under ios/JKPerformance/Resources/Fonts and register them in ios/project.yml (the target's resources, plus info.properties UIAppFonts), then regenerate with XcodeGen. Verify optical sizing on device.
- Replace .tint(.green) at AccountViews.swift:112 and :405, PlanEditorViews.swift:293 and :306, and CoachViews.swift:1134 with JK.accentControl. Replace the red heart at ClientHomeView.swift:208.
- Android: split design/Theme.kt into design/Tokens.kt, Type.kt (res/font/newsreader_roman.ttf and newsreader_italic.ttf with FontVariation.Settings per token) and Icons.kt. Icons.kt replaces sfIcon with IconKey, backed by res/drawable/ms_*_fill0/1.xml exported by scripts/export-symbols.mjs. Add design/components/*.kt. ProgressRing becomes Ring.
- Desk: tokens go into server/desk/app.css (dark and light), and the 2-stop chrome is removed.
- Add scripts/lint-design.sh and scripts/contrast-check.mjs, and wire both into .github/workflows/check.yml, android.yml and server.yml, adding the script paths to each workflow's path filters.
- Swap the palette. Ring, PrimaryButton and Surface stand in for the old components under their old names, so screens change colour and type but not structure.

PHASE 2: Today and the 3-tab layout, mostly on existing APIs (about 2 weeks). Owner checkpoint at the end.
- Server first (small): /api/me features from planOf (dataChanges 1), GET /api/client/guides (2), GET /api/habits/week and habitWeek on ClientSummary (3). docs/API.md and tests.
- iOS:
  - JKPerformanceApp.swift ClientTabs (100-126): Today, Progress and JK, with tabs hidden by plan.
  - Net/Push.swift:13 TabRouter.Client: today, progress and jk, with old cases remapped.
  - Client/ClientHomeView.swift is rebuilt as TodayView. It uses /api/habits, /api/habits/week, the workouts, bookings and reports endpoints, and merges them client-side for now. WeekDots show done and not done using the current all-habits rule, plus today; rest arrives in phase 3. The Goal block is hidden until phase 3. The Consistency tile is deferred to phase 3; Progress shows Strength or Body and the existing history.
  - DailyHabitsView becomes HabitSheet with FuelPanel (gated on 'nutrition').
  - Client/TrainingViews.swift WorkoutPlanView and Client/CalendarViews.swift MyCalendarView merge into YourWeekView, with BookSessionView and the CalendarSubscribeCard moved to its foot.
  - SessionComplete is added in TrainingViews.swift (the feel word is stored in completionNote until phase 3).
  - Client/MessagesView.swift becomes JKView: a timeline merged client-side from four calls, the synthetic check-in confirmation card, AskJKRow, the reply line (temporarily from config, priority line by plan), and the Free variant.
  - New Client/GuidesView.swift.
  - Client/FeedbackViews.swift becomes a LetterView rendering the old summary, wins and focus fields.
  - Client/ProgressViews.swift is reorganised into three levels (Challenges behind the coach toggle). WeeklyCheckInView becomes CheckInSheet (gated on 'checkin').
  - Client/AccountViews.swift is presented as the eight-row sheet; reminder toggles collapse to on/off plus a time.
  - Client/FormViews.swift is reached through NextCard.
- Android: App.kt client tabs (~256-266), net/Push.kt TabRouter, and the same client/*.kt files (including client/OnboardingViews.kt for the restyle), plus a new client/GuidesViews.kt.
- Coach, iOS and Android:
  - CoachTabs (JKPerformanceApp.swift:128-147 and App.kt ~277-281) become Today, Clients and Messages.
  - Coach/TodayCards.swift and CoachViews.swift Today become a NeedsYou list computed client-side, with priority-plan unread ranked first.
  - ScheduleViews.swift becomes the DayAgenda.
  - The Guides tab is removed; its desk link and 'Preview as client' move to Account.
  - ClientDetailViews.swift defaults to the Overview, with the title set to the client's name and the habitWeek strip in the Clients list.
  - Desk-only screens are hidden behind a flag; nothing is deleted yet (this is release A of phase 5).
- Checkpoint: the owner uses the 3-tab app on TestFlight for at least a week before phase 3 is merged.

PHASE 3: Goal, letters and the Today aggregate (about 2 to 2.5 weeks). Owner checkpoint at the end.
- Server:
  - New server/goals.mjs, server/today.mjs, server/media.mjs and server/timeline.mjs, registered in server/app.mjs.
  - store.mjs migrations for goals, rest_days, media, the habit columns (iconKey, step, introducedAt), and the new report, check-in, booking and message columns.
  - daily.mjs: dayMinimum, dayDone, consistency, missedYesterday; legacy streak kept for one release. progress.mjs:137 challenge streak moved to the new rule.
  - reports.mjs: letter fields, kinds, read, answer, deliverAt scheduling, per-plan rhythm, publishing marks the check-in as replied.
  - progress.mjs: goal current, weekOf and source.
  - coach.mjs: needs-you (with priority and milestone suggestions), rest days.
  - bookings.mjs: meetingUrl and the coach default room.
  - Me.coach avatar, signature and the two reply lines.
  - Media in /api/me/export and DELETE /api/me.
  - docs/API.md, server/test/api.test.mjs and desk.test.mjs.
- Desk: in server/desk/clients.js, the Overview gets a GoalCard, Edit habits (cap, minimum, macro targets), rest days, and the LetterComposer with media upload and per-client rhythm. today.js gets letters due. Coach settings get the meeting room and reply lines.
- Apps:
  - Net/Models.swift and net/Models.kt gain the new optional types. APIClient.swift and Api.kt gain the endpoints.
  - TodayView and its Android twin switch to /api/today: GoalLine, CoachNote with the stale rule, NextCard with alsoDue and Join/Details, WeekDots with rest gaps, "Day done".
  - JKView switches to /api/timeline.
  - LetterView gets the full shape, "Reply to JK" and milestone letters.
  - Progress gets GoalHero and the Consistency tile.
  - SessionComplete posts feel; the logger gets the form-check camera.
  - ClientDetailViews gets GoalCard, HabitWeekGrid, Give a rest day and LetterComposer, and the per-check-in reply box is removed (CoachNotesTab 624-703).
  - Reminders.swift and Reminders.kt use the single evening time.
  - The migration seeds draft goals; JK sets goals in bulk on the desk before the client release.
- The first letter after release explains the day rule ("A day counts once you hit JK's minimum").
- Checkpoint: the owner decides which, if any, later options are wanted.

PHASE 4: Later options, only if the owner approves (sized after the decision)
- Candidates: anchors and anchor-timed reminders, identity lines, pillars, per-client nudge tone on the desk, habit-to-outcome insights on the letter draft, a votes window or bedding-in arc, an intro-call booking for Free.

PHASE 5: Coach phone clean-up, over two releases (about 1 week)
- Release A (ships inside phase 2): hide the Programs, Autoflows and Forms editors (CoachViews.swift:485-860, AutomationViews.swift), Plans & prices (PlanEditorViews.swift), Business (CoachViews.swift:200-303) and availability (ScheduleViews.swift:299-396), plus the Android twins (AutomationViews.kt, PlansViews.kt, CoachViews.kt), behind a coach setting.
- Release B: delete them once JK confirms he does not use them from the phone. This removes about 4,000 lines across the two platforms.
- Toggleable Week 1 onboarding sequence on the desk (autoflows.mjs).

Release gate:
- A reachability table: every feature each plan promises (plans.mjs FEATURES, per plan) has exactly one client home, including Guides for Free, food logging for Elite without targets, the calendar feed for 'sessions', and the same-day line and priority ranking for 'priority'. Coach toggles are listed separately.
- A ceiling check: 10 client destinations or fewer, 3 parts or fewer per Today block.
- Contrast pass in both modes, including non-text pairs.
- Fit on a 6.1-inch screen at default size, and a usable vertical layout at AX3 and Android font scale 2.0.
- Verify on an iOS device; the audit only saw Android.

## Open questions

1. Can JK keep up the letter rhythm by tier (Elite weekly with voice or video, Performance weekly written)? At what client count should Performance default to fortnightly? Is a voice note plus a headline acceptable as the minimum?
2. Should Foundation, which does not include the weekly check-in, get an occasional monthly note from JK, or is JK's latest message on Today enough? Adding a note would be a new promise in Membership.
3. Serif: keep Newsreader (free, OFL, but widely used on editorial and SaaS sites) or license a signature face for headlines and JK's line only, for example GT Super (Grilli Type), Canela (Commercial Type) or Tiempos Headline (Klim)? App licences are sold separately from web and desktop licences, so quotes are needed for iOS, Android and the desk before phase 1 ships. Newsreader remains the fallback either way.
4. Should the chrome gradient survive in BrandIntro and the app icon as heritage, or should the icon move to bone and champagne too? The owner needs to decide before phase 1 ships.
5. Does JK have a professional portrait and a monogram vector? The JK tab, CoachNote and the letter signature depend on both. A commissioned monogram is the one bespoke asset to prioritise.
6. Which coach-phone editors (Programs, Forms, Autoflows, Plans & prices, availability) does JK actually use away from a desk? There are no analytics, so this decides how fast phase 5 can go.
7. Default day minimum: is 60% of habits (3 of 5) right, and should JK set it per client?
8. Food logging is now gated on the 'nutrition' feature (Elite only). Does any Foundation or Performance client log food today? If so, should JK be able to switch it on for them as a coach extra?
9. Should Challenges stay as a coach toggle at all, or be removed in keeping with the one-to-one positioning?
10. Which video service holds JK's meeting room for Elite calls, and is one fixed room enough?
11. When should the light "paper" mode ship, and should the letter default to light in the daytime?
12. Is Monday 07:00 Europe/London right for all clients, or should delivery follow each client's local time zone?
13. Should Elite's rhythm and same-day replies be visible to lower plans as quiet text in Membership, or not at all?
14. Is the third tab best named "JK" or "Coach"? "JK" is more personal and more distinctive; "Coach" is clearer to a new client.
15. Is the current five-tab muscle memory a risk for existing family testers? If they look for the programme, should Your week ship as a fourth tab from day one?
16. After testing phase 3, which later options (anchors, identity lines, a votes window, nudge tone set by JK, insights, an intro call for Free) does the owner want, if any?

## Borrowed from

- **Everfit**: Today is built only from what the coach has assigned, never shows empty sections, and keeps the week off the main view (https://help.everfit.io/en/articles/3581190-client-app-today)
- **Trainerize (2024/25 redesign)**: Tabs stay hidden until something is assigned; profile moves to the top corner; one light, spaced-out list for today (https://www.trainerize.com/blog/trainerize-product-update-new-modern-app-experience/)
- **Oura (Nov 2025 redesign)**: Taken as principles, not as a look: fewer tabs, one big thing on Today, and a ground that is not pure black. Its tone switch is deliberately not copied, because JK's voice is the product, and the brand is carried by JK's portrait, monogram and rule rather than a palette (https://ouraring.com/blog/new-app-design/)
- **WHOOP**: Every colour has one job; one dominant answer per screen; detail behind three levels of deliberate taps; a separate treatment for numbers; a minimum-data rule before any behaviour-to-outcome claim (https://developer.whoop.com/assets/files/WHOOP - Brand & Design Guidelines-bdea3554e94b4ea09e68695b1e8dc8e7.pdf)
- **Caliber**: A weekly coach review with a short video is the product; summary figures must say what they are made from (https://www.garagegymreviews.com/caliber-app-review)
- **Future**: Sunday-to-Monday rhythm, a one-tap word for how a session felt, form-check video tied to the lift, nutrition led by the coach rather than logged in the app (https://www.garagegymreviews.com/future-app-review)
- **Ladder**: One primary action per screen; the session-complete page is the emotional peak; tier differences shown as what the coach does rather than as locked tiles (https://screensdesign.com/showcase/ladder-strength-training-plans)
- **Streaks (Apple Design Award)**: One tap to tick, a short list, and automatic completion from Health. Its row of large icon rings is not copied; JK uses glyphs over one shared rule (https://apps.apple.com/us/app/streaks/id963034692)
- **Apple HIG Activity rings**: Never copy the three concentric Activity rings or their colours (https://developer.apple.com/design/human-interface-guidelines/activity-rings)
- **Apple HIG Typography and Large Content Viewer**: Scale every text style with Dynamic Type, cap only display numerals, and give non-scaling bar items a large content image (https://developer.apple.com/design/human-interface-guidelines/typography)
- **Atoms (James Clear)**: 'Never miss twice' wording the morning after a miss, and a count that a miss lowers rather than wipes out (https://atoms.jamesclear.com)
- **Sharif and Shu; Duolingo Streak Freeze**: Protecting consistency with rest days, adapted so that JK grants them and a day counts once his minimum is met (https://anderson-review.ucla.edu/emergency-reserves/ ; https://blog.duolingo.com/improving-the-streak)
- **MacroFactor and Noom**: Adherence-neutral display: no red, no shaming numbers when over target (https://macrofactor.com/dashboard-revamp/)
- **Fabulous**: Feedback as a short personal letter. Its commitment button and programme chapters are not copied; the letter ends with a real reply to JK (https://design.google/library/fabulous-motivating-app-engagement)
- **Kivetz et al. (goal gradient)**: Always show distance remaining (https://business.columbia.edu/faculty/research/goal-gradient-hypothesis-resurrected-purchase-acceleration-illusionary-goal)
- **Dai, Milkman and Riis (fresh start effect)**: The letter lands on Monday morning (https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf)
- **Equinox (COLLINS) and Aesop**: Restraint as the luxury signal: no gradients or shadows, controlled typography, and one recurring brand device (the champagne rule and the monogram); a licensed signature face is worth pricing (https://wearecollins.com/work/equinox-hotels)
- **Third Space London**: Commitment marked sparingly; one design system shared by the app and the web (https://marcommnews.com/?p=85117)
- **Ultrahuman Emerald (July 2026)**: Lead with what to do rather than a number: JK's line on Today (https://www.techtimes.com/articles/321536/20260724/ultrahuman-emerald-update-ditches-dashboards-ai-driven-health-coaching.htm)
- **Eight Sleep**: A light display weight for headings rather than heavy semibold (https://www.anagrama.com/project/eight)
- **Google Material Symbols**: Rounded style, grade −25 on dark, opsz matched to the rendered size, FILL 0 to 1 for the done state (https://developers.google.com/fonts/docs/material_symbols)
- **Android Compose variable fonts**: Set FontVariation.Settings (weight and opsz) on each Font so optical sizing applies (https://developer.android.com/develop/ui/compose/text/fonts)
- **Material dark theme guidance and WCAG 2.1 (1.4.1, 1.4.3, 1.4.11)**: Avoid pure black and white, desaturate on dark, measure every text pair to 4.5:1 and every state-bearing graphic to 3:1, and never rely on colour alone (https://m2.material.io/design/color/dark-theme ; https://www.w3.org/TR/WCAG21/)
- **Hevy Coach / TrueCoach / Kahunas reviews**: Prefill check-ins from data already held, keep the note on the session-complete page, one chronological plan list, never thin small type (https://www.g2.com/products/xplor-truecoach/reviews)