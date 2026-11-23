# Desk v2 API documents

Each desk v2 package documents what it adds in its own file here, in the house style of [`docs/API.md`](../API.md). The build contract is
[`docs/design/desk-v2.md`](../design/desk-v2.md); where a package file and the spec disagree, the spec wins until WP-Z changes it.

| File | Package |
|---|---|
| [`wp0-server.md`](wp0-server.md) | WP0-S foundation, server: events, notifications, stream, facts, tags, segments, prefs, outreach, search, AI, audio |
| `wp0-desk.md` | WP0-D foundation, desk |
| `wp1-command.md` | WP1 Command (F1, F2, F3, F4) |
| `wp2-crm.md` | WP2 Clients and lifecycle (F5, F7, F8, F27) |
| `wp3-billing.md` | WP3 Billing and revenue (F9–F12, F26) |
| `wp4-campaigns.md` | WP4 Campaigns and guidebook (F13, F14) |
| `wp5-automations.md` | WP5 Automations and outreach (F15–F17) |
| `wp6-ai-voice.md` | WP6 AI and voice (F18, F19) |
| `wp7-calendar.md` | WP7 Calendar and diary (F20–F22) |
| `wp8-tasks.md` | WP8 Tasks, accountability and insights (F23–F25) |
| `wp11-growth.md` | WP11 Growth: leads and marketing (F6, F28) |

## Conventions

- JSON in and out, **camelCase** keys. Days are London `YYYY-MM-DD`; instants are UTC ISO strings; money is integer pence (GBP).
- Errors are `{"error": "A short sentence."}`. 400 bad input (the message names the field), 401 sign in again, 403 wrong role
  (`requireCoach`), **404 for anything foreign or missing** (never 403 for a foreign id), 409 conflict, 413 too large, 415 wrong media,
  429 a limit, 503 busy.
- Every coach endpoint calls `requireCoach(ctx)` and scopes every query by the coach. Bulk endpoints check every id: one foreign id fails the
  whole request with a 404 and writes nothing.
- Each package file has these sections: endpoints, events (with payload keys and `aiDerived`), actions (with ParamSpecs and `clientFacing`),
  facts, variables, then **Integration requests** (shared edits WP-Z must make), **Parity gaps** and **Design notes**.
- Tests may move time with `?at=<iso>` only where a route reads `requestNow(ctx)` and the config has `testNow` (the test helper sets it).

## OpenRouter: facts checked at build time (WP0-S, 2026-11-23)

The spec (3.13) marked five points as unverified. Checked against OpenRouter's public docs on **2026-11-23**:

| Point | What the docs say (2026-11-23) | What the code does |
|---|---|---|
| (a) `input_audio` formats | Chat Completions takes `{"type":"input_audio","input_audio":{"data":<base64>,"format":…}}`; the Responses API lists only `wav` and `mp3`; Chat Completions "accepts any format string the provider supports, such as `aiff`, `aac`, `ogg`, `flac`, `m4a`, `pcm16`, or `pcm24`", per model. Audio must be base64; URLs are not accepted. No size limit is stated. ([audio](https://openrouter.ai/docs/features/multimodal/audio)) | Sends **mp3**, 16 kHz mono 32 kbps (the documented baseline), base64, on `/chat/completions`. |
| (b) audio-capable model ids | Not listed on the page: "filter the Models page by audio input modality". The docs' example model is `google/gemini-2.5-flash`. | No model id in code. John sets `AI_AUDIO_MODEL`. Claude models take no audio, so the privacy text must name the audio model's vendor. |
| (c) `json_schema` and `require_parameters` | `response_format: {type:'json_schema', json_schema:{name, strict:true, schema}}` is current. Support is **per endpoint** ("the same model may work through one provider but not another"); the docs say to set `provider.require_parameters: true` to route only to endpoints that support it. An unsupported model "will fail with an error indicating lack of support". ([structured outputs](https://openrouter.ai/docs/features/structured-outputs)) | Sends `json_schema` + `require_parameters: true` whenever a schema is set, says "Reply with JSON only" in the prompt, parses defensively and checks the schema's required keys. On a 400 (or a 404 about parameters) it retries **once** with `{type:'json_object'}` and the schema in the prompt, and records `downgraded:json_object`. |
| (d) data-policy field, ZDR | `provider.data_collection: "allow" \| "deny"` (default allow; deny = "only providers which do not collect user data"). `provider.zdr: boolean` **exists**: "the request will only be routed to ZDR endpoints". Also present: `allow_fallbacks`, `order`, `only`, `ignore`, `sort`, `max_price`. ([provider routing](https://openrouter.ai/docs/features/provider-routing)) | Every request sends `provider: {data_collection:'deny', zdr:true}` (+ `require_parameters:true` with a schema). Never relaxed. |
| (e) an audio endpoint left under deny + ZDR | Not answerable from the docs: it depends on the model John picks. The docs offer `GET /api/v1/endpoints/zdr` (a preview of which endpoints remain under ZDR). The exact error text for "no endpoint meets the constraints" is not documented; reports describe a **404** such as "No endpoints found matching your data policy" (or "No allowed providers are available for the selected model"). | A 400/404 whose message mentions the data policy, privacy, ZDR, allowed providers or "no endpoints" raises `AiError('provider')`, shown as "AI unavailable: no provider meets the privacy settings". No fallback to the stub. **Before setting the key, John should check the chosen `AI_AUDIO_MODEL` against `/api/v1/endpoints/zdr`.** |

Nothing in the tests depends on these points: the stub and a fake `fetchImpl` cover them.

## ffmpeg in the image (WP0-S, 2026-11-23)

The Dockerfile installs `ffmpeg` from Debian trixie with `--no-install-recommends` (layer placed before the app copy so it caches). The base
image digest pin is kept, but the apt layer floats, so **the image is no longer bit-reproducible**.

| Measure | Value |
|---|---|
| Installed version | `ffmpeg version 7.1.5-0+deb13u1` (the host porkserv has the same build) |
| Image size before (`jk-performance:f3802da6277f`, branch point) | 232 MB (232,452,664 bytes) |
| Image size after (`jk-performance:desk-v2-fs`, throwaway tag) | 681 MB (680,776,932 bytes), **+448 MB**, disk only |
| Peak memory, 300 s conversions in a `--memory 512m` container | cgroup `memory.peak` **41 MB** for the whole container (Node + ffmpeg) while converting a 300 s Opus webm and a 300 s AAC m4a through `audio.convertUpload` (probe, re-encode, probe), 4.0 s and 3.6 s |

Measured with `docker build -t jk-performance:desk-v2-fs .` and
`docker run --rm --memory 512m -v <dir>:/in:ro --entrypoint node jk-performance:desk-v2-fs /in/convert.mjs`, reading
`/sys/fs/cgroup/memory.peak` at the end. No running container was touched.
