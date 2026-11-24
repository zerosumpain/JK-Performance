# WP4: Campaigns and guidebook (F13, F14)

What `desk-v2-wp4` adds (docs/design/desk-v2.md F13, F14, section 5 WP4). Server: `server/features/campaigns.mjs`,
`server/features/guidebook.mjs`. Desk: `server/desk/f-campaigns*.{js,css}`, `server/desk/f-guidebook*.{js,css}`.
JSON fixtures for the apps (WP9, WP10) are in [`wp4-fixtures/`](wp4-fixtures/), captured from the demo world.

Conventions are those of [`README.md`](README.md): camelCase, London days `YYYY-MM-DD`, UTC instants, integer pence,
`{error}` bodies, 403 for the wrong role, **404 for anything foreign or missing**. Every coach route calls `requireCoach`
and joins the client's **current** coach (a reassigned client leaves the old coach's lists, boards and nudges).

## For the apps (WP9, WP10): the client side

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/campaigns/mine` | – | `{invitations:[Invitation], enrolments:[MyEnrolment]}`; enrolments are `active`, `paused`, and `completed` in the last 30 days |
| POST | `/api/campaigns/mine/:enrolmentId/accept` | `{startOn?}` (rolling campaigns only, not in the past) | `{enrolment: MyEnrolment}`; **409** `"This campaign is full"` (no waitlist), or `enrolment.status:'waitlisted'`; 409 when already answered |
| POST | `/api/campaigns/mine/:enrolmentId/decline` | `{}` | `{ok:true}` |
| GET | `/api/campaigns/mine/:enrolmentId` | – | `{enrolment, campaign, phases:[Phase+{startsOn, guide:{id,title}\|null}], activities:[Activity], kit:[Kit+{bought, spentPence}]}`; for an open invitation `enrolment` is `{id, status, invitation: Invitation}` |
| POST | `/api/campaigns/mine/:enrolmentId/items/:itemId` | `{done:bool, value?, note?, mediaId?, spentPence?}` (`itemId` = an activity or a kit item) | `{pct, points, pace}`; 409 unless `active`; 409 "That one is not due yet" for a future activity; emits `campaign.activityDone` the first time |
| GET | `/api/guides/coach/:guideId` | – | `{guide:{id, title, summary, tags, readMinutes, blocks:[Block], updatedAt}}`: a **published** guide of the caller's own coach, else 404. Emits `guide.opened` once per client per guide |
| GET | `/api/guides/coach/:guideId/media/:mediaId` | – | the file (Range supported), only when the block is in that guide and the file is the coach's; else 404 |

Only the client's own enrolments, in campaigns of their current coach, are visible: anything else is a 404. A coach calling
`/api/campaigns/mine…` gets 403.

```jsonc
// Invitation (invitationOut): what the client sees before committing
{"enrolmentId":"ce_…","status":"invited|waitlisted",
 "campaign":{"id":"cg_…","name":"12-Week Marathon Build","tagline":"…","description":"…","coverUrl":"/api/media/md_…"|null,
             "startMode":"fixed|rolling","startsOn":"2026-11-01"|null,"endsOn":"2027-01-23"|null,"lengthDays":84},
 "feePence":4900,"discountPence":0,"discountCode":null,
 "kit":{"required":[{"name":"Running shoes","estPence":12000}],"optional":[{"name":"Running belt","estPence":1500}],
        "requiredPence":15300,"optionalPence":5300},
 "expectedSpendPence":15300,            // required kit + planned purchases (a purchase linked to a kit item counts once); the fee is extra
 "placesLeft":2|null,                    // null: no capacity limit
 "respondBy":"2026-12-06",               // 14 days after the invitation, or the start of a fixed campaign if sooner
 "welcomeText":"…"}
// MyEnrolment
{"id":"ce_…","status":"active|paused|completed","campaign":{"id","name","tagline","coverUrl"},
 "day":24,"lengthDays":84,"startOn":"2026-11-01","endsOn":"2027-01-23","pct":20,"points":215,
 "today":[Activity],"next":[Activity ×≤3],          // next: the next three activities after today
 "rank":{"position":3,"of":4},                     // only when the coach shows ranks (settings.showRank)
 "planUrl":"https://…/plan/<token>"}               // the read-only web plan page, valid 45 days
// Activity (activityOut)
{"id":"ca_…","day":23,"date":"2026-11-24","title":"Intervals 6 × 800 m",
 "kind":"task|workout|habit|checkin|read|purchase|session|measure|custom","detail":"","points":15,"required":true,"spendPence":0,
 "guide":{"id":"gb_…","title":"Fuel the long run"}   // a linked guide: fetch /api/guides/coach/:id
        |{"blocks":[Block]}                        // or inline blocks (media blocks carry "url")
        |null,
 "done":false,"doneAt":null,"spentPence":12999?}    // spentPence only when the client reported one
// Kit (in GET …/mine/:id)
{"id":"ck_…","name":"Running shoes","estPence":12000,"required":true,"url":"https://…"|null,"note":"","position":0,"bought":true,"spentPence":12999|null}
```

**Guide blocks (F14).** A JSON list, at most 200 blocks and 60 KB. Text is plain; the only inline formatting is `**bold**` and
`_italic_` (an underscore pair at word boundaries). **Never render a guide as HTML**: tokenise the two markers and draw text.

```jsonc
[{"t":"h","text":"Fuel the long run"},
 {"t":"p","text":"Eat **30–60 g** of carbs per hour after the first hour."},
 {"t":"list","style":"bullet|number|check","items":["Gel at 45 min","Water every 20 min"]},
 {"t":"callout","tone":"tip|warn|info","text":"Practise race-day fuel in training."},
 {"t":"image","mediaId":"md_…","caption":"","url":"/api/guides/coach/gb_…/media/md_…"},   // url added in client responses
 {"t":"video","mediaId":"md_…","caption":"","url":"…"},{"t":"audio","mediaId":"md_…","caption":"","url":"…"},
 {"t":"link","url":"https://…","label":"Shop list"},      // https only; open outside the app
 {"t":"exercise","exerciseId":"ex_…"},                    // look it up in /api/exercises
 {"t":"divider"}]
```

Fixtures: [`mine-sam.json`](wp4-fixtures/mine-sam.json) (an active enrolment with a rank, and a completed one),
[`mine-alex-invitation.json`](wp4-fixtures/mine-alex-invitation.json) (an open invitation), [`mine-detail.json`](wp4-fixtures/mine-detail.json),
[`guide-client.json`](wp4-fixtures/guide-client.json).

### The plan page (public, server-rendered, no JS)

| Method | Path | Notes |
|---|---|---|
| GET | `/plan/<token>` | One enrolment: the invitation with **Accept** / **Not this time**, or Day N of M, today's activities, the next three days, the phases, the kit list and every guide in full |
| POST | `/plan/<token>` | `application/x-www-form-urlencoded` `csrf=<per-token>&action=accept\|decline`; 303 back to the page; 409 page when already answered or full; 403 page for a bad CSRF field; 429 page after 10 posts per token per hour |
| GET | `/plan/<token>/guide/<guideId>` | One guide in full (a guide-share token, or an enrolment token for a guide its campaign uses). Emits `guide.opened` once |
| GET | `/plan/<token>/media/<mediaId>` | A file that sits in a guide (or inline blocks, or the cover) the token opens; anything else 404 |

- `token` = `<subject>.<expiry>.<HMAC-SHA256(key, "plan:" + subject + "." + expiry)>`, base64url, with a 32-byte key at
  `<DATA_DIR>/secrets/plan-link.key` (made on first use, mode 0600). `subject` is an enrolment id (`ce_…`), or `<clientId>~<guideId>`
  for a guide shared with one client. Valid **45 days**; every nudge and invitation carries a fresh one.
- 404 for a tampered, malformed or expired token, an erased client, a client who has moved to another coach, a `dropped` enrolment,
  one `completed` more than 30 days ago, or an unpublished or deleted guide.
- Headers on every answer: `content-security-policy: default-src 'none'; style-src 'sha256-…'; img-src 'self'; media-src 'self';
  form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, `referrer-policy: no-referrer`, `x-robots-tag: noindex, nofollow`,
  `cache-control: no-store`, `x-content-type-options: nosniff`. First names only.

## Coach endpoints (F13)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/campaigns` | `?status=draft\|live\|ended\|archived` (default: all but archived) | `{campaigns:[Summary]}` |
| POST | `/api/campaigns` | `{name, tagline?, template?:'blank'\|'challenge6'\|'event12'\|'reset30'}` | `{campaign}` (a draft; `reset30` is rolling, the rest fixed) |
| GET | `/api/campaigns/:id` | – | `Design` = `{campaign, phases:[Phase], activities:[Activity], kit:[Kit]}` |
| PUT | `/api/campaigns/:id` | a `Design` (each of `campaign`'s keys, `phases`, `activities`, `kit` optional: absent = unchanged) | `Design` |
| POST | `/api/campaigns/:id/status` | `{status}` | `{campaign}`; `live` needs an activity (and a start date when fixed), 409 otherwise; `ended` stops nudges |
| POST | `/api/campaigns/:id/duplicate` | – | `{campaign}` (a draft "… (copy)" with new ids, no dates, not public) |
| DELETE | `/api/campaigns/:id` | – | `{ok}`; 409 for a non-draft with any enrolment ("archive it instead") |
| POST | `/api/campaigns/:id/enrol` | `{clientIds?, audience?, startOn?, invoice?:bool=true, discountCode?, discountPence?, mode:'invite'\|'inPerson', layProgram?:bool}` | `{invited, enrolled, waitlisted, skipped:[{clientId, reason}]}`; one foreign id 404s the whole request; 409 when not live; **409 "This campaign is full"** for `inPerson` with no waitlist (nothing written) |
| POST | `/api/campaigns/:id/invitation-preview` | `{clientId?, startOn?, discountCode?, discountPence?}` | `{text}`: the invitation message exactly as it would be sent |
| POST | `/api/campaigns/:id/enrolments/:eid/resend` | – | `{ok}` (open invitations only; restarts the 14 days) |
| DELETE | `/api/campaigns/:id/enrolments/:eid` | – | `{ok}`: withdraws an invitation (the row goes) or drops an active/paused enrolment (frees the place) |
| GET | `/api/campaigns/:id/board` | – | `{campaign: Summary, phases, clients:[BoardRow], invited:[{enrolment, client}], totals:{expectedSpendPence, spentPence, requiredKitPence, optionalKitPence}, challenge?}` |
| POST | `/api/campaigns/:id/announce` | `{text}` | `{sent}`: one message to every active and paused client (`via:'coachAction'`) |
| POST | `/api/campaigns/:id/nudge` | `{text, clientIds?}` (default: everyone behind) | `{sent, deferred, skipped}` (`via:'nudge'`, governed by the outreach rules) |
| GET | `/api/campaigns/ending` | `?days=30` | `{enrolments:[{client, campaign:{id,name}, endsOn, enrolmentId, status}]}` (F8 renewals) |
| GET | `/api/coach/clients/:id/campaigns` | – | `{enrolments:[Enrolment + {campaign:{id,name,status,tagline}, today:[Activity]}]}` (the Client 360 tab) |

```jsonc
// Summary (list and board)
{...Campaign, "enrolled":4,"invited":1,"placesLeft":2,"avgProgress":28,"behind":1,"activityCount":64,"phaseCount":4,
 "expectedSpendPence":15300,"requiredKitPence":15300,"people":[{"id","name","initials"}],"today":24|null}
// Campaign
{"id":"cg_…","name":"…","tagline":"…","description":"…","coverMediaId":null,"coverUrl":null,"status":"draft|live|ended|archived",
 "startMode":"fixed|rolling","startsOn":"2026-11-01"|null,"endsOn":"2027-01-23"|null,"lengthDays":84,"feePence":4900,"capacity":6|null,
 "waitlist":true,"public":false,"challengeId":null,"settings":{"dailyNudge":true,"nudgeAt":"07:00","showRank":true},
 "welcomeText":"…","completionText":"…","createdAt":"…","updatedAt":"…"}
// Phase: {"id":"cph_…","name":"Base","startDay":0,"endDay":20,"color":"chart-1…chart-6","guideId":"gb_…"|null,"summary":"","position":0}
// Activity (coach): {"id":"ca_…","phaseId","day","title","kind","detail","guideId","blocks":[Block]|null,"linkRef":"p_…|ck_…|inperson|video|<metric>"|null,
//                    "points","required","spendPence","position"}
// Kit (coach): {"id":"ck_…","name","estPence","required","url","note","position"}
// Enrolment (coach)
{"id":"ce_…","campaignId","clientId","status":"invited|waitlisted|declined|active|paused|completed|dropped","startOn","endsOn","day","lengthDays",
 "pct","pace","behind","behindSince","points","cells":[{"phaseId","pct","duePct","due"}],"feePence","discountCode","discountPence","invoiceWanted",
 "acceptedVia":"app|plan|inPerson"|null,"invitedAt","respondBy","respondedAt","enrolledAt","completedAt","droppedAt","pausedDays","note",
 "spentPence","expectedSpendPence"}
// BoardRow: {"enrolment":Enrolment,"client":{"id","name","initials"},"pct","pace","behind","points","rank","expectedSpendPence","spentPence","cells"}
```

Saving a design: rows keep their ids when `id` is sent; a new phase or kit row may carry a client-made `key` that a new
activity's `phaseId` / `linkRef` refers to. An activity removed from the document is **archived** when it has progress and
deleted otherwise (kit rows the same); a removed phase is deleted (its activities lose the phase). Live campaigns may be
edited: changes apply forward and past progress stays. Fixtures: [`campaigns-list.json`](wp4-fixtures/campaigns-list.json),
[`campaign-design.json`](wp4-fixtures/campaign-design.json), [`campaign-board.json`](wp4-fixtures/campaign-board.json).

### Rules the server applies

- **Days.** An activity's date is `start_on + day + paused_days`. Fixed campaigns use `starts_on` for every enrolment; rolling ones
  use the acceptance day, or the `startOn` the coach or client chose. The enrolment's last day is `start_on + length_days - 1 + paused_days`.
- **Invite, then accept.** Inviting writes `invited` rows and sends one message (`via:'coachAction'`) with the dates, the fee after
  any discount, the required kit with prices, the optional kit total, the expected spend and the plan link. Nothing is charged and
  nothing is nudged while invited. Accepting (app, plan page or "Agreed in person") sets `active` and only then emits
  `campaign.enrolled`. An unanswered invitation expires to `declined` ("Invitation expired") after `respondBy`.
- **Capacity** counts `active`, `paused` and `completed`, re-checked inside the accepting transaction: full means `waitlisted`
  (waitlist on) or 409. When a place frees (a drop), the oldest waitlisted client gets a new invitation.
- **Pace** = required activities done ÷ required activities due by today (a late joiner of a fixed campaign is not held to days
  before they joined). **Behind** = active, at least 2 due, pace below 70%. `pct` = activities done ÷ all activities. `points` is
  recomputed on every tick and untick.
- **Daily nudge** (clock `campaigns.tick`, every 5 min): after `settings.nudgeAt` London, once per enrolment per day
  (`campaign_nudges`), "Day N of <campaign>: <titles>. Today's plan: <link>" through `sendMessage(…, {via:'campaign'})`, so the
  daily cap, quiet hours and "outreach paused" apply; a deferred or skipped nudge is still recorded and never resent.
- **End.** At `start_on + length_days + paused_days`: `completed` when every required activity is done (sends `completionText`
  if set), else 7 days' grace, then `dropped`.
- **Pause / resume** (`client.paused`, `client.resumed {pausedDays}`): active → paused (no nudges, pace frozen, never behind);
  resume adds the paused days, moving the remaining dates and the end. **End of coaching** (`client.offboarded`): every open
  enrolment and invitation is dropped; no fee is raised.
- **Fees.** `campaign.enrolled {enrolmentId, campaignId, feePence, invoice, campaignName, discountCode?, startOn, via}`;
  `invoice` is `feePence > 0 && invoice` (the enrol option). Billing (WP3) raises the invoice from it; WP4 never writes billing tables.
- **Workout activities** with a program `linkRef` lay that program (unpublished drafts) from the activity's date on acceptance,
  when the coach ticked `layProgram`. **Habit** activities are tick boxes only (no habit rows).

## Coach endpoints (F14)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/guidebook` | `?q=` | `{guides:[GuideSummary]}` newest first |
| POST | `/api/guidebook` | `{title?, summary?, blocks?, tags?, status?}` | `{guide}` |
| GET | `/api/guidebook/:id` | – | `{guide}` |
| PUT | `/api/guidebook/:id` | any of `{title, summary, blocks, tags, status}` | `{guide}`; emits `guide.published` on the move to published |
| DELETE | `/api/guidebook/:id` | – | `{ok}` (campaigns that linked it simply stop showing it) |
| POST | `/api/guidebook/:id/send` | `{clientId}` | `{ok, link, messageId}`: "JK shared a guide: <title>. Read it here: <link>" (`via:'coachAction'`); 409 for a draft |

```jsonc
// Guide (coach)
{"id":"gb_…","title":"Fuel the long run","summary":"…","tags":["running"],"status":"draft|published","blockCount":12,"readMinutes":1,
 "cover":"md_…"|null,"createdAt":"…","updatedAt":"…","blocks":[Block]}     // GuideSummary: without blocks, plus "opens":n
```

Block validation (`validateBlocks`, exported from `guidebook.mjs`, also used for `campaign_activities.blocks`): unknown types,
over 200 blocks or 60 KB, non-https links and bad fields are a 400 naming the block (`blocks[3].url must be an https link`).
Media must be the coach's own file with no client (`client_id` NULL), purpose `guide` or `other` (WP6 adds `guide`; demo
fixtures `demo:*` too) and of the block's kind. Text that looks like HTML is stored and shown as text.

## Events

| Event | Payload | When |
|---|---|---|
| `campaign.invited` | `enrolmentId, campaignId` (+`fromWaitlist`, `by`) | an invitation is sent (coach, automation, or a freed place) |
| `campaign.declined` | `enrolmentId, campaignId, reason?` | declined, or expired (`reason:'expired'`) |
| `campaign.waitlisted` | `enrolmentId, campaignId` | accepted into a full campaign with a waitlist |
| `campaign.enrolled` | `enrolmentId, campaignId, feePence, invoice, campaignName, discountCode?, startOn, via` | **on acceptance only** |
| `campaign.activityDue` | `enrolmentId, campaignId, day, count` (+`deferredUntil` / `skipped`) | the daily nudge |
| `campaign.activityDone` | `enrolmentId, campaignId, itemId` | the first tick of an item |
| `campaign.behind` | `enrolmentId, campaignId, pace` | once per crossing below 70% |
| `campaign.completed` | `enrolmentId, campaignId` | at the end, everything required done |
| `campaign.dropped` | `enrolmentId, campaignId, reason?` | unenrolled, coaching ended, or the grace ran out |
| `guide.published` | `guideId` | a guide is first published (or re-published) |
| `guide.sent` | `guideId` | shared with a client |
| `guide.opened` | `guideId` | a client's first read (app or plan page) |

None is `aiDerived`. Consumed: `day.started` (a sweep for that coach), `client.paused`, `client.resumed`, `client.offboarded`.

## Actions, facts, variables

- Action `campaign.enrol {campaignId: campaign}` (clientFacing): **always an invitation** (automations never enrol anyone into
  spending); outcome "Invited", "Skipped: campaign not live", "Skipped: already active". `options(db, coachId)` → `[{value, label}]`
  of live campaigns.
- Facts: `campaign.active` (tags: active campaign ids), `campaign.pace` (number 0–100, the lowest active), `campaign.endsInDays` (days).
- Variables: `{campaign}`, `{campaignDay}`, `{campaignToday}`, `{planLink}` (the soonest-ending active enrolment).

## Hooks

`needs` (behind for 3+ days, rank 7, "Behind on 12-Week Marathon Build (pace 52%)", action Nudge → the board), `search`
(campaigns and guides by name), `timeline` (invited, joined, declined, fell behind, completed, left), `diary` (fixed starts and
ends; rolling starts and finishes per client), `forecast` (fees of open invitations as `possible`, and of accepted enrolments the
coach chose not to invoice as `likely`; accepted invoiced fees are billing's), `exportFor` (the client's enrolments, progress and
spend; guide reads), `renewals` (`{client, kind:'campaign', label, on, detail, path}` for enrolments ending in the window),
`offboarding` (`{enrolments:[{id, status, campaign}]}`), `publicOffers` (`[{id, name, tagline, description, startMode, startsOn,
endsOn, lengthDays, feePence, placesLeft}]` for live public campaigns).

## Integration requests

1. **Demo wipe before feature schemas.** `api`, `par`, `plans`, `demo` and `webauth` tests call `buildDemo(db)` before
   `createApp`, so `runFeatureSchemas` has not run and the foundation's wipe of a feature's `demo.tables` fails ("no such table").
   WP4 therefore declares **no `demo.tables`**: its builders create their tables if needed and clear the demo accounts' rows
   themselves. WP-Z: make `buildDemo` call `runFeatureSchemas` (or have the old tests create the app first), after which WP4 can
   declare `{client:['campaign_progress','campaign_enrolments','coach_guide_opens'], coach:['campaigns','coach_guides']}`.
2. `campaigns.mjs` imports `validateBlocks` and the plan-page helpers from `./guidebook.mjs` (same package; the spec has WP4 use
   `validateBlocks` "exported from the feature file"). `foundation.test.mjs` allows it; WP-Z may move the shared helpers to a
   foundation module if it wants feature files strictly independent.
3. WP6: add `guide` to `media.mjs` `PURPOSES`; the desk uploads guide files as `other` until then (both are accepted).
4. WP11: `publicOffers` returns campaign objects; build the offer link and interest count on your side. The demo's
   "January Reset" is a **draft** (as the spec says), so it is not a live public offer until the coach makes it live.
5. WP3: `campaign.enrolled` carries `campaignId` and `startOn` besides the spec's keys; the Campaigns board reads
   `GET /api/billing/invoices?sourceRef=<enrolmentId>` when `billing` is in `/api/coach/capabilities`.

## Parity gaps

- The apps' invitation card, campaign card and native guide renderer are WP9/WP10's (P1); the plan page is the guaranteed client
  surface and is what was exercised locally.

## Design notes

- Tables follow the spec, plus columns on WP4's own new tables: `campaign_enrolments.discount_pence` (the coach's checked discount,
  for the invitation text), `lay_program`, `behind_since` (once-per-crossing and the 3-day needs rule) and `note`;
  `campaign_kit.archived`; a new `coach_guide_opens (guide_id, client_id, opened_at)` table for `guide.opened` once per client.
- Endpoints added beyond the spec: `POST …/invitation-preview`, `POST …/nudge` (the board's "Nudge behind").
- The plan page's styles are inline with a CSP **hash** (no `unsafe-inline`), so no extra public stylesheet route is needed.
