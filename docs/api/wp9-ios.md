# WP9: iPhone app (F19 apps, F13 client view, F14 renderer)

What `desk-v2-ios` adds to the iPhone app (`ios/**`, docs/design/desk-v2.md section 5, WP9). It builds against
[`wp6-ai-voice.md`](wp6-ai-voice.md) ("Apps contract") and [`wp4-campaigns.md`](wp4-campaigns.md) ("For the apps"),
whose JSON fixtures are copied into `ios/JKPerformanceTests/Fixtures/` and decoded by the tests. No server file changes.

## What the app does

### Voice notes (F19)

| Where | Behaviour |
|---|---|
| `Client/VoiceViews.swift` | `VoiceRecorder(cap:purpose:)` (moved out of the letter composer; letters keep 90 s, chat uses `me.features.voiceMaxSec`, 300), with a live level meter, a 30-second warning, Cancel, Stop, a preview with Listen back, Delete and Send. Uploads `audio/mp4` to `POST /api/media?purpose=voice&durationSec=` (a coach adds `clientId`), then `POST /api/messages {kind:'voice', mediaId}`. |
| | `VoicePlayback`: one player for the app (starting a note stops any other, the audio session is configured once), 1×/1.5×/2×, tap or drag the bars to seek. It downloads `voice.url` with the bearer token (only `/api/` paths) and caches the m4a. |
| | `VoiceNoteBubble`, chosen by `kind == "voice"`, never by `mediaId`: play/pause, 40 bars (a seeded shape at first, the real RMS peaks once the file is downloaded), elapsed / total, speed; the "Transcript" disclosure; the copy for every `status`/`reason` from the contract table; a client's `noConsent` note reads "You chose no transcription · Change" and Change opens Account › Privacy; `deleted` has no player. |
| | `VoiceConsentSheet`: the one-time sheet (D16) when `voiceTranscription == "ask"`, with **Allow** and **Send without transcription**; the choice goes to `PUT /api/voice/consent` and `me` is re-read before recording starts. |
| `Coach/VoiceInsights.swift` | Only when the server sent them (a coach): the summary on a silver rule, worded flag pills with a glyph (urgent kinds in `JK.urgent`, the rest in `JK.attention`), the mood and topic chips, and the action items with "Add as tasks" (`POST /api/voice/:id/tasks`). Coach notes that `failed` or are `off` (not `noConsent`) offer "Retry transcription" (`POST /api/voice/:id/retry`). |
| `Client/JKView.swift` | The client's JK thread: the mic beside the field when `me.features.voiceNotes` and the field is empty; the recording bar replaces the field; voice bubbles in the timeline. |
| `Client/MessagesView.swift` | The coach's thread: the same mic and bar (uploads with `clientId`), voice bubbles in the coach view, previews "Voice note · 0:42" (plus "· flagged"). |
| `Client/AccountViews.swift` | Account › Privacy gains **Transcribe my voice notes** (same endpoint), shown when the server reports `voiceTranscription`. |
| `Coach/LetterComposer.swift` | Uses the shared recorder (`cap: 90, purpose: "letter"`). |
| `project.yml` | `NSMicrophoneUsageDescription`: "JK Performance uses the microphone to record voice notes for your coach and letters." |

**Refresh rule.** The coach thread polls `GET /api/messages?clientId&after&since=<cursor>`; the client chat polls
`GET /api/timeline?limit=50&since=<cursor>`. Both merge `updated` by id (`VoiceRefresh.merge`) and keep the last `cursor`.
While any voice note on screen is `pending` they poll every 10 s for up to 2 minutes, otherwise every 15 s (`VoiceRefresh.interval`).

**Models.** `Message` gains `mediaKind`, `durationSec`, `updatedAt` and `voice: VoiceInfo?`; every `VoiceInfo` field except
`status` is optional and an unknown `status` decodes as `failed`. `Features` gains `voiceNotes`, `voiceMaxSec`, `voiceTranscription`
(and an optional `voiceProvider`, see Integration requests). `MediaFiles` caches audio as `.m4a`.

### Campaigns and guides (F13, F14)

| Where | Behaviour |
|---|---|
| `Client/ActViews.swift` | Act (the client's Today) loads `GET /api/campaigns/mine` after the week; a 403/404 (older server) hides the section. |
| `Client/CampaignViews.swift` | **Invitation card**: name, tagline, dates ("1 Nov – 23 Jan · 12 weeks" or "Starts the day you join"), Fee / Kit to buy / Places, the required kit with prices, optional extras (expandable), Accept (confirms the fee and expected spend first) and Not this time (confirms). A waitlisted answer says so. |
| | **Campaign card**: progress ring, "Day 24 of 84", points and rank, today's activities with tick boxes (optimistic, put back on a 409 such as "That one is not due yet"), "Read guide", "I spent £…" on purchases; paused enrolments say why and do not tick. Campaigns finished in the last 30 days show as a quiet row. |
| | **Campaign plan** (`ClientRoute.campaign`): the hero (ring, points, rank, last day), the phase strip with today marked and each phase's summary and guide, Today, Coming up (dated), Earlier (collapsed, missed days can still be ticked), Kit and spend (bought ticks, "I spent £…", https shop links, totals expected vs spent), Guides, and the web plan link. An open invitation shows the full invitation, the phases and the first week. |
| `Client/GuideBlocksView.swift` | **Native F14 renderer**: `h`, `p`, `list` (bullet, number, check with on-phone ticks), `callout` (tip, warn, info: a glyph and a word), `image`, `video`, `audio` (the voice player), `link` (https only, opens in Safari), `exercise` (looked up in `/api/exercises`), `divider`; unknown kinds are skipped. `**bold**` and `_italic_` are the only formatting (`InlineMarkup`); nothing is HTML. Media load through `block.url` (the guide route). `CoachGuideView` loads `GET /api/guides/coach/:id`; inline activity blocks open through `ClientRoute.inlineGuide`. |
| `Design/Components/LinkedText.swift` | Message text with tappable, underlined **https** links (never markdown, never other schemes). In the client's chat, links to our own host's `/plan/<token>` open the campaign natively and `/plan/<token>/guide/<gb_…>` the guide (`PlanLink`); every other https link opens in the browser. |

## Endpoints used

`GET /api/me` (`features.voice*`), `PUT /api/voice/consent`, `POST /api/media?purpose=voice|letter`, `POST /api/messages`,
`GET /api/messages?since`, `GET /api/timeline?since`, `POST /api/voice/:id/retry`, `POST /api/voice/:id/tasks`,
`GET /api/campaigns/mine`, `GET /api/campaigns/mine/:id`, `POST /api/campaigns/mine/:id/accept|decline`,
`POST /api/campaigns/mine/:id/items/:itemId`, `GET /api/guides/coach/:id`, `GET /api/guides/coach/:id/media/:mediaId` (via `block.url`),
`GET /api/exercises`. The app adds no endpoint, event, action, fact or variable.

## Tests

`ios/JKPerformanceTests` (33 XCTest cases): every voice fixture decodes (pending, done client and coach view, stub, failed, off with
each reason, deleted, unknown status, coach caption, since pages for messages and timeline, `me.features`, consent); the per-state
copy; no analysis in the client view; the refresh merge and intervals; the campaign fixtures (an active enrolment with rank, an
invitation, the detail with 64 activities, the guide); unknown block kinds and non-https links; money entry; the inline markup
(bold, italic, underscores inside words, unclosed markers, HTML stays text); https link detection and plan-link routing.

- **Linux**: `ios/JKPerformanceTests/Linux/check.sh` compiles the Foundation-only files of `ios/JKPerformance/Net` as module
  `JKPerformance` in Docker `swift:6.0-jammy` and runs the tests (33 pass), and runs `swiftc -parse` over every app file.
- **Xcode**: `project.yml` adds the `JKPerformanceTests` unit-test target to the `JKPerformance` scheme's test action
  (`xcodebuild test`); `check.yml` only builds, so CI compiles the app but not the tests (Integration request 1).

## Integration requests

1. **`.github/workflows/check.yml`**: add a step that runs the unit tests on a simulator, for example
   `xcodebuild test -project ios/JKPerformance.xcodeproj -scheme JKPerformance -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO`
   (or `build-for-testing` at least), so the decoder tests run in CI and not only in the Linux check.
2. **WP6 `meFeatures`**: add `voiceProvider` (the vendor of `AI_AUDIO_MODEL`, e.g. "Google") so the consent sheet can say
   "(OpenRouter, using Google)" as D16 asks. Until then the app says "(OpenRouter)"; it already reads `features.voiceProvider`.
3. **`docs/api/README.md`**: add the row `wp9-ios.md | WP9 iPhone app (F19 apps, F13 client view, F14 renderer)`.
4. **Store paperwork** (F19 item 10, for the status doc; John does it **before** setting `OPENROUTER_API_KEY`):
   - App Store Connect › App Privacy: add **Audio Data** — *linked to the user*, *used for App Functionality*, *not used for tracking*;
     disclose that it is shared with a third-party AI processor (OpenRouter and the audio model's provider) for transcription.
   - Review the consent copy against App Review Guideline **5.1.2(i)** (sharing personal data with third-party AI, as updated in late
     2025; verify the current wording before submitting). The copy shown is exactly:
     "Voice notes are transcribed and summarised for JK by an AI service (OpenRouter[, using <provider>]). The summary is seen only by JK."
     with **Allow** / **Send without transcription**, plus "JK hears every voice note, whichever you choose" and "Change it any
     time in Account › Privacy".
   - The microphone purpose string changed (above); no new entitlement.

## Parity gaps

- **iOS compiles only in CI.** There is no simulator or device here: none of the new screens was run or screenshotted, so the
  "looks premium" pass was done by reading the layout code against the design tokens, not by viewing it. The macOS `check.yml`
  run (Debug and Release simulator builds) is the compile proof; the decoder and text-rule tests ran on Linux.
- Recording, playback, the waveform peaks (`AVAudioFile`), the consent sheet's microphone prompt and the upload were not exercised;
  they need a device (or a simulator with a microphone) against a server with WP6 merged.
- Real transcription is never exercised (stub only, as everywhere).
- Campaign and voice shapes were checked against the WP4/WP6 fixtures captured from their demo worlds, not against a running
  merged server.

## Design notes

- Client screens stay monochrome (`scripts/lint-design.sh ios`): voice flags and mood are words beside a glyph; colour appears only
  in `Coach/VoiceInsights.swift`. The invitation's Accept is the outlined secondary button because Act already has its one chrome
  primary ("Begin today").
- The waveform has 40 capsule bars lit in silver with the playhead; before a note is downloaded the bars are a calm shape seeded from
  the media id, replaced by the real RMS peaks after the first play (the desk does the same with a seeded placeholder).
- The composer swaps its field for a capsule recording bar (Cancel, a breathing dot, the timer, the live meter, Stop), then the
  preview (Delete, Listen back, the recorded level shape, the length, Send). With Reduce Motion the dot does not breathe and
  "Transcribing…" does not pulse.
- Deviations, code wins: `ISO` and the JSON coders moved from `APIClient.swift` to `Net/JSONCoding.swift` (Foundation-only, so the Linux
  check decodes exactly as the app); `TabRouter` gains `showPrivacy`/`openPrivacy()`; `ClientRoute` gains `campaign`, `coachGuide`
  and `inlineGuide`. Hold-to-record (P3) and the coach AI Check button (later batch) are not built.
