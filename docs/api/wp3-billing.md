# WP3: Billing and revenue (F9, F10, F11, F12, F26)

Billing is a **record of money handled outside the app**: nothing charges a card or calls a payment provider, the copy says
"Record payment", `PAYMENTS=off` is untouched and nothing changes `users.plan` or gates a service. Money is integer pence (GBP);
days are London `YYYY-MM-DD`. Everything is coach-only (`requireCoach`, a client gets 403) unless marked **client**, and a foreign or
missing id is a 404. Client-linked rows are always read through the client's **current** coach (`users.coach_id`), so a client moved to
another coach leaves the old coach's lists and appears in the new coach's.

Feature files: `server/features/billing.mjs` (ledger, packages, schedules, dunning, discount maths), `offers.mjs` (discount screens and
codes, referrals), `revenue.mjs` (insights and forecast). Desk: `f-billing*.js|css`, `f-offers.*`, `f-revenue.*`, and `plans.js`.

## Endpoints

### Ledger (F9)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET / PUT | `/api/billing/settings` | `{businessName, address, paymentDetails, invoicePrefix, dueDays, vatRateBp, vatNumber, footer, autoIssueRecurring, dunning:[{day, template:'gentle'\|'firm'\|'coach'}], texts:{receipt, gentle, firm}}` | `{settings}` (+ `nextNumber`, `defaults`) |
| GET | `/api/billing/overview` | – | `{outstandingPence, overduePence, overdueCount, collectedMonthPence, collectedLastMonthToDatePence, scheduled30Pence, scheduled30Count, draftCount, aged:{d30, d60, d90, older}, recent:[{at, kind, icon, tone, title, detail, path, client}], collectedSeries:[{month, pence}] (6)}` |
| GET | `/api/billing/invoices` | `?status=draft\|issued\|paid\|void\|open\|overdue\|partial&clientId=&from=&to=&sourceRef=` | `{invoices:[Invoice]}` |
| POST | `/api/billing/invoices` | `{clientId, lines:[{description, quantity, unitPence, kind?, ref?}], dueOn?, note?, discountCode? \| discountId?}` | `{invoice}` (draft) |
| GET | `/api/billing/invoices/:id` | – | `{invoice, lines, payments, creditNotes, events:[{at, kind, title, detail}], settings}` |
| PUT | `/api/billing/invoices/:id` | as POST (drafts); `{note}` alone on an issued invoice; `discountCode:null` clears | `{invoice}`; 400 for any other change to an issued invoice |
| DELETE | `/api/billing/invoices/:id` | – | `{ok}` (drafts only, 409 otherwise) |
| POST | `/api/billing/invoices/:id/issue` | `{send?, dueOn?}` | `{invoice}`; 409 not a draft or discount no longer valid, 400 no lines / nothing to bill |
| POST | `/api/billing/invoices/:id/void` | `{reason}` | `{invoice}`; 409 when it has payments |
| POST | `/api/billing/invoices/:id/duplicate` | – | `{invoice}` (new draft) |
| POST | `/api/billing/invoices/bulk` | `{ids:[…], action:'voidDrafts'\|'remind'}` | `{done, skipped}`; one foreign id is a 404 and nothing happens |
| GET | `/api/billing/payments` | `?clientId=&from=&to=` | `{payments, creditNotes, refunds}` |
| POST | `/api/billing/payments` | `{clientId, invoiceId?, amountPence, method:'bank'\|'cash'\|'card'\|'other', receivedOn, reference?, note?, sendReceipt?}` | `{payment, invoice?, messageId?}` |
| DELETE | `/api/billing/payments/:id` | – | `{ok}` (sets `voided_at`, re-derives the invoice) |
| POST | `/api/billing/credit-notes` | `{clientId, invoiceId?, amountPence, reason}` | `{creditNote}`; against an invoice, at most its total less earlier credits |
| POST | `/api/billing/refunds` | `{creditNoteId, amountPence, method, paidOn, reference?}` | `{refund}`; 400 above what the credit note has left |
| DELETE | `/api/billing/refunds/:id` | – | `{ok}` (sets `voided_at`) |
| GET | `/api/billing/export.csv` | `?from=&to=` (≤ 2 years; default the last 365 days) | `text/csv`, `content-disposition: attachment`: `date,type,number,client,description,net,vat,total,method,reference`, one row per invoice, payment, credit note and refund; cells starting `= + - @` are prefixed with `'` |
| GET | `/api/coach/clients/:id/billing` | – | `{balancePence, ltvPence, invoices, payments, creditNotes, refunds, packages, schedules, ended, plan}` |
| GET | `/api/billing/mine` (**client**) | – | `{balancePence, invoices:[{number, issueOn, dueOn, totalPence, paidPence, status, lines}]}`; anyone else gets an empty list, never a 403 |

```jsonc
// Invoice
{"id":"iv_…","number":"JK-2026-0012","client":{"id","name","initials"},"clientId":"u_…","status":"draft|issued|paid|void",
 "displayStatus":"draft|issued|partial|overdue|paid|void|credited","issueOn":"2026-11-24","dueOn":"2026-12-08",
 "subtotalPence":12000,"discountPence":0,"taxPence":0,"totalPence":12000,"paidPence":5000,"creditedPence":0,"outstandingPence":7000,
 "daysOverdue":null,"discount":{"id","name","code"}|null,"note":"","source":"manual|recurring|package|campaign|policy","sourceRef":null,
 "sentMessageId":"m_…","voidReason":null,"remindersPaused":false,"createdAt","issuedAt","paidAt","voidedAt"}
```

### Packages and schedules (F10)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET / POST | `/api/billing/packages` | `{name, description?, sessions 1–200, pricePence, validDays?, bookingKind?:'any'\|'inperson'\|'video'\|'group'}` | `{packages}` / `{package}` (+ `sold`, `activeCount`, `unitPence`) |
| PUT / DELETE | `/api/billing/packages/:id` | same (+ `active`) | `{package}` / `{ok, deactivated}` (a sold package is switched off) |
| POST | `/api/billing/packages/:id/sell` | `{clientId, startsOn?, invoice?:true, issue?:false}` | `{clientPackage, invoice?}` (`issue` issues and sends) |
| POST | `/api/billing/client-packages/:id/adjust` | `{delta −50…50, reason}` | `{clientPackage}` |
| GET / POST | `/api/billing/schedules` | `?endingWithin=<days>` / `{clientId, label, amountPence, interval:'week'\|'fourWeeks'\|'month', nextOn, endsOn?, discountId?, discountCycles?}` | `{schedules}` / `{schedule}` (each with `monthlyPence`, `preview` = the next 3 billing days) |
| PATCH / DELETE | `/api/billing/schedules/:id` | `{status?, amountPence?, nextOn?, label?, endsOn?, interval?, pausedUntil?}` | `{schedule}` / `{ok}`; an ended schedule can't restart (409) |

### Dunning (F11)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/billing/invoices/:id/remind` | `{text?}` (default: the gentle text, rendered) | `{messageId}`; logged as step 100+n, `via:'coachAction'` |
| POST | `/api/billing/invoices/:id/reminders` | `{paused: bool}` | `{ok}` (a `dunning_log` row with step −1) |
| GET | `/api/billing/invoices/:id/reminders` | – | `{log:[{step, kind, outcome, messageId, at}], next:{step, template, on}\|null, paused, steps}` |

### Offers and referrals (F12)

| Method | Path | Body | Response |
|---|---|---|---|
| GET / POST | `/api/offers/discounts` | `{code?, name, kind:'percent'\|'fixed', value (bp or pence), appliesTo?, startsOn?, endsOn?, maxRedemptions?, perClientMax?, firstInvoiceOnly?, active?}` | `{discounts:[Discount + redemptions, discountedPence, revenuePence, live, label, client, origin]}` / `{discount}`; 409 code in use |
| PUT / DELETE | `/api/offers/discounts/:id` | same | `{discount}` / `{ok, deactivated}` |
| POST | `/api/offers/discounts/check` | `{code, clientId, lines?:[{kind, amountPence}]}` | `{ok, amountPence?, discount?, reason?}` |
| POST | `/api/offers/discounts/generate` | `{prefix?}` | `{code}` (unique for this coach) |
| POST | `/api/offers/discounts/:id/issue` | `{clientId, send?:true}` | `{discount, code, messageId}` (a client-bound single-use copy, `via:'coachAction'`) |
| GET / PUT | `/api/offers/referrals/settings` | `{active, rewardKind:'credit'\|'sessions'\|'percentNext', rewardValue, refereeDiscountId?, notifyReferrer?, message?}` | `{settings}` |
| GET | `/api/offers/referrals` | – | `{referrals:[{id, referrer, referee, refereeName, leadId, status, rewardRef, rewardText, createdAt, updatedAt}], leaderboard:[{client, referred, qualified, rewarded}], codes:[{client, code, link}], settings}` |
| POST | `/api/offers/referrals/codes` | `{clientId}` | `{code, link}` (idempotent) |
| POST | `/api/offers/referrals/:id/void` | – | `{referral}`; 409 once rewarded |
| GET | `/api/offers/performance` | – | `{offers:[{id, name, code, redemptions, discountedPence, revenuePence, active}], referredClients, referredRevenuePence, referralCostPence, discountCostPence, discountRevenuePence}` |
| GET | `/api/referral/mine` (**client**) | – | `{active, code, link, rewardText}` (the code is made on first ask) |

### Revenue (F26)

| Method | Path | Response |
|---|---|---|
| GET | `/api/revenue/summary?months=12` | `{collected, billedMrr, planMrr:[{month, pence}], arpcPence, avgLtvPence, mix:[{source:'recurring'\|'packages'\|'campaigns'\|'other', pence}], target, month:{collectedPence, lastMonthToDatePence, lastMonthPence, day, daysInMonth}, totals}` |
| GET | `/api/revenue/forecast?days=90` | `{days:[{day, certainPence, likelyPence, possiblePence}], lines:[{label, day, pence, confidence, source}], totals}` |
| GET | `/api/revenue/clients` | `{clients:[{client, ltvPence, paid12Pence, balancePence, monthsActive, tenureDays, lastPaidOn}]}` |
| PUT | `/api/revenue/target` | `{targetPence}` → `{target}` (coach pref `revenue.target`) |

## Rules worth knowing

- **Numbers** are `<prefix>-<YYYY>-<0001>`, assigned in the issue transaction from `billing_settings.next_number` (one sequence per coach across years; a clash skips forward).
- **Totals**: line amount `round(qty × unit)`; VAT `round((subtotal − discount) × vat_rate_bp / 10000)`.
- **Balance** = Σ issued+paid totals − Σ payments − Σ credit notes + Σ refunds (voided payments and refunds left out).
- **Discounts**: active, in window, under `max_redemptions` and `per_client_max`, `applies_to` matches a line, `first_invoice_only`; percent rounds down, both capped at the eligible lines. The redemption row is written **on issue**. Client-bound copies (`offer.issue`, referral rewards) carry `discounts.client_id`.
- **Credits**: `booking.created` takes one credit from the oldest-expiring matching package **unless the plan's monthly credits cover it** (see deviations); a refunded cancel gives it back unless `late && policy.forfeitCredit`.
- **Recurring clock** (15 min): one invoice per `(schedule, next_on)` (`source_ref`), issued and sent (`via:'dunning'`) with `autoIssueRecurring`, else a draft plus a notification; months clamp and return to the anchor day (31 Jan → 28 Feb → 31 Mar).
- **Dunning clock** (30 min, 08:00–20:00 London): each step once per invoice (claimed by its `dunning_log` primary key before it acts). When several steps are due at once only the latest acts; the earlier ones are logged "skipped". `coach` notifies JK (and calls `task.create` when a feature registers it) and sends nothing. Paid, credited, voided, paused and ended-client invoices are skipped (unless Keep chasing).
- **End of coaching** (`client.offboarded`): schedules end, packages expire or are credited for the unused share, `writeOff` raises a credit note for the balance, `invoice` issues open drafts (unsent), open invoices get a paused dunning row unless `keepChasing`; `billing_client_state` stops recurring and dunning until `client.stageChanged` to active/onboarding.

## Events

| Event | Payload | aiDerived |
|---|---|---|
| `invoice.issued` | `invoiceId, totalPence, dueOn, source, discountId?, discountPence?` | no |
| `invoice.paid` | `invoiceId, totalPence` | no |
| `invoice.voided` | `invoiceId` | no |
| `invoice.overdue` | `invoiceId, daysOverdue` (once, at the first step) | no |
| `payment.recorded` | `paymentId, amountPence, method, invoiceId` | no |
| `refund.recorded` | `refundId, amountPence` | no |
| `package.sold` / `package.low` / `package.expired` | `clientPackageId, packageId?, invoiceId?` / `clientPackageId, left` | no |
| `billing.scheduleCreated` / `billing.scheduleInvoiced` | `scheduleId` / `scheduleId, invoiceId` | no |
| `offer.redeemed` | `discountId, invoiceId, amountPence` (from `invoice.issued`) | no |
| `referral.created` / `referral.qualified` / `referral.rewarded` | `referralId, leadId?` / `referralId` / `referralId, rewardKind` | no |

Consumed: `booking.created`, `booking.cancelled`, `booking.noShow`, `booking.lateCancel`, `client.paused`, `client.resumed`, `client.offboarded`,
`client.stageChanged`, `campaign.enrolled` (billing); `lead.created`, `lead.won`, `client.joined`, `invoice.paid`, `invoice.issued` (offers).

## Actions

| Action | Params | clientFacing | Outcome |
|---|---|---|---|
| `invoice.create` | `preset: enum planMonth\|custom`, `amountPence: money`, `description: text`, `issue: enum no\|yes` | yes | "Drafted an invoice", "Issued an invoice", "Skipped: no paid plan" |
| `offer.issue` | `discountId: discount` (options: the coach's live general discounts) | yes | "Sent code SAM-K7QP", "Code … held until later", "Skipped: no such offer" |

## Facts and variables

Facts: `billing.balance` (money), `billing.overdueDays` (days, null if none), `billing.ltv` (money), `billing.lastPaidDays` (days),
`billing.credits` (number, null without an active package), `billing.packageExpiresDays` (days), `billing.recurringPence` (money/month).
Variables: `{balance}` ("£120" / "£0"), `{oldestInvoice}` ("JK-2026-0012 (£120)"), `{packageLeft}`. Per-render variables in dunning and
receipt texts: `{invoiceNumber} {invoiceTotal} {invoiceDue} {daysOverdue} {invoiceOutstanding} {paymentAmount} {paymentDay}`.

## Hooks provided

`needs` (oldest invoice 14+ days overdue, rank 7, "Chase"), `inbox` (`flag:invoice:<id>` at a coach step, actions Remind / Record payment /
Pause reminders), `search` (invoices by number or client; offers by code), `timeline` (issued, paid, payment; referrals), `forecast`
(schedules certain, packages ≤ 1 credit likely at ½ price), `badges` (`billing`: overdue invoices), `renewals` (packages near expiry or ≤ 1
left, schedules ending in the window), `offboarding` (`balancePence, schedules, packages (+refundPence), openInvoices`), `exportFor`
(client: invoices with lines, payments, credit notes, refunds, packages, schedules; offers: referral code, referrals, personal codes,
redemptions; coach: billing settings).

## Desk

Nav (Business): Billing (`g b`, badge on overdue), Offers, Revenue, Plans & prices (`/business/plans`). Routes `/billing/:tab?`,
`/billing/invoices/:id`, `/offers/:tab?`, `/revenue/:tab?`. Client tab `billing`, client action `invoice`, quick-create `invoice` (the
wizard), widgets `revenue` and `overdue`, settings section `billing`, panel `invoice` (`?panel=invoice:<id>`), commands for each.

## Deviations from the spec

1. **Discount tables live in `billing.mjs`**, not `offers.mjs`: invoices and schedules apply them inside the issue transaction. `offers.mjs`
   and `revenue.mjs` import helpers from `billing.mjs` (same package; the foundation's import scan allows a sibling import, as WP4 does)
   and read the ledger tables. They always ship together.
2. **Plan credits.** `bookings.uses_credit` is always 1 while `GATE_SERVICES` is off, so "uses_credit = 0" would never fire in prod. A
   booking takes a package credit unless it is a credit-using 1:1 within the plan's monthly allowance (ranked by start in that month).
3. **No `demo.tables`**: like WP4, the builders create their tables if missing and clear the demo accounts' rows themselves, because older
   tests build the demo before `createApp` runs feature schemas.
4. **Extra columns on new tables**: `invoices.void_reason`, `billing_settings.receipt_text/gentle_text/firm_text`, `billing_schedules.anchor_day`,
   `billing_client_state.keep_chasing`, `discounts.client_id/origin`, `referral_settings.notify_referrer/reward_text`, `referrals.referee_name/reward_text`.
5. **Extra endpoints**: invoice `DELETE` (drafts: the policy fee draft is "confirm or delete") and `bulk`, `GET /api/billing/payments`,
   `/api/offers/discounts/generate`, `/api/offers/discounts/:id/issue`, `/api/offers/performance`, `PUT /api/revenue/target`.
6. **Recurring and campaign invoices sent automatically use `via:'dunning'`** (billing class: cap-exempt, quiet hours and 08:00–20:00), since
   no coach pressed a button; coach-pressed sends use `coachAction`.
7. **`displayStatus` adds `credited`** (issued but fully covered by credit notes) so it is never chased.
8. **Aged debt** buckets outstanding by days since issue (0–30, 31–60, 61–90, 90+).
9. **ARPC** = 12-month collected ÷ paying clients ÷ months. **Billed MRR** per month = Σ monthly-normalised schedules that existed and had not
   ended at month end.
10. **Referral `client.joined`** joins through WP11's `leads` table when it exists (guarded); `lead.won` covers the same path.

## Integration requests

- **WP-Z**: redirect `/business` to `/revenue`; `plans.js` no longer links back to `/business`.
- **WP-Z / WP0-D**: `ui.js` `dataTable` right-aligned columns leave the header label left-aligned; `f-billing.css` fixes it for WP3 screens
  only (`th.ui-al-right`). A kit-wide fix belongs in `ui.css`.
- **WP8**: dunning's coach step calls `task.create` with `title` (and a `day` param set to today if one is required); keep a `title`/`text` param.
- **WP7**: `booking.noShow` / `booking.lateCancel` must carry `policy:{forfeitCredit, feePence}` and `bookingId` in the payload (billing reads
  `bookings.start` for the line text). `booking.cancelled` late cancels carry `policy` as F21 says.
- **WP4**: `campaign.enrolled` with `enrolmentId, feePence, invoice, campaignName, discountCode?`; the fee invoice is found by
  `GET /api/billing/invoices?sourceRef=<enrolmentId>`.
- **WP11**: `lead.created` with `referralCode`, `lead.won {leadId}` with `clientId` (payload or event column); the referral link uses
  `lead_forms.slug` (falls back to `jk`).
- **WP2**: Renewals can use the `renewals` hook (or `GET /api/billing/schedules?endingWithin=30`); End coaching reads `offboarding`; the
  Client 360 chips can read `billing.balance`, `billing.credits`, `billing.ltv`.
- No new glyphs needed; no lint allow-list entries.

## Parity gaps

- Nothing moves money: no card processing (D3), no email receipts (D14); receipts and invoices go to the client's thread only.
- Clients have JSON (`/api/billing/mine`, `/api/referral/mine`) but no app UI in this batch (D11).
- The print view relies on the browser's print dialog to save a PDF; it was checked by screenshot, not on paper.
- The by-source tile on `/revenue` appears only when WP11's `marketing` feature is loaded (it is absent in this worktree).
- The demo's extra clients from other packages have no billing history (the builder covers the six named demo clients).

## Design notes

- The invoice is drawn as a sheet of `--paper` with a champagne top edge, serif business name and number, and a rotated "Paid"/"Void"
  stamp. Printing switches `<html data-theme>` to light for the print and back afterwards, so the paper prints on white using the
  existing light tokens (no new colours).
- Status is always a pill with a glyph and a word (`bl-status`), toned with the status tokens; a quiet tone uses `--text-secondary`.
- Line items reflow with a container query (`@container bl-lines`), so the same editor works in the paper, the wizard and on a phone;
  rows move by drag or Alt+↑/↓ (and ↑/↓ on the handle).
- The forecast is drawn as running totals by week, stacked (certain at the bottom), which reads better than weekly spikes for monthly billing.
