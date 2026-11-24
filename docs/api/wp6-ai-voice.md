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
| | 400 | "Voice notes can be up to 5 minutes" / "Say which client this is for" (coach) / "durationSec must be a number from 0 to 300" |
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

(Events, actions, facts, Integration requests, Parity gaps and Design notes follow below as the build lands.)
