# Desk v2: integration status

WP-Z, 24 November 2026. Branch `desk-v2` in `/home/john/JK-Performance`. Not pushed. No PR. Not deployed.
The build contract is [`desk-v2.md`](desk-v2.md). Each package documents its API in [`../api/`](../api/README.md).

## What was merged

The wave-1 branches were merged with merge commits in the order the spec gives: `desk-v2-wp6`, `wp2`, `wp11`, `wp3`, `wp7`, `wp8`, `wp4`, `wp5`,
`wp1`, then `desk-v2-ios` and `desk-v2-android`. All eleven branches existed. None of the merges had a conflict, so no package broke file
ownership.

Integration work is in two commits after the merges:
- `Apply wave-1 integration requests and add the End coaching cross-package test`
- `Polish the integrated desk from the preview pass`

## Validation (section 7)

| Check | Result |
|---|---|
| `node --test server/test/*.test.mjs`, real day | 492 of 492 pass (36 files) |
| Same, `TZ=Europe/London FAKE_TODAY=monday` | 492 of 492 pass |
| Same, `TZ=Europe/London FAKE_TODAY=sunday` | 492 of 492 pass |
| `demo-features.test.mjs` with every feature loaded | passes (all 20 feature files are in `server/features/`) |
| Cross-package End coaching test (`server/test/integration.test.mjs`) | passes |
| `node --check` on every server `.mjs` and desk module | clean |
| `scripts/lint-design.sh desk`, `ios`, `android` | clean, clean, clean |
| `node scripts/contrast-check.mjs desk`, `ios`, `android` | 51 pairs pass on each |
| `scripts/export-symbols.mjs --check` and `--desk --check` | 113 glyphs (226 drawables) and 174 desk glyphs current |
| Start-up migration on a temp copy of the latest prod backup (`backup-before-f3802da6277f.sqlite`, 6.9) | about 150 ms in total: core 22 ms, loading features 114 ms, feature schemas 18 ms. The copy was deleted afterwards. |
| Local preview at `http://100.83.68.108:5671` | Rebuilt, demo rebuilt. Desktop and phone screenshots of all 25 nav items had no console errors. No route scrolls sideways at 390 px. |

**End coaching (F8) done condition.** `integration.test.mjs` sets up a recurring schedule, an issued invoice, a live campaign with a 09:00
nudge and a hand-started automation that is waiting. It then ends coaching through WP2's real `POST /api/coach/clients/:id/end`. After that,
the billing, dunning, campaign and automation clocks run on later days. The test checks that no invoice is made, no dunning message or
coach step happens, no campaign nudge is sent and no automation message is sent. It also checks that the schedule is `ended`, the enrolment
is `dropped`, the run is `stopped`, and that re-enrolling the client starts nothing.

## Feature × status

✓ means it works in the merged tree with demo data. Partial items are explained in the notes.

| # | Feature | Status | Notes |
|---|---|---|---|
| F1 | Command Centre | ✓ | Bento built from `registerWidget`, Brief me (stub-labelled), Customise, live activity feed. The sessions tile now also shows WP7 calendar clashes. |
| F2 | Palette, search, shortcuts | ✓ (gap) | The Clients group can't show stage or score yet: `palette.js` has no detail hook. |
| F3 | Notifications | ✓ | `notifyCoach` now honours `notify.prefs[kind] === false` for every kind. Settings › Notifications lists every loaded package's kinds. |
| F4 | Inbox | ✓ | Voice notes are listed once (WP6's item, with the analysis). There are new Testimonials and Waitlist filters, which show only when they have items. |
| F5 | Client 360 and health score | ✓ (partial) | Only the Overview's top row is a bento; the sections below keep two columns. The AI brief tile and voice-consent chip are in. |
| F6 | Leads and enquiry form | ✓ (partial) | Plan consult or trial uses WP11's own day and time sheet, because WP7 has no desk entry point for its slot finder. |
| F7 | Lifecycle, tags, segments | ✓ | |
| F8 | Retention, pause, End coaching, win-back | ✓ | The cross-package test passes. The radar's Offer play now opens a "send a personal code" sheet on `/offers?client=`. The plays use WP5 templates by category. |
| F9 | Invoices and payments | ✓ | |
| F10 | Packages, credits, recurring | ✓ | The package credit rule differs from the spec; see `wp3-billing.md`. |
| F11 | Dunning | ✓ | |
| F12 | Discounts, codes, referrals | ✓ | WP4's Enrol tab now calls WP3's real check shape (`lines`, `{ok, amountPence \| reason}`). |
| F13 | Campaigns and plan page | ✓ | Done condition met: a demo client sees today's activities and full guides on `/plan/<token>` and can accept an invitation there. Demo "January Reset" is now **live** and public (see decisions). |
| F14 | Guidebook | ✓ | Guide files upload with the `guide` media purpose. |
| F15 | Automation builder | ✓ | All 18 recipes can be used now that every package is merged. `pulse.send`'s survey is shown as a select. Trigger values read as words. |
| F16 | Templates | ✓ | `GET /api/templates?category=` now filters. Slash items show a preview line again. |
| F17 | Scheduled messages, broadcasts | ✓ | The thread pane carries `data-client-id` for the ghost bubbles. |
| F18 | AI check, drafting, approval | ✓ (partial) | Stub only locally. AI upstream errors answer 424 (see `wp6-ai-voice.md`). |
| F19 | Voice notes | ✓ desk, partial apps | Consent gate is proved by test. Oversized uploads are now refused before the body is read. Apps: built and decoder-tested; iOS compiles in CI only; Android ran in the emulator without a microphone. |
| F20 | Calendar connections, holds, clashes | ✓ | One real fetch of the public gov.uk bank-holiday feed, by WP7. |
| F21 | Slot finder, series, waitlist, reminders | ✓ (partial) | A client who books themselves gets no confirmation message showing the cancellation policy. |
| F22 | Diary and session notes | ✓ | |
| F23 | Tasks | ✓ | |
| F24 | Accountability board | ✓ | Paused and ended clients (crm stage) are now left off, as well as lapsed ones. |
| F25 | Insights (heatmap, cohorts, NPS) | ✓ | |
| F26 | Revenue | ✓ | `/business` redirects to `/revenue`. The old Business screen and its styles are gone. |
| F27 | Onboarding checklist | ✓ | |
| F28 | Marketing | ✓ | The new `billing.paid12` fact makes Sources' "Revenue, 12 mo" exact. The Offers tab has January Reset. |

## Integration requests: what was done

| From | Request | Done |
|---|---|---|
| WP1, WP2, WP4, WP5, WP6, WP7 | Demo wipe failed on feature tables that weren't created yet | `buildDemo` now runs every feature schema first. It goes through `registry.ensureFeatureSchemas`, which `features.mjs` registers, so `demo.mjs` still doesn't import the loader. Packages may now list `demo.tables`; their own self-wiping builders are left as they are. |
| WP1 | `notifyCoach` honours per-kind prefs | Done, and Settings lists the other packages' kinds |
| WP1, WP7 | Clash badges on the sessions tile | Done, from `/api/calendar/conflicts` when `calsync` is loaded |
| WP11 | Inbox `testimonial` key | Done; `waitlist` got a filter too |
| WP2 | Needs-you skips paused and ended clients | Done: no quiet, no-training or letter-due reasons; pain and messages still show |
| WP8 | Needs-you skips lapsed no-plan clients | Done (28+ days idle). The accountability board now also drops paused and ended clients. |
| WP2 | Template plays read WP5 categories | Server filters by `category`. The desk maps renewal and check-in plays to WP5's categories and leaves out templates that would send a raw `{variable}`. |
| WP2 | Offer play to `/offers?client=` | Offers opens a personal-code sheet for that client |
| WP3 | `/business` redirects to `/revenue` | Done; the dead code and CSS are removed |
| WP3, WP11 | Right-aligned sortable headers | Kit-wide in `ui.css`; the WP3 and WP11 scoped fixes are removed |
| WP8 | `table.ui-sr` stretched pages; `.ui-table-scroll` sideways scroll | Kit-wide in `ui.css`; the WP8 workarounds are removed |
| WP5 | Slash menu overlap | Fixed in `composer.css`; template shortcuts show a preview again |
| WP5 | `data-client-id` on the thread pane | Done in `messages.js` |
| WP5, WP8 | `task.create {title}`; `pulse.send` survey select | `task.create` has `title` (checked). The catalogue serves text-id params that have `options()` as an enum. |
| WP6 | Early 413 in `app.mjs` | Done: `rawLimit` and `tooLarge` route options |
| WP6 | `search.mjs` and Inbox detail use the coach view | Not needed. Search returns snippets, not message objects, and the Inbox opens threads with WP6's own `threadPane`. |
| WP6, WP0-S | `core.pain14` includes `voice.pain14` | **Declined.** `voice.pain14` is AI-derived; folding it into `core.pain14` would launder it past the AI-derived guard (6.3). The F18 stub already reads both. |
| WP9, WP10 | Audio vendor for the consent sheet | `meFeatures` returns `voiceProvider` (iOS) and `voiceAiProvider` (Android), taken from `AI_AUDIO_MODEL`'s prefix, only when it is set |
| WP10 | Sam's demo voice note in the future | Demo notes are anchored to the build time when the build runs before noon |
| WP4 | `guide` media purpose | It was already in `PURPOSES`; the guidebook desk now uploads with it |
| WP4, WP11 | January Reset as a public offer | Made **live** in the demo (see decisions) |
| WP4, WP3 | Discount check and `sourceRef` shapes | Aligned (the check was calling the wrong shape); `sourceRef` and `campaign.enrolled` keys match |
| WP3, WP7 | `booking.noShow` and `lateCancel` carry `bookingId` and `policy` | Checked |
| WP3, WP11 | `lead.created.referralCode`, `lead.won.clientId`, `lead_forms.slug` | Checked |
| WP11 | `billing.paid12` fact | Added in `billing.mjs` |
| WP10 | Android glyphs in `export-symbols.mjs` | Added; `--check` covers them |
| WP9 | Unit tests in CI | `check.yml` now has an `xcodebuild test` step on the first available iPhone simulator. **Not yet run in CI** (desk-v2 isn't pushed). |
| WP8, WP9, WP10 | `docs/api/README.md` rows | Done, plus notes on the desk cache, demo schemas, prefs and early 413 |
| Spec 5 WP-Z 3 | Old availability sheet; `?kit=1` link | WP7 had already replaced the sheet. The Settings "Design kit" link now shows only in kit mode. |
| WP11 | Referral attribution reads WP3's table directly | Left as is (same release, guarded by `sqlite_master`); a hook is a later tidy-up |
| WP7, WP11 | Slot finder entry point for Plan consult | Not done: needs a WP7 desk export. WP11's own sheet works. |
| WP1 | Palette detail hook for stage and score | Not done (it's a `palette.js` change; later batch) |
| WP6 | Overview tile slot for the AI brief | WP2 hosts it in the Overview top row |
| WP7 | WP5 `reschedule` and `waitlist` templates | Not done; the built-in wording is used |

Lint allow-list: no package asked for an entry, so `scripts/lint-design-allow.txt` is unchanged.

## Decisions WP-Z made

- **January Reset is live in the demo, not a draft.** The spec says draft in F13, but F28 needs it as a public offer with 3 interested leads, and
  `publicOffers` lists live campaigns only. A draft should never be on a public page, so it is safer to make the demo campaign live (open for
  sign-ups, nobody in it yet) than to let drafts be public.
- **`core.pain14` stays non-AI** (see the integration table).
- **Phones show only the current breadcrumb.** A breadcrumb step with no link ("Engage") is drawn as a group label, the same as the shell's own.
- **The Inbox lists each voice note once**, as WP6's item. WP1's thread item now leaves out voice messages when the voice feature is loaded.

## Known gaps and issues

- **Demo data:**
  - Every demo voice note plays the same 3.2 s clip, so the player stops at 0:03.
  - A few demo rows are stamped later today. For example, a campaign tick reads "done 08:15" when the demo is built before 08:15.
  - The four WP2 extra demo clients (Hannah, Marcus, Dan, Ellie) get new ids each night.
- **Clients:**
  - Tom's notes read "Active today" next to "no messages … in 14 days". Both are true, but they read as a contradiction (WP2).
  - Viewing a segment in the client list shows at most its first 50 members.
- **Calendar:**
  - The slot finder's "−1 per day further out" can rank a usual slot below a sooner one.
  - Ignoring a clash can't be undone.
  - The Availability slide-over rows are tall.
- **Billing:**
  - Offer performance groups personal codes with their parent offer by name, kind and value.
  - `/api/referral/mine` writes a row the first time it is asked for.
  - On phones the invoice table scrolls inside its card.
- **Voice:** deleting your own uploads lowers the stored daily count. An in-memory limit still blocks abuse, but it resets when the server restarts.
- **Programs and Library** are the older screens, restyled by the shell but not redesigned.
- **The CI step for iOS unit tests is unproven** until `desk-v2` runs in GitHub Actions. If the simulator lookup fails, use `build-for-testing`.

## Parity gaps (local preview vs production)

- The desk microphone needs HTTPS. Locally only the upload fallback was used.
- Real OpenRouter calls never ran. Locally everything is the labelled stub ("AI · stub", "[Stub]"); fake-fetch tests cover the request shape and
  the privacy routing.
- The coach's urgent phone pushes are proved only with the test recorder; there are no APNs or FCM credentials locally.
- The Android emulator has no audio input. iOS only compiles in CI: no simulator run, no screenshots, recording untested.
- Real personal iCal URLs are never fetched (fake `calFetch`). WP7 made one public bank-holiday fetch.
- Plan links in the local preview are plain http, so the apps show them as text, not links.
- No card payments or emailed receipts exist anywhere (D3, D14), so there is nothing to compare there.

## Draft privacy paragraph (for `/privacy`; not deployed)

> **AI tools used by your coach.** JK uses AI tools to help write and check messages, summarise recent activity and transcribe voice notes.
> These run through OpenRouter (OpenRouter Inc., USA). OpenRouter passes each request to a model provider: text to the provider of the text
> model JK has chosen, and voice notes to **[vendor of `AI_AUDIO_MODEL`, for example Google]**. We ask OpenRouter to use only providers that do
> not collect or keep the data (no training, zero data retention). If no provider meets that, the request fails and nothing is sent.
>
> **What is sent.** To check or draft a message, we send JK's draft together with your first name, your goal and plan, and short extracts from
> your recent messages. We also send this health information: injuries and limitations from your profile, and pain flags and notes from your
> last four check-ins. Before anything is sent, we remove e-mail addresses, phone numbers, web links, postcodes and surnames. We never send Apple
> Health or Health Connect data, photos, invoices or payment details.
>
> **Voice notes.** A voice note is sent for transcription and analysis only if you have said yes in the app. The audio goes exactly as you
> recorded it, with your first name. The transcript, summary, mood and any flags are seen only by JK; they are not shown to you, but they are
> included if you ask for a copy of your data. You can change your choice at any time in Account › Privacy, and JK still receives every voice
> note whichever you choose.
>
> **How long we keep it.** Transcripts and analyses are deleted 12 months after your coaching ends, and the analysis fields are deleted after 24
> months in any case. The record of an AI check keeps JK's own draft for 180 days. We keep usage records with no message content. Deleting
> your account removes all of it at once.

Before you publish it, fill in the audio vendor, and check the 12-month, 24-month and 180-day periods against the open points in the spec (9.5).

## Store paperwork checklist (before setting `OPENROUTER_API_KEY`)

- [ ] Choose `AI_MODEL` and `AI_AUDIO_MODEL`. Check the audio model against OpenRouter's `GET /api/v1/endpoints/zdr`; it can't be a Claude model.
- [ ] Put the privacy paragraph above on `/privacy`, with the audio vendor named.
- [ ] **App Store Connect › App Privacy:** add **Audio Data**. It is linked to the user, used for App Functionality and not used for tracking.
      Say that it is shared with a third-party AI processor (OpenRouter and the audio model's vendor) for transcription.
- [ ] **Apple guideline 5.1.2(i):** check the consent sheet against the current wording. The sheet says: "Voice notes are transcribed and
      summarised for JK by an AI service (OpenRouter[, using <provider>]). The summary is seen only by JK." The buttons are **Allow** and
      **Send without transcription**, and it says JK hears every voice note and that this can be changed in Account › Privacy.
- [ ] The iOS microphone purpose string changed (WP9); no new entitlement is needed.
- [ ] **Google Play › Data safety:** add **Audio › Voice or sound recordings**. It is collected, linked to the user and used for app
      functionality. It is shared with the AI processor only when the client allows transcription. Sending a voice note is required, but
      transcription is optional (the consent sheet and the Privacy switch). Recordings can be deleted on request or with the account. The
      microphone permission declaration stays as it is.
- [ ] Set `OPENROUTER_API_KEY`, `AI_MODEL` and `AI_AUDIO_MODEL` in production. The server then sends `voiceProvider` and `voiceAiProvider`
      to the apps, and the consent sheet names the vendor.

## Local preview

- Desk: <http://100.83.68.108:5671/desk#/today>. Sign in with the code `local-demo-coach`.
- Every nav item: `#/today`, `#/inbox`, `#/clients`, `#/pipeline`, `#/marketing`, `#/segments`, `#/retention`, `#/accountability`,
  `#/messages`, `#/campaigns`, `#/automations`, `#/broadcasts`, `#/templates`, `#/schedule`, `#/diary`, `#/tasks`, `#/billing`, `#/offers`,
  `#/revenue`, `#/insights`, `#/business/plans`, `#/programs`, `#/guidebook`, `#/guides`, `#/account`.
- Plan page: get Sam's link from `GET /api/campaigns/mine/<enrolmentId>` (field `planUrl`) as `local-demo-client`.
- Public enquiry page: <http://100.83.68.108:5671/enquire/demo-jk>.
