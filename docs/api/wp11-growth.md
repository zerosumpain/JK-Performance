# WP11: Growth (leads and marketing)

F6 Leads pipeline and the public enquiry form, F28 Marketing (sources, follow-ups, testimonials, offer pages)
(docs/design/desk-v2.md F6, F28). Server: `server/features/leads.mjs`, `server/features/marketing.mjs`. Desk:
`server/desk/f-growth.js` (pipeline, lead panel, widget, quick-create, Settings › Enquiry form), `f-growth-marketing.js`
(`/marketing/:tab?`), `f-growth.css`. Tests: `server/test/leads.test.mjs`, `server/test/marketing.test.mjs`.

Every coach endpoint calls `requireCoach` (a client gets 403); a foreign or missing id is a 404. Leads and lapsed clients are reached by
copy-to-clipboard and `mailto:` only (D14): the server sends no e-mail.

## Endpoints: leads (F6)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/leads` | `?stage=&q=` | `{leads:[Lead], totals:{[stage]:{count, valuePence, weightedPence}}}` |
| POST | `/api/leads` | `{name, email?, phone?, source?, sourceDetail?, valuePence?, note?, nextActionOn?}` | `{lead}`; emits `lead.created` |
| GET | `/api/leads/:id` | – | `{lead, activities:[{id, kind, text, at}]}` newest first |
| PATCH | `/api/leads/:id` | `{name?, email?, phone?, source?, sourceDetail?, valuePence?, nextActionOn?, lostNote?, lostReason?}` | `{lead}`; `stage` is refused (use move) |
| POST | `/api/leads/:id/move` | `{stage, position (index in the column), lostReason?, lostNote?}` | `{lead}`; lost needs `lostReason` ∈ `price timing location fit noReply other` (400) |
| POST | `/api/leads/:id/activities` | `{kind: note\|call\|email\|message, text}` | `{activity}` (touches `updated_at`, so the purge clock restarts) |
| POST | `/api/leads/:id/convert` | `{clientId}` (an own client) | `{lead}` (won, linked); emits `lead.won` |
| DELETE | `/api/leads/:id` | – | `{ok}`; hard delete; emits `lead.deleted` |
| GET / PUT | `/api/leads/form` | `{slug ^[a-z0-9-]{3,40}$, title, intro, fields ⊆ goal experience times budget, active}` | `{form:{…, exists}, url}`; 409 for a slug in use; before the first save `exists:false` and `url:null` |
| GET | `/api/leads/funnel` | `?days=90` | `{stages:[{stage, label, entered, converted}]}` (enquiry…won, from the furthest stage each lead reached) |

```jsonc
// Lead
{"id":"ld_…","name":"Hannah Lee","email":"…","phone":"…","source":"referral","sourceLabel":"Referral","sourceDetail":"…",
 "referralCode":"SAM-K7QP","campaignId":null,"campaignName":null,"stage":"enquiry","stageLabel":"Enquiry","position":0,"reached":"enquiry",
 "valuePence":12000,"probability":0.1,"weightedPence":1200,"answers":{"goal":"…","experience":"some","times":["early"],"budget":"80to150"},
 "consentAt":"…","nextActionOn":"2026-11-25","lostReason":null,"lostReasonLabel":null,"lostNote":null,
 "client":{"id","name","initials"}|null,   // only while that client is still this coach's
 "createdAt":"…","updatedAt":"…","closedAt":null,"ageDays":2}
```

### Public (no session)

| Method | Path | Notes |
|---|---|---|
| GET | `/enquire/:slug` | Server-rendered HTML, no script. CSP `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `cache-control: no-store`. `?ref=` fills a hidden field; `?campaign=<id>` shows the offer only when it is one of the coach's live, public campaigns (WP4 `publicOffers`) that has not ended. Inactive or unknown slug: 404 page. A demo coach's page shows the form with a "demo" banner. |
| POST | `/enquire/:slug` | `application/x-www-form-urlencoded`, 8 KB. 5 posts per IP (`cf-connecting-ip`, else socket) per hour per slug, then a 429 page. Demo coach: 403 page. Wrong content type: 415 page. Filled honeypot `website`: the thanks page, nothing kept. Missing name, bad e-mail, bad phone or no consent: 400 with the form re-shown (values escaped). Else a lead (`source` `referral` when `ref` matches one of the coach's referral codes, else `enquiryForm`; `campaign_id` and `source_detail = 'campaign:<name>'` for a valid offer; the budget answer estimates `valuePence`), a `lead` notification to the coach (`notify.prefs.lead !== false`), and the "Thanks, JK will be in touch within a day" page. |
| GET | `/enquire.css` | The page's stylesheet. |

## Endpoints: marketing (F28)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/marketing/sources` | `?days=365` (`0` or `all` = all time) | `{sources, referralCodes, campaigns}`, each `[{source, label, leads, won, conversionPct\|null, medianDaysToWin\|null, avgLtvPence\|null, revenue12Pence\|null}]` |
| GET / POST | `/api/marketing/followups/templates` | `{stage: enquiry\|contacted\|consult\|trial\|lost, name, subject?, body, nextInDays?}` | `{templates, variables}` / `{template}`. The five defaults are written on first read (once). |
| PUT / DELETE | `/api/marketing/followups/templates/:id` | same | `{template}` / `{ok}` |
| GET | `/api/marketing/followups` | – | `{due:[{lead, overdueDays, template\|null, rendered:{subject, body}\|null, mailto\|null}]}`: leads (not won) whose `nextActionOn` is today or past |
| GET | `/api/leads/:id/followups` | – | `{lead, suggestedId, options:[{template, rendered, mailto}]}` (the "Follow up" picker) |
| POST | `/api/leads/:id/followed-up` | `{templateId, channel: copy\|mailto}` | `{lead}`; logs an `email` activity, `nextActionOn` = today + `nextInDays`; emits `marketing.followedUp`. `mailto` without an e-mail is 400. |
| GET / POST | `/api/marketing/testimonials` | `{clientId, quote?, attribution?}` | `{testimonials, asks}` / `{testimonial}` (`received` with a quote, else `requested`) |
| PATCH | `/api/marketing/testimonials/:id` | `{status?, quote?, attribution?, consentPublish?, evidenceMessageId?}` | `{testimonial}`. `consentPublish:true` needs `evidenceMessageId` (or a stored one) of a message **from that client** (400 otherwise) and makes it `approved`; `approved` needs a quote and consent. |
| GET | `/api/marketing/testimonials/:id/messages` | – | `{messages:[{id, text, at}]}`: the client's recent messages, to pick the quote or the "yes". Marks nothing read. |
| POST | `/api/marketing/testimonials/ask` | `{clientId, text, surveyId?}` | `{testimonial, messageId}`: the coach pressed Send; one message `via:'coachAction'`, a `requested` row, the ask closed; emits `testimonial.requested` |
| POST | `/api/marketing/testimonials/asks/:id/dismiss` | – | `{ok}` |
| GET | `/api/marketing/offers` | – | `{offers:[{campaign, link\|null, interest}], formLive}` from `hooks('publicOffers')` (ended ones dropped) |

Follow-up variables: `{leadFirst}` `{coachFirst}` ("Coach JK" → "JK") `{enquiryLink}` (with `?campaign=` for a lead from a live offer) `{offer}`;
unknown names stay as written. `mailto:` = `mailto:<email>?subject=<encodeURIComponent>&body=<encodeURIComponent>`, or null without an e-mail.

**Sources maths.** Leads created in the window, grouped by `source`, by `referral_code` and by `campaign_id` (labelled from
`source_detail`, else "A past offer"). Conversion = won / leads; median days from `created_at` to `closed_at` of won leads.
`avgLtvPence` is the mean of the fact `billing.ltv` (WP3) over won, linked, still-own clients, and null when that fact does not exist.
`revenue12Pence` is Σ `billing.paid12` when such a fact exists, else Σ `billing.ltv` of clients won in the last 12 months (all their
payments fall in the window), else null.

## Events

| Event | Payload | Summary | Notes |
|---|---|---|---|
| `lead.created` | `{leadId, source, referralCode?, campaignId?}` | "New lead · Instagram" | Summaries never carry a lead's name (events outlive the 12-month purge). |
| `lead.stageChanged` | `{leadId, from, to}` | "Lead moved to Trial" | |
| `lead.won` | `{leadId}` + event `clientId` (null when won without a link) | "Lead won" | On move to won, convert, and `client.joined` |
| `lead.lost` | `{leadId, reason}` | "Lead lost · Price" | |
| `lead.deleted` | `{leadId}` | "Lead deleted" | Manual delete and the purge clock |
| `marketing.followedUp` | `{leadId}` | "Followed up a lead" | |
| `testimonial.requested` | `{testimonialId}` + `clientId` | | |
| `testimonial.approved` | `{testimonialId}` + `clientId` | | |

None is `aiDerived`. Consumed: `client.joined` (leads: an unconverted lead of that coach with the same lower-case e-mail is linked and
won, with a `converted` activity; another coach's lead is never touched), `lead.created` (marketing: first reply due the next day, the
cadence then follows the templates' `nextInDays`: 1 → 3 → 7 → 14), `pulse.answered` (marketing: score ≥ 9 for an own client with no open
testimonial → one `testimonial_asks` row per client and survey; a repeat does nothing).

## Hooks, clocks and tables

- `inbox`: `lead:<id>` (kind `lead`, enquiries in the last 7 days still at Enquiry, action "Mark contacted"); `testimonial:<clientId>:<surveyId>`
  (kind `testimonial`, open asks, action "Not now"; the path `/marketing/testimonials?ask=<id>` opens the ask composer).
- `badges`: `pipeline` (new enquiries, 7 days), `marketing` (follow-ups due).
- `search`: leads by name or e-mail (type `lead`), testimonials by quote (type `testimonial`).
- `forecast`: open leads' weighted value (value × .1/.2/.4/.6), spread over the next 60 days in weekly lines, `confidence:'possible'`, `source:'leads'`.
- `exportFor`: leads → the client's own enquiry and its activities; marketing → their testimonials and asks.
- Clock `lead.purge` (6 h): hard-deletes leads with `updated_at` older than 12 months that are lost or unconverted (`client_id` null), emitting `lead.deleted`.
- Tables: `leads` (+ column `reached`, the furthest stage, for the funnel; + index on `client_id`), `lead_activities`, `lead_forms`,
  `followup_templates`, `testimonials`, `testimonial_asks`. A `BEFORE DELETE ON users` trigger deletes the leads linked to an erased client.
- ID prefixes: `ld` leads, `la` activities, `lf` forms, `ft` templates, `tm` testimonials and asks.
- No actions, facts or variables.

## Desk

- Nav: `pipeline` (Clients, order 20, badge) and `marketing` (Clients, order 25, badge, tabs). Commands: Go to Pipeline (`g p`), Go to
  Marketing, Add a lead…, Enquiry form settings, Follow-ups due today, Ask a client for a testimonial…. Quick-create: Lead. Widget: `pipeline`
  (s). Settings section: `enquiry-form`. Panel: `lead` (`?panel=lead:<id>`; `/pipeline/:id` redirects to it).
- `/pipeline`: weighted-pipeline hero (count-up, stage bar, 90-day stats), the 90-day funnel, source chips, a filter, the kanban (Lost folded
  into a drop zone; dragging to Lost asks for the reason; keyboard moves via the kit), cards with value, next action (overdue in attention) and age.
- Lead panel: inline edits, next-action date and quick buttons, answers in the lead's words, activity log with a quick add, and Plan consult /
  Plan trial (a coach-only hold through `POST /api/calendar/holds` when `calsync` is present; otherwise only `nextActionOn`; either way the lead
  moves to Consult booked / Trial if it was earlier), Follow up (template picker, editable, Copy or Open in mail), App invite (copied),
  Convert (pick a client; then offers to turn a future trial hold into a booking), Move, Delete.

## Integration requests

1. **WP4 demo**: "January Reset" is built as a *draft*, and `publicOffers` returns live campaigns only, so the demo's Offers tab and the 3
   interested leads (F28 demo) stay empty. Make it live and public in the demo (or have `publicOffers` include public drafts that take
   interest). The leads demo already tags 3 leads with the first public offer it finds (preferring a name with "Reset").
2. **WP3**: a `billing.paid12` fact (paid in the last 12 months) would make `revenue12Pence` exact; today it falls back to LTV of clients won in the last year.
3. **WP7**: the spec asks "Plan consult" to open the F21 slot finder in hold mode. There is no cross-package desk entry point for it, so WP11
   ships its own day/time/length sheet that posts the hold. A `registerCommand` or exported `openSlotFinder({mode:'hold', leadId, kind})` from
   WP7 would let WP-Z swap it in.
4. **WP1**: the inbox counts have no `testimonial` key; WP11's asks use kind `testimonial` (they fall under All).
5. Referral attribution reads WP3's `referral_codes` table directly (guarded by `sqlite_master`) to decide `source='referral'`, since no hook
   exists for it; WP-Z may prefer a hook.

## Parity gaps

- Calendar holds, `publicOffers` and `billing.ltv` come from WP7, WP4 and WP3, which are not in this worktree: the local Plan consult only sets
  the next action, Offers shows its empty state, and LTV columns read "—". The tests cover all three with fixture features
  (`marketing.test.mjs` runs its own `FEATURES_DIR`), and the Offers screen was checked against a fixture campaign locally.
- Clipboard: the local preview is plain http, so `navigator.clipboard` is missing; copy falls back to `execCommand('copy')`.
- `mailto:` opens the viewer's mail app; not exercised headless.

## Design notes and deviations

- `leads.reached` (extra column) records the furthest stage, so the funnel and a lost lead's history are exact.
- `client.joined` also converts a *lost* lead with the same e-mail (they came back), not only open ones.
- A filled honeypot gets the normal thanks page (bots learn nothing); missing consent gets a 400 page.
- The spec's proposed default slug `jk` fails its own `^[a-z0-9-]{3,40}$`; the suggestion is `train-with-jk` (demo: `demo-jk`).
- `testimonial_asks` is an extra table: `testimonials.status` has no "suggested" state.
- `marketing.mjs` reads and writes WP11's own `leads` tables (same package, guarded with `sqlite_master`), since features may not import each other.
- The enquiry page keeps the site's public look (black, silver button) rather than the desk's Atelier palette.
