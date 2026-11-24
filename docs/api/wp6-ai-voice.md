# WP6: AI and voice (F18, F19)

What `desk-v2-wp6` adds (docs/design/desk-v2.md F18, F19). Coach endpoints call `requireCoach` (a client gets 403) and a
foreign or missing id is a 404. Server files: `server/features/aireview.mjs`, `server/features/voice.mjs`, and the owned
`messages.mjs`, `media.mjs`, `timeline.mjs`, `settings.mjs`.

## Apps contract (WP9 iOS, WP10 Android)

This section is the part the apps build against. JSON fixtures, one per state, live in
[`fixtures/`](fixtures/) (`voice-*.json`); decoder unit tests should load every one of them.

### Messages that are voice notes

A voice note is a message with `kind: "voice"`. Choose the bubble by `kind == "voice"`, **never** by `mediaId`.

- Top level: `mediaId: null`, `mediaUrl: null`, `mediaKind: "audio"`. Builds already in the field render any `mediaId` as an
  image or video, so voice messages never carry one at the top level; old builds show only `text`.
- `text` is `"Voice note · 0:42"`, or the caption the sender typed, or `"Voice note deleted"` once the audio is deleted.
- Every message with media gains `mediaKind` ∈ `image` | `video` | `audio` (null without media). Every message gains
  `updatedAt` (ISO; equals `at` until something changes it, e.g. a transcript arriving).
- The audio is in `voice.url` (a signed-in GET, Range supported, always an AAC m4a, `audio/mp4`).

```jsonc
// client view: what every signed-in client gets, and what the coach gets from /api/timeline
"mediaId": null, "mediaUrl": null, "mediaKind": "audio",
"voice": {
  "mediaId": "md_…" | null,            // null only when status = deleted
  "url": "/api/media/md_…" | null,      // null only when status = deleted
  "durationSec": 42,                    // the server's probed length (may be null on a server without ffmpeg)
  "status": "pending" | "done" | "failed" | "off" | "deleted",
  "reason": null | "aiOff" | "quota" | "noConsent",    // set only when status = off
  "transcript": "…" | null,            // non-null only when status = done (null after the 12-month retention rule)
  "provider": "stub" | "openrouter" | null,           // null unless done
  "model": "…" | null                  // null unless done with openrouter
}
// coach view (a coach reading GET/POST /api/messages, GET /api/threads, GET /api/voice), when status = done and the
// note is FROM the client, adds:
  "summary": "…", "mood": "upbeat|steady|flat|low|stressed|unknown", "sentiment": -0.4, "topics": ["knee","sleep"],
  "actions": [{"text":"Send a deload week","owner":"coach|client"}],
  "flags": [{"kind":"pain|injury|illness|mentalHealth|safeguarding|cancelIntent|billing","quote":"my knee's been sore","severity":"low|medium|high"}]
// coach view of the coach's OWN note (status done) adds only "summary" (one line); no analysis is ever run on coach notes.
```

Decoding rules: every `voice` field except `status` is optional; an unknown `status` decodes as `failed`
(fixture `voice-unknown-status.json`). The shape is decided by the server from the signed-in role: there are no "coach builds".
A client never receives `summary`, `mood`, `sentiment`, `topics`, `actions` or `flags` on any route except `GET /api/me/export`.

### Copy per state

| `status` / `reason` | Coach and client copy | Player |
|---|---|---|
| `pending` | "Transcribing…" | yes |
| `done` | "Automatic transcript, may contain mistakes"; when `provider == "stub"`: "Sample transcript (AI is off)"; when `transcript` is null: "Transcript removed" | yes |
| `failed` | "Couldn't transcribe this one" | yes |
| `off` + `aiOff` | "Transcripts are off" | yes |
| `off` + `quota` | "Transcript not available today" | yes |
| `off` + `noConsent` | coach: "Not transcribed"; client: "You chose no transcription · Change" (Change opens Account › Privacy) | yes |
| `deleted` | "Voice note deleted" | **no** |

### Refresh rule

While any visible voice item is `pending`, refetch with `since=<cursor>` every 10 s for up to 2 minutes, merging `updated` by id:
- coach thread: `GET /api/messages?clientId=…&since=<cursor>` → `{messages, updated, cursor}`;
- client chat: `GET /api/timeline?since=<cursor>` → `{items, nextBefore, updated:[item], cursor}` (items are `{kind:'message', id, at, message}`).

`cursor` is always present (null for an empty thread). Pass back the last `cursor` you got. Fixtures: `voice-messages-since.json`,
`voice-timeline-since.json`.

### Consent (D16)

Before a client's first voice note, when `me.features.voiceTranscription == "ask"`, show the one-time sheet:

> "Voice notes are transcribed and summarised for JK by an AI service (OpenRouter, using <provider of AI_AUDIO_MODEL>). The summary is seen only by JK."
> **[Allow]**  **[Send without transcription]**

then `PUT /api/voice/consent {voice:'on'|'off'}` before recording. Account › Privacy gets a "Transcribe my voice notes" switch on the
same endpoint. Withdrawing stops processing of new notes at once (a note still pending is not sent to the model); existing transcripts stay.

`me.features` (in `GET /api/me`, fixture `voice-me-features.json`) gains:
- `voiceNotes` (bool): show the mic in the client composer. Coaches always get `true`.
- `voiceMaxSec` (300): the chat recorder's cap. Letters stay at 90 s.
- `voiceTranscription`: `ask` (no choice yet) | `on` | `off`. Coaches get `on` when their own AI transcription is on, else `off`.

### Sending a voice note

1. `POST /api/media?purpose=voice&durationSec=<secs>` with the raw bytes. A coach adds `&clientId=<id>`. Send `audio/mp4` (or any
   audio type; the server sniffs the bytes and re-encodes everything to an AAC m4a). → `{id, kind:'audio', mime:'audio/mp4', durationSec, url, …}`.
2. `POST /api/messages {kind:'voice', mediaId, text?}` (a coach adds `clientId`). `text` is an optional caption. → the message (`voice.status`
   is `pending`, or `off` with a reason).

Previews in a thread list read `"Voice note · 0:42"` (that is the message `text`).

### Error table

| Call | Status | `error` |
|---|---|---|
| `POST /api/media?purpose=voice` | 413 | "Voice notes are limited to 10 MB" |
| | 415 | "No audio in that file" / "This server can't convert that recording; send m4a" / "That is a video, not a voice note" |
| | 400 | "Voice notes can be up to 5 minutes" / "Say which client this is for" (coach) / "durationSec must be a number from 0 to 300" / "Demo voice notes can be up to a minute" (demo accounts) |
| | 429 | "That's a lot of voice notes today" |
| | 503 | "Busy, try again in a minute" |
| `POST /api/messages` kind `voice` | 400 | "That voice note is for someone else" / "That voice note has already been sent" / "mediaId is required" |
| | 403 | `not_enabled` (show "Voice notes are off") |
| `PUT /api/voice/consent` | 400 | "voice must be one of on, off" |
| | 403 | "Clients only" (a coach) |

Letters (`purpose=letter`) use the same rules with a 90 s cap ("Voice notes on letters can be up to 90 seconds"); a letter's video note
(`video/mp4`) keeps the old path.

## Endpoints

### Voice (F19, `features/voice.mjs`)

| Method | Path | Who | Body / query | Response |
|---|---|---|---|---|
| PUT | `/api/voice/consent` | client | `{voice:'on'\|'off'}` | `{voice}` |
| GET | `/api/voice/consent` | client | – | `{voice:'ask'\|'on'\|'off', at}` |
| GET | `/api/coach/clients/:id/ai-consent` | coach | – | `{voice:'ask'\|'on'\|'off', at}` |
| GET | `/api/voice` | coach | `?clientId=&flagged=1&q=&limit=50` | `{items:[{message (coach view), client:{id,name,initials}, voice}]}` newest first |
| POST | `/api/voice/:messageId/retry` | coach | – | `{voice}` (a `failed` or `off` note goes back to `pending`) |
| POST | `/api/voice/:messageId/listened` | coach | – | `{ok}` (clears the Inbox item) |
| POST | `/api/voice/:messageId/tasks` | coach | `{indexes?:[n]}` | `{created:n}`; 409 "Tasks are not available" without a `task.create` action |

### AI review and drafts (F18, `features/aireview.mjs`)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/ai/review` | `{clientId?, surface:'message'\|'letter'\|'broadcast'\|'scheduled', text, audience?}` | `{id, verdict:'ok'\|'caution'\|'stop', summary, issues:[{kind, severity, quote, note}], rewrite, factsUsed:[label], provider, model}` |
| POST | `/api/ai/review/:id/decision` | `{decision, messageId?}` | `{ok}` |
| POST | `/api/ai/review/voice` | `{clientId, mediaId}` | as `/api/ai/review`, plus `transcript` |
| POST | `/api/ai/approvals` | `{clientId, surface, text}` | `{id}` (an Inbox draft; never sends) |
| GET | `/api/ai/reviews` | `?clientId=&before=&decision=` | `{reviews:[…]}` |
| GET | `/api/ai/reviews/:id` | – | `{review}` |
| POST | `/api/ai/draft` | `{clientId, intent:'reply'\|'nudge'\|'celebrate'\|'reschedule'\|'free', note?}` | `{text, provider, model}` |
| POST | `/api/coach/clients/:id/ai-summary` | `{days:14}` | `{bullets:[string], provider, model, at}` |

The AI never sends: none of these creates a message, scheduled message, deferred message or broadcast.

Review rules and errors:
- `/api/ai/review` needs `clientId` except for `surface: broadcast|scheduled` (a group: reviewed with no client facts).
- `decision` ∈ `sentOriginal usedRewrite edited dismissed overridden approved rejected`; `messageId` must be in the same client's thread
  (through `clientFor`), or for a group review a coach-owned `broadcasts` / `scheduled_messages` id; anything else is a 404.
  `approved`/`rejected` apply to drafts (`kind: draft|approval`).
- `/api/ai/review/voice` takes an unsent `purpose=voice` upload of this coach for this client (else 404; 400 once sent); it transcribes with
  `listen` (purpose `review`, the audio budget) and reviews the transcript; the later send copies the transcript (no second model call).
- Errors: 409 "AI is turned off in Settings › AI" / "AI drafts are off in Settings › AI" / "Transcription is off in Settings › AI"; 429 "AI limit reached
  for today" (daily cap) or "Too many AI requests; try again in a minute" (30 a minute); **424** "AI unavailable: …" for every upstream failure
  (timeout, privacy routing, invalid answer). 424 rather than the foundation's 502/503/504 because `app.mjs` hides the message of any 5xx, and the
  coach must see why (never a stub).
- A review stores `{kind:'review'|'draft'|'approval', intent, job}` beside the spec's columns (`ai_reviews` is new, so the extra columns are additive).

Review object (`GET /api/ai/reviews`): `{id, kind, clientId, client:{id,name,initials}|null, surface, draft, verdict, summary, issues, rewrite, factsUsed,
provider:'stub'|'openrouter'|'none', model, decision, messageId, mediaId, transcript, intent, job, createdAt, decidedAt}`.

### Changed existing endpoints (WP6-owned files)

| Endpoint | Change |
|---|---|
| `POST /api/media` | purposes `voice` and `guide`; voice/letter audio sniffed and re-encoded (above); per-user daily caps; `DELETE /api/media/:id` on a sent voice note tombstones the message |
| `GET /api/messages`, `POST /api/messages`, `GET /api/threads` | `mediaKind`, `updatedAt`, the `voice` block; coach callers get the coach view |
| `GET /api/timeline` | `since` → `updated` + `cursor`; messages always in the client view |
| `GET /api/me` | `features.voiceNotes`, `voiceMaxSec`, `voiceTranscription` |
| `PATCH /api/coach/settings` | `voiceNotes` (bool, default true): may clients send voice notes |

## Events

| Event | Payload | `aiDerived` | Summary |
|---|---|---|---|
| `voice.analysed` | `{messageId, direction, flagged}` | yes | "Voice note transcribed" |
| `voice.flagged` | `{messageId, kinds}` | yes | "Voice note flagged: pain" |
| `ai.reviewed` | `{reviewId, verdict, decision}` (no text) | yes | "AI check: stop, overridden" |
| `ai.overridden` | `{reviewId, verdict}` | yes | "Sent despite an AI stop" |
| `ai.drafted` | `{reviewId}` | yes | "AI draft ready for Sam" |

Consumed: `message.sent`, `message.received` (kind `voice`: queue), `client.offboarded` (WP2: starts the 12-month transcript clock).

## Actions

| Action | Params | clientFacing | Outcome |
|---|---|---|---|
| `ai.draft` | `intent: enum(reply, nudge, celebrate, reschedule, free)`, `note: text` | no | "Draft queued" (the `ai.drafts` clock writes it; an Inbox item "Draft ready for Sam"; never sends) |

## Facts and variables

| Fact | Type | `aiDerived` | Meaning |
|---|---|---|---|
| `voice.sentiment14` | number −1…1 | yes | mean sentiment of the client's analysed notes over 14 days, `null` when none |
| `voice.pain14` | bool | yes | a pain or injury flag in a voice note in 14 days (read by the F18 stub and offered for `core.pain14`) |

No template variables (no AI output may be quoted by an automated message).

## Hooks

`needs` (rank 1 "Mentioned knee pain in a voice note", rank 2 illness; until the coach replies, 7 days), `inbox` (`voice:<messageId>` unheard client
notes with Mark done and "Add actions as tasks"; `draft:<reviewId>` drafts awaiting approval and AI drafts with Discard, path
`/messages/<clientId>?draft=<reviewId>`), `search` (type `voice`, transcripts), `timeline` (F5 items), `messageExtras`, `meFeatures`, `exportFor`
(`features.voice.{consent, analyses, endedAt}`, `features.aireview.reviews`).

## Clocks

`voice.transcribe` (10 s, one note at a time, 3-minute lease, retry once after 5 min), `voice.retention` (daily), `ai.drafts` (30 s), `ai.prune` (daily, 180 days).

## Desk

| Registration | Where |
|---|---|
| nav `messages` (badgeOn adds `voice.flagged`) | `f-voice.js` |
| composer tools `voice` (recorder), `attach` (audio file), `ai-check`, `ai-draft` | `f-voice.js`, `f-ai.js` |
| send guards `ai-review` (10), `route-to-approval` (20, prefs `review.routeToApproval`) | `f-ai.js` |
| client tab `voice`, client action `ai-brief` | `f-voice.js`, `f-ai.js` |
| widget `voice-review` | `f-voice.js` |
| settings section `ai` (and `/account/ai?log=1`, the review log) | `f-ai.js` |

`messages.js` keeps `threadPane(el, clientId, view, {compact})` and its DOM events. Exports for others: `voiceBubble`, `recorder`, `composerPanel`,
`consentChip` (f-voice.js); `reviewPanel`, `wordDiff`, `briefBody`, `aiStatus` (f-ai.js).

Links: `http://100.83.68.108:5686/desk#/messages`, `#/account/ai`, `#/account/ai?log=1`, `#/clients/<id>/voice`, `#/today`.

## Integration requests

1. **`app.mjs` early 413 (F19).** The upload route registers `rawLimit: rawLimitFor(req, url)` (exported from `media.mjs`): 10 MB for voice/letter
   audio, 60 MB otherwise. `app.mjs` should call it and refuse on `content-length` above it **before** `readBody`. Today the handler still answers 413
   "Voice notes are limited to 10 MB", but only after buffering up to 60 MB.
2. **`demo.mjs` wipe before feature schemas.** `buildDemo` wipes every feature's `demo.tables` before `runFeatureSchemas` has run when a test builds the
   demo before `createApp` (par, plans, api tests), which throws "no such table". WP6 therefore declares no `demo.tables`: its builders run their
   own idempotent schema and wipe their own tables. WP-Z: have `buildDemo` run each feature's `schema` first (it may not import `features.mjs`), then
   WP6 can move back to `demo.tables`.
3. **`search.mjs`** message results use the client view; call `messagesOut(db, rows, {coachView: true})` if the palette should show voice blocks.
4. **WP1 inbox detail** should render messages through `messagesOut(..., {coachView: true})` (the voice block), and run inbox actions with their `body`.
5. **`core.pain14`** could include `voice.pain14` (WP0-S noted it); the F18 stub already reads both.
6. **WP2**: draw `consentChip()` from `GET /api/coach/clients/:id/ai-consent` in the Client 360 header, and host the "Last 14 days in brief" Overview
   tile (`briefBody(box, client)` from `f-ai.js`); until then it is the `ai-brief` client action and the thread's context pane. A score endpoint at
   `GET /api/coach/clients/:id/score` returning `{score}` lights up the ring in the context pane (asked only when the `crm` feature is present).
7. **`symbols.js`**: no new glyphs needed.
8. **Privacy page and store paperwork** (6.3): unchanged; WP-Z drafts them. The consent copy for the apps is in the contract above.

## Parity gaps

- The desk microphone needs a secure context: the local preview is plain http, so the recorder shows "Recording needs HTTPS. Upload an audio file
  instead" and the upload fallback was exercised. MediaRecorder output (Chrome `audio/webm;codecs=opus` or fragmented `audio/mp4`, Safari `audio/mp4`,
  sometimes an empty `blob.type`) is unverified locally; it is safe because the server sniffs and re-encodes everything (fake-ffmpeg tests cover
  webm, ogg, mp3, wav and m4a, and the real ffmpeg on porkserv converts the fixture).
- Real OpenRouter transcription is never exercised locally (stub only); a fake `fetchImpl` proves the `input_audio` mp3 request, the privacy block and
  the json_schema → json_object retry.
- Headless Chromium has no AAC decoder in some builds; the VoiceBubble then keeps its seeded placeholder waveform (no console error).
- Demo notes reuse one 3.2 s fixture (six copies, one per note, because a media backs one message); the stored durations (0:19–0:58) are the
  pre-written ones, so the player's elapsed time ends at 0:03.
- Coach urgent pushes for voice flags are proved with the recorder transport only.

## Design notes

- The thread is three panes on ≥ 1280 px (list · conversation · the client's mini 360 with health ring when available, consent, next session, quiet days,
  adherence, pain, voice mood, tags, recent voice notes and "Brief me"). Bubbles group by sender within 5 minutes; only the last of a run shows its time
  and the tail corner; day separators read "Today", "Yesterday", "Mon 3 Nov".
- The VoiceBubble: champagne play button on client notes, ink on the coach's bone bubbles; 48 bars light up with the playhead; flags are worded pills with
  a glyph (urgent ones in the urgent tone), the summary sits in an accent-ruled box, action items carry an owner tag and "→ Task".
- Tool panels (the recorder, the Check result) open **inside the composer's panel area** (`composerPanel`), not in popovers: their content grows
  (record → preview → review) and a popover measured at open time clipped at the bottom of the viewport. Draft stays a popover (fixed size).
- The review panel: worded verdict pill with glyph (Looks good · Worth a look · Stop and check), the quotes highlighted in the draft by issue kind,
  the rewrite as an LCS word diff (insertions in the accent wash, deletions struck through), "What I checked against" collapsed. A stop's Send original
  turns red on the first click and reads "Send anyway".
- Settings › AI: a sheen hero with the provider state in words, today's usage bars, the review mode as a segmented control, the switches, and the plain
  "What is sent to the AI" list from 6.3.
- With review mode off (or drafts off) the Check (or Draft) tool hides through `data-ai-review` / `data-ai-drafts` on `<html>`.
- Deviations from the spec, code wins: `voice_analyses` adds `listened_at` (the Inbox "not yet listened"); voice queue rows for a client whose coach
  is gone become `off/aiOff`; after the retention rule a note stays `done` with `transcript: null` (copy "Transcript removed"); coach view adds
  `voice.listenedAt`; `messageOut(m, {coachView, media, extra})` cannot reach hooks without a db, so lists use `messagesOut(db, rows, {coachView})`.
