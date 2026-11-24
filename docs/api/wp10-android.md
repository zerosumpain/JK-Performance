# WP10: Android (F19 apps, F13/F14 client view)

What `desk-v2-android` adds to the Android app (docs/design/desk-v2.md section 5, WP10; F19 "Apps"; F13 "Client
experience"; F14 renderer). Built against `docs/api/wp6-ai-voice.md` and `docs/api/wp4-campaigns.md` (branches
`desk-v2-wp6` at 0fb1a8e and `desk-v2-wp4` at bb42ddd), exercised in the emulator against a scratch merge of the two
on `http://100.83.68.108:5691`. No server, desk or iOS file is touched.

## What the app does now

| Spec item | Where | Notes |
|---|---|---|
| F19 1: shared recorder `VoiceRecorder(context, cap, purpose)` | `client/VoiceViews.kt` | Moved out of `LetterComposer.kt`; letters keep 90 s (`purpose=letter`), chat uses `me.features.voiceMaxSec` (300). AAC m4a, mono 44.1 kHz, live level from `maxAmplitude`, warning 30 s before the cap |
| F19 2: client composer mic + consent sheet | `client/JKView.kt` `JKComposer` | Mic shown when `features.voiceNotes`; `voiceTranscription == "ask"` opens the one-time sheet (Allow / Send without transcription) and `PUT /api/voice/consent` before recording. Record bar: breathing dot, clock "0:12 of 5:00", live bars, Cancel, Stop; preview with play, bars, Discard, Send. Uploads `audio/mp4` `purpose=voice`, then `POST /api/messages {kind:'voice', mediaId, text?}` (the typed text becomes the caption) |
| F19 2: Account › Privacy switch | `client/AccountViews.kt` `PrivacyView` → `VoicePrivacySection` | "Transcribe my voice notes", same endpoint, with the consent copy and the withdrawal note |
| F19 3: coach thread composer | `client/MessagesView.kt` `MessagesThreadView` | Same recorder; uploads with `clientId`; a coach is never asked for consent |
| F19 4: `VoiceNoteBubble` | `client/VoiceViews.kt` | Chosen by `kind == "voice"`, never `mediaId`. One `VoicePlayer` per screen (`VoicePlayerScope`; starting one stops the other; speech audio attributes set once), 1× / 1.5× / 2×, elapsed / length, 44 calm bars seeded by media id with the played part lit. Coach view (when the server sends it): summary with a silver rule, worded flag pills with glyphs, mood, topics, the first flag's quote, action items with owner. Then the "Transcript" disclosure with the per-state copy (pending shimmers "Transcribing…"; noConsent for the client reads "You chose no transcription · Change", Change opens Privacy; deleted shows no player) |
| F19 5: models and decoder tests | `net/VoiceModels.kt`, `net/Models.kt`, `net/AtelierModels.kt`, `src/test/…/VoiceDecodingTest.kt` | `Message` gains `mediaKind`, `durationSec`, `updatedAt`, `voice`; every `VoiceInfo` field but `status` optional; unknown status → `failed`. All 15 WP6 fixtures decode (copied into `src/test/resources/fixtures/voice`). `MediaFiles` caches audio as `.m4a` and can fetch the server's own `/api/` path |
| F19 6: refresh rule | `JKView.kt` (timeline), `MessagesView.kt` (coach thread) | Every poll passes `since=<cursor>` and merges `updated` by id; while a visible note is pending the poll is 10 s for up to 2 minutes, then back to 15 s |
| F19 7: copy | manifest unchanged | `RECORD_AUDIO` with the runtime prompt and `VoiceSection`'s refusal copy |
| F19 8: previews | `MessagesView.kt` `threadPreview` | "Voice note · 0:42" (the message text, or the caption) |
| F13 invitation card | `client/CampaignViews.kt` `InvitationCard`, on the Act root (`ThisWeekView`) | Name, tagline, When / Fee / Places in three columns, required kit line by line with prices, optional extras (collapsed, or open when there is no required kit), expected spend sentence, JK's welcome line, Accept / Not this time (with a confirm), "Nothing is charged until you accept". Waitlisted shows the waitlist line instead of buttons |
| F13 campaign card | same | Ring with %, Day N of M, points and rank, a day-progress rule, today's activities with ticks (`POST …/items/:itemId`), "Read guide", "The whole plan →" |
| F13 campaign detail | `CampaignDetailView` | Stats (done, points, rank), the phases as a proportional strip with today's position, the current phase card with its guide, Today, Coming up, every activity by phase (current open; future ones can't be ticked), the kit with bought ticks, estimates, notes, https shop links and "I spent £__" (a dialog storing pence), the web plan link (https only) |
| F14 native guide renderer | `client/GuideRenderer.kt` | `GET /api/guides/coach/:id`, on paper: rule, serif headline, read time, blocks `h p list(bullet/number/check) callout(tip/warn/info) image video audio link exercise divider`, unknown types skipped. `**bold**` / `_italic_` tokenised (`net/RichText.kt` `GuideText`), never HTML. Media through the block's `url` (`/api/guides/coach/…/media/…`). Inline activity blocks use the same renderer |
| Tappable https links | `design/components/LinkedText.kt`, both bubbles | `Links.find`: https only, trailing punctuation trimmed, balanced brackets kept; http stays text |
| Debug "Send test clip" | both composers | `BuildConfig.DEBUG` only: an m4a pushed to `/sdcard/Android/data/com.jkperformance.app/files/test-clip.m4a` is loaded as if recorded (same consent step, preview and upload) |

Unit tests: `scripts/android-build.sh testDebugUnitTest` → 28 tests (VoiceDecodingTest 14, CampaignDecodingTest 6,
RichTextTest 8), all green. `testImplementation junit:junit:4.13.2` is added (`gradle/libs.versions.toml`).

## Integration requests

1. **`scripts/export-symbols.mjs` GLYPHS**: add `campaign`, `info`, `link`, `mic`, `open_in_new`, `shopping_bag`. Their
   drawables were exported with the script's own `toVector` (same source, axes and format) into
   `android/app/src/main/res/drawable/`, but the list lives in `scripts/`, which WP10 does not own, so `--check`
   does not cover them yet.
2. **WP6 `meFeatures`**: the consent sheet's "(OpenRouter, using <provider of AI_AUDIO_MODEL>)" needs the provider's
   name. The app reads an optional `features.voiceAiProvider` (e.g. "Google") and falls back to "(OpenRouter)".
   Suggest `voice.mjs meFeatures` return it from `AI_AUDIO_MODEL`'s prefix.
3. **WP6 demo**: Sam's demo voice note is stamped 10:00 London today; when the demo is built before 10:00 it is in the
   future, `/api/timeline` leaves it out, so the client never sees it (the coach thread does). Stamp it in the past.
4. **Play Data safety form** (for the status doc, F19 item 10; John does it before setting `OPENROUTER_API_KEY`):
   add **Audio › Voice or sound recordings**: collected, linked to the user, purpose App functionality, **shared**
   with a third party (the AI processor, OpenRouter and its model provider) when the client allows transcription,
   not optional for sending a voice note but transcription is optional (the consent sheet and Privacy switch),
   deletable on request / account deletion. The microphone permission declaration stays (already used by letters).
5. **Consent copy** used by the app (identical to the spec's D16 sheet): "Voice notes are transcribed and summarised
   for JK by an AI service (OpenRouter[, using <provider>]). The summary is seen only by JK." Buttons "Allow" and
   "Send without transcription"; under them "Your recording always reaches JK. You can change this any time in
   Account › Privacy."

## Parity gaps

- **Recording**: the emulator runs `-no-audio`, so `MediaRecorder` capture was not exercised; upload, consent,
  playback, speed, transcript refresh and every bubble state were, through the debug test clip.
- **Real transcription**: the server ran without `OPENROUTER_API_KEY`, so transcripts are the stub ("Sample
  transcript (AI is off)"); the coach analysis seen in screenshots is the demo's pre-written one.
- **Plan links**: the local server's `PUBLIC_URL` is plain http, so invitation and nudge links render as text (the app
  makes only https tappable) and the detail hides "Open the web plan". An https link sent by the coach was tapped-ready
  and underlined. Production links are https.
- **Guide media blocks** (image, video, audio, exercise) are implemented but the demo guides carry none, so they were
  not seen on screen; the decoder handles them and unknown types.
- The client sees today's demo voice note only when the demo was built after 10:00 (integration request 3).

## Screens

`android/screens/wp10-*.png` (gitignored folder, kept locally): Today with the campaign card (03), the invitation
card (05), after accepting (06), a guide (07), the campaign detail (08–11), the chat with a voice note, consent sheet,
preview, pending, transcript, playing and a tappable link (12–18), Privacy (19), coach thread list previews (21) and
the coach thread with the analysis (22–25).
