# JK Studio: the coach desk, version 2

Build contract for the desk overhaul. Branch `desk-v2` (cut from `main` at f3802da).
Owner brief: John ("Coach JK"), 2026-11-23. Author: Claude, 2026-11-23.

This document is the **only** contract for the developer agents who build desk v2 in
parallel, each in its own git worktree, before everything is merged back into `desk-v2`. If the
code and this spec disagree, the spec wins until the integration pass (WP-Z) changes it on
purpose. Every package reads all of section 3 (architecture), its own features in section 4,
its own row in section 5 (work packages), and section 6 (security).

Words used throughout:
- **coach**: a `users` row with role `coach`.
- **client**: a `users` row with role `client` and a `coach_id`.
- **lead**: a person who is not yet a user.
- **day**: a London calendar day, `YYYY-MM-DD`.
- **instant**: a UTC ISO string.
- **pence**: integer money, always GBP.

---

## 0. What the owner asked for, and the decisions this spec makes

The owner's brief, quoted:

> "I want a significant overhaul for the https://jk.strangeramblings.com/ desk. This needs to be a one-stop-shop for client
> management. Billing, scheduling, coaching, planning, accountability management. I want the ability to add bespoke
> campaigns; activities that are timebound, may require additional spending by the client, clear guides. The desk should be
> interactive, use modern features, allow message automation, docking in with an LLM could be interesting too to validate
> or confirm advice before sending a message from coach to JK. Also, transcribing and analysing voice notes to/from clients
> and their app. (add this functionality into the apps too). I want the ability to build automations, calendar
> integrations, diary and slot conflict management etc. I want a slick UI, it needs to look amazing, it doesn't need to be
> as bound by the basic current design system. Keep the colors, but I want you to consider the breadth of client
> management that needs to be in there; retention, discounting, marketing, engagement, etc the whole lifecycle. … add as
> many new features as you like, but at LEAST 15 new features. work autonomously."

Decisions this spec makes, so no agent has to:

| # | Decision |
|---|----------|
| D1 | We ship **28 numbered features** (F1–F28), grouped into 11 work packages (WP1–WP11) built on a two-part foundation (WP0-S server, WP0-D desk). 25 are new; F1, F5 and F26 rework existing screens (section 8 marks each). Foundation plumbing is not counted as a feature. |
| D2 | Server stays Node built-ins only (`node:http`, `node:sqlite`, `node:crypto`, `node:child_process`, `node:dns`, `node:https`). **No npm dependencies.** The desk stays plain ES modules with no build step. |
| D3 | Billing is a **manual ledger** (invoices, recorded payments, credit notes, packages, recurring schedules, discounts). No card processing and no Stripe. Prod keeps `PAYMENTS=off` and `GATE_SERVICES=false`; nothing in billing gates any service. |
| D4 | The LLM is **OpenRouter over HTTPS**, configured by env (`OPENROUTER_API_KEY`, `AI_MODEL`, `AI_AUDIO_MODEL`). No model id is hard-coded. With no key, a deterministic **stub** provider answers and every output is labelled `provider: "stub"`. The local preview and every demo account always use the stub. |
| D5 | The AI **never sends anything**, and nothing it produces can make anything else send. It reviews, drafts, transcribes and summarises. A human coach presses Send every time. AI-derived data (voice analysis, sentiment, AI drafts) is marked `aiDerived` at its source, and automations that use it may only notify the coach, create tasks or create inbox drafts (6.3). |
| D6 | Voice notes are recorded as m4a in the apps and as webm/ogg/mp4 in browsers. For purposes `voice` and `letter` the server **always** re-encodes the upload with **ffmpeg** (added to the Docker image) to AAC m4a, whatever the label says, with the container sniffed from magic bytes and passed explicitly. It also makes a 16 kHz mono mp3 for the model. |
| D7 | Calendar integration needs **no OAuth**. The coach pastes the secret iCal URLs of their Google, Outlook or Apple calendars. The server fetches them as busy time, with an SSRF-safe fetcher. The existing outbound `/cal/<token>.ics` feed stays. |
| D8 | The colours do not change. Every token in `server/desk/app.css` keeps its value, including `--accent:#C8A970`. The layout, components and motion are redesigned boldly. Departures from the Atelier spec are recorded in `docs/design/decisions.md` (see 2.6). |
| D9 | Existing autoflows keep running untouched. The new automation engine (F15) is a separate engine with event triggers, and offers "convert an autoflow". |
| D10 | New features **do not seed prod test clients** (`testclients.mjs` stays as it is). They seed only the demo world, which is rebuilt nightly. |
| D11 | Client-side app scope (iOS and Android), all **P1**: voice notes in chat both ways with transcripts and the AI-consent sheet; a campaign card (invitation with accept/decline, today's activities with ticks) and the native guide renderer; tappable `https` links in message bubbles. Because app builds depend on CI, every campaign client surface also exists as a **server-rendered, read-only plan page** (`/plan/<token>`, F13) linked from campaign messages, so the feature is usable even if an app slips. Invoices and other new features have client APIs but no app UI in this batch. |
| D12 | The desk gets **live updates** over a fetch-streamed `text/event-stream` (`/api/coach/stream`), with a 30 s polling fallback. |
| D13 | **"Validate or confirm advice before sending a message from coach to JK"** is read as: JK (the one coach today) gets an AI second opinion on his own messages to clients (F18). The other reading, an assistant coach whose messages JK approves, is **not built**, but it is reserved at low cost: `ai_reviews.decision` has `pendingApproval`, and F18 ships a send guard option "Route to JK for approval" that files the draft in JK's Inbox as a `draft:` item instead of sending. A later assistant-coach role needs no schema change. Listed in section 9. |
| D14 | **Leads and lapsed clients are reached by copy-to-clipboard and `mailto:` only.** The server sends no email in this batch (no SMTP, no provider). Every automated channel is in-app messaging to current clients. Listed in section 9. |
| D15 | **Existing challenges stay** as the separate metric-leaderboard feature (`challenges`, `challenge_members`, shown in the apps' Progress). A campaign may link one (`campaigns.challenge_id`) and shows it on its board. Nothing is migrated or hidden. |
| D16 | **Client consent gates AI on a client's voice.** Each client chooses once (apps sheet) whether their voice notes are transcribed and analysed by the AI service. Without consent the server never sends their audio to a model. Transcripts and analyses are deleted 12 months after coaching ends (6.3). |
| D17 | **One outreach governor** in `sendMessage` caps automated messages per client per day, applies quiet hours to every automated sender, and honours per-client "pause outreach" and "no broadcasts" flags (3.5). |
| D18 | **Nothing automatic moves money or ends coaching.** Lifecycle rules may only *suggest* Churned; ending coaching (schedules, packages, enrolments, runs) happens through the explicit End coaching flow (F8). |

**Brief → features traceability.** Each clause of the brief and what answers it:

| Brief clause | Features | Gap or deferred |
|---|---|---|
| One-stop client management | F5 Client 360, F7 lifecycle, F27 onboarding, F8 end coaching, F1 Today, F4 Inbox, F2 palette | Multi-coach teams (D13, section 9) |
| Billing | F9 invoices, payments, refunds, export; F10 packages, recurring; F11 dunning; F12 discounts; F26 revenue | Card processing (D3); email receipts (D14) |
| Scheduling | F20 calendar sync, holds, conflicts; F21 slot finder, standing sessions, waitlist, reminders, cancellation policy | Two-way calendar write (outbound ICS feed only) |
| Coaching | F18 advice check, F19 voice, F22 session notes, F14 guides, existing programs and letters | — |
| Planning | F22 diary, F23 tasks, F13 campaign design, F21 slot finder | — |
| Accountability management | F24 board, F23 tasks, F3 urgent notifications, F11 dunning | — |
| Bespoke time-bound campaigns, client spend, clear guides | F13 (invitation with spend, accept, fees, kit spend), F14 guidebook, `/plan` page, apps P1 | — |
| Interactive, modern | WP0-D shell, F2, F3 live updates, kanban, bento | — |
| Message automation | F15, F16, F17, outreach governor (D17) | Email/SMS channels (D14) |
| LLM to validate advice before sending | F18 (D13) | Assistant-coach approval queue (reserved, D13); Check button in the apps' coach composer (section 9) |
| Voice notes to/from clients, transcribed and analysed, in the apps | F19, WP9, WP10, consent D16 | Real transcription only once John sets the key |
| Automations, calendar integrations, diary, slot conflicts | F15, F20, F21, F22 | — |
| Slick UI, keep colours | section 2, WP0-D | — |
| Retention | F8 radar, renewals, win-back; F5 health; F7 stages | — |
| Discounting | F12, schedule discount cycles (F10) | — |
| Marketing | F6 pipeline and enquiry form, F28 sources, follow-ups, testimonials, campaign offer pages, F12 referrals | Email nurture (D14); social posting; ad tracking |
| Engagement | F25 insights and NPS, F24, F15 celebration recipes (birthdays, anniversaries) | — |
| Whole lifecycle | F6 → F27 → F7/F5 → F8 (pause, renew, end, win-back) | — |

---

## 1. Vision and information architecture

### 1.1 Vision

JK Studio is the coach's command centre. Every client relationship is run from one place:
- from the first enquiry, through onboarding, coaching, accountability, billing and campaigns;
- through to retention, win-back or a warm goodbye.

It should feel like a premium instrument: a warm off-black canvas, bone type, champagne light, the
Newsreader voice for JK's words. It should be dense where the coach scans and calm where the coach writes.

The three jobs, in order of importance:
1. **What needs me now?** Command centre, inbox, notifications.
2. **Act on a person.** Client 360, thread, voice, letter, booking, invoice, campaign, task, all one keystroke away.
3. **Run the business.** Pipeline, billing, revenue, retention, automations, campaigns, insights.

### 1.2 Navigation (sidebar groups)

The sidebar is built from the `registerNav` registry (3.9). Groups and items are fixed here. Owner packages register them.

| Group | Item (id) | Route | Icon (Material name) | Owner |
|---|---|---|---|---|
| **Command** | Today (`today`) | `/today` | `space_dashboard` | WP1 |
| | Inbox (`inbox`) | `/inbox` | `inbox` | WP1 |
| **Clients** | Clients (`clients`) | `/clients`, `/clients/:id/:tab?` | `group` | WP2 |
| | Pipeline (`pipeline`) | `/pipeline`, `/pipeline/:id` | `view_kanban` | WP11 |
| | Marketing (`marketing`) | `/marketing/:tab?` | `storefront` | WP11 |
| | Segments (`segments`) | `/segments`, `/segments/:id` | `filter_alt` | WP2 |
| | Retention (`retention`) | `/retention/:tab?` | `monitor_heart` | WP2 |
| | Accountability (`accountability`) | `/accountability` | `checklist` | WP8 |
| **Engage** | Messages (`messages`) | `/messages/:id?` | `chat_bubble` | WP6 |
| | Campaigns (`campaigns`) | `/campaigns`, `/campaigns/:id/:tab?` | `rocket_launch` | WP4 |
| | Automations (`automations`) | `/automations`, `/automations/:id/:tab?` | `bolt` | WP5 |
| | Broadcasts (`broadcasts`) | `/broadcasts`, `/broadcasts/:id` | `campaign` | WP5 |
| | Templates (`templates`) | `/templates` | `description` | WP5 |
| **Schedule** | Calendar (`schedule`) | `/schedule`, `/schedule/class/:id/:day?` | `calendar_month` | WP7 |
| | Diary (`diary`) | `/diary/:day?` | `edit_note` | WP7 |
| | Tasks (`tasks`) | `/tasks` | `task_alt` | WP8 |
| **Business** | Billing (`billing`) | `/billing`, `/billing/invoices/:id`, `/billing/:tab?` | `receipt_long` | WP3 |
| | Offers (`offers`) | `/offers/:tab?` | `sell` | WP3 |
| | Revenue (`revenue`) | `/revenue/:tab?` | `trending_up` | WP3 |
| | Insights (`insights`) | `/insights/:tab?` | `monitoring` | WP8 |
| | Plans & prices (`plans`) | `/business/plans` | `workspace_premium` | WP3 (existing `plans.js`) |
| **Build** | Programs (`programs`) | `/programs/:tab?` … | `format_list_bulleted` | existing (WP0-D registers) |
| | Guidebook (`guidebook`) | `/guidebook`, `/guidebook/:id` | `menu_book` | WP4 |
| | Library (`guides`) | `/guides` | `auto_stories` | existing (WP0-D registers) |
| | Settings (`account`) | `/account/:section?` | `settings` | WP0-D (existing `guides.js` account screen + section registry) |

Route rules (the router picks the first match in registration order; see the traps):
- Feature routes use the **distinct top-level paths above**. No package registers under `/clients/<word>`, `/schedule/<word>` (except WP7, which owns schedule.js) or `/programs/<word>`.
- The existing `/business` screen (MRR) stays in `today.js` until WP-Z redirects it to `/revenue`.

Bottom bar (≤ 820 px): **Today · Inbox · Clients · Calendar · More**. More opens a full-height sheet listing every group. Badges show on Inbox and More.

### 1.3 The shell

```
┌────────────┬──────────────────────────────────────────────────────────────────────┐
│ JK Studio  │ ◂ Clients / Sam Carter     [⌕ Search or jump to…  ⌘K]  [+ New] 🔔3 AI·stub ◐ (JK) │  ← glass top bar (sticky)
│            ├──────────────────────────────────────────────────────────────────────┤
│ COMMAND    │                                                                      │
│  ▣ Today   │   screen outlet (max-width 1440, gutters 32 / 16 px)                  │
│  ▢ Inbox 4 │                                                                      │
│ CLIENTS    │                                                                      │
│  …         │                                                         slide-over ▸ │
│ ⟨ collapse │                                                                      │
└────────────┴──────────────────────────────────────────────────────────────────────┘
```

**Sidebar**
- 248 px wide. It collapses to a 72 px icon rail with `⌘\` (the choice is saved in coach prefs `desk.shell.rail`).
- Group labels are 11 px uppercase with tracking `.08em`, in `--text-tertiary`.
- The selected item gets an `--accent-wash` pill, a 2 px accent bar on its left edge, and its icon switches to filled.
- Badges are small accent pills with tabular numbers.
- The foot holds the coach avatar and name, a theme switch and sign-out.

**Top bar**
- Sticky, 60 px high, glass (`--glass` background, `backdrop-filter: blur(var(--blur)) saturate(1.2)`), with a hairline bottom edge that appears only after the page scrolls.
- **Breadcrumb**: set by screens through `setCrumbs([{label, path}])`.
- **Search trigger**: a fake input that opens the palette.
- **+ New**: a quick-create menu from `registerQuickCreate`, for client invite link, lead, invoice, booking, hold, task, campaign, broadcast and automation.
- **Notification bell**: an unread count plus a slide-over list (F3).
- **AI status chip**: `AI · stub`, `AI · on` or `AI · off`, from `GET /api/ai/status`. Clicking it opens Settings › AI.
- **Avatar menu**: theme (System, Dark, Light), keyboard shortcuts, sign out.

**Command palette (`⌘K` / `Ctrl K` / `/`)** (F2)
- A centred floating panel 640 px wide, with a large input and results grouped as Jump to · Clients · Actions · Results.
- Keys: arrows to move, Enter to run, `⌘Enter` to open in a slide-over, Esc to close. The last 5 used items are remembered.

**Keyboard map** (shown by `?`):
- Palette: `⌘K`.
- Go to: `g t` Today, `g i` Inbox, `g c` Clients, `g p` Pipeline, `g m` Messages, `g s` Calendar, `g d` Diary, `g b` Billing, `g a` Automations, `g k` Tasks.
- Create and toggle: `n` new (quick-create), `⌘\` rail, `⌘.` toggle theme.
- Lists (Inbox, Tasks, Clients): `j`/`k` move, `e` done, `s` snooze, `r` reply, `x` select.
- Esc closes the top layer.
- Shortcuts never fire while the focus is in an input, textarea or contenteditable, except `⌘K` and Esc.

**Slide-over**
- Right-hand panel, 480 px (or 720 px "wide"), with a scrim on screens of 1100 px or less.
- Esc closes it, and it traps focus.
- It is used for previews: a client quick view, an invoice, a lead or a task. Each one opens from any list without losing the list's place.
- `#…?panel=client:cl_123` deep links one, so it survives a reload.

---

## 2. Visual direction and component kit

### 2.1 Direction: "Atelier Night"

The palette does not change. What changes:
- **Bento dashboards.**
- **Large serif display type** for screen titles and the key numbers.
- **Glass** on floating chrome only.
- **Soft depth** on floating layers only.
- **Champagne light** used sparingly, as sheen on hero tiles and as the focus ring.
- **Motion** that explains (things slide from where they come from).
- **Skeletons** instead of "Loading…".

Rules that stay from Atelier:
- Status colour is always paired with a word **and** a glyph.
- At most one primary (bone-filled) button per screen region.
- Tertiary text never sits on `--raised`.
- No boxed icons.
- `prefers-reduced-motion` turns off every transition except opacity.

Atelier rules this spec **relaxes** (log them in `docs/design/decisions.md`):
1. Shadows are allowed on floating layers only (palette, slide-over, menus, toasts, the dragged card).
2. Gradients are allowed only as the tokenised `--sheen` on hero tiles and the skeleton shimmer.
3. Glass is allowed on the top bar, the palette and the bottom bar.
4. The serif display size goes up to 44 px for screen titles.

### 2.2 New tokens (WP0-D adds to both `:root` blocks of `app.css`; no package adds colours)

Packages may derive local variables only with `var()` / `color-mix()` from existing tokens, and only in
their own CSS. **No hex, rgb() or hsl() literals outside the `app.css` `:root` blocks.**

```css
/* dark (default) — light theme values in :root[data-theme=light] mirror these */
--glass: rgba(14,13,12,.72);            --glass-light-edge: rgba(242,238,231,.06);
--blur: 18px;
--tile: var(--surface);                  --tile-hover: #1C1A18;   --tile-edge: rgba(242,238,231,.06);
--sheen: radial-gradient(120% 80% at 100% 0%, rgba(200,169,112,.14) 0%, rgba(200,169,112,0) 60%);
--shimmer: linear-gradient(90deg, rgba(242,238,231,0) 0%, rgba(242,238,231,.06) 50%, rgba(242,238,231,0) 100%);
--shadow-float: 0 24px 64px -16px rgba(0,0,0,.6), 0 0 0 1px var(--hairline);
--shadow-drag: 0 18px 40px -12px rgba(0,0,0,.7);
--focus: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
--chart-1: var(--accent); --chart-2: var(--data); --chart-3: var(--on-track);
--chart-4: var(--kind-video); --chart-5: var(--attention); --chart-6: var(--text-secondary);
--chart-grid: var(--track); --chart-area: var(--accent-wash);
--heat-0: rgba(200,169,112,.04); --heat-1: rgba(200,169,112,.18); --heat-2: rgba(200,169,112,.34);
--heat-3: rgba(200,169,112,.55); --heat-4: rgba(200,169,112,.85);
--r-bento: 18px; --r-float: 16px;
--dur-fast: 120ms; --dur-slow: 420ms; --spring: cubic-bezier(.3,1.3,.5,1);
--t-display: 600 44px/1.05 var(--serif); --t-display-s: 500 32px/1.1 var(--serif);
--t-number: 600 28px/1 var(--sans);       /* with font-variant-numeric: tabular-nums */
--sidebar: 248px; --rail: 72px; --topbar: 60px;
```

The light theme gets matching values: glass `rgba(245,240,232,.78)`, the accent tints built from `#7A5C2C`, and lighter shadows.
- WP0-D runs a manual WCAG check of every new text/background pair: 4.5:1 for text and 3:1 for UI.
- It adds the desk tokens to `scripts/contrast-check.mjs` (new `--desk` mode that parses `app.css`).
- The light theme ships, selectable through the avatar menu (`data-theme` on `<html>`, saved in coach prefs `desk.theme`; `system` follows `prefers-color-scheme`).

### 2.3 Layout system

- **Bento grid** (`.bento`): a 12-column CSS grid, 14 px gap, `grid-auto-rows: minmax(150px, auto)`, `grid-auto-flow: dense`.
  - Tile sizes are fixed column spans: `s` = 3, `m` = 4, `l` = 6, `xl` = 8, `full` = 12. Tall tiles add `tall` (row span 2).
  - Breakpoints: ≤ 1280 px gives 8 columns (s=4, m=4, l=8, xl=8); ≤ 820 px gives 1 column, in order.
- **Screen header**:
  - an eyebrow (group name);
  - a display title (`--t-display-s`, with an optional italic accent word in `--accent`, like the Plan·Act·Review boards);
  - a subtitle line;
  - actions aligned right, with at most one primary.
- **Split views** (Inbox, Messages, Pipeline detail): resizable panes. Drag the divider; the widths are saved in coach prefs. Below 1100 px they collapse to a single pane with back navigation.

### 2.4 Component kit: `server/desk/ui.js` + `ui.css` (WP0-D), plus `charts.js` and `composer.js`

All components:
- build DOM with `h()`;
- take a plain options object;
- return an element, or `{el, …methods}` where stated;
- never use innerHTML;
- are keyboard reachable with visible `--focus`.

Class prefix: `ui-`.

| Component | Signature | Behaviour |
|---|---|---|
| `tile` | `tile({title, eyebrow, icon, size='m', tall=false, hero=false, action:{label, path\|onclick}, body, loading=false})` | A bento card. `hero` adds `--sheen`. When `loading`, the body is a skeleton. Hover lifts it 1 px and lightens it to `--tile-hover`. |
| `bento` | `bento(el, tiles, {editable, onLayout})` | Lays out tiles. In edit mode: drag to reorder, a size menu, and hide/show. `onLayout([{id,size,hidden}])`. |
| `skeleton` | `skeleton(kind='lines'\|'card'\|'table'\|'chart', {rows=3})` | Shimmer placeholders (`--shimmer`, 1.4 s). |
| `slideOver` | `slideOver(title, build(body, close), {wide, onClose, deepLink})` → `{close}` | The right-hand panel (1.3). It stacks at most 2 deep. |
| `menu` | `menu(anchorEl, items:[{label, icon, kbd, danger, onclick} \| 'sep'])` | A popover menu with arrow-key navigation. It flips when there is no room. |
| `popover` | `popover(anchorEl, build)` | A generic anchored floating panel. |
| `tabs` | `tabs(options:[{id,label,badge}], value, onchange, {sync:'tab'})` | An underline tab bar. `sync` writes the tab into the hash route. |
| `dataTable` | `dataTable({columns:[{key,label,align,sort,width,render}], rows, rowKey, onRow, selectable, bulkActions:[{label,icon,run(rows)}], empty, filter:true, initialSort})` → `{el, setRows}` | Sticky header, click to sort, text filter, and a checkbox column. While rows are selected, a bulk action bar floats at the bottom. Arrow-key row navigation. |
| `kanban` | `kanban({columns:[{id,label,tone,collapsed}], items, columnOf(item), render(item), onMove(item, toColumn, index) → Promise, onOpen(item)})` → `{el, setItems}` | HTML5 drag and drop with a placeholder ghost and `--shadow-drag`. Keyboard: Space picks up, arrows move, Space drops, Esc cancels. Optimistic, and a failed `onMove` rolls back with a toast. Column header counts and sums (when `sum(items)` is given). |
| `timeline` | `timeline(items:[{at, icon, tone, title, detail, path}], {groupByDay=true})` | A vertical rail with day headers. |
| `wizard` | `wizard(steps:[{id,label,render(box, data), valid(data)}], {onFinish(data)})` | A stepper with Back and Next. |
| `ruleBuilder` | `ruleBuilder({facts, value, onChange})` | Edits the Rules JSON (3.5): pick a fact, then an operator and a value control typed by the fact type, with nested any/all groups (one level). It shows a live match count when given `count(rules) → Promise<number>`. |
| `tagChip` / `tagPicker` | `tagChip(tag, {onRemove})`, `tagPicker({selected, all, onChange, allowCreate})` | Tags are coloured from the chart tokens (`tag.color` ∈ `chart-1..6`). |
| `avatarStack` | `avatarStack(people, {max=4})` | Overlapping avatars with +N. |
| `scoreRing` | `scoreRing(score 0–100, {size=56, label, band})` | A ring in the band colour, the number in the centre, and the band word beneath it. |
| `countUp` | `countUp(el, to, {format, dur=600})` | Animates a number. Off under reduced motion. |
| `moneyInput` | `moneyInput({value pence, onChange})` | A £ input that stores pence. |
| `dateField` / `timeField` / `dateRange` | as named | Native inputs styled, with London days. |
| `kbd` | `kbd('⌘K')` | Key caps. |
| `emptyHero` | `emptyHero({icon, title, line, action})` | Large empty states, with the serif title. |
| `toast` (core, extended) | `toast(text, {error, undo: async fn, action:{label, run}, ms=5000})` | Stacks bottom-centre. `undo` shows an Undo button and runs the inverse. |
| `confirmBox` (core) | unchanged | |
| `inlineEdit` | `inlineEdit(value, onSave, {multiline, placeholder})` | Click to edit, Enter to save, Esc to cancel. |
| `progressBar` | `progressBar(pct, {tone, label})` | |
| `segmentedNav` | `segmentedNav(options, value, onchange)` | A pill segmented control (the existing `segmented`, restyled). |

**`charts.js`** (WP0-D): hand-written SVG with no library.
- Every chart takes `{width:'100%', height, ariaLabel}`.
- It draws an accessible `<title>` / `<desc>` plus a visually hidden data table.
- Hover shows a crosshair and tooltip; keyboard focus steps through the points.
- Colour goes through classes defined in `charts.css` (`.ch-tone-1` … `.ch-tone-6`, `.ch-heat-0` … `-4`) or through
  `el.style.fill = 'var(--chart-n)'`, **never** through SVG presentation attributes (`fill="var(--chart-1)"` does not resolve custom
  properties) and never through a `style` attribute string (blocked by the CSP, 6.6). Bar widths and heights are set the same way, through CSSOM.
- Charts:
  - `lineChart({series:[{label, tone, points:[{x, y}]}], yFormat, xFormat, area=false, goal})`
  - `barChart({bars:[{label, value, tone}], stacked, yFormat})`
  - `donut({parts:[{label, value, tone}], centre})`
  - `heatmap({rows, cols, values[r][c], format})`, using `--heat-0..4`
  - `cohortGrid({cohorts:[{label, size, values:[pct]}]})`
  - `funnel({stages:[{label, value}]})`
  - `sparkline` (re-exported from core)
  - `gauge(score, {bands})`

**`composer.js`** (WP0-D): one composer for threads, inbox replies, broadcasts and scheduled sends.
```js
composer({ clientId, audience = null, placeholder, draftKey, initial = '', onSend: async ({text, mediaId, kind, meta}) => {}, compact = false })
  → { el, setText(t), insert(t), getText(), focus(), attach({mediaId, kind, durationSec, label}), clearAttachment(), busy(bool) }
```
- Auto-growing textarea. Enter sends; Shift+Enter makes a newline. Drafts are kept in localStorage per `draftKey`.
- Tool buttons come from `registerComposerTool({id, icon, label, order, run(composerApi, ctx)})`. Order: templates (WP5) 10, voice record (WP6) 20, attach (WP6) 30, schedule send (WP5) 40, AI draft (WP6) 50, AI check (WP6) 60.
- A slash menu: typing `/` at the start of a word opens `registerSlash` items (WP5 registers template shortcuts).
- **Send guards**: before `onSend`, the composer runs each `registerSendGuard({id, order, check: async (draft, ctx) → {ok:true} | {ok:false, panel: Element}})` in order.
  - A guard that returns a panel shows it above the composer: the AI review result, with the buttons Send original, Use rewrite, Edit.
  - The guard resolves only through the coach's click.
  - **No guard may send by itself.**

### 2.5 Micro-interactions (all in `ui.css`, all off under reduced motion)

- Tiles and cards: hover `translateY(-1px)` over 120 ms; press `scale(.99)`.
- The slide-over enters with `translateX(24px)` → 0 and opacity, over 240 ms with `--ease`. The palette scales .98 → 1 over 160 ms.
- Toasts rise 8 px with a fade. The Undo countdown is a hairline bar.
- Kanban drag: the card tilts 1.5° with `--shadow-drag`, and the drop target column gets an accent-wash background.
- Numbers count up on first paint of a tile. Charts draw their line in (a stroke-dashoffset transition over 600 ms).
- Live updates: a row that changes flashes `--accent-wash` for 1.2 s. The badge pops with the `--spring` ease.
- Optimistic UI everywhere a write is cheap (tick a task, move a card, mark done). Roll back with an error toast.

### 2.6 Design records

WP0-D appends a dated entry to `docs/design/decisions.md`. It records the relaxations in 2.1, the new tokens, the light theme shipping, and the new IA. Packages do not edit that file. Any further departure goes in their own `docs/api/<package>.md` under "Design notes", and WP-Z folds it in.

---
## 3. Architecture for the parallel build (read this whole section)

### 3.0 Build order

```
 wave 0 (two agents, in parallel, disjoint files)    wave 1 (eleven agents, in parallel)     wave 2
 ┌──────────────────────────┐                         ┌ WP1 Command ─────────────┐
 │ WP0-S foundation: server │──┐                      ├ WP2 Clients & CRM ───────┤
 └──────────────────────────┘  ├─ merge to desk-v2 ──▶├ WP3 Billing & revenue ───┤
 ┌──────────────────────────┐  │  (tests green,       ├ WP4 Campaigns & guides ──┤
 │ WP0-D foundation: desk   │──┘   local preview up)  ├ WP5 Automations & outreach├─ merge each into desk-v2 ─▶ WP-Z integration
 └──────────────────────────┘                         ├ WP6 AI & voice ──────────┤   when green (any order;     (one agent)
                                                      ├ WP7 Calendar & diary ────┤    WP6 before WP9/WP10's
                                                      ├ WP8 Tasks, accountability│    final device checks)
                                                      ├ WP11 Growth (leads, mkt) ┤
                                                      ├ WP9 iOS ─────────────────┤
                                                      └ WP10 Android ────────────┘
```

**The golden rule:** in wave 1, a package edits only the files listed as **owned** by it in section 5. It creates
new files only under its own prefixes. Anything that needs a shared file goes through a registry
(3.2–3.9). If a package finds it truly needs a shared edit, it does **not** make it. It writes the need under
"Integration requests" in its `docs/api/<package>.md`, and WP-Z applies it.

Worktrees:
- **Before wave 0**, the orchestrator commits `docs/design/desk-v2.md` to `desk-v2` (it is untracked at the time of writing, and a
  worktree would not contain it). WP0-S commits `server/features/README.md` and `docs/api/README.md` in its first commit, so wave 1 inherits them.
- Each wave-0 and wave-1 package makes `git worktree add ~/jk-wt-<pkg> -b desk-v2-<pkg> desk-v2`.
- iOS uses `~/jk-wt-ios` and Android uses `~/jk-wt-android`. Both exist today on `par-ios` and `par-android` (clean and merged into `main`
  when this spec was written). Before WP9/WP10 start, re-check: `git -C ~/jk-wt-ios status --short` is empty **and** its branch is merged into `main`,
  then `git worktree remove ~/jk-wt-ios`. If either is dirty or unmerged, **stop and report**; never reuse or force-remove it.
- Commit in small, scoped commits. Do not push to `main`. Never open a PR; WP-Z and the owner decide that.

### 3.1 Server feature modules (`server/features/*.mjs`, auto-discovered)

**Module layout (this avoids an import cycle that deadlocks Node).** A naive loader, where `store.mjs` imports a
top-level-await loader that dynamically imports features which themselves import `store.mjs`, never settles: Node prints
"Detected unsettled top-level await" and exits with code 13. So:

1. **`server/registry.mjs`** (WP0-S) has **no imports**. It holds the mutable `FEATURES` array and the readers `hooks(name)`,
   `allFacts()`, `allActions()`, `allEvents()`, `allVariables()` and `featureNames()`. Foundation and existing modules
   (`events.mjs`, `facts.mjs`, `templating.mjs`, `needs.mjs`, `demo.mjs`, `account.mjs`, `messages.mjs`, `search.mjs`)
   import the registry and read it **at call time, never at import time**.
2. **`server/features.mjs`** (WP0-S) is the only module with the top-level-await loader. It reads `server/features/` (or `FEATURES_DIR`, honoured only
   when `NODE_ENV=test`), imports every `*.mjs` matching `/^[a-z0-9-]+\.mjs$/` sorted by name (a `README.md` beside them is fine), validates
   them, and fills the registry. **Only entry points import it**: `main.mjs`, `app.mjs` and `server/test/helpers.mjs`. No other module may.
3. **`openStore` stays feature-free.** `createApp(db, config)` calls `runFeatureSchemas(db)` (idempotent) and `attachEvents(db, config)`, so
   `createApp` stays synchronous and existing tests keep working. `main.mjs` calls `runFeatureSchemas(db)` right after `openStore` and
   **before** `seedDemo`, because demo builders write feature tables.
4. **A feature never imports** `app.mjs`, `main.mjs`, `features.mjs`, `demo.mjs`, `account.mjs` or another feature's file.
   `foundation.test.mjs` enforces it by scanning the import specifiers of every `server/features/*.mjs`, and by spawning
   `node -e "await import('./server/app.mjs')"` with a 5 s timeout and asserting exit code 0 (exit 13 means a cycle).

Each module exports exactly one `feature` object. **The loader throws at start-up on** an unknown key; a duplicate name; a name that is not the
file name; an event, action or fact id outside the feature's own `namespaces` and not listed in its `exact` array; two features claiming the
same namespace or exact id; or a feature claiming a foundation-reserved id (3.11).

```js
// server/features/<name>.mjs
export const feature = {
  name: 'billing',                    // MUST equal the file name without .mjs
  namespaces: ['invoice', 'payment', 'package', 'billing', 'refund'],  // id prefixes this feature owns (3.11); the name itself is NOT implied
  exact: [],                          // single ids outside those namespaces, e.g. ['client.stageChanged'] or ['booking.rescheduled']
  schema(db, { addColumn, tx }) {},   // idempotent DDL (CREATE … IF NOT EXISTS, addColumn). Run by runFeatureSchemas, after the core schema.
  routes(r) {},                       // r.add(method, path, handler, opts) — same router as today
  clocks: [{ id: 'billing.recurring', everyMs: 60_000, run(db, config, now) {} }],  // sync or async; see 3.6
  on: { 'booking.created': (db, config, event) => {} },   // SYNC handlers; '*' subscribes to everything
  emits: { 'invoice.issued': { label: 'Invoice issued', payload: ['invoiceId', 'totalPence'] } },
  actions: { 'invoice.create': { label: 'Create an invoice', params: [/* ParamSpec */], run(db, config, ctx) {} } },
  facts: { 'billing.balance': { label: 'Balance owed', type: 'money', compute(db, coachId, clientIds, today) {} } },
  variables: { balance: { label: 'Balance owed', value(db, coachId, client) {} } },
  needs(db, coach, clients, today) { return []; },        // extra Needs-you reasons (3.7)
  inbox(db, coach, opts) { return []; },                  // extra Inbox items (F4)
  search(db, coach, q, limit) { return []; },             // palette results (F2)
  forecast(db, coach, fromDay, toDay) { return []; },     // revenue forecast lines (F26)
  diary(db, coach, day) { return []; },                   // diary agenda items (F22)
  timeline(db, coach, client, before, limit) { return []; },  // client 360 timeline items (F5)
  exportFor(db, user) { return {}; },                     // GDPR export additions (keys = section names)
  messageExtras(db, messages, { coachView }) { return new Map(); },  // extra fields per message id for messageOut (F19)
  quiet(db, coachId, clientIds, sinceIso) { return new Set(); },     // booking ids that do NOT count as attended (F22 no-shows, 3.4)
  badges(db, coach) { return {}; },                       // {navId: count} for GET /api/coach/badges (3.16)
  meFeatures(db, user) { return {}; },                    // extra me.features keys (F19 voice flags)
  renewals(db, coach, days) { return []; },               // F8 Renewals rows
  offboarding(db, coach, client) { return {}; },          // F8 End coaching: what this feature still has active for the client
  publicOffers(db, coachId) { return []; },               // F28 / F6: live public campaigns
  demo: { tables: { client: [], user: [], coach: [] }, media: [/* {key, file, mime, durationSec} */], build(db, ctx) {} },  // 3.10
};
```

Exports:
- `registry.mjs`: `FEATURES` (filled once, then frozen), `hooks(name)` → `[[feature, fn], …]`, `allFacts()`, `allActions()`, `allEvents()`
  (each entry carries `aiDerived` when set), `allVariables()`, `featureNames()`.
- `features.mjs`: `runFeatureSchemas(db)`, `startClocks(db, config)` → `stop()`, `tickClock(db, config, id, now)` (tests).
- `GET /api/coach/capabilities` (WP0-S, coach) → `{features:[name], ai:{provider}}`. The desk shell reads it once at start-up and hides what is absent.

**Rules for feature modules**
1. A feature may import `registry.mjs`, the foundation modules (`events.mjs`, `facts.mjs`, `ai.mjs`, `audio.mjs`, `notifications.mjs`,
   `templating.mjs`, `ratelimit.mjs`, `rng.mjs`) and existing server modules other than those listed in point 4 above. **It never imports another
   feature's file.** It reaches other features only through events, actions, facts, variables and hooks. It may not rely on another
   feature's tables existing: reads of another feature's table go through a fact, a hook or an event payload.
2. Every coach endpoint calls `requireCoach(ctx)` and scopes every query by `coach_id = ctx.user.id`. It reaches clients
   only through `clientFor(ctx, id)`, which gives a 404 for anything foreign. Use `ownRow(ctx, table, id)` (foundation: `SELECT * FROM <table>
   WHERE id=? AND coach_id=?`, or 404) for coach-owned rows. Never return 403 for a foreign id.
3. Every new table that holds a person's data has `client_id … REFERENCES users(id) ON DELETE CASCADE` and/or
   `coach_id … REFERENCES users(id) ON DELETE CASCADE`. Client ids never live only inside JSON.
4. IDs come from `newId('<prefix>')` with the prefix registered in 3.11. Money is integer pence. Days are `YYYY-MM-DD` London
   days; instants are UTC ISO. Compare like with like.
5. Never `await` inside `tx()`. Do the network, AI and ffmpeg work first, then write in one short `tx`.
6. A new SQL `CHECK` on an enum is allowed only on new tables. Never rebuild an existing table in wave 1.
7. Handlers return JSON objects with camelCase keys. Errors come from `fail(status, message)`, and messages are short sentences.
8. Each feature documents its API in `docs/api/<package>.md`, in the house style of `docs/API.md`.

### 3.2 The event bus (`server/events.mjs`, WP0-S)

```sql
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  coach_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',        -- one human line for timelines, e.g. "Booked Tue 4 Nov 07:00 · 1:1"
  payload TEXT NOT NULL DEFAULT '{}',      -- JSON: ids and small values only, never message bodies or transcripts
  is_demo INTEGER NOT NULL DEFAULT 0,
  at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_coach_seq ON events(coach_id, seq);
CREATE INDEX IF NOT EXISTS events_client_seq ON events(client_id, seq);
CREATE TABLE IF NOT EXISTS event_cursors (handler TEXT PRIMARY KEY, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS event_failures (
  seq INTEGER NOT NULL, handler TEXT NOT NULL, error TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (seq, handler));
```

API:
- `emit(db, type, { coachId, clientId = null, summary = '', ...payload })` inserts one row **synchronously**, inside the
  caller's transaction if there is one, so a rolled-back write emits nothing. It then schedules a drain with `setImmediate`.
  `is_demo` is copied from the coach row.
- `attachEvents(db, config)` is called by `createApp` (and therefore before any request or clock). It remembers the config for draining
  (a WeakMap keyed by db) and **creates every cursor eagerly**: `INSERT OR IGNORE INTO event_cursors (handler, seq)` for every
  `<feature>:<type>` handler in the registry, with `seq` = the current `max(seq)` (0 on an empty DB). A newly deployed handler therefore
  starts at the deploy point, and the first event after start-up is never skipped.
- `drainEvents(db, config)` is **synchronous** and **never initialises a cursor**. For each handler key, it reads events after the handler's cursor
  (`LIMIT 500`) in seq order and calls the handler. Each handler call runs in its own `tx`, and the cursor advances in the same tx.
  When a handler throws, the error is logged to `event_failures`, the cursor advances anyway (nothing is retried forever) and the error goes to `console.error`.
- `startClocks` also drains every 10 s, as a backstop after a crash.
- `eventsFor(db, {coachId, clientId, before, limit, types})` → rows, for the timeline (F5) and the activity feed (F1).
- **Live fan-out happens in `drainEvents`**, which only ever sees committed rows: after the handlers run, it pushes rows with
  `seq` above a fan-out cursor (in memory, per db) to that coach's open `/api/coach/stream` connections (3.8), as `{seq, type, clientId, summary}`.
  An event inside a transaction that rolls back is never streamed.
- **Emit from request paths, not from shared helpers.** Helpers that `demo.mjs` or `testclients.mjs` also call (`setUpClient`,
  `recordPlan`, `sendForm`, `buildPerson`, `layProgram`) never emit by default. Where such a helper needs an event on the HTTP path, it takes
  an `{ emit = false }` option that only the HTTP handler sets, or the handler emits after calling it.
- Retention: a daily clock deletes events older than 400 days. Those are plumbing; domain tables keep the history.
- Foundation test: emit immediately after `createApp`, then `settle()`: the handler has run exactly once.

Handlers are sync. Async work (AI, fetch, ffmpeg) is queued by the handler into the feature's own table and done
by the feature's clock.

**Events WP0-S emits from existing code** (one `emit` line each, after the write, inside the existing tx where one exists):

| Event | Where (existing) | Payload | Summary example |
|---|---|---|---|
| `client.joined` | `auth.mjs` `upsertIdentityUser` (after insert, beside `startJoinFlows`; not in `setUpClient`, which the demo calls) | `{email}` (lower-case; used only for lead matching) | "Joined" |
| `message.sent` (coach → client) | `messages.mjs` `send` and the new `sendMessage()` helper, which `autoflows.mjs` `doStep` now uses (`via:'autoflow'`) | `{messageId, kind, mediaId, via}` (`via` values in 3.5) | "Message sent" |
| `message.received` (client → coach) | `messages.mjs` `send` | `{messageId, kind, mediaId}` | "Voice note · 0:42" or "Message" |
| `checkin.submitted` | `daily.mjs` `submitCheckin` | `{checkinId, week, pain:bool}` | "Weekly check-in" |
| `form.sent` / `form.submitted` | `forms.mjs` `sendForm` / `answer` | `{requestId, formId, flagged:n}` | "Answered Monthly review" |
| `booking.created` / `booking.cancelled` | `bookings.mjs` `createBooking`, `createClass`, `joinClass` / `cancelBooking`, `leaveClass` | `{bookingId, kind, start, purpose, byRole, late:bool, refunded:bool}` | "Booked Tue 4 Nov 07:00" |
| `workout.completed` | `training.mjs` `completeWorkout` | `{workoutId, feel}` | "Finished Lower A" |
| `membership.changed` | the `account.mjs` HTTP handler that calls `recordPlan` (line ~248), **not** `recordPlan` itself, which `demo.mjs` and `testclients.mjs` call | `{from, to}` | "Plan: Performance" |
| `letter.published` / `letter.delivered` | `reports.mjs` put (publish) / `deliverDue` | `{reportId, kind}` | "Letter delivered" |
| `commitment.reviewed` | `par.mjs` (commitment outcome set) | `{commitmentId, outcome}` | "Commitment kept" |
| `day.started` | foundation clock, once per coach per London day after 05:00 (meta key `day_started:<coachId>`) | `{day}` | "" (not shown) |

The event catalogue (`GET /api/automations/catalogue`, see F15) also lists every feature's `emits`. Its payload
keys are documented there, so automations can filter on them. An `emits`, `facts` or `variables` entry may carry
`aiDerived: true`; WP6 sets it on every `voice.*` and `ai.*` event and on `voice.sentiment14` (6.3).

**Messages that emit no `message.sent`.** The client's welcome message (`auth.mjs` `setUpClient`, covered by `client.joined`) and
delivered letters (`reports.mjs`, covered by `letter.delivered`) insert directly and stay as they are. Facts such as "days since the last
coach message" therefore read the `messages` table, never the events table.

### 3.3 Coach notifications (`server/notifications.mjs`, WP0-S)

```sql
CREATE TABLE IF NOT EXISTS coach_notifications (
  id TEXT PRIMARY KEY,                                   -- newId('nt')
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  path TEXT, icon TEXT, tone TEXT NOT NULL DEFAULT 'data', -- urgent|attention|ok|data
  dedupe TEXT,                                           -- same (coach, dedupe) within 24 h is dropped
  push_after TEXT, pushed_at TEXT,                       -- urgent pushes only (below)
  read_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS coach_notifications_coach ON coach_notifications(coach_id, created_at);
CREATE INDEX IF NOT EXISTS coach_notifications_push ON coach_notifications(push_after) WHERE pushed_at IS NULL AND push_after IS NOT NULL;
```

- `notifyCoach(db, config, coachId, {clientId, kind, title, body, path, icon, tone, dedupe})` inserts and queues a stream message `{type:'notification'}`
  (sent after commit, 3.5).
- **Urgent pushes.** A notification with `tone='urgent'` (a voice flag for pain, injury, illness, mentalHealth or safeguarding, a PAR-Q health
  flag, pain in a check-in, a high-severity calendar conflict, a detractor) is also pushed to the coach's own devices through the existing
  `notify()` path (APNs and FCM), so it reaches JK when the desk is closed:
  - controlled by prefs `notify.push.urgent` (default **on**);
  - outside the coach's quiet hours (prefs `notify.quietHours`, default `22:00–06:30` London) it is pushed after commit; inside them,
    `push_after` is set to the end of quiet hours and the notifications clock (60 s) pushes it then, unless it has been read;
  - at most one push per `(coach, dedupe)` (the dedupe rule above means a duplicate never inserts);
  - other tones never push (the coach apps already get message pushes);
  - the demo coach never pushes (existing `notify` behaviour).
  - Test with the recorder `pushTransport`: an urgent notification pushes once, a `data` one does not, one inside quiet hours pushes when they end, and a read one never pushes.
- Routes:
  - `GET /api/notifications?before=<iso>&limit=30` → `{items:[{id, kind, title, body, path, icon, tone, client, readAt, at}], unread}`.
  - `GET /api/notifications/count` → `{unread}`.
  - `POST /api/notifications/read {ids?:[…], all?:true}` → `{unread}`.
- Notifications are pruned after 90 days. Built-in action `coach.notify` (3.5).

### 3.4 Facts, rules, tags and segments (`server/facts.mjs`, WP0-S)

**Facts** are named per-client values. Segments, automation conditions, broadcast audiences and the palette all use them.
- `clientFacts(db, coachId, clientIds, {only, today})` → `Map<clientId, {[factId]: value}>`.
  - Computed per request, in batches.
  - A provider that throws yields `null` for its fact and logs the error.
- Fact types: `number`, `money` (pence), `days` (a number of days), `bool`, `enum` (with `options:[{value,label}]`), `tags` (an array of tag ids), `day` (`YYYY-MM-DD`).

Built-in facts (WP0-S):

| Fact | Type | Meaning |
|---|---|---|
| `core.plan` | enum none/foundation/performance/elite | `users.plan` |
| `core.daysSinceJoined` | days | since `users.created_at` |
| `core.daysQuiet` | days | since the last client-originated activity: a message, a set, a workout completed, a check-in, a habit tick, **or an attended session** (below) |
| `core.sessionsAttended14` | number | attended sessions in the last 14 days (below) |
| `core.anniversaryInDays` | days | until the next yearly anniversary of `users.created_at` (0 on the day) |
| `core.outreachPaused` | bool | `client_outreach.paused` (3.5) |
| `core.daysSinceWorkout` | days | since the last completed workout (`null` if never) |
| `core.adherence28` | number 0–100 | `coach.mjs` `adherence()` over 28 days |
| `core.unread` | number | unread client messages |
| `core.pain14` | bool | a pain flag in the last 14 days (check-in pain, urgent words, a flagged form or voice flag via hook) |
| `core.nextSessionDays` | days | until the next non-cancelled booking (`null` if none) |
| `core.onboarded` | bool | `onboarded_at` is set |
| `core.tags` | tags | from `client_tags` |
| `core.segments` | tags | the ids of saved segments the client matches (computed lazily, only when referenced) |

**Attended sessions count as activity**, so a client who trains in person with JK but rarely opens the app is not "quiet".
`facts.mjs` exports `attendedSessions(db, coachId, clientIds, fromIso, toIso)` → `Map<clientId, [{bookingId, start}]>`: past, non-cancelled
bookings (1:1 or a class the client joined) whose start is before now, **minus** the booking ids returned by `hooks('quiet')` (WP7 returns those
marked `noShow` or `lateCancel` in `session_notes`). `core.daysQuiet`, `core.sessionsAttended14` and the F5 health score all use it.
WP0-S test: a client with no app activity but an in-person session 3 days ago has `core.daysQuiet = 3`; WP2 test: that client stays Active.

**Rules JSON** (one schema everywhere):
```json
{ "match": "all", "rules": [
    { "fact": "core.daysQuiet", "op": "gte", "value": 7 },
    { "match": "any", "rules": [ { "fact": "core.tags", "op": "has", "value": "tg_abc" },
                                 { "fact": "core.plan", "op": "in", "value": ["performance","elite"] } ] } ] }
```
- Operators: `eq ne gt gte lt lte in notIn has hasNot isSet isNotSet between` (`between` value `[a,b]`).
- Groups nest at most one level deep. At most 20 rules.
- `evaluate(rules, facts)` → bool. `validateRules(rules)` throws `fail(400)` with a path such as `rules[1].rules[0].op is not known`.

**Audience**:
```json
{ "clientIds": ["…"], "segmentId": "sg_…", "rules": { … } }
```
- `resolveAudience(db, coachId, audience, {purpose = 'any'})` → client rows: the union of the listed ids, the segment members and the rule matches.
- It always runs inside `role='client' AND coach_id=? AND is_demo = coach.is_demo`.
- With `purpose: 'broadcast'` it drops clients with `client_outreach.no_broadcasts = 1`; with `purpose: 'automated'` (automation starts,
  campaign nudges, bulk nudges) it drops clients with `client_outreach.paused = 1`. Callers report the dropped count ("2 skipped: outreach paused").
- With purpose `broadcast` or `automated` it refuses (400) rules that reference a fact marked `aiDerived` (6.3).

Tags and segments are foundation tables, so every package can use them:

```sql
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL DEFAULT 'chart-1' CHECK (color IN ('chart-1','chart-2','chart-3','chart-4','chart-5','chart-6')),
  created_at TEXT NOT NULL, UNIQUE (coach_id, name));
CREATE TABLE IF NOT EXISTS client_tags (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL, added_by TEXT NOT NULL DEFAULT 'coach',   -- coach|automation
  PRIMARY KEY (client_id, tag_id));
CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coach_prefs (
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL, value TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (coach_id, key));
CREATE TABLE IF NOT EXISTS client_outreach (               -- per-client outreach flags (3.5); absent row = defaults
  client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paused INTEGER NOT NULL DEFAULT 0, no_broadcasts INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deferred_messages (             -- automated sends held by the outreach governor (3.5)
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', media_id TEXT, via TEXT NOT NULL,
  send_at TEXT NOT NULL, reason TEXT NOT NULL,             -- cap|quietHours
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','sending','sent','dropped')),
  message_id TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS deferred_messages_due ON deferred_messages(status, send_at);
```

Foundation routes:

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/facts` | none | `{facts:[{id, label, type, options?, feature}]}` |
| GET | `/api/facts/clients/:id` | none | `{facts:{[id]: value}}` (for the client header chips) |
| GET | `/api/tags` | none | `{tags:[{id, name, color, count}]}` |
| POST | `/api/tags` | `{name, color?}` | `{tag}` |
| PATCH | `/api/tags/:id` | `{name?, color?}` | `{tag}` |
| DELETE | `/api/tags/:id` | none | `{ok}` |
| PUT | `/api/coach/clients/:id/tags` | `{tagIds:[…]}` | `{tags:[…]}` (emits `client.tagged` / `client.untagged` per change) |
| POST | `/api/coach/clients/tags` | `{clientIds, add?:[tagId], remove?:[tagId]}` | `{changed:n}` (bulk) |
| GET | `/api/segments` | none | `{segments:[{id, name, description, rules, pinned, count}]}` |
| POST | `/api/segments` | `{name, description?, rules, pinned?}` | `{segment}` |
| PUT | `/api/segments/:id` | same | `{segment}` |
| DELETE | `/api/segments/:id` | none | `{ok}` |
| POST | `/api/segments/preview` | `{rules}` or `{audience}` | `{count, clients:[{id, name, initials}] (≤50)}` |
| GET | `/api/coach/prefs/:key` | none | `{value}` (`key` ~ `^[a-z0-9.-]{1,64}$`; `null` if unset) |
| PUT | `/api/coach/prefs/:key` | `{value}` (JSON ≤ 16 KB) | `{ok}` |
| GET/PUT | `/api/coach/clients/:id/outreach` | `{paused?, noBroadcasts?, note?}` | `{outreach:{paused, noBroadcasts, note, sentToday, cap}}` (WP2 draws the toggles in the Client 360) |

### 3.5 Actions and templating (`server/facts.mjs` + `server/templating.mjs`, WP0-S)

An **action** is something an automation (F15) or a bulk command can do for one client. Actions run **synchronously**
inside a `tx` and return a short outcome string such as "Sent", "Skipped: no form", or "Created task".

ParamSpec: `{key, label, type:'text'|'longtext'|'template'|'number'|'money'|'day'|'enum'|'tag'|'form'|'program'|'campaign'|'segment'|'package'|'discount', options?, required?, default?}`.
The builder UI draws a control per `type`. The id types (`form`, `program` and so on) are filled from
`GET /api/automations/catalogue` lookups, which each owning feature supplies through its action's `options(db, coachId)`.

Built-in actions (WP0-S):

| Action | Params | Effect |
|---|---|---|
| `message.send` | `text:template` | `sendMessage(..., {via:'automation'})` with the template rendered |
| `form.send` | `formId:form` | existing `sendForm` |
| `program.assign` | `programId:program`, `start:enum(nextMonday,today)` | existing `layProgram` (published) |
| `tag.add` / `tag.remove` | `tagId:tag` | `client_tags` |
| `coach.notify` | `title:text`, `body:template` | `notifyCoach` |

Every action declares `clientFacing: true|false` (unknown counts as true). Built-ins: `message.send`, `form.send` and `program.assign` are client-facing;
`tag.add`, `tag.remove` and `coach.notify` are not. F15 uses it for the AI-derived guard (6.3).

`server/templating.mjs`:
- `render(db, coachId, client, text, {extra})` → `{text, missing:[name]}`.
- Variables use `{name}` syntax, are case-sensitive, and unknown names are left as written and reported in `missing`.
- Built-ins: `{first}`, `{name}`, `{coach}`, `{coachFirst}`, `{plan}`, `{nextSession}` ("Tue 4 Nov at 07:00"), `{nextSessionDay}`, `{daysQuiet}`, `{streak}` (minimum-day streak), `{today}`, `{yearsCoached}`.
- Features add more through `variables`, for example `{balance}` (WP3), `{campaign}` and `{campaignDay}` (WP4), `{packageLeft}` (WP3).
- **No variable may expose AI output** (transcripts, summaries, moods, drafts). The registry refuses a variable marked `aiDerived`, so no automated message can quote a model.
- Rendering is plain text with no HTML, and the result is capped at 4000 characters.

`messages.mjs` gains an exported helper, which every non-HTTP send uses (automations, autoflows, broadcasts, campaigns, scheduled sends, dunning):
```js
sendMessage(db, config, { coachId, clientId, text, kind = 'text', mediaId = null, via, now = new Date() })
  → { message: row | null, deferredUntil: iso | null, skipped: reason | null }
// inserts as from_role 'coach', from_id coachId, messages.via = via; emits message.sent; refuses if the client is not this coach's.
// Push (notify) and stream fan-out are queued with afterCommit(), never fired inside the transaction.
```

**After-commit work.** `store.mjs` adds `afterCommit(fn)`: inside a `tx` it queues `fn`, and `tx()` runs the queue when the outermost
transaction commits (depth 0) and drops it on rollback; outside a `tx` it runs `fn` on `setImmediate`. `sendMessage`, `notifyCoach` and the
existing `messages.mjs` `send` use it for `notify()` and stream work, so a handler that throws after `message.send` leaves no push for a message
that does not exist. Test (recorder `pushTransport`): an action that throws after `message.send` sends no push and leaves no row.

**The outreach governor** (in `sendMessage`; `messages.via TEXT` is added with `addColumn`). Each `via` has a fixed class:

| `via` | Class | Daily cap | Quiet hours | Honours `paused` | Honours `noBroadcasts` |
|---|---|---|---|---|---|
| `desk`, `app`, `scheduled`, `coachAction` (a coach pressed a button: invoice send, recap, guide share, waitlist offer, plays) | coach | no | no | no | no |
| `automation`, `autoflow`, `campaign`, `nudge` (bulk accountability nudges) | automated | yes | yes | yes | no |
| `broadcast` | marketing | yes | yes | yes | yes |
| `dunning` | billing | no (exempt) | yes (and its own 08:00–20:00 window) | no | no |

- **Cap:** at most `outreach.dailyCap` (prefs, default **3**) capped sends per client per London day, counted from `messages.via`.
- **Over the cap, or inside quiet hours** (prefs `outreach.quietHours`, default `21:00–07:30`): the send is written to `deferred_messages`
  with `send_at` = the end of quiet hours, or 07:30 the next London day for the cap, and `sendMessage` returns `deferredUntil`. A foundation clock (60 s)
  claims due rows (`status='sending'`) and sends them through `sendMessage` again (still governed; a send deferred twice is `dropped` and logged).
- **Paused or no-broadcasts:** returns `skipped: 'outreach paused'` / `'no broadcasts'`, writes nothing, and the caller logs it.
- Session reminders are pushes, not messages, and are not governed.
- Tests: the 4th automated send of the day is deferred and goes out the next morning; a coach-typed send is never capped; quiet hours defer a
  campaign nudge and a dunning step; a paused client gets no automation message but still gets a desk message; `noBroadcasts` drops the client from a broadcast audience.

### 3.6 Clocks (`features.mjs` `startClocks`, WP0-S)

- `main.mjs` replaces its hand-started clocks with `startClocks(db, config)`. That covers the autoflow clock (5 min), the letter clock (60 s),
  the demo clock (10 min, only with demo codes), the event backstop (10 s), `day.started` (60 s), the deferred-message sender (60 s, 3.5),
  the urgent-push sender (60 s, 3.3), the pruning (daily) and every feature clock. `SIGTERM` calls `stop()`, then `closeAllStreams()` (3.8),
  then `app.close()`.
- Each clock run is wrapped in try/catch. A clock whose previous async run is still going is skipped, never overlapped.
- The first run happens 5 s after start-up (not immediately), so the boot stays fast.
- **Idempotent across restarts**: record what was done in a row before or with the side effect (the `runDue` done-map pattern,
  or `UPDATE … SET status='sending' WHERE status='scheduled'` to claim a row). A missed tick means late, never twice.
- Tests call `tickClock(db, config, id, now)` with an injected `now` (a Date). Clock code must take `now` from the argument and
  never read `Date.now()` directly.

### 3.7 Needs-you, inbox, search, timeline and diary hooks

- `needs.mjs` `needsYou()` (WP0-S edit) merges `hooks('needs')`. Each hook returns
  `[{clientId, kind, text, at, rank (1–8, same scale as REASON_RANK), iconKey, action:{label, path}}]`, and its items join
  the client's reasons. A new `iconKey` must be a Material name present in `symbols.js` (3.12).
- Inbox (F4), search (F2), timeline (F5), forecast (F26) and diary (F22) are aggregated by their **owning** feature, which iterates
  `hooks('<name>')`. The item shapes are fixed in those features' sections, so providers can be written before the owner merges.
- `messageExtras` is aggregated by `messages.mjs` `messageOut` (F19), `meFeatures` by `settings.mjs` `featuresOf`, `quiet` by `facts.mjs` (3.4),
  `badges` by `GET /api/coach/badges` (3.16), `renewals` and `offboarding` by WP2 (F8), and `publicOffers` by WP11 (F6, F28).
  Each aggregator catches a throwing provider, logs it and carries on.

### 3.8 Live stream (`server/stream.mjs`, WP0-S)

- `GET /api/coach/stream` (coach only) answers `content-type: text/event-stream`, `cache-control: no-cache`, `x-accel-buffering: no`.
- It writes `event: <type>\ndata: <json>\n\n` for each event and notification of that coach, plus `: ping` every 25 s.
- At most 4 open streams per coach; the oldest is closed.
- Events reach it from `drainEvents` (committed rows only, 3.2). Notifications reach it through `afterCommit` (3.5).
- The desk reads it with `fetch()` plus a stream reader (EventSource cannot send the Bearer header). On error it backs off 2 s, 5 s, 15 s, then 30 s,
  and falls back to polling.
- **Shutdown.** An open event stream never goes idle, so `server.close()` alone would wait for Docker's SIGKILL. `stream.mjs` exports
  `closeAllStreams()`, which ends every response. `main.mjs` calls it on SIGTERM before `app.close()`, and the test helper's `close()` calls it
  (plus `server.closeAllConnections()`), so a test that opened a stream cannot hang.

### 3.9 Desk registries and module discovery (WP0-D)

**Discovery.**
- `server/desk.mjs` keeps serving flat `[a-z0-9-]+.(js|css)` files.
- It also serves a generated module, `/desk/features.js`, containing one `import './<name>';` line for every `f-*.js` file in name order.
- `main.js` does `import './features.js';` **after** its existing screen imports. Existing routes therefore register first and feature
  routes cannot shadow them.
- CSS is auto-linked, but today's order (`app.css`, then everything alphabetically) would load the kit `ui.css` **after** every `f-*.css`, so the kit
  would silently override feature CSS at equal specificity. WP0-D changes `STYLES` in `desk.mjs` to a fixed order: `app.css`, `ui.css`, `charts.css`,
  `composer.css`, then the existing screen sheets alphabetically, then `f-*.css` alphabetically. `desk.test.mjs` asserts the order.
- Each package's desk files are named `f-<package-prefix>[-part].js|css` (3.11).
- `desk.test.mjs` asserts that `/desk/features.js` lists every `f-*.js`.
- **`h()` and the CSP.** Today `h()` passes a string `style` to `setAttribute`, which `style-src 'self'` blocks (a CSP violation, so desk-shot fails).
  WP0-D changes `h()` to map a string `style` to `el.style.cssText` and to apply object keys that start with `--` through `el.style.setProperty`
  (`style: {'--pct': '40%'}`); CSSOM writes are allowed by the CSP. `desk.test.mjs` fails on any `setAttribute('style'` in `server/desk/*.js`.

**Registries in `core.js`.** All registrations happen at module top level, at import time.
```js
registerNav({ id, label, icon, group: 'command'|'clients'|'engage'|'schedule'|'business'|'build'|'settings', order, badge: true|false, badgeOn: ['message.received', …], mobile: false })
  // badge counts come from one GET /api/coach/badges (3.16); badgeOn lists the live event types that can change this item's count
  // registering an id that already exists merges into it (later wins per key), so a package may refine
  // an existing item (e.g. WP6 adds a badge to 'messages') without duplicating it
registerCommand({ id, label, group = 'Actions', icon, keys /* e.g. 'g i' or '⌘⇧N' */, when /* () => bool */, run })
registerQuickCreate({ id, label, icon, order, run })
registerWidget({ id, title, size: 's'|'m'|'l'|'xl'|'full', tall = false, order, defaultOn = true, render: async (bodyEl, view) => {} })
registerClientTab({ key, label, order, render: async (box, { client, detail, view }) => {} })
registerClientAction({ id, label, icon, order, run: (client) => {} })   // header buttons + palette "… for <client>"
registerBulkAction({ id, label, icon, scope: 'clients', run: async (clientIds) => {} })
registerComposerTool({ id, icon, label, order, run: (composer, ctx) => {} })
registerSendGuard({ id, order, check: async (draft, ctx) => ({ ok: true }) })
registerSlash({ id, label, detail, run: (composer) => {} })
registerSettingsSection({ id, label, icon, order, render: async (box) => {} })   // /account/:section
registerSearchRenderer(type, (result) => Element)   // optional custom palette rows
setCrumbs([{ label, path }])
live.on(type | '*', fn) → off()      // stream events; '*' gets everything
prefs.get(key) / prefs.set(key, value)  // coach_prefs with a local cache
```

**Every registry has a working host in wave 0**, so each wave-1 package can see and screenshot what it registers in its own worktree.
WP0-D ships minimal hosts; WP1, WP2 and WP6 restyle them in wave 1 and must keep them drawing every registration.
1. **`clients.js`** (WP0-D in wave 0, WP2 in wave 1): the static `TABS` array becomes `registerClientTab` calls (the six existing tabs register from
   `clients.js` itself), the client header draws `registerClientAction` buttons, and the clients list draws `registerBulkAction` items in a bar when rows are selected.
2. **`today.js`** (WP0-D in wave 0, WP1 in wave 1): keeps its current content, plus a plain grid below it that draws every `registerWidget`.
3. **`messages.js`** (WP0-D in wave 0, WP6 in wave 1): the conversation, today an inline closure inside `route('/messages/:id?')` of about 130 lines, is
   **extracted for real** into `export function threadPane(el, clientId, view, { compact = false })`, and it mounts `composer.js`, so composer tools and
   send guards run. This is a refactor, not a one-line export. WP6 must keep the signature.
4. **Dev harness** under `/account/kit` (only with `?kit=1`): `/account/kit/widgets` draws every registered widget; `/account/kit/client-tab/:key?client=<id>`
   draws one client tab; `/account/kit/composer?client=<id>` mounts a composer with every tool and guard.

Existing screens: WP0-D registers nav for Today, Clients, Schedule, Messages, Programs, Library and Settings in `main.js` (with the new icons and groups).

### 3.10 Demo world, export and erasure hooks (WP0-S edits `demo.mjs`, `account.mjs`)

- **What `wipe()` deletes.** Today it deletes only the existing per-client lists and keeps media ("Photos stay"). WP0-S extends it, for the demo coach
  and the demo clients only:
  - the **foundation tables**: `events`, `event_failures` rows of those events, `coach_notifications`, `ai_calls`, `ai_settings`, `tags`, `client_tags`,
    `segments`, `coach_prefs` (except `desk.*` layout and theme keys), `client_outreach` and `deferred_messages`;
  - every feature's `demo.tables.client` / `.user` / `.coach`, in **reverse dependency order** (features later in name order first, then the existing lists;
    a feature's coach table that other rows reference by FK is listed after its children);
  - **media**: every `media` row whose `owner_id` or `client_id` is a demo user, **except** purpose `avatar`, `signature` and the reusable fixtures
    (purpose `demo:<key>`). Their files are removed with the same `rmSync` path as `eraseMedia`, **after** the tx commits. This also clears anything
    the public demo codes uploaded that day.
- **Config is threaded through:** `buildDemo(db, today, config)`, and `seedDemo` passes it (today only `demoPortrait` gets it).
- `buildDemo()` calls each feature's `demo.build(db, ctx)` **inside the same tx**, after `library()`, in feature-name order.
  - `ctx = { coach, clients /* rows */, byName /* first name → row */, today, rng /* rng(seed) from the new server/rng.mjs */, config, media }`.
    `testclients.mjs` keeps its private `rng` and stays untouched.
  - `ctx.media(key, {file, mime, durationSec})` returns a media row for the demo coach with purpose `demo:<key>`, reusing it if it exists. When it does not,
    the file is written **before** the tx starts (`buildDemo` pre-creates every fixture a builder declares in `demo.media: [{key, file, mime}]`), and only the
    row is inserted inside the tx. With no `config.dataDir` (e.g. `demo.test.mjs` without config), `ctx.media` returns `null` and builders skip media.
- Demo builders write rows directly. **They never call `emit`, `sendMessage`, `notifyCoach` or `notify`**, and never call a helper that does.
  All dates are relative to `today`. The world must look alive on any weekday (see the Monday trap).
- Tests (WP0-S, `demo-features.test.mjs`, which loads every feature through `helpers.mjs`): `buildDemo` twice on consecutive days succeeds;
  `SELECT COUNT(*) FROM events` is unchanged by a build and no drain is pending; the media row count and the file count on disk are the same after both builds;
  a file uploaded by a demo client is gone after the next build.
- `account.mjs` `exportMe` merges `hooks('exportFor')` into its output under `features.<name>`. Erasure stays FK
  cascade plus `eraseMedia`. Features that store files must store them as `media` rows, so `eraseMedia` and the demo wipe remove them.

### 3.11 Name registry (to avoid collisions)

**Per package** (files and prefixes). ID prefixes already used by existing code and therefore **forbidden**:
`af ar b bt c ch cm ex f fr g h i m md n p ph pr pri r s ta tc tf tp u w`.

| Package | Server files | Desk files | ID prefixes | CSS class prefix | Port |
|---|---|---|---|---|---|
| WP0-S | `registry.mjs features.mjs events.mjs facts.mjs templating.mjs notifications.mjs ai.mjs audio.mjs stream.mjs search.mjs ratelimit.mjs rng.mjs` | — | `ev nt tg sg ai dm` | — | 5680 |
| WP0-D | — | `ui.js ui.css charts.js charts.css composer.js composer.css live.js palette.js` + edits | — | `ui- ch- cmp- shell- pal-` | 5680 (5679 before WP0-S merges) |
| WP1 | `features/command.mjs` | `f-command*.{js,css}` | `ib` | `cmd-` | 5681 |
| WP2 | `features/crm.mjs features/onboarding.mjs` | `f-crm*.{js,css} f-onboard*.{js,css}` | `nb os` | `crm- rt- onb-` | 5682 |
| WP3 | `features/billing.mjs features/offers.mjs features/revenue.mjs` | `f-billing*.{js,css} f-offers*.{js,css} f-revenue*.{js,css}` | `iv il py cr rd pk cp cmv bs dc dr rc rf` | `bl- of- rv-` | 5683 |
| WP4 | `features/campaigns.mjs features/guidebook.mjs` | `f-campaigns*.{js,css} f-guidebook*.{js,css}` | `cg cph ca ck ce gb` | `cg- gb-` | 5684 |
| WP5 | `features/automations.mjs features/templates.mjs features/outreach.mjs` | `f-auto*.{js,css} f-templates*.{js,css} f-outreach*.{js,css}` | `au aur mt sm bc` | `au- mt- ob-` | 5685 |
| WP6 | `features/aireview.mjs features/voice.mjs` + owned existing files | `f-ai*.{js,css} f-voice*.{js,css}` + owned existing files | `rv` | `ai- vc-` | 5686 |
| WP7 | `features/calsync.mjs features/diary.mjs` + owned existing | `f-calendar*.{js,css} f-diary*.{js,css}` + owned existing | `cs bb to wl de sn hd` | `cal- dy-` | 5687 |
| WP8 | `features/tasks.mjs features/accountability.mjs features/insights.mjs` | `f-tasks*.{js,css} f-account*.{js,css} f-insights*.{js,css}` | `tk an ps` | `tk- ac- in-` | 5688 |
| WP11 | `features/leads.mjs features/marketing.mjs` | `f-growth*.{js,css}` | `ld la lf ft tm` | `ld- mk-` | 5689 |

**Per feature file: the `namespaces` and `exact` keys** (3.1). Every event, action and fact id a feature declares starts with one of its
namespaces (`<ns>.`) or is in its `exact` list. Copy this table into `server/features/README.md`.

| Feature file | `namespaces` | `exact` |
|---|---|---|
| *foundation (reserved)* | `core message checkin form workout membership letter commitment day tag coach program` | `client.joined client.tagged client.untagged booking.created booking.cancelled` |
| `command` | `inbox command` | — |
| `crm` | `crm lifecycle` | `client.stageChanged client.paused client.resumed client.offboarded` |
| `onboarding` | `onboarding` | — |
| `leads` | `lead` | — |
| `marketing` | `marketing testimonial` | — |
| `billing` | `invoice payment package billing refund` | — |
| `offers` | `offer referral` | — |
| `revenue` | `revenue` | — |
| `campaigns` | `campaign` | — |
| `guidebook` | `guide` | — |
| `automations` | `automation` | — |
| `templates` | `template` | — |
| `outreach` | `broadcast scheduled outreach` | — |
| `aireview` | `ai` | — |
| `voice` | `voice` | — |
| `calsync` | `calendar waitlist hold` | `booking.rescheduled booking.upcoming booking.series` |
| `diary` | `diary session` | `booking.attended booking.noShow booking.lateCancel` |
| `tasks` | `task` | — |
| `accountability` | `accountability` | — |
| `insights` | `pulse insights` | — |

The loader rejects: an id outside these; two features claiming one namespace or one exact id; and a feature claiming a reserved namespace
or a reserved exact id. Adding a namespace later is an edit to this table and to the feature's own file, nothing else.

Tests: `server/test/<feature>.test.mjs` per feature file. API docs: `docs/api/<package>.md` (wp1-command.md, wp2-crm.md, …). WP0-S
pre-creates `docs/api/README.md` and adds an index of all of them to `docs/API.md`.

### 3.12 Icons

WP0-D adds every glyph below to `symbols.js` in one commit. It extends `scripts/export-symbols.mjs` with `--desk` mode, which writes
`server/desk/symbols.js` from the same source: Material Symbols Rounded, weight 300, outline and filled. Packages use raw Material
names in `icon()` and **never edit `symbols.js`**. A glyph a package finds missing goes in its integration requests.

`space_dashboard inbox notifications notifications_active add search keyboard_command_key more_horiz close
drag_indicator undo redo bolt campaign rocket_launch receipt_long payments request_quote sell percent redeem
card_giftcard loyalty view_kanban filter_alt label monitoring trending_up trending_down savings
account_balance_wallet calendar_month event_busy event_available edit_calendar edit_note sticky_note_2 task_alt
checklist local_fire_department mic stop pause play_arrow graphic_eq auto_awesome verified gpp_maybe warning
error schedule_send forum description sync link link_off person_add group handshake heart_broken pause_circle
logout dark_mode light_mode contrast settings open_in_new content_copy upload download print chevron_left
chevron_right expand_more expand_less check done_all snooze archive reply menu_book auto_stories route map
shopping_bag flag timeline star sentiment_satisfied sentiment_neutral sentiment_dissatisfied shield
workspace_premium bar_chart donut_large grid_view hourglass_empty timer alarm inventory_2 tune visibility
visibility_off lock key travel_explore person_search hub science summarize translate psychology monitor_heart
storefront format_quote cake celebration event_repeat how_to_reg mail block approval front_hand`

### 3.13 The AI module (`server/ai.mjs`, WP0-S)

Config (`config.mjs`; tests build config by hand, so a missing key means **stub**):
```
config.ai = {
  key:        env.OPENROUTER_API_KEY || null,
  model:      env.AI_MODEL || null,            // text model id, e.g. chosen by John at deploy time
  audioModel: env.AI_AUDIO_MODEL || null,      // an audio-capable model id
  dailyCalls: Number(env.AI_DAILY_CALLS ?? 300),        // per coach, TEXT calls only (review, draft, summary, brief)
  dailyAudioSeconds: Number(env.AI_DAILY_AUDIO_SECONDS ?? 7200),   // per coach, audio only: voice can never starve F18 reviews
  clientDailyNotes: Number(env.AI_CLIENT_DAILY_NOTES ?? 20),       // per client: voice notes transcribed per London day
  clientDailyAudioSeconds: Number(env.AI_CLIENT_DAILY_AUDIO_SECONDS ?? 1800),
  disabled:   env.AI_DISABLED === '1',
  baseUrl:    'https://openrouter.ai/api/v1',
}
config.ffmpegPath = env.FFMPEG_PATH || 'ffmpeg'
```

```sql
CREATE TABLE IF NOT EXISTS ai_calls (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,             -- review|draft|summary|brief|transcribe|analyse|...
  provider TEXT NOT NULL,            -- stub|openrouter
  model TEXT, ok INTEGER NOT NULL, error TEXT,
  input_tokens INTEGER, output_tokens INTEGER, audio_seconds REAL, ms INTEGER, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_calls_coach_at ON ai_calls(coach_id, at);
CREATE TABLE IF NOT EXISTS ai_settings (
  coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  review_mode TEXT NOT NULL DEFAULT 'ask' CHECK (review_mode IN ('off','ask','always')),
  transcribe INTEGER NOT NULL DEFAULT 1, analyse INTEGER NOT NULL DEFAULT 1, drafts INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL);
```
`ai_calls` stores **metadata only**: no prompts, no outputs.

API (JS):
```js
aiInfo(db, config, user) → { provider: 'stub'|'openrouter'|'off', model, audio: bool, reason }
  // 'openrouter' iff config.ai.key && config.ai.model && !config.ai.disabled && !user.is_demo && ai_settings.enabled
  // 'off' iff ai_settings.enabled = 0;   audio iff provider openrouter && config.ai.audioModel && ffmpeg available
  // `user` is ALWAYS the coach row. A clock with no request user loads the coach (users WHERE id = client.coach_id) and treats
  // client.is_demo || coach.is_demo as stub. Passing a client row is a bug (it has no ai_settings and would be charged to the client).
complete(db, config, { user, clientId, purpose, system, prompt, schema = null, maxTokens = 900, temperature = 0.2, stub })
  → Promise<{ text, json, provider, model, usage, ms }>
listen(db, config, { user, clientId, purpose, audioPath, durationSec, system, prompt, schema, stub })
  → Promise<same>   // converts audioPath with audio.toModelMp3() then sends input_audio
redactForAi(text, { surname }) → text   // applied to ALL text built from client data before complete() or listen()
```
- **Redaction.** `redactForAi` replaces e-mail addresses (`[email]`), UK and international phone numbers (`[phone]`), URLs (`[link]`),
  UK postcodes (`[postcode]`) and the client's surname, case-insensitive on word boundaries (`[surname]`). Every prompt builder that includes client
  text (thread messages, check-in notes, transcripts, profile fields) calls it. Audio cannot be redacted and is sent as recorded (6.3).
  Test: one message containing each pattern comes out with every placeholder and none of the originals.
- **Budgets.** Text and audio budgets are separate, per coach (`dailyCalls`, `dailyAudioSeconds`). Voice also has per-client budgets
  (`clientDailyNotes`, `clientDailyAudioSeconds`). `ai_calls.audio_seconds` is charged with the **probed** duration (3.14), never the client's figure.
  Over a budget the caller does not fail: the voice row becomes status `off` with reason `quota` (F19), and text features answer 429 "AI limit reached for today".
- `stub` is a **required** function `(input) → {text}` or `{json}`. Each feature writes a deterministic stub that reads as plausible and
  starts its visible text with `[Stub]` or carries `provider:'stub'`. The stub never calls the network.
- OpenRouter request:
  - `POST {baseUrl}/chat/completions` with `Authorization: Bearer <key>`, `HTTP-Referer: <publicUrl>`, `X-Title: JK Performance`.
  - Body: `{model, messages:[{role:'system', content: system}, {role:'user', content:[{type:'text', text: prompt}, …(audio? [{type:'input_audio', input_audio:{data:<base64 mp3>, format:'mp3'}}])]}], max_tokens, temperature, response_format?, provider}`.
  - `provider` is always `{data_collection:'deny'}`, plus `zdr:true` if WP0-S confirms the field exists, plus `require_parameters:true` whenever a
    `schema` is set (otherwise OpenRouter may route to an endpoint that silently ignores `response_format`, and parsing fails intermittently).
  - With `schema`, send `response_format:{type:'json_schema', json_schema:{name: purpose, strict:true, schema}}`, and **also** say in the prompt
    "Reply with JSON only", then parse defensively (strip code fences, take the first `{…}`). Validate the result against
    the schema's required keys, and treat a mismatch as an error.
  - If the model answers **400** to `json_schema` (common for audio models), retry **once** with `response_format:{type:'json_object'}` and the schema
    pasted into the prompt, and record `error:'downgraded:json_object'` on that `ai_calls` row.
  - If OpenRouter reports that no endpoint meets the provider constraints (a 404/400 naming the data policy or no allowed providers), raise
    `AiError('provider')`, shown as "AI unavailable: no provider meets the privacy settings". **Never** relax the privacy settings and never fall back to the stub.
  - Timeouts: 45 s for text, 120 s for audio. All HTTP goes through `config.fetchImpl`, so tests can fake it.
- Errors: a typed `AiError` (`quota`, `timeout`, `provider`, `invalid`) is recorded in `ai_calls`. **There is no silent fallback to the stub when
  OpenRouter was expected.** The caller shows "AI unavailable: <reason>".
- Concurrency: at most 2 text calls and 1 audio call at once, process-wide (a small semaphore). Daily per-coach caps come from `ai_calls`.
- `GET /api/ai/status` → `{provider, model, audio, reviewMode, enabled, usedToday:{calls, audioSeconds}, limits}` (coach).
- `PUT /api/ai/settings {enabled?, reviewMode?, transcribe?, analyse?, drafts?}` → settings (coach).

**Uncertainty, to check at build time** (unverified from memory; WP0-S checks each against OpenRouter's current docs and writes what it found,
with the date, in `docs/api/README.md`):
- (a) `input_audio` formats: `wav` and `mp3` are the documented baseline; some models take `ogg`, `aac` or `flac`. We send mp3, 16 kHz mono, 32 kbps.
- (b) which model ids accept audio (Gemini 2.x Flash/Pro class, or `gpt-4o-audio` class); John picks `AI_AUDIO_MODEL`.
- (c) `response_format` `json_schema` support for the chosen models, and whether `require_parameters` is still the field that enforces it.
- (d) the exact name of the provider data-policy field (`provider.data_collection: 'deny'`), and whether `provider.zdr: true` (zero data retention) exists.
- (e) whether, with deny/ZDR set, any audio-capable endpoint remains for the chosen `AI_AUDIO_MODEL`. If none does, transcription surfaces as
  `AiError('provider')` (above) and John picks another model.

Anthropic Claude models do not take audio input, so the audio model is necessarily another vendor's model, which the privacy text must name (6.3).
Nothing in the tests depends on these points: the stub and the fake `fetchImpl` cover them.

### 3.14 Audio tools (`server/audio.mjs`, WP0-S)

ffmpeg runs on bytes uploaded by clients, including through the public demo codes, so it is treated as hostile-input processing.
- `ffmpegAvailable(config)` → bool. It runs `ffmpeg -version` once, cached.
- `sniffAudio(bytes)` → `'mov'|'matroska'|'ogg'|'mp3'|'wav'|null` from magic bytes only (`ftyp` at offset 4 → `mov`, but **not** when the major brand is
  `heic`, `heix`, `mif1` or `msf1`; EBML `1A 45 DF A3` → `matroska`; `OggS` → `ogg`; `ID3` or an MPEG frame sync `FF Ex/FFx` → `mp3`; `RIFF….WAVE` → `wav`).
  The label (`content-type`, `blob.type`, which can be empty) is never trusted.
- `probe(path, fmt)` → `{seconds, hasAudio}` from ffmpeg's stderr (`Duration:` and an `Audio:` stream line).
- `toM4a(inPath, outPath, {fmt, capSec})`: `-nostdin -hide_banner -protocol_whitelist file -f <fmt> -i <in> -t <capSec+2> -map 0:a:0 -vn -sn -dn
  -map_metadata -1 -c:a aac -b:a 64k -ac 1 -movflags +faststart -f mp4 <out>`.
- `toModelMp3(inPath)` → a temp path: the same input flags, then `-vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 32k -f mp3`. The caller deletes it.
- The input format is **always passed explicitly** (`-f`), so crafted input cannot select demuxers such as `hls`, `concat` or `image2` that open other files or URLs,
  and `-protocol_whitelist file` blocks network protocols outright. The output format is fixed.
- Every run uses `spawn(config.ffmpegPath, args, {stdio})` with an argument array (never a shell) and a 60 s timeout (SIGKILL).
- Files live in `<DATA_DIR>/tmp/audio` (mode 0700) with random names, are deleted in `finally`, and stale files (older than 1 h) are swept at start-up.
- **Queue:** one process at a time; at most **4 waiting jobs**, after which the caller gets 503 "Busy, try again in a minute".
- **Per-user upload caps** for purposes `voice` and `letter` (checked in `media.mjs`, WP6): 30 uploads or 50 MB per London day per user (429
  "That's a lot of voice notes today"); demo users 5 uploads and 60 s each.
- Test: a playlist-looking file (`#EXTM3U`), a mismatched-magic file and a file with no audio stream are each refused **before or by** the probe, never converted.
- Dockerfile (WP0-S): `RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*` before `USER node`.
  Keep the base digest pin. The apt layer installs a floating trixie version, so the image is no longer bit-reproducible: record the installed
  `ffmpeg -version` line, the image size before and after (a few hundred MB more, disk only) and the peak RSS of a 300 s conversion measured inside the
  container's 512m limit, all in `docs/api/README.md`.

### 3.15 Other foundation helpers

- `server/ratelimit.mjs`: `limit(key, {max, perMs})` → bool. In-memory sliding window, used by the public enquiry form and AI endpoints.
- `server/search.mjs`: `GET /api/search?q=&types=&limit=20` (coach).
  - It merges the built-ins (clients by name or email, message text, programs, forms) with `hooks('search')`.
  - The result is `{results:[{type, id, title, detail, path, icon, score, at?}]}`, sorted by score and then recency. `q` must be at least 2 characters.
  - Matching is `LIKE '%q%'` with LIKE escaping. Every query is scoped by coach.
- `access.mjs` adds `ownRow(ctx, table, id)` and `isDemo(ctx)`. `ownRow` checks `table` against a whitelist regex `^[a-z_]+$`.
- `store.mjs` exports `addColumn`.
- `store.mjs` adds `messages.updated_at TEXT` via `addColumn` and backfills `updated_at = at` lazily (NULL is read as `at`).
- `messages.mjs` `list` accepts `since=<iso>`. It returns `updated:[messageOut]` for messages in the thread with
  `COALESCE(updated_at, at) >= since`, plus `cursor` = the greatest `COALESCE(updated_at, at)` in the thread, read in the **same statement**
  (never wall-clock now, which could skip a write committed between the query and the cursor). Clients de-duplicate by id. Old clients ignore both keys.
- `server/rng.mjs`: `rng(seed)` → a seeded PRNG function (mulberry32), for demo builders (3.10).
- `GET /api/coach/badges` (WP0-S) → `{badges:{[navId]: n}}`, the merge of `hooks('badges')` (3.16).
- `server/test/helpers.mjs`: `makeWorld({config?})` → `{db, config, base, call, signIn(sub, email), coach, client, settle(), close}`.
  It contains the fake Apple JWKS, and `settle()` drains events. New tests use it, and old tests stay as they are.

### 3.16 What WP0-D changes in the desk shell

- `main.js`:
  - the shell is rewritten per 1.3: the grouped sidebar from `registerNav`, the rail, the glass top bar, breadcrumbs, the palette, quick-create,
    the bell with its slide-over list, the AI chip, the avatar menu with theme, the keyboard map, and the More sheet on mobile;
  - live updates start through `live.js`;
  - existing nav entries are registered with the new icons;
  - badges come from one `GET /api/coach/badges`. Refreshes are **coalesced**: at most one request per 2 s window, triggered only by live
    events whose type is in some nav item's `badgeOn`, plus every 60 s. A broadcast to 20 clients therefore costs one request, not hundreds;
  - foundation endpoints are probed once through `GET /api/coach/capabilities`; a 404 from any foundation endpoint means "absent" and is never
    logged as an error, so the shell runs quietly against a server without WP0-S.
- `core.js`: the registries (3.9), `toast` with undo, `setCrumbs`, `prefs`, and the `live` re-export. Every existing export is kept, with the same signature.
- `app.css`: the tokens (2.2), the restyled shell, the restyled base components (`.card` becomes a tile look, plus `.btn`, `.pill`, `.tabs`, `.segmented`, `dialog.sheet`), and the type classes.
- `guides.js`: the `/account` screen becomes `/account/:section?`, with a left section list made of the existing sections plus `registerSettingsSection`.
- `ui.js/.css`, `charts.js/.css`, `composer.js/.css`, `live.js`, `palette.js`: new.
- `desk.mjs`: the `features.js` virtual module and the fixed `STYLES` order (3.9). The CSP is unchanged, which is enough for streaming fetch, `blob:` audio and `getUserMedia`.
- `clients.js`, `today.js`, `messages.js`: the minimal registry hosts and the real `threadPane` (3.9).
- `desk.test.mjs`: the new modules, `features.js`, and the `--accent:#C8A970` check is kept.
- A reference screen proving the kit: `/account/kit` (only when `?kit=1` is in the hash). A living style guide of every component in both themes.
  WP-Z removes it from the nav, but keeps it.

---

## 4. Features

Every feature has a user story, screens, tables, API, events, demo data and tests. "Coach" endpoints call
`requireCoach`. "Client" endpoints act on `ctx.user` as a client. All bodies are JSON unless stated otherwise.

### Command (WP1)

#### F1 Command Centre (`/today` as a bento)
**Story.** As JK, I open the desk and in five seconds I know who needs me, what is on today, what money is due and
what is slipping, and I can act on each without leaving the page.

**Screen.**
- Header: the eyebrow is the date ("Monday 24 November"). The display line is "Good morning, *JK*" (the italic word is in the accent colour). The brief line is
  "4 people need you · 6 sessions · £360 due". The actions are **Brief me** (AI) and **Customise**.
- Bento tiles, all from `registerWidget`; WP1 owns the first five:
  - `needs` (l, tall, hero): the existing Needs-you list, restyled, with an inline action button per row (Reply, Write letter, Nudge…). It opens the client slide-over.
  - `today-sessions` (m): the next sessions as a mini timeline, with conflict badges (from the F20 `calendar.conflict` facts when present).
  - `inbox` (s): the count by kind, and a link.
  - `letters` (s): letters due this week, with the existing toggle.
  - `activity` (m): the live activity feed from `eventsFor`. It gets new rows through `live.on('*')` with a flash.
  - Other packages add: `revenue` (WP3, s), `overdue` (WP3, s), `at-risk` (WP2, s), `onboarding` (WP2, s), `renewals` (WP2, s), `pipeline` (WP11, s), `diary` (WP7, m),
    `conflicts` (WP7, s), `tasks` (WP8, s), `accountability` (WP8, m), `campaigns-live` (WP4, m), `scheduled` (WP5, s), `voice-review` (WP6, s).
- Customise mode: drag to reorder, a size menu, an eye toggle, and Reset. It is saved in prefs `desk.today.layout`.
- Brief me opens a slide-over with a 5-bullet morning brief. The server builds it from counts and Needs-you texts (first names only), via `ai.complete`
  with purpose `brief`. The stub produces the same bullets from templates, labelled "[Stub] Brief".

**API.**

| Method | Path | Response |
|---|---|---|
| GET | `/api/command/summary` | `{needs:n, sessionsToday:n, inbox:n, lettersDue:n}` (dueMoney comes from the WP3 widget, not here) |
| GET | `/api/command/activity?before=<seq>&limit=30` | `{items:[{seq, type, at, summary, client:{id,name,initials}\|null, path}]}` |
| POST | `/api/command/brief` | `{bullets:[string], provider, model, at}` |

**Events.** Consumes `*` (activity feed); emits nothing.

**Demo.** Nothing new. The tiles read existing demo data. WP1 checks that every tile is non-empty for the demo coach.

**Tests.**
- The summary counts match the needs-you output.
- Activity is coach-scoped: a second coach's events are never returned.
- `before` paging works.
- The brief uses the stub when no key is set and is labelled.
- Demo coach → stub even with a fake key in config.

#### F2 Command palette, global search and keyboard shortcuts
**Story.** As JK, I press ⌘K and type "sam inv" to land on Sam's latest invoice, or "book" to book a session, without the mouse.

**Screen.** The palette as in 1.3:
- **Jump to**: every registered nav item plus its tabs.
- **Clients**: local fuzzy match on `state.clients`, with the client's lifecycle stage and health score if facts are present.
- **Actions**: `registerCommand` plus `registerClientAction` × the matched client ("Message Sam", "Invoice Sam", "Enrol Sam…").
- **Results**: server `/api/search` (debounced 150 ms) across messages, transcripts, invoices, leads, campaigns, tasks, notes and diary.

The `?` overlay lists the shortcuts. WP0-D builds the palette shell and the shortcuts. WP1 adds the local fuzzy scorer
(`f-command-search.js`: a subsequence match plus a word-start bonus plus a recency bonus) and the results renderers.

**Search provider contract** (each feature's `search` hook):
`[{type:'invoice', id, title:'JK-2026-0012 · Sam Carter', detail:'£120 · overdue 3 days', path:'/billing/invoices/iv_x', icon:'receipt_long', score:0–1, at}]`.

**Tests.**
- `/api/search` merges the built-ins and the hooks.
- `q` shorter than 2 characters gives a 400.
- Coach scoping, and LIKE wildcards in `q` are escaped (searching `%` does not match everything).
- The demo coach sees only demo rows.

#### F3 Notification centre and live updates
**Story.** As JK, I see a bell count go up when something important happens (a pain flag, a payment, a lead, a voice note
with a risk flag, a cancelled session), even when I'm on another screen. I can catch up in one list.

**Screen.**
- The bell (WP0-D) opens a slide-over with the tabs Unread and All. Rows show an icon, title, body, client avatar and relative time, and clicking one goes to its path and marks it read.
  There is also "Mark all read".
- Settings › Notifications (WP1, `registerSettingsSection`) has a toggle per kind.

**WP1 adds default event → notification handlers** in `features/command.mjs`, each controlled by prefs `notify.<kind>` (default on):

| Event | Notification |
|---|---|
| `client.joined` | "New client: Ella Hughes" |
| `booking.cancelled` with `byRole=client` | "Sam cancelled Tue 07:00 (late)" |
| `form.submitted` with `flagged>0` | "Health flag on PAR-Q: Priya", tone urgent |
| `checkin.submitted` with `pain` | "Pain reported in check-in: Tom", tone urgent |

Urgent notifications also push to the coach's phone (3.3). Settings › Notifications carries the `notify.push.urgent` toggle and the coach's quiet hours.

Other packages notify for their own events (lead.created, payment.recorded, voice.flagged, calendar.conflict, task.due …) by calling `notifyCoach` themselves.

**Tables.** None beyond 3.3. Preferences live in `coach_prefs` (`notify.prefs` = `{kind: bool}`).

**Tests.**
- Each handler creates exactly one notification (dedupe works).
- Turning a kind off suppresses it.
- The read and count endpoints work.
- The stream receives `notification` (a test reads the first chunk with a fetch reader, then aborts).

#### F4 Unified Inbox (`/inbox`)
**Story.** As JK, I triage everything clients send me (messages, voice notes, form answers, check-ins, flags, AI drafts
and drafts routed to me for approval, new leads) in one keyboard-driven list. I mark things done or snooze them until later.

**Screen.**
- Three panes.
  - **Filters**: All, Messages, Voice, Forms, Check-ins, Flags, Drafts, Leads, Snoozed and Done, each with a count.
  - **List**: rows with an avatar, a kind glyph, a title, a two-line preview and an age. `j`/`k` move, `e` marks done, `s` snoozes (Later today, Tomorrow 07:00, Next Monday, or a picked date), `r` replies, and `x` selects for bulk done.
  - **Detail**: for message and voice items, `threadPane(el, clientId)` from `messages.js` with the composer. For forms and check-ins, a review view with "Mark reviewed" calling the existing review endpoints.
    For providers' items, a generic card with the item's actions.
- An empty state ("Inbox zero. Go coach someone.") with a serif title.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS inbox_state (
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,              -- '<kind>:<id>' e.g. 'thread:cl_abc:msg_last', 'form:fr_x', 'voice:msg_y'
  client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('done','snoozed')),
  snooze_until TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (coach_id, item_key));
```
- A thread item's key includes the newest client message id, so a new message reopens a thread that was marked done.
- Snoozed items come back after `snooze_until`.
- Rows for items that are gone are deleted after 60 days.

**Inbox provider contract** (`inbox` hook):
`[{key, kind:'message'|'voice'|'form'|'checkin'|'flag'|'draft'|'lead'|'waitlist'|string, clientId|null, title, preview, at, icon, tone, path, actions:[{id, label, method, url, body?}]}]`.
- The aggregator drops items whose state is done (with the same key) or snoozed (until passed).
- `actions` run through `api(method, url, body)` from the desk. They are coach endpoints owned by the provider.

**API.**

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/inbox` | `?filter=all\|message\|…\|snoozed\|done&limit=50` | `{items:[…], counts:{all, message, voice, form, checkin, flag, draft, lead, snoozed}}` |
| POST | `/api/inbox/state` | `{keys:[…], status:'done'\|'snoozed'\|'open', until?}` | `{ok}` (emits `inbox.done` for each) |

**Core providers (WP1):**
- unread client threads (`thread:`);
- submitted form requests not yet reviewed (`form:`);
- check-ins not yet reviewed (`checkin:`);
- needs-you `pain` reasons (`flag:`).

**Tests.**
- Every core kind appears.
- Done hides an item, and a new message makes the thread reappear.
- Snooze hides until the time passes (inject `now` through the query param `at`, accepted only when `config.testNow` is allowed: use a helper).
- Coach isolation.
- A provider hook with a throwing function does not break the inbox.

### Clients and lifecycle (WP2)

#### F5 Client 360 and health score
**Story.** As JK, opening a client shows me in one glance how they are doing (a health score with its reasons), where they are in their
lifecycle, what they've paid and owe, their tags, what's next, and everything that has happened, with every action one click away.

**Screen.** `/clients/:id/:tab?`, owned by WP2, which rewrites `clients.js`, `overview.js` and `clients.css`.
- **Hero header**:
  - a large avatar and the name in serif;
  - pills for the lifecycle stage, the plan, and tags (with `tagPicker` inline);
  - a `scoreRing` with the health band word, with a hover popover of factors ("Adherence 82 · Quiet 1 day · Kept 2/3 commitments");
  - stat chips from facts when present: Balance (`billing.balance`), Credits left (`billing.credits`), LTV (`billing.ltv`), Next session, Campaign;
  - small state chips: **AI consent** (`Voice AI: allowed` / `not asked` / `declined`, from `GET /api/coach/clients/:id/ai-consent`, WP6) and
    **Outreach** (`Outreach paused`, `No broadcasts`, from 3.4's endpoint; the chip opens the two toggles);
  - an optional **birthday** (day and month only, coach-entered, stored in `client_lifecycle.birthday` as `MM-DD`);
  - quick actions from `registerClientAction`: Message, Voice note, Book, Invoice, Enrol, Add task, Add note, Pause, End coaching.
- **Tabs**:
  - Overview (existing content, regridded as a bento);
  - **Timeline** (new);
  - Plan, Letters, Sessions, Progress, Health (existing);
  - tabs registered by other packages: Billing (WP3), Campaigns (WP4), Voice (WP6, the transcripts list), Notes (WP2).
- **Timeline**: a `timeline()` of the events for this client, plus pinned notes, plus `hooks('timeline')` items, with infinite scroll and a filter by kind.
- **Notes**: private coach notes, with pin, edit and delete. They are never shown to the client.
- Overview carries an **Onboarding** card (F27) while the checklist is incomplete.
- Clients list `/clients`:
  - a `dataTable` with the columns name, stage, health (a ring), onboarding (`4/7` with a mini bar, blank once complete), plan, last active, next session, balance, tags;
  - views: All, by stage, by segment (pinned segments as chips);
  - multi-select and bulk actions (`registerBulkAction`): tag, message (opens the WP5 broadcast composer prefilled), enrol (WP4), start automation (WP5), export CSV (client side, from a Blob).

**Health score** (`crm.health`, 0–100). It is computed nightly at 04:30 London and on demand for one client, and stored per day:
```
engagement  (30) = min(1, (client messages 14d + check-ins 14d ×3 + habit days met 14d / 2 + sessions attended 14d ×3) / 12)
                   // sessions attended = core.sessionsAttended14 (3.4): in-person clients score on attendance, not only app use
adherence   (30) = core.adherence28 / 100           (null → 0.5)
consistency (20) = min(1, minimumStreak / 14)
wellbeing   (20) = 1 − 0.5×pain14 − 0.25×(missed commitments 4w / max(1, set commitments 4w)) − 0.25×(voice sentiment < −0.3 in 14d)
score = round(100 × weighted sum)   bands: ≥75 Thriving (on-track) · 50–74 Steady (data) · 30–49 Watch (attention) · <30 At risk (urgent)
trend = score − score 14 days ago
```
- The voice sentiment comes from the fact `voice.sentiment14` if present, and is otherwise ignored (that term counts as 0).
- Overdue money is deliberately **not** in the health score; it shows separately.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS client_scores (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, health INTEGER NOT NULL, band TEXT NOT NULL, factors TEXT NOT NULL,  -- JSON {engagement, adherence, consistency, wellbeing, notes:[…]}
  PRIMARY KEY (client_id, day));
CREATE TABLE IF NOT EXISTS client_notes (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS client_notes_client ON client_notes(client_id, created_at);
```
Notes use the id prefix `nb`. Scores older than 400 days are pruned.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/coach/clients/:id/score` | none | `{health, band, trend, factors, series:[{day, health}] (90 d)}` |
| GET | `/api/coach/clients/:id/timeline` | `?before=<iso>&limit=50&kinds=` | `{items:[{at, kind, icon, tone, title, detail, path}], next}` |
| GET/POST | `/api/coach/clients/:id/notes` | `{body, pinned?}` | `{notes}` / `{note}` |
| PATCH/DELETE | `/api/coach/clients/:id/notes/:noteId` | `{body?, pinned?}` | `{note}` / `{ok}` |
| GET | `/api/crm/clients` | none | `{clients:[{id, name, initials, plan, stage, health, band, trend, lastActiveAt, nextSessionAt, tags}]}` (the list view; `/api/coach/clients` stays for old callers) |

**Facts.** `crm.health` (number), `crm.band` (enum), `crm.trend` (number), `crm.stage` (enum, F7).

**Events.**
- Emits `crm.bandChanged {from, to, health}` when the nightly band differs from yesterday's.
- Consumes `day.started` to compute the scores.

**Demo.** The 6 demo clients each get 90 days of `client_scores` with plausible trajectories:
- Sam: Thriving, rising.
- Priya: Steady.
- Tom: Watch, falling (with a pain flag).
- One At risk.
- Notes: 2–3 per client.

**Tests.**
- The score formula on a fixture.
- An in-person-only fixture (two attended sessions a week, no app activity for 35 days) scores at least Steady and stays **Active** (F7).
- The band boundaries.
- Isolation: no notes or scores for a foreign client (404).
- The timeline merges events, notes and a hook.
- Notes are included in that client's GDPR export under `features.crm.notes` (they are personal data about the client), and appear in no other
  client-facing endpoint (`/api/timeline`, `/api/messages`, `/api/me`).

#### F7 Lifecycle stages, tags and segments
**Story.** As JK, every client sits in a clear stage: Onboarding, Active, At risk, Paused, Churned or Alumni. I can tag people and save
segments ("Performance clients quiet for 5+ days"), and use them everywhere: broadcasts, automations, campaigns, filters.

**Lifecycle rules** (the nightly `crm.lifecycle` clock, run after the scores; a manual override sticks until it is cleared):
- **Onboarding**: the F27 checklist is not complete (`onboarding.pct < 100`) and the client joined less than 60 days ago. A client joined before
  desk v2 with no checklist row counts as complete. Completing the checklist moves the client to Active the same night, or at once on the event.
- **Active**: the default.
- **At risk**: health below 35, or `core.daysQuiet` of 10 or more (attended sessions count as activity, 3.4), or a trend of −20 or worse.
- **Paused**: `paused_until` is in the future (F8).
- **Churned**: set **only** by the End coaching flow (F8). The rule "plan `none` for 14+ days after having a plan, or quiet for 30+ days"
  only **suggests** it: a needs-you reason (rank 6, "Looks like Tom has stopped: quiet 34 days. End coaching or check in?") with the actions
  End coaching and Check in. It never changes the stage, billing or anything else by itself.
- **Alumni**: set manually, or by End coaching with exit reason "goal reached", or churned for 90+ days with that reason.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS client_lifecycle (
  client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('onboarding','active','atRisk','paused','churned','alumni')),
  since TEXT NOT NULL, manual INTEGER NOT NULL DEFAULT 0,
  paused_until TEXT, pause_reason TEXT, paused_at TEXT,
  exit_reason TEXT, exit_note TEXT, ended_at TEXT,
  birthday TEXT,                                 -- 'MM-DD' only, coach-entered, optional
  churn_suggested_at TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lifecycle_history (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS lifecycle_history_coach ON lifecycle_history(coach_id, at);
```

**Screens.**
- `/segments`: a list of saved segments with live counts, and an editor with the `ruleBuilder`, a live member preview and pin-to-clients-list.
  Built-in starter segments are shown as suggestions:
  - "Quiet 5+ days";
  - "Performance & Elite";
  - "At risk";
  - "New this month";
  - "No session booked";
  - "Owes money" (uses `billing.balance` if that fact exists);
  - "Upgrade candidates": `core.plan = foundation` and `core.adherence28 ≥ 80` and `crm.health ≥ 75` (or `performance` with the same numbers, toward `elite`);
  - "Stuck in onboarding" (`onboarding.stuckDays ≥ 5`, F27).
- Tags are managed inline in the client hero and in a bulk action. Settings › Tags lets the coach rename, recolour and delete them.
- The stage pill in the client hero is a menu: set a stage manually, clear the override, or open the history.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/coach/clients/:id/lifecycle` | none | `{stage, since, manual, pausedUntil, exitReason, history:[…]}` |
| PUT | `/api/coach/clients/:id/lifecycle` | `{stage?, manual?:bool, exitReason?, exitNote?}` | same |
| GET | `/api/crm/stages` | none | `{counts:{[stage]:n}}` |

Tags and segments use the foundation endpoints in 3.4.

**Facts.** `crm.stage` (enum), `crm.daysInStage` (days), `crm.birthdayInDays` (days until the next birthday, `null` if none set),
`crm.daysSinceEnded` (days since End coaching, `null` otherwise).

**Diary hook.** Birthdays (`cake`) and coaching anniversaries (`celebration`, from `core.anniversaryInDays`) on their day.

**Variables.** `{birthdayDay}` ("Fri 12 Dec").

**Events.** Emits `client.stageChanged {from, to, manual}`. Automations commonly trigger on it.

**Demo.** Every demo client gets a stage that matches its score story. History rows cover the last 60 days. Tags: "Morning crew", "Marathon 2027", "Returning from injury". Segments: 3 saved, 1 pinned.

**Tests.**
- Each automatic rule, including Onboarding → Active on checklist completion.
- The churn rule creates a suggestion (needs-you reason) and **does not** change the stage, a schedule or an enrolment.
- An in-person-only client (attended sessions, no app activity) is never At risk on quietness.
- A manual override survives the nightly run until it is cleared.
- The history is appended once per change.
- Isolation.
- Segment preview counts match the rules evaluation.

#### F8 Retention radar, renewals, pause, end coaching and win-back
**Story.** As JK, I see who is slipping before they leave, and why, and whose package, campaign or fixed term is about to run out. I can pause a
membership instead of losing someone. When someone does leave, I end their coaching properly in one place (final bill, schedules, packages,
campaigns, automations, a goodbye), record why, and later run a win-back play.

**Screen.** `/retention/:tab?`, tabs **Radar**, **Renewals** and **Ended**:
- **Radar**: three columns (Watch, At risk, Churn suggested). Each card shows the score trend sparkline, the top 2 factor reasons, days quiet, last contact and the suggested play.
- **Renewals**: one list, soonest first, of what is about to run out in the next 30 days:
  - packages with `billing.packageExpiresDays ≤ 21` or `billing.credits ≤ 1`;
  - billing schedules with an `ends_on` in the window (from `GET /api/billing/schedules?endingWithin=30`, WP3; hidden if absent);
  - campaign enrolments ending in the window (from `GET /api/campaigns/ending?days=30`, WP4; hidden if absent);
  - and an "Upgrade candidates" strip (the F7 starter segment). Each row has Renew/Offer (opens the composer with a `winback`/`billing` template, or `offer.issue`).
- **Ended**: clients ended in the last 12 months, the exit reasons donut, churn by month (bars), saves (at risk → active within 30 days), and a
  "Win back" button per person.
- **Plays**:
  - "Check in" opens the composer with a template from category `winback` (from WP5's templates if present, else a built-in text).
  - "Offer" applies the action `offer.issue` if the billing feature registered it, else the button is hidden.
  - "Pause" opens a dialog with the pause length (2–12 weeks) and a reason.
  - "End coaching" opens the flow below.

**Pause.** `POST …/pause` sets `client_lifecycle.paused_until` and `paused_at`, emits `client.paused {until, reason, days}`, and on resume (manual or automatic at
`paused_until`) emits `client.resumed {pausedDays}`. Consumers:
- billing (WP3) pauses and resumes recurring schedules, and **extends `expires_on` of active `client_packages` by the pause length** on resume (logged as a
  `credit_moves` row with delta 0 and reason `pause:+<n>d`);
- campaigns (WP4) mark active enrolments `paused` (no nudges, pace frozen, end date pushed by the pause length on resume);
- accountability and needs-you hooks skip paused clients; the automation engine defers runs (F15).

**End coaching** (`client.offboarded`). A slide-over wizard, from the Client 360 header, the Radar card, or a churn suggestion. It gathers, then commits in one request:
1. **Money**: the outstanding balance (`billing.balance`). Choose **Final invoice** (issue the open drafts, or raise one), **Write off** (a credit note for the balance,
   reason "Write-off at end of coaching"), or **Leave as is** (dunning continues only if "Keep chasing" is ticked).
2. **Recurring schedules**: each active one is listed and ended (`ends_on = today`).
3. **Packages**: each active one with credits left: **Expire** or **Refund** (a credit note for the unused share at the package's unit price; the coach records the money
   paid back as a refund, F9).
4. **Campaign enrolments**: dropped (no further nudges or fees).
5. **Automation runs and scheduled messages**: active runs stopped, scheduled and deferred messages cancelled.
6. **Exit reason** (required: cost, time, injury, results, moved, coachFit, goalReached, other) and a note.
7. **Exit survey** (optional): sends a short F25-style form ("What could JK have done better?") through `form.send`, if the coach ticks it.
8. **Farewell message** (optional): a `winback`/`general` template, previewed and sent through the composer by the coach (`via:'coachAction'`).
- The server writes the lifecycle stage (`churned`, or `alumni` for goalReached), `ended_at`, the exit reason, and emits
  `client.offboarded {exitReason, money:'invoice'|'writeOff'|'leave', keepChasing:bool, packages:'expire'|'refund', at}`.
  WP3 (schedules, packages, write-off, dunning pause), WP4 (enrolments) and WP5 (runs, scheduled messages) **consume the event** and do their own part; WP2 never writes
  their tables. The desk shows the result of each step from the event's handlers (`GET /api/coach/clients/:id/offboarding` lists what is still active).
- Ending coaching does **not** change `users.plan` or remove app access: the client keeps their history and can still message JK. Erasure stays the client's own choice.
- "Restart coaching" (manual stage change back to Active) emits `client.stageChanged`; nothing restarts automatically.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/retention` | none | `{watch:[card], atRisk:[card], suggested:[card], stats:{saves90, churn:[{month, n}], reasons:[{reason, n}]}}` |
| GET | `/api/retention/renewals` | `?days=30` | `{items:[{client, kind:'package'\|'schedule'\|'campaign'\|'upgrade', label, on, detail}]}` (merges `hooks('renewals')`, below) |
| GET | `/api/retention/ended` | `?months=12` | `{clients:[{client, endedAt, exitReason}]}` |
| POST | `/api/coach/clients/:id/pause` | `{weeks, reason}` | `{lifecycle}` |
| POST | `/api/coach/clients/:id/resume` | none | `{lifecycle}` |
| GET | `/api/coach/clients/:id/offboarding` | none | `{balancePence?, schedules?, packages?, enrolments?, runs?, scheduled?}` (from `hooks('offboarding')`: each feature lists what it still has active) |
| POST | `/api/coach/clients/:id/end` | `{exitReason, exitNote?, money, keepChasing?, packages, survey?:bool}` | `{lifecycle}` (emits `client.offboarded`) |

`renewals` and `offboarding` are two more hook names (WP3 and WP4 provide `renewals`; WP3, WP4 and WP5 provide `offboarding`).

**Actions registered.**
- `lifecycle.set {stage}` (never `churned`: that needs End coaching).
- `lifecycle.pause {weeks, reason}`.

**Needs hook.**
- A `bandChanged` into At risk gives a reason with rank 6 and the text "Health dropped to 32 (At risk)", with the action Check in.
- A churn suggestion (F7), rank 6.

**Demo.** One paused client (back in 3 weeks). Two ended clients in the last 60 days with reasons (one goalReached → alumni). One save. One churn suggestion.
Two renewals due (a package at 1 credit, a schedule ending in 3 weeks).

**Tests.**
- Pause and resume emit their events with `days`, and the automatic resume happens on the clock.
- Exit reason is required to end coaching; `lifecycle.set` refuses `churned`.
- **An ended client gets no recurring invoice and no dunning step** (WP3's test, driven by `client.offboarded`), unless "Keep chasing" was ticked.
- Ending drops enrolments (WP4's test) and stops runs and scheduled messages (WP5's test).
- The radar groups by band and stage; renewals merge hooks and tolerate a throwing one.
- Isolation.

#### F27 Onboarding checklist
**Story.** As JK, every new client walks a clear onboarding path (health questionnaire, waiver, goal, first program, first session, billing in place,
welcome guide read, app set up). Steps tick themselves as things happen. I see who is onboarding, how far they are, and who is stuck on which step.

**Template.** One per coach (Settings › Onboarding, `registerSettingsSection`): an ordered list of up to 12 steps. Each step is
`{key, label, kind:'event'|'fact'|'manual', event?, where?, fact?, op?, value?, ref?}`. Defaults (editable, reorderable, removable):

| Key | Label | Ticks when |
|---|---|---|
| `parq` | Health questionnaire returned | `form.submitted` whose `formId` = the template's chosen PAR-Q form (`ref`) |
| `waiver` | Terms and waiver agreed | `form.submitted` for the chosen waiver form, or a manual tick |
| `goal` | Goal set | fact `onboarding.hasGoal` (a `goals` row exists; existing table) |
| `program` | First program laid | fact `onboarding.hasProgram` (any `workouts` row for the client; existing table) |
| `booking` | First session booked | `booking.created` for the client |
| `billing` | Billing in place | `invoice.issued`, `package.sold` or `billing.scheduleCreated` for the client (WP3 events; the step is hidden if billing is absent) |
| `guide` | Welcome guide read | `guide.opened` with `guideId` = the chosen guide (F14) |
| `app` | App set up | fact `core.onboarded` |
| `notifications` | Notifications on | fact `onboarding.notificationsOn` (`users.notifications_on`) |

- A checklist starts on `client.joined` (clients who join after the deploy), or by "Start onboarding" on any client. Existing clients have no row and count as complete.
- Event steps tick from the `on` handlers; fact steps are evaluated on each event for that client and nightly. A ticked step stays ticked
  (the coach can untick or tick by hand; `by` records who).
- Completion (every non-hidden step done) emits `onboarding.completed`, which F7 turns into Onboarding → Active.
- **Stalled**: no step ticked for `stallDays` (template setting, default 5) while incomplete emits `onboarding.stalled {days, nextStep}` once per stall.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS onboarding_templates (
  coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  steps TEXT NOT NULL, stall_days INTEGER NOT NULL DEFAULT 5, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS onboarding_clients (
  client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, completed_at TEXT, last_progress_at TEXT NOT NULL, stalled_at TEXT);
CREATE TABLE IF NOT EXISTS onboarding_steps (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL, done_at TEXT NOT NULL, by TEXT NOT NULL DEFAULT 'auto' CHECK (by IN ('auto','coach')),
  PRIMARY KEY (client_id, step_key));
```

**Screens.**
- Client 360 Overview: an **Onboarding** card (progress ring, the steps with ticks, the source of each tick, "Nudge about <next step>" which opens the composer
  with a template, and manual tick/untick).
- Clients list: the Onboarding column (F5). Widget `onboarding` (s): "3 onboarding · 1 stuck", linking to `/clients?stage=onboarding`.

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET/PUT | `/api/onboarding/template` | `{steps, stallDays}` | `{template}` (validated: known kinds, known events and facts from the catalogue) |
| GET | `/api/coach/clients/:id/onboarding` | none | `{started, completedAt, pct, steps:[{key, label, done, doneAt, by}]}` |
| POST | `/api/coach/clients/:id/onboarding` | `{start:true}` or `{step, done:bool}` | same |
| GET | `/api/onboarding` | none | `{clients:[{client, pct, stuckDays, nextStep}]}` |

**Facts.** `onboarding.pct` (0–100, `null` if no checklist), `onboarding.stuckDays` (days since the last tick while incomplete, else `null`),
`onboarding.hasGoal`, `onboarding.hasProgram`, `onboarding.notificationsOn` (bool).

**Events.** `onboarding.stepDone {step}`, `onboarding.completed`, `onboarding.stalled {days, nextStep}`.

**Needs hook.** Stalled → rank 5, "Onboarding stuck 6 days: no health questionnaire", action Nudge.

**Recipe** (WP5): "Onboarding stalled 5 days": on `onboarding.stalled`, send the `welcome` template for the next step and notify the coach.

**Demo.** Two demo clients onboarding: one at 6 of 9, one stuck at 3 of 9 for 7 days. The rest complete.

**Tests.**
- Each default step ticks from its event or fact; an event of another client or coach ticks nothing.
- Completion emits once and moves the stage (with F7).
- Stalled emits once per stall, and again only after new progress and a new stall.
- A client with no checklist row counts as complete (existing clients are never "onboarding").
- Isolation; the export includes the client's steps.

### Growth: leads and marketing (WP11)

#### F6 Leads pipeline and enquiry form
**Story.** As JK, every enquiry (from my enquiry page, a referral link or someone I met at the gym) lands in a pipeline. I move it
from Enquiry to Won with drag and drop, see its value and next step, and when the person signs up in the app they become a client automatically.

**Screens.**
- `/pipeline`: a `kanban` with the columns Enquiry, Contacted, Consult booked, Trial, Won and Lost (Lost collapsed).
  - Cards show the name, source chip, value (£/mo), next-action date (overdue in attention) and age.
  - Column headers show the count and the weighted value.
  - Dragging to Lost asks for a reason (price, timing, location, fit, no reply, other).
  - The top bar has "Add lead", the enquiry form settings and a funnel chart (conversion by stage, last 90 days).
- `/pipeline/:id` (slide-over or full page): details with inline edit, an activity log (note, call, email, stage change) and "Plan consult".
  Leads are not users, so "Plan consult" (and "Plan trial") opens the F21 slot finder in **hold mode** and creates a coach-only **calendar hold**
  (`POST /api/calendar/holds {leadId, kind:'consult'|'trial', start, end, title}`, F20), which blocks the slot for clients and shows on `/schedule`
  and in the diary. It also sets `next_action_on` to the hold's day. If the calendar feature is absent (404), it only sets `next_action_on`.
  - "Follow up" opens the F28 follow-up templates (copy or `mailto:`).
  - "Send app invite" copies the app download/sign-up text with the coach's name.
  - "Convert manually" links a lead to an existing client. On conversion (manual or automatic), if the lead has a `trial` hold in the future,
    the desk offers "Turn the trial into a booking" (`POST /api/calendar/holds/:id/convert {clientId}`, F20).
- Settings › Enquiry form (`registerSettingsSection`): slug, title, intro, the fields to ask (goal, experience, preferred times, budget), active/inactive,
  and a copyable public link `https://jk.strangeramblings.com/enquire/<slug>` with a "referral code supported" note.

**Public enquiry page** (WP11, server-rendered HTML in `features/leads.mjs`, **no JS**):
- `GET /enquire/:slug` (public) serves a page in the site's existing public page style, with its own CSP:
  `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`.
  The CSS is served from `/enquire.css`, also defined in the feature.
- The form has name, email, phone (optional), the chosen fields, a consent checkbox (required; the wording is
  "JK may contact me about coaching. My details are kept for up to 12 months if I don't become a client.") and a honeypot `website`.
  A hidden `ref` is filled from `?ref=`, and a hidden `campaign` from `?campaign=<campaignId>` (F28).
  When `campaign` names a **live, public** campaign of that coach (`campaigns.public = 1`), the page shows its name, dates, tagline and fee above the form
  ("Register interest in January Reset"), and the lead is created with `campaign_id` and `source_detail = 'campaign:<name>'`. Any other value is ignored.
- `POST /enquire/:slug` (public, `rawBody: 8192`, `application/x-www-form-urlencoded`, parsed with URLSearchParams):
  - It is rate-limited to 5 per IP per hour per slug (`cf-connecting-ip` header, else the socket address).
  - The honeypot is checked, the fields are validated, and the lead is created with source `enquiryForm` (or `referral` when `ref` matches a referral code; the
    code is stored, and WP3's handler links the referral).
  - It answers a "Thanks, JK will be in touch within a day" page. A demo coach's slug gives a 403 page.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT, phone TEXT,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual|enquiryForm|referral|instagram|word|event|other
  source_detail TEXT NOT NULL DEFAULT '', referral_code TEXT, campaign_id TEXT,   -- campaign_id: no FK (WP4's table); a stale id is shown as "a past offer" 
  stage TEXT NOT NULL DEFAULT 'enquiry' CHECK (stage IN ('enquiry','contacted','consult','trial','won','lost')),
  position REAL NOT NULL DEFAULT 0, value_pence INTEGER NOT NULL DEFAULT 0,   -- expected monthly value
  answers TEXT NOT NULL DEFAULT '{}', consent_at TEXT,
  next_action_on TEXT, lost_reason TEXT, lost_note TEXT,
  client_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
CREATE INDEX IF NOT EXISTS leads_coach_stage ON leads(coach_id, stage, position);
CREATE TABLE IF NOT EXISTS lead_activities (
  id TEXT PRIMARY KEY, lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,  -- note|call|email|message|stage|created|converted
  text TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lead_forms (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '["goal","experience","times"]', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
```
Stage probabilities for forecasting: enquiry .1, contacted .2, consult .4, trial .6, won 1, lost 0.

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/leads` | `?stage=&q=` | `{leads:[leadOut], totals:{[stage]:{count, valuePence, weightedPence}}}` |
| POST | `/api/leads` | `{name, email?, phone?, source?, sourceDetail?, valuePence?, note?}` | `{lead}` |
| GET | `/api/leads/:id` | none | `{lead, activities}` |
| PATCH | `/api/leads/:id` | any editable field | `{lead}` |
| POST | `/api/leads/:id/move` | `{stage, position, lostReason?, lostNote?}` | `{lead}` |
| POST | `/api/leads/:id/activities` | `{kind, text}` | `{activity}` |
| POST | `/api/leads/:id/convert` | `{clientId}` | `{lead}` (links to an existing own client) |
| DELETE | `/api/leads/:id` | none | `{ok}` (hard delete) |
| GET/PUT | `/api/leads/form` | `{slug, title, intro, fields, active}` | `{form, url}` (slug `^[a-z0-9-]{3,40}$`, unique) |
| GET | `/api/leads/funnel?days=90` | none | `{stages:[{stage, entered, converted}]}` |

**Events.**
- Emits `lead.created {leadId, source, referralCode?, campaignId?}`, `lead.deleted {leadId}` (manual delete and the 12-month purge; WP7 drops the lead's holds), `lead.stageChanged {leadId, from, to}`, `lead.won {leadId, clientId}` and `lead.lost {leadId, reason}`.
- Consumes `client.joined`: it matches open leads of that coach by lower(email), sets `client_id`, moves the lead to won and logs a `converted` activity.
- Each emit carries `coachId`. `client_id` is null until conversion.

**Other hooks.**
- `forecast` (weighted value × probability, spread evenly over the next 60 days).
- `search`.
- `inbox` (new leads in the last 7 days, still at enquiry: key `lead:<id>`).
- A clock that hard-deletes lost or unconverted leads 12 months after `updated_at` (the GDPR promise on the form).

**Demo.** 9 leads across all stages with sources (instagram, referral from Sam, enquiryForm, word), values £80–£200/mo, and activities. A demo lead form with slug `demo-jk`.

**Tests.**
- The public POST creates a lead, and the honeypot or a missing consent is rejected.
- The rate limit gives a 429 page on the 6th post.
- A demo slug gives a 403.
- `client.joined` converts a lead with a matching email, but only for the same coach.
- Move with lost requires a reason.
- Isolation.
- The purge clock deletes after 12 months (injected `now`).
- The enquiry page answers with its CSP header.

#### F28 Marketing: sources, lead follow-ups, testimonials and offer pages
**Story.** As JK, I know which channels bring clients who stay and pay, I follow up every lead with a ready-written note, I capture glowing
feedback as testimonials with the client's permission, and I can put a public offer such as "January Reset" in front of prospects.

**Channel rule (D14).** Leads and lapsed clients are reached by **copy-to-clipboard** and **`mailto:`** buttons only. The server sends no email.

**Screens.** `/marketing/:tab?`, tabs **Sources**, **Follow-ups**, **Testimonials** and **Offers**.
- **Sources**: a table and a bar chart, per `leads.source`, per referral code and per campaign: leads, won, conversion %, median days to win, average LTV of the
  won clients (fact `billing.ltv` when present, else "—") and their revenue over 12 months. A period picker (90 days, 12 months, all).
  `/pipeline` shows the same numbers as a chip row over the board, and `/revenue` Overview shows a "By source" tile from the same endpoint (WP3, hidden on 404).
- **Follow-ups**: the leads whose `next_action_on` is today or past, each with its suggested template; and the template list (per stage:
  enquiry, contacted, consult, trial, lost-reopen). "Follow up" renders the template for the lead and offers **Copy** and **Open in mail**
  (`mailto:<email>?subject=…&body=…`, URL-encoded, shown only when the lead has an email). Either logs a lead activity of kind `email` and moves
  `next_action_on` by the template's `nextInDays`. A suggested cadence (day 1, 3, 7, 14 after enquiry) sets `next_action_on`; nothing is sent.
- **Testimonials**: requests, received quotes and approved quotes. On `pulse.answered` with `score ≥ 9` (F25), an inbox item "Ask Priya for a testimonial"
  (key `testimonial:<clientId>:<surveyId>`) opens the composer with the "testimonial ask" text; the coach sends it (`via:'coachAction'`), and the row becomes
  `requested`. When the client replies, the coach pastes or picks the quote ("Use a message from this thread"), sets the attribution ("Priya, marathon runner")
  and ticks **consent to publish** only with the client's explicit yes, linking that message as evidence. Approved quotes can be copied for the coach's own site
  or socials. Nothing is published by the app.
- **Offers**: live campaigns the coach marks public (`campaigns.public`, F13) with their enquiry link `/enquire/<slug>?campaign=<id>`, a copy button, and the
  interest count (leads with that `campaign_id`).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS followup_templates (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
  next_in_days INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS testimonials (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','received','approved','archived')),
  quote TEXT NOT NULL DEFAULT '', attribution TEXT NOT NULL DEFAULT '',
  consent_publish INTEGER NOT NULL DEFAULT 0, consent_at TEXT, evidence_message_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',          -- nps|manual
  survey_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
```
Follow-up template variables: `{leadFirst}`, `{coachFirst}`, `{enquiryLink}`, `{offer}` (rendered by WP11 itself; leads are not clients, so `templating.mjs` is not used).
Follow-up templates use the id prefix `ft`, testimonials `tm` (`lf` is the lead form).

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/marketing/sources` | `?days=365` | `{sources:[{source, leads, won, conversionPct, medianDaysToWin, avgLtvPence\|null, revenue12Pence\|null}], referralCodes:[…same], campaigns:[…same]}` |
| GET/POST | `/api/marketing/followups/templates` | `{stage, name, subject?, body, nextInDays?}` | `{templates}` / `{template}` |
| PUT/DELETE | `/api/marketing/followups/templates/:id` | same | `{template}` / `{ok}` |
| GET | `/api/marketing/followups` | none | `{due:[{lead, template, rendered:{subject, body}, mailto\|null}]}` |
| POST | `/api/leads/:id/followed-up` | `{templateId, channel:'copy'\|'mailto'}` | `{lead}` (logs the activity, moves `next_action_on`) |
| GET/POST | `/api/marketing/testimonials` | `{clientId, quote?, attribution?}` | `{testimonials}` / `{testimonial}` |
| PATCH | `/api/marketing/testimonials/:id` | `{status?, quote?, attribution?, consentPublish?, evidenceMessageId?}` | `{testimonial}` (`consentPublish:true` requires `evidenceMessageId` of a message **from that client**) |
| GET | `/api/marketing/offers` | none | `{offers:[{campaign, link, interest}]}` (from `hooks('publicOffers')`, which WP4 provides) |

**Events.** Emits `marketing.followedUp {leadId}`, `testimonial.requested`, `testimonial.approved`. Consumes `pulse.answered`, `lead.created`.

**Hooks.** `inbox` (testimonial asks), `exportFor` (the client's testimonials), `search` (quotes).

**Demo.** 9 leads (F6) spread over 4 sources with 4 won; 5 follow-up templates; 3 testimonials (1 requested, 1 received, 1 approved with evidence);
"January Reset" marked public with 3 interested leads.

**Tests.**
- Source maths on a fixture (conversion, median days, LTV only from `billing.ltv` when that fact exists, else null).
- `mailto:` is URL-encoded and absent without an email.
- `pulse.answered` with 9 creates one inbox item; with 8, none; a repeat event creates no second item.
- Consent to publish without evidence, or with a message from another client, gives 400.
- The enquiry page shows a public campaign and ignores a private, ended or foreign one (`?campaign=`).
- Isolation; erasure removes the client's testimonials.

### Billing and revenue (WP3)

All billing is a **record of money handled outside the app**. Nothing charges a card.
- The copy says "Record payment", never "Charge".
- Prod `PAYMENTS=off` is untouched.
- Plans (`users.plan`) stay the service tier. The ledger is what is owed and paid.

#### F9 Invoices and the payments ledger
**Story.** As JK, I raise a clear invoice in seconds (a plan month, sessions, a campaign fee, kit), send it into the client's thread,
record payments however they pay me, and always know who owes what.

**Screens.**
- `/billing`: tabs Overview, Invoices, Payments, Packages, Schedules and Settings.
  - **Overview** is a bento: Outstanding, Overdue, Collected this month and Next 30 days scheduled, then the aged debt bars (0–30, 31–60, 61–90, 90+) and the latest activity.
  - **Invoices** is a `dataTable` (number, client, issued, due, total, paid, status pill) with filters and bulk actions (send reminders, void drafts).
  - **Export**: a date range and "Download CSV" (`GET /api/billing/export.csv`) for the accountant and the tax return.
- `/billing/invoices/:id`: an invoice editor and viewer.
  - Line items with drag to reorder, a discount line (F12), a totals panel, a status timeline and the actions Issue and send, Record payment, Credit note, Void, and Duplicate.
  - **Print view** (`print.css` media rules in `f-billing.css`): the business details, the client name, the lines, the bank details and the footer. The browser's print dialog saves a PDF.
- The client 360 **Billing** tab (`registerClientTab`): balance, invoices, payments, active packages and schedules, plus "New invoice".
- Quick-create: "Invoice…" opens a slide-over wizard: client, then lines (presets: this month's plan at the plan price; a session pack; a campaign fee; custom), then due date, then Issue or Save draft.
- "Issue and send" posts a message into the client's thread. It goes through the new kind `text` (via `sendMessage`, `via:'coachAction'`, so it is never capped or deferred) with the text
  "Invoice JK-2026-0012 · £120 due Fri 5 Dec. Pay by bank transfer to … (ref JK-2026-0012)". No client app UI is needed.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS billing_settings (
  coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
  payment_details TEXT NOT NULL DEFAULT '',     -- shown on invoices: bank name, sort code, account
  invoice_prefix TEXT NOT NULL DEFAULT 'JK', next_number INTEGER NOT NULL DEFAULT 1,
  due_days INTEGER NOT NULL DEFAULT 14, vat_rate_bp INTEGER NOT NULL DEFAULT 0, vat_number TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '', auto_issue_recurring INTEGER NOT NULL DEFAULT 0,
  dunning TEXT NOT NULL DEFAULT '[{"day":1,"template":"gentle"},{"day":7,"template":"firm"},{"day":14,"template":"coach"}]',
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  number TEXT,                                   -- assigned on issue: '<prefix>-<YYYY>-<0001>'
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','paid','void')),
  issue_on TEXT, due_on TEXT,
  subtotal_pence INTEGER NOT NULL DEFAULT 0, discount_pence INTEGER NOT NULL DEFAULT 0,
  tax_pence INTEGER NOT NULL DEFAULT 0, total_pence INTEGER NOT NULL DEFAULT 0, paid_pence INTEGER NOT NULL DEFAULT 0,
  discount_id TEXT, note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',         -- manual|recurring|campaign|package
  source_ref TEXT, sent_message_id TEXT,
  created_at TEXT NOT NULL, issued_at TEXT, paid_at TEXT, voided_at TEXT,
  UNIQUE (coach_id, number));
CREATE INDEX IF NOT EXISTS invoices_coach_status ON invoices(coach_id, status, due_on);
CREATE INDEX IF NOT EXISTS invoices_client ON invoices(client_id);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1, unit_pence INTEGER NOT NULL, amount_pence INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',           -- plan|session|package|campaign|kit|custom
  ref TEXT);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  method TEXT NOT NULL CHECK (method IN ('bank','cash','card','other')),
  received_on TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, voided_at TEXT);
CREATE TABLE IF NOT EXISTS credit_notes (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0), reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refunds (                -- money the coach paid back to the client, always against a credit note
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  method TEXT NOT NULL CHECK (method IN ('bank','cash','card','other')),
  paid_on TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, voided_at TEXT);
```

Rules:
- **Money arithmetic.** Integers only, in pence. Line `amount = round(quantity × unit)`. VAT is `round((subtotal − discount) × vat_rate_bp / 10000)`.
- **Drafts.** Only drafts are editable.
- **Issuing.**
  - Issuing assigns the next number atomically in the tx and sets `issue_on` (today) and `due_on` (issue + due_days unless given).
  - Issued invoices are immutable except `note`; correct them with a credit note or a void.
  - Void is allowed only with no payments.
- **Payments.**
  - Recording a payment against an invoice increases `paid_pence`, and the invoice becomes `paid` when `paid ≥ total`.
  - A payment without an invoice is account credit.
- **Statuses.** `overdue` and `partial` are derived in output (`displayStatus`).
- **Balance** = Σ(total of issued and paid invoices) − Σ(non-voided payments) − Σ(credit notes) + Σ(non-voided refunds).
- **Refunds.** A refund needs a credit note of the same client, and Σ refunds on a credit note ≤ its amount (400 otherwise). The coach records it; nothing moves money.
- **Receipts.** "Record payment" has an optional **Send receipt** tick: a thread message "Thanks, {first}: received £120 on Fri 5 Dec for JK-2026-0012."
  (`via:'coachAction'`, editable template in Billing › Settings).

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET/PUT | `/api/billing/settings` | settings fields | `{settings}` |
| GET | `/api/billing/overview` | none | `{outstandingPence, overduePence, collectedMonthPence, scheduled30Pence, aged:{d30, d60, d90, older}, recent:[…]}` |
| GET | `/api/billing/invoices` | `?status=&clientId=&from=&to=` | `{invoices:[invoiceOut]}` |
| POST | `/api/billing/invoices` | `{clientId, lines:[{description, quantity, unitPence, kind?, ref?}], dueOn?, note?, discountCode?}` | `{invoice}` (draft) |
| GET | `/api/billing/invoices/:id` | none | `{invoice, lines, payments, creditNotes, events}` |
| PUT | `/api/billing/invoices/:id` | same as POST (drafts only) | `{invoice}` |
| POST | `/api/billing/invoices/:id/issue` | `{send?:true, dueOn?}` | `{invoice}` |
| POST | `/api/billing/invoices/:id/void` | `{reason}` | `{invoice}` |
| POST | `/api/billing/invoices/:id/duplicate` | none | `{invoice}` (new draft) |
| POST | `/api/billing/payments` | `{clientId, invoiceId?, amountPence, method, receivedOn, reference?, note?, sendReceipt?:bool}` | `{payment, invoice?, messageId?}` |
| DELETE | `/api/billing/payments/:id` | none | `{ok}` (sets `voided_at` and re-derives the invoice) |
| POST | `/api/billing/credit-notes` | `{clientId, invoiceId?, amountPence, reason}` | `{creditNote}` |
| POST | `/api/billing/refunds` | `{creditNoteId, amountPence, method, paidOn, reference?}` | `{refund}` |
| DELETE | `/api/billing/refunds/:id` | none | `{ok}` (sets `voided_at`) |
| GET | `/api/billing/export.csv` | `?from=&to=` (London days, ≤ 2 years) | `text/csv`: one row per invoice, payment, credit note and refund (date, type, number, client name, description, net, VAT, total, method, reference), `content-disposition: attachment` |
| GET | `/api/coach/clients/:id/billing` | none | `{balancePence, invoices, payments, creditNotes, packages, schedules}` |
| GET | `/api/billing/mine` (**client**) | none | `{balancePence, invoices:[{number, issueOn, dueOn, totalPence, paidPence, status, lines}]}` (no app UI yet) |

**Events emitted.**
- `invoice.issued {invoiceId, totalPence, dueOn, source}`
- `invoice.paid {invoiceId, totalPence}`
- `invoice.voided`
- `payment.recorded {paymentId, amountPence, method, invoiceId}`
- `refund.recorded {refundId, amountPence}`
- `invoice.overdue {invoiceId, daysOverdue}` (F11)

**Actions registered.**
- `invoice.create {lines preset: 'planMonth'|'custom', amountPence?, description?, issue:bool}`.

**Facts.**
- `billing.balance` (money)
- `billing.overdueDays` (days, the oldest overdue invoice, or `null`)
- `billing.ltv` (money, Σ payments)
- `billing.lastPaidDays` (days)

**Variables.**
- `{balance}`
- `{oldestInvoice}` ("JK-2026-0012 (£120)")

**Hooks.**
- `search`: invoices by number or client.
- `timeline`: issued, paid and payment.
- `exportFor` (client): their invoices, lines, payments and credit notes.

**Needs hook.**
- Overdue 14+ days gives rank 7, "Invoice overdue 15 days · £120", with the action "Chase" (opens the F11 reminder).

**Demo.**
- Settings with a sample business and the bank details text "Sample Bank · 00-00-00 · 00000000 (demo)".
- About 24 invoices over 6 months for the 6 demo clients: mostly paid, 2 overdue (5 and 20 days) and 1 partial.
- About 25 payments across methods. 1 credit note.

**Tests.**
- Totals, VAT and rounding.
- Numbering is gap-free and unique per coach, including under two issues in a row.
- An issued invoice is immutable (400 on PUT).
- Partial then full payment moves the status to paid.
- A refund raises the balance by its amount, needs a credit note, and cannot exceed it.
- The CSV export has one row per ledger entry in the range, escapes commas and quotes, and contains only that coach's rows.
- Send receipt sends exactly one message.
- Voiding with payments is refused.
- The balance formula.
- A client sees only their own invoices via `/billing/mine`; another client gets an empty list, never a 403.
- Coach isolation (404s).
- The export includes the invoices.
- Erasing a client removes everything by cascade.

#### F10 Packages, credits and recurring billing
**Story.** As JK, I sell session packs ("10 × 1:1, valid 3 months"), and credits come off automatically when the client books. Monthly
memberships invoice themselves on schedule, and paused clients aren't billed.

**Screens.**
- Billing › Packages: a catalogue (name, sessions, price, validity, kind), plus "Sell to client". Selling creates a `client_packages` row and optionally an invoice.
- Billing › Schedules: a recurring schedule per client (amount, interval, next date, status) with pause and resume. A preview shows the next 3 invoice dates.
- In the client 360 Billing tab, a package balance meter (used/total, expiry) and the credit history.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sessions INTEGER NOT NULL CHECK (sessions BETWEEN 1 AND 200),
  price_pence INTEGER NOT NULL, valid_days INTEGER NOT NULL DEFAULT 90,
  booking_kind TEXT NOT NULL DEFAULT 'any',     -- any|inperson|video|group
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS client_packages (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT REFERENCES packages(id) ON DELETE SET NULL,
  name TEXT NOT NULL, booking_kind TEXT NOT NULL, sessions_total INTEGER NOT NULL, sessions_used INTEGER NOT NULL DEFAULT 0,
  starts_on TEXT NOT NULL, expires_on TEXT NOT NULL, invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','expired','cancelled')),
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_moves (
  id TEXT PRIMARY KEY, client_package_id TEXT NOT NULL REFERENCES client_packages(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id TEXT, delta INTEGER NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL,
  UNIQUE (client_package_id, booking_id, reason));
CREATE TABLE IF NOT EXISTS billing_schedules (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL, amount_pence INTEGER NOT NULL CHECK (amount_pence > 0),
  interval TEXT NOT NULL CHECK (interval IN ('week','fourWeeks','month')),
  next_on TEXT NOT NULL, ends_on TEXT, discount_id TEXT,
  discount_cycles INTEGER,                       -- the discount applies to the first N invoices of the schedule; NULL = every invoice
  discount_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended')),
  paused_until TEXT, created_at TEXT NOT NULL);
```

Rules:
- **Using credits.** On `booking.created` for a client with `uses_credit = 0` (meaning plan credits did not cover it) and an active, unexpired package of a matching kind, take the
  oldest-expiring package. Insert a `credit_moves` row with delta −1 and reason `booking`. The UNIQUE constraint makes it idempotent.
- **Refunds.** On `booking.cancelled` with `refunded`, restore the credit: delta +1, reason `refund`.
- **Low and used up.** Emit `package.low` when 1 session is left. The status becomes `used` at 0 left.
- **Expiry.** A daily clock expires packages past `expires_on` and emits `package.expired`.
- **Recurring clock** (every 15 min; it acts once per schedule per `next_on`):
  1. When `next_on ≤ today` and the schedule is active, create the invoice (source `recurring`, `source_ref = schedule.id + ':' + next_on`).
     A UNIQUE check via `SELECT` on `source_ref` makes this idempotent.
  2. Issue and send it if `auto_issue_recurring`, else leave it as a draft and notify the coach.
  3. Advance `next_on` by the interval. Month addition clamps to the end of the month.
- **Schedule discounts.** Each recurring invoice applies the schedule's discount while `discount_cycles` is NULL or `discount_used < discount_cycles`,
  then increments `discount_used` in the same tx ("20% off for the first 3 months").
- **Pausing.** `client.paused` sets all of that client's active schedules to paused with `paused_until`. `client.resumed`, or the date passing, resumes them and moves
  `next_on` forward to the first date on or after today, with no back-billing. On `client.resumed {pausedDays}`, every active package's `expires_on`
  moves forward by `pausedDays`, logged as a `credit_moves` row (delta 0, reason `pause:+<n>d`, `booking_id` NULL).
- **End of coaching** (`client.offboarded`): every active schedule ends (`status='ended'`, `ends_on = today`); packages are expired, or refunded by credit note for
  the unused share (`packages:'refund'`); with `money:'writeOff'` a credit note for the balance is raised; open invoices get a dunning `paused` row unless
  `keepChasing`. The recurring clock and dunning both skip schedules and invoices of a client whose last lifecycle event is `client.offboarded` (the
  billing handler keeps that in its own table `billing_client_state(client_id PK REFERENCES users ON DELETE CASCADE, coach_id, ended_at)`, cleared by `client.stageChanged`
  to `active` or `onboarding`), so nothing is billed or chased by accident. Restarting coaching never restarts old schedules: the coach creates new ones.
- **Cancellation policy** (data from F21, carried in the event so billing never reads WP7's tables):
  - `booking.cancelled` with `late:true` and `policy.forfeitCredit` → no credit refund, even if `refunded`;
  - `booking.noShow` or `booking.lateCancel` with `policy.feePence > 0` → a **draft** invoice line of kind `session`, "Late cancellation · Tue 4 Nov"
    (or "Missed session"), on a draft invoice (source `policy`), which the coach confirms or deletes. Never auto-issued.

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET/POST | `/api/billing/packages` | `{name, description?, sessions, pricePence, validDays, bookingKind}` | `{packages}` / `{package}` |
| PUT/DELETE | `/api/billing/packages/:id` | same | `{package}` / `{ok}` (delete = deactivate if sold) |
| POST | `/api/billing/packages/:id/sell` | `{clientId, startsOn?, invoice: true\|false, issue?: bool}` | `{clientPackage, invoice?}` |
| POST | `/api/billing/client-packages/:id/adjust` | `{delta, reason}` | `{clientPackage}` |
| GET/POST | `/api/billing/schedules` | `?endingWithin=<days>` / `{clientId, label, amountPence, interval, nextOn, endsOn?, discountId?, discountCycles?}` | `{schedules}` / `{schedule}` |
| PATCH/DELETE | `/api/billing/schedules/:id` | `{status?, amountPence?, nextOn?, label?, endsOn?}` | `{schedule}` / `{ok}` |

**Events.**
- Emits `package.sold`, `package.low {clientPackageId, left}`, `package.expired`, `billing.scheduleCreated {scheduleId}` and `billing.scheduleInvoiced {scheduleId, invoiceId}`.
- Consumes `booking.created`, `booking.cancelled`, `booking.noShow`, `booking.lateCancel`, `client.paused`, `client.resumed`, `client.offboarded` and `campaign.enrolled` (F13 fee, see F13).

**Hooks.** `renewals` (packages near expiry or nearly used; schedules with `ends_on` in the window), `offboarding` (balance, active schedules, packages with credits).

**Facts.**
- `billing.credits` (number left across active packages)
- `billing.packageExpiresDays` (days)
- `billing.recurringPence` (money/month normalised: week × 52/12, fourWeeks × 13/12)

**Variables.**
- `{packageLeft}`

**Forecast hook.**
- Every scheduled invoice in the window.

**Demo.**
- 3 packages ("Single 1:1", "10 × 1:1", "Video 5-pack").
- 3 demo clients with packs, one at 1 left.
- 4 monthly schedules, one paused.

**Tests.**
- Booking consumes one credit exactly once (emit twice → one move).
- A refund restores it.
- Expiry.
- The recurring clock is idempotent across two ticks and a restart (re-open the store).
- Month-end clamping (31 Jan → 28/29 Feb).
- Pause and resume do not back-bill, and resume extends package expiry by the paused days.
- `discount_cycles = 3` discounts exactly the first 3 recurring invoices.
- After `client.offboarded`, the recurring clock creates no invoice and dunning sends no step for that client (unless `keepChasing`).
- A late cancel with `forfeitCredit` restores no credit; a no-show with a fee creates one draft line and issues nothing.

#### F11 Dunning: chasing overdue payments
**Story.** As JK, I never have to remember who owes me. Polite reminders go out on a schedule I control, they stop the moment
someone pays, and I'm told when it's time for a personal word.

**Rules.**
- A billing clock runs every 30 min, between 08:00 and 20:00 London only.
- For each issued, unpaid invoice past `due_on`, walk the `billing_settings.dunning` steps (`day` after due):
  - Template `gentle` sends a message.
  - Template `firm` sends a message.
  - Template `coach` sends **no** client message. It calls `notifyCoach` and creates a task through the `task.create` action if registered, else only the notification.
- Each step happens once per invoice. Every step is logged, and paid or void invoices are skipped, as are invoices of an ended client (F10) unless "Keep chasing" was chosen.
- Steps send through `sendMessage` with `via:'dunning'`: exempt from the daily cap, subject to quiet hours (3.5).
- The message texts are editable in Billing › Settings, use template variables, and have these defaults:
  - gentle: "Hi {first}, a quick nudge that invoice {invoiceNumber} for {invoiceTotal} was due on {invoiceDue}. Details are in our last message. Thanks!"
  - firm: "Hi {first}, invoice {invoiceNumber} ({invoiceTotal}) is now {daysOverdue} days overdue. Could you sort it this week, or let me know if something's up?"
- The invoice variables are supplied in `render(…, {extra})`.
- `invoice.overdue` is emitted once, at the first step.
- Coach override per invoice: "Pause reminders" (stored on the dunning log as a `paused` row).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS dunning_log (
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step INTEGER NOT NULL,                -- index into settings.dunning, or -1 for 'paused'
  outcome TEXT NOT NULL, message_id TEXT, at TEXT NOT NULL,
  PRIMARY KEY (invoice_id, step));
```

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/billing/invoices/:id/remind` | `{text?}` | `{messageId}` (manual reminder now, logged as step 100+n) |
| POST | `/api/billing/invoices/:id/reminders` | `{paused: bool}` | `{ok}` |
| GET | `/api/billing/invoices/:id/reminders` | none | `{log:[…], next:{step, on}}` |

**Inbox hook.**
- Overdue invoices at a `coach` step become `flag:invoice:<id>`, with the actions Remind, Record payment and Pause reminders.

**Tests.**
- The step sequence happens with injected days.
- Nothing is sent outside 08:00–20:00.
- Paid stops further steps.
- Paused stops them.
- Each step happens exactly once across repeated ticks.
- The `coach` step sends no client message.
- Demo coach clocks still run, but `notify` push is skipped (existing behaviour).

#### F12 Discounts, promo codes and referrals
**Story.** As JK, I can run offers: a promo code for January, a 20% returning-client discount, a free session for every friend referred.
I see what each offer cost and earned.

**Screens.** `/offers` has three tabs.
- **Discounts and codes**: a table with code, kind and value, applies-to, window, redemptions/limit, and £ discounted. An editor sheet. A one-click "Generate code".
- **Referrals**:
  - Programme settings: reward kind (account credit £X, free sessions N, or % off the next invoice) and the qualifying rule ("first invoice paid").
  - A per-client referral code with a copy-link button (`/enquire/<slug>?ref=CODE`).
  - A table of referrals by status.
  - A leaderboard of referrers.
- **Performance**: a bar chart of redemptions per offer, revenue from referred clients, and cost of discounts.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT,                                   -- upper-case A-Z0-9-, unique per coach when set; null = manual-only discount
  name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value INTEGER NOT NULL,                      -- percent in basis points (2000 = 20%) or pence
  applies_to TEXT NOT NULL DEFAULT 'any',      -- any|plan|package|campaign|session
  starts_on TEXT, ends_on TEXT, max_redemptions INTEGER, per_client_max INTEGER NOT NULL DEFAULT 1,
  first_invoice_only INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS discounts_code ON discounts(coach_id, code) WHERE code IS NOT NULL;
CREATE TABLE IF NOT EXISTS discount_redemptions (
  id TEXT PRIMARY KEY, discount_id TEXT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL, amount_pence INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS referral_settings (
  coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0,
  reward_kind TEXT NOT NULL DEFAULT 'credit' CHECK (reward_kind IN ('credit','sessions','percentNext')),
  reward_value INTEGER NOT NULL DEFAULT 2000,   -- pence | sessions | basis points
  referee_discount_id TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE (coach_id, code));
CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referrer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id TEXT, referee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','joined','qualified','rewarded','void')),
  reward_ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
```

Rules:
- **Applying a discount** (on a draft invoice, at creation through `discountCode`, or from `campaign.enrolled {discountCode}` for a campaign fee):
  - The checks are active, inside the window, under the limits, `applies_to` matches at least one line kind, and `first_invoice_only` holds.
  - The amount is computed on the eligible lines and capped at their sum.
  - The redemption row is written on **issue** (not on draft).
- **Referrals.**
  - `lead.created` with a `referralCode` that matches a code creates a pending referral.
  - `lead.won` and `client.joined` (email match through the lead) move it to `joined` with `referee_id`.
  - `invoice.paid` for the referee's first paid invoice qualifies it.
  - The reward is then applied in the same handler, and the referral moves to rewarded:
    - `credit`: a credit note on the referrer, "Referral reward: <first name>".
    - `sessions`: a `client_packages` row named "Referral reward".
    - `percentNext`: a single-use discount bound to the referrer.
  - A thread message to the referrer is sent only if the coach ticks "tell them". Default off; the message is a template, and the coach can also send it manually.
- **Codes.** Referral codes are generated as `FIRSTNAME-XXXX` (upper-case, without ambiguous characters).

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET/POST | `/api/offers/discounts` | discount fields | `{discounts:[…+stats]}` / `{discount}` |
| PUT/DELETE | `/api/offers/discounts/:id` | | |
| POST | `/api/offers/discounts/check` | `{code, clientId, lines?}` | `{ok, amountPence?, reason?}` |
| GET/PUT | `/api/offers/referrals/settings` | | |
| GET | `/api/offers/referrals` | none | `{referrals:[…], leaderboard:[{client, qualified, rewarded}]}` |
| POST | `/api/offers/referrals/codes` | `{clientId}` | `{code, link}` (idempotent) |
| POST | `/api/offers/referrals/:id/void` | none | `{referral}` |
| GET | `/api/referral/mine` (**client**) | none | `{active, code, link, rewardText}` (no app UI yet) |

**Actions registered.**
- `offer.issue {discountId}`: creates a client-bound single-use copy of the discount and sends the code in a templated message.

**Events.** Emits `offer.redeemed {discountId, invoiceId, amountPence}`, `referral.created`, `referral.qualified` and `referral.rewarded`.

**Demo.**
- 3 discounts (NEWYEAR20 at 20%, RETURN15 at 15%, Founding member at £10 fixed), with redemptions.
- The referral programme is active, with Sam's code and 2 referrals (one rewarded, one pending tied to a demo lead).

**Tests.**
- The discount maths: percent rounds down and is capped at the eligible amount.
- Window and limit rejections.
- `per_client_max`.
- The redemption is written only on issue.
- The full referral chain through to reward, with events injected in order.
- Duplicate events do not double-reward.
- Coach isolation on codes: two coaches may both have the code `SAM-AB12`.

#### F26 Revenue insights and forecast (`/revenue`)
**Story.** As JK, I see what I earn, what's coming, which clients and offers drive it, and where the gap is to my monthly target.

**Screen.** `/revenue`, with tabs Overview, Forecast and Clients.
- **Overview**:
  - a hero tile with the month's collected amount (count-up), the vs-target ring (target in prefs `revenue.target`), and the delta vs last month;
  - a line chart of collected per month over 12 months, with Billed MRR from schedules and Plan MRR from the existing plans maths;
  - the aged-debt stack;
  - ARPC, average LTV, and the % of revenue from packages, recurring, campaigns and other;
  - a "By source" tile from `GET /api/marketing/sources` (F28), hidden when that endpoint answers 404.
- **Forecast**:
  - the next 90 days as a stacked area: scheduled recurring (certain), packages likely renewing (clients at ≤1 credit × their last package price × .5), campaign
    fees for enrolments starting, and the weighted pipeline from `hooks('forecast')`;
  - a table of the contributing lines with a confidence label.
- **Clients**: a `dataTable` of LTV, paid 12 months, balance, months active and tenure, plus a "top 10 by LTV" bar chart.

**API.**

| Method | Path | Response |
|---|---|---|
| GET | `/api/revenue/summary?months=12` | `{collected:[{month, pence}], billedMrr:[{month, pence}], planMrr:[{month, pence}], arpcPence, avgLtvPence, mix:[{source, pence}], target}` |
| GET | `/api/revenue/forecast?days=90` | `{days:[{day, certainPence, likelyPence, possiblePence}], lines:[{label, day, pence, confidence:'certain'\|'likely'\|'possible', source}]}` |
| GET | `/api/revenue/clients` | `{clients:[{client, ltvPence, paid12Pence, balancePence, monthsActive}]}` |

**Forecast hook contract.** `[{day, pence, label, confidence, source}]`. Providers: billing schedules (certain), packages (likely), campaigns (WP4, likely),
leads (WP11, possible).

**Demo.** Uses the F9–F12 data. The target is £2,500.

**Tests.**
- Collected-per-month buckets by `payments.received_on` (already a London day), never by `created_at`.
- The forecast includes the hooks and tolerates a throwing hook.
- The demo coach's numbers never include real coaches (isolation).

### Campaigns and guides (WP4)

#### F13 Bespoke campaigns
**Story.** As JK, I design a time-bound campaign such as "12-week Marathon Build", "January Reset" or "Ski-fit 6 weeks".
- It has phases, dated activities, clear guides, a kit list with expected spend, and an optional fee.
- I **invite** clients. Before they commit, they see the dates, the fee, the required and optional kit and the expected spend, and they accept or decline.
- Once in, they see what to do each day, in the app or on their plan page, and record what they actually spent.
- I watch progress on a live board and nudge whoever is behind.

**Relationship to challenges (D15).** The existing `challenges` stay as the metric leaderboard. A campaign may link one (`challenge_id`); the board shows
its leaderboard beside the campaign's own points.

**Screens.**
- `/campaigns`: a gallery of campaign cards: cover (media image, or an accent sheen with the serif title), status pill (Draft, Live, Ended), dates, enrolled avatars,
  invited and capacity ("8 of 12 places"), average progress ring, and expected spend.
  - "New campaign" opens a wizard with templates (blank, 6-week challenge, 12-week event build, 30-day habit reset) that pre-fill the phases and activities.
- `/campaigns/:id/:tab?`, with five tabs:
  - **Design**:
    - **Phases** are a horizontal Gantt-like strip by week. Drag the edges to resize a phase; click one to edit its name, its guide and its colour token.
    - **Activities** are a day-by-day list grouped by phase. Each row has a kind glyph, a title, the day offset, points, required, and an expected spend.
      Drag rows to re-day them; "Duplicate weekly" repeats a row.
    - Each activity has a guide (an F14 guidebook block document, or a linked guide), plus a link to a program, a habit or a booking kind.
  - **Kit & spend**: items with name, expected £, required or optional, a link (https only) and a note. Totals show "Expected spend £180 (required £95)".
  - **Enrol**:
    - pick clients or a segment (`resolveAudience`);
    - start mode: fixed campaign dates, or a rolling start from the acceptance day;
    - fee: none, or £X, with an optional discount code (checked live through `POST /api/offers/discounts/check` when billing is present);
    - **how they join**: **Invite** (the default: the client accepts in the app or on the plan page) or **Agreed in person** (the coach confirms the client said
      yes; the enrolment starts at once and records `accepted_via='inPerson'`);
    - a preview of the invitation message, which always states the dates, the fee, the required kit with expected spend and the optional kit total.
  - **Board**:
    - a progress matrix of clients × phases (cells shaded by completion), per-client progress rings, behind-pace flags, and a leaderboard by points (coach only);
    - **spend**: expected vs actual per client (Σ `spent_pence` reported against the kit and purchase activities);
    - the invited list (pending, declined, waitlisted) with Resend invite and Withdraw;
    - bulk "Nudge behind" through the composer;
    - an announcement composer that messages all enrolled.
  - **Settings**: daily nudge on/off and its time (default 07:00), capacity and "waitlist when full", whether clients see an anonymous rank, **Public offer**
    (shows on the enquiry page through `?campaign=`, F28), a linked challenge, completion message, and archive.
- In the client 360, a **Campaigns** tab: invitations and enrolments with the today list, progress, spend, and Unenrol.

**Client experience** (all P1; the plan page guarantees it does not depend on app CI):
- **Apps (WP9, WP10)**: the client's Today shows an **invitation card** (name, dates, fee, kit with expected spend, Accept / Not this time) and, once accepted,
  a **campaign card**: name, day N of M, today's activities with tick boxes, and "Read guide". The guide screen renders F14 blocks natively. The kit list has
  bought ticks and an optional "I spent £__".
- **Plan page** (`GET /plan/<token>`, WP4, server-rendered HTML with no JS, like the enquiry page): the same content, read-only, for one enrolment:
  invitation details with **Accept** and **Decline** buttons (a `POST /plan/<token>` form with a per-token CSRF field), today's activities, the next 3 days,
  the phases, the kit list, and every guide in full (rendered from blocks server-side, text only, images through
  `/plan/<token>/media/<mediaId>` with the same block check as F14).
  - `token` = `<enrolmentId>.<expiry>.<HMAC-SHA256(enrolmentId + expiry)>` with a 32-byte key at `<DATA_DIR>/secrets/plan-link.key` (created like the
    calendar key, F20), valid 45 days, refreshed in each new nudge. A dropped, completed-over-30-days or erased enrolment answers 404.
  - Headers: the enquiry page's CSP, `referrer-policy: no-referrer`, `x-robots-tag: noindex`, `cache-control: no-store`. It shows the client's first name only.
  - Invitations, daily nudges and guide shares carry the link ("Today's plan: https://jk.strangeramblings.com/plan/…"); WP9 and WP10 make `https` links in
    message bubbles tappable (P1).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  cover_media_id TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','ended','archived')),
  start_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (start_mode IN ('fixed','rolling')),
  starts_on TEXT, ends_on TEXT, length_days INTEGER NOT NULL CHECK (length_days BETWEEN 1 AND 366),
  fee_pence INTEGER NOT NULL DEFAULT 0, capacity INTEGER, waitlist INTEGER NOT NULL DEFAULT 1,
  public INTEGER NOT NULL DEFAULT 0, challenge_id TEXT REFERENCES challenges(id) ON DELETE SET NULL,
  settings TEXT NOT NULL DEFAULT '{"dailyNudge":true,"nudgeAt":"07:00","showRank":false}',
  welcome_text TEXT NOT NULL DEFAULT '', completion_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_phases (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL, start_day INTEGER NOT NULL, end_day INTEGER NOT NULL,     -- 0-based offsets, inclusive
  color TEXT NOT NULL DEFAULT 'chart-1', guide_id TEXT, summary TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_activities (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES campaign_phases(id) ON DELETE SET NULL,
  day INTEGER NOT NULL, title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task','workout','habit','checkin','read','purchase','session','measure','custom')),
  detail TEXT NOT NULL DEFAULT '', guide_id TEXT, blocks TEXT,          -- inline guide blocks (F14 format) when no guide_id
  link_ref TEXT,                                                       -- programId | kitId | 'inperson'|'video' | metric
  points INTEGER NOT NULL DEFAULT 10, required INTEGER NOT NULL DEFAULT 1, spend_pence INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_kit (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL, est_pence INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0,
  url TEXT, note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_enrolments (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','waitlisted','declined','active','paused','completed','dropped')),
  start_on TEXT, points INTEGER NOT NULL DEFAULT 0,
  fee_pence INTEGER NOT NULL DEFAULT 0, discount_code TEXT, invoice_wanted INTEGER NOT NULL DEFAULT 1,
  accepted_via TEXT CHECK (accepted_via IN ('app','plan','inPerson')),
  paused_at TEXT, paused_days INTEGER NOT NULL DEFAULT 0,
  invited_at TEXT NOT NULL, responded_at TEXT, enrolled_at TEXT, completed_at TEXT, dropped_at TEXT,
  UNIQUE (campaign_id, client_id));
CREATE TABLE IF NOT EXISTS campaign_progress (
  enrolment_id TEXT NOT NULL REFERENCES campaign_enrolments(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,                       -- activity id or kit id
  done_at TEXT NOT NULL, value REAL, note TEXT, media_id TEXT,
  spent_pence INTEGER,                         -- what the client says they actually spent (kit or purchase items)
  PRIMARY KEY (enrolment_id, item_id));
CREATE TABLE IF NOT EXISTS campaign_nudges (
  enrolment_id TEXT NOT NULL REFERENCES campaign_enrolments(id) ON DELETE CASCADE,
  day TEXT NOT NULL, message_id TEXT, PRIMARY KEY (enrolment_id, day));
```

Rules:
- **Days.** An activity's date is `start_on + day`. `fixed` campaigns use `starts_on` for every enrolment; `rolling` campaigns use the acceptance day (or a chosen start).
- **Saving.** `PUT /api/campaigns/:id` saves the whole design document in one tx. Rows keep their ids when the client sends `id`.
  - Removing an activity that has progress archives it.
  - Removing one without progress deletes it.
  - Live campaigns may be edited. Changes apply forward, and past progress stays.
- **Invite → accept.** Enrol creates `invited` rows and sends each client one invitation message (`via:'coachAction'`, with the plan link) stating the dates,
  fee (after any discount), required kit with expected spend and optional kit total. Nothing is charged and no nudge is sent while invited.
  - `accept` (client app, plan page, or the coach's "Agreed in person") sets `active`, `start_on`, `enrolled_at`, `accepted_via`, and only **then** emits
    `campaign.enrolled` (so the fee invoice is created on acceptance, never on invitation). `decline` sets `declined`. An invitation not answered within 14 days,
    or by the campaign's start for fixed campaigns, expires to `declined` with a note.
- **Capacity.** `capacity` counts `active`, `paused` and `completed` enrolments. Accepting into a full campaign either sets `waitlisted` (when `waitlist = 1`)
  or answers **409** "This campaign is full". Inviting more people than places is allowed (the invitation says "places are limited"). When a place frees up
  (drop, decline after waitlist), the oldest waitlisted client is offered it by a new invitation. Two concurrent accepts for the last place: one wins (the count is
  re-checked inside the tx), the other gets 409 or waitlisted.
- **Points.** An enrolment's `points` is recomputed on each tick or untick.
  - **Pace** = required activities done ÷ required activities due by today.
  - "Behind" means a pace below 0.7.
- **Daily nudge clock** (every 5 min):
  - For each `active` enrolment, when the London time is past `nudgeAt` and there are activities due today, send once per day (the `campaign_nudges` PK):
    "Day {campaignDay} of {campaign}: {activity titles joined}. Today's plan: {planLink}". It goes through `sendMessage` with `via:'campaign'`, so the daily cap,
    quiet hours and "outreach paused" apply (3.5); a deferred or skipped nudge is still recorded in `campaign_nudges` so it is never sent twice.
  - It emits `campaign.activityDue`.
- **Pause** (`client.paused` / `client.resumed {pausedDays}`): active enrolments become `paused` (no nudges, pace frozen, not counted as behind) and on resume return to
  `active` with `paused_days` added, which moves every remaining activity date and the end date forward by that many days.
- **End of coaching** (`client.offboarded`): invited, waitlisted, active and paused enrolments become `dropped`; no fee is raised.
- **End of campaign.** At `start_on + length_days + paused_days`, the enrolment becomes completed when every required activity is done, else it stays active for 7 days'
  grace and is then marked dropped. It emits `campaign.completed` or `campaign.dropped`, and sends `completion_text` if one is set.
- **Habit activities.** A `habit` activity does **not** create habit rows (that would collide with the client's 5-habit cap). It is a tick-box only. Its detail tells the client what to do.
- **Workout activities.** A `workout` activity with a `link_ref` program id offers "Lay program from day N" at acceptance (via existing `layProgram`, unpublished by default).
- **Fees.** On acceptance with `fee_pence > 0` and `invoice_wanted`, emit `campaign.enrolled {enrolmentId, feePence, invoice:true, campaignName, discountCode?}`.
  Billing's handler creates the invoice with one line of kind `campaign`, applies `discountCode` through the F12 rules (an invalid code is dropped and noted on the
  invoice), and sets `source='campaign', source_ref=<enrolmentId>` on it. Billing never writes WP4's tables. The Campaigns UI finds the invoice through
  `GET /api/billing/invoices?sourceRef=<enrolmentId>` when billing is present (WP3 supports the `sourceRef` filter).

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/campaigns` | `?status=` | `{campaigns:[{…summary, enrolled, invited, capacity, avgProgress, expectedSpendPence}]}` |
| POST | `/api/campaigns` | `{name, template?:'blank'\|'challenge6'\|'event12'\|'reset30'}` | `{campaign}` |
| GET | `/api/campaigns/:id` | none | `{campaign, phases, activities, kit}` |
| PUT | `/api/campaigns/:id` | the whole design document | the same |
| POST | `/api/campaigns/:id/status` | `{status}` | `{campaign}` (live needs at least 1 activity; ended stops nudges) |
| POST | `/api/campaigns/:id/duplicate` | none | `{campaign}` |
| DELETE | `/api/campaigns/:id` | none | `{ok}` (only drafts or campaigns with no enrolments; otherwise archive) |
| POST | `/api/campaigns/:id/enrol` | `{clientIds?, audience?, startOn?, invoice?:bool, discountCode?, mode:'invite'\|'inPerson', layProgram?:bool}` | `{invited:n, enrolled:n, waitlisted:n, skipped:[{clientId, reason}]}` (409 when `inPerson` and the campaign is full without waitlist) |
| POST | `/api/campaigns/:id/enrolments/:eid/resend` | none | `{ok}` |
| DELETE | `/api/campaigns/:id/enrolments/:eid` | none | `{ok}` (withdraws an invitation or marks dropped) |
| GET | `/api/campaigns/:id/board` | none | `{phases, clients:[{enrolment, client, pct, pace, behind, points, rank, expectedSpendPence, spentPence, cells:[{phaseId, pct}]}], invited:[…], challenge?}` |
| POST | `/api/campaigns/:id/announce` | `{text}` | `{sent:n}` |
| GET | `/api/campaigns/ending` | `?days=30` | `{enrolments:[{client, campaign, endsOn}]}` (for F8 Renewals) |
| GET | `/api/coach/clients/:id/campaigns` | none | `{enrolments:[…]}` |

**API (client).**

| Method | Path | Response |
|---|---|---|
| GET | `/api/campaigns/mine` | `{invitations:[invitationOut], enrolments:[{id, status, campaign:{id, name, tagline, coverUrl}, day, lengthDays, pct, today:[activityOut], next:[activityOut ×3], rank?: {position, of}, planUrl}]}` |
| POST | `/api/campaigns/mine/:enrolmentId/accept` | `{}` → `{enrolment}` (409 "This campaign is full" or `status:'waitlisted'`) |
| POST | `/api/campaigns/mine/:enrolmentId/decline` | `{}` → `{ok}` |
| GET | `/api/campaigns/mine/:enrolmentId` | `{enrolment, campaign, phases:[{…, guide?}], activities:[activityOut with done], kit:[{…, bought, spentPence}]}` |
| POST | `/api/campaigns/mine/:enrolmentId/items/:itemId` | body `{done:true\|false, value?, note?, mediaId?, spentPence?}` → `{pct, points}` (emits `campaign.activityDone` when done; only for `active` enrolments) |
| GET | `/api/guides/coach/:guideId` | a published guide of the client's own coach, `{guide:{title, blocks}}`, else 404 |

`invitationOut` = `{enrolmentId, campaign:{id, name, tagline, coverUrl, startsOn, endsOn, lengthDays}, feePence, discountPence, kit:{required:[{name, estPence}], optional:[{name, estPence}], requiredPence, optionalPence}, expectedSpendPence, placesLeft|null, respondBy}`.
`activityOut` = `{id, day, date, title, kind, detail, points, required, spendPence, guide:{id?, blocks?}|null, done, doneAt}`.

**Events.**
- Emits `campaign.invited`, `campaign.declined`, `campaign.waitlisted`, `campaign.enrolled` (on acceptance), `campaign.activityDue`, `campaign.activityDone {enrolmentId, itemId}`,
  `campaign.behind {enrolmentId, pace}` (daily, once per crossing), `campaign.completed` and `campaign.dropped`.
- Consumes `day.started`, `client.paused`, `client.resumed`, `client.offboarded`.

**Actions.** `campaign.enrol {campaignId}` (always an **invitation**; automations never enrol anyone into spending).

**Facts.**
- `campaign.active` (tags: the active campaign ids, rendered with names in the builder)
- `campaign.pace` (number 0–100, the lowest active)
- `campaign.endsInDays` (days until the soonest active enrolment ends)

**Variables.** `{campaign}`, `{campaignDay}`, `{campaignToday}`, `{planLink}`.

**Hooks.**
- `forecast`: fees for accepted enrolments starting in the window, if not yet invoiced.
- `diary`: campaign starts and ends.
- `timeline`: invited, accepted, completed and milestones.
- `search`: campaigns by name.
- `exportFor`: the client's enrolments, progress and spend.
- `needs`: behind pace for 3+ days, rank 7, "Behind on Marathon Build (pace 52%)", action Nudge.
- `renewals`: enrolments ending in the window (F8). `offboarding`: open invitations and enrolments. `publicOffers`: live public campaigns (F28).

**Demo.**
- **"12-Week Marathon Build"** (live, fixed dates, started 23 days ago, capacity 6):
  - 4 phases (Base, Build, Peak, Taper), about 60 activities with guides, and 6 kit items:
    shoes £120 (required), gels £25 (required), a running belt £15, a foam roller £20, and two more;
  - a fee of £49;
  - 4 demo clients enrolled with varied progress and reported spend (one behind, one leading), 1 invitation pending, 1 declined.
- **"January Reset"** (draft, rolling, 30 days, public).
- **"Ski-fit 6 weeks"** (ended, with 2 completed).

**Tests.**
- Saving the design document is idempotent and preserves ids.
- Deleting an activity with progress archives it.
- **Invite creates no invoice and no nudge; accept emits `campaign.enrolled` with the fee and the discount code; decline emits nothing billable.**
- "Agreed in person" enrols at once and records `accepted_via='inPerson'`.
- **Capacity**: the accept after the last place gives 409 (no waitlist) or `waitlisted`; a freed place invites the oldest waitlisted client.
- The invitation text contains dates, fee, required kit spend and optional kit total.
- `spentPence` is stored and summed on the board.
- Pause freezes pace and nudges; resume shifts the dates by the paused days.
- `client.offboarded` drops every open enrolment and invitation.
- Enrolment start dates in both modes.
- Pace and behind.
- The nudge fires once per day after `nudgeAt` (injected now) and is deferred by the outreach governor in quiet hours or over the cap.
- Completion, and drop after grace.
- Client endpoints: only their own enrolments (404 otherwise).
- **Plan page**: a valid token shows today's activities and a full guide; a tampered, expired or dropped-enrolment token is 404; accept by form works once;
  the response carries the CSP, `no-referrer` and `noindex` headers and no surname.
- Ticking updates points.
- A guide from another coach gives a 404.
- The demo builds without emitting.

#### F14 Guidebook: coach-written guides
**Story.** As JK, I write clear, good-looking guides once ("How to fuel a long run", "Your first week") with headings, steps, tips, images
and videos, and attach them to campaigns, activities, or send them to a client.

**Screens.**
- `/guidebook`: a grid of guides (title, summary, tags, status) with search.
- `/guidebook/:id`: a block editor.
  - The left side is the document. Each block is a row with a drag handle and a type menu. `/` inside an empty paragraph opens the block picker.
  - The right side is a live phone-frame preview, rendered exactly as the apps will.
  - Inline formatting supports only `**bold**` and `_italic_`. The renderer tokenises them, and **no HTML is ever stored or rendered**.
- "Send to client" posts a thread message (`via:'coachAction'`), "JK shared a guide: <title>. Read it here: <link>", where the link is a guide view on the
  F13 plan page route (`/plan/<token>/guide/<guideId>`, a token bound to the client and the guide, same signing and headers as F13). Clients read it in full there,
  or natively in the apps (P1 renderer).

**Block format** (JSON array, ≤ 200 blocks, ≤ 60 KB):
```json
[ {"t":"h","text":"Fuel the long run"},
  {"t":"p","text":"Eat **30–60 g** of carbs per hour after the first hour."},
  {"t":"list","style":"bullet|number|check","items":["Gel at 45 min","Water every 20 min"]},
  {"t":"callout","tone":"tip|warn|info","text":"Practise race-day fuel in training."},
  {"t":"image","mediaId":"md_…","caption":""},
  {"t":"video","mediaId":"md_…"}, {"t":"audio","mediaId":"md_…"},
  {"t":"link","url":"https://…","label":"Shop list"},
  {"t":"exercise","exerciseId":"ex_…"},
  {"t":"divider"} ]
```
- Media in guides must be the coach's own media (`attachableMedia`) with `client_id` NULL and purpose `guide` (WP6 adds `guide` to PURPOSES; until then use `other`).
- Clients may fetch guide media only through the guide: `GET /api/guides/coach/:guideId/media/:mediaId` checks that the block exists and the guide belongs to their coach.
  This avoids widening `canSeeMedia`.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS coach_guides (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
```
The id prefix is `gb`.

**API.**
- `GET/POST /api/guidebook`
- `GET/PUT/DELETE /api/guidebook/:id`
- `POST /api/guidebook/:id/send {clientId}`
- Client: `GET /api/guides/coach/:id`, `GET /api/guides/coach/:id/media/:mediaId`.

`validateBlocks()` is exported **from the feature file**. WP4 also uses it for `campaign_activities.blocks`.

**Events.** `guide.published`, `guide.sent`, and `guide.opened {guideId}` once per client per guide (from the client API or the plan page; F27 uses it).

**Demo.** 6 guides (Fuel the long run, Taper week, Your first week, Mobility 10, Sleep basics, Ski-fit warm-up), used by the demo campaigns.

**Tests.**
- Block validation (unknown types, oversize, HTML-ish text stays text).
- Media ownership.
- The client fetches only published guides of their own coach.
- Guide-media access through a block works, and access to a media id not in the guide is refused.

### Automations and outreach (WP5)

#### F15 Automation builder
**Story.** As JK, I build "when X happens, if Y, do Z" automations visually:
- "When a client cancels late, wait 1 hour, send this message, and create a task to call them."
- "Every Monday 08:00, nudge everyone in *Quiet 5+ days*."
- "When someone enters *At risk*, notify me and offer a check-in call."

I can test one on a client before turning it on, and see every run.

**Screens.**
- `/automations`, with three tabs:
  - **Automations**: cards with a status toggle, the trigger summary in words, runs in 30 days, last run, and errors.
  - **Recipes**: a one-click gallery that creates a draft from a recipe.
  - **Sequences (legacy)**: the existing autoflows, read-only here, each with "Edit in Programs" and "Convert to automation".
- `/automations/:id/:tab?` (Build, Runs):
  - **Build canvas**: a vertical flow, centred.
    - A Trigger node, then an optional Conditions node, then step nodes joined by connector lines with a "+" between each pair.
    - Drag steps to reorder them. Clicking a node opens the inspector slide-over with fields from the catalogue's ParamSpecs.
    - Each node shows a plain-English sentence ("Wait 2 days, then at 07:30").
  - Above the canvas, the whole automation reads as one sentence.
  - The header has: Test on… (a client picker that shows the simulated timeline with rendered messages; **nothing is sent**), Save, and Turn on.
  - **Runs**: a `dataTable` of runs (client, started, status, current step), and a per-run log timeline. Stop run.

**Model.**
```json
{ "trigger":   { "type": "event", "event": "booking.cancelled", "where": { "late": true, "byRole": "client" } }
            |  { "type": "schedule", "days": [1], "at": "08:00", "audience": { "segmentId": "sg_…" } }
            |  { "type": "enters", "rules": { …Rules… } }
            |  { "type": "manual" },
  "conditions": { …Rules… } | null,
  "steps": [ { "id": "s1", "type": "wait", "days": 0, "hours": 1, "at": null },
             { "id": "s2", "type": "action", "action": "message.send", "params": { "text": "Hi {first}…" }, "if": null },
             { "id": "s3", "type": "action", "action": "task.create", "params": { "title": "Call {first}" } } ],
  "settings": { "reentry": "never" | "always" | { "cooldownDays": 14 }, "quietHours": true,
                "stopOn": ["message.received"], "maxPerDay": 50 } }
```
- Steps: at most 20.
- Waits: `days` 0–365, `hours` 0–72, and `at` "HH:MM" London (wait until that clock time after the delay).
- Quiet hours and the daily cap are applied by the outreach governor in `sendMessage` (3.5), so every message action is governed; the engine logs
  "Deferred to 07:30" or "Skipped: outreach paused" from the result. The `quietHours` setting is kept only to let a coach **opt a single automation out of
  starting runs** during quiet hours.
- `stopOn` events for the same client stop the run.
- `if` on a step is evaluated against the facts at execution time. False means the step is skipped and logged.

**Engine.**
- `on['*']`, for **event** triggers:
  - for each live automation of the event's coach whose trigger matches the type and every `where` key equals the payload value;
  - and the client passes the conditions and the re-entry policy;
  - create a run with `next_at = now`.
- **enters** triggers: a clock every 15 min evaluates the rules for the coach's clients and stores membership in `automation_state`. A false → true change starts a run.
  The first evaluation only records membership; it never starts runs, to avoid a flood when the automation is turned on.
- **schedule** triggers: a clock every minute. At `days`/`at` (London), resolve the audience and start runs (once per scheduled slot, via `automation_state.last_slot`).
- **Advancing runs**: a clock every 30 s processes runs with `next_at ≤ now`, in batches of 100, executing steps until it reaches a wait (setting `next_at`) or the end.
  - Each step runs in its own tx. The log line is written with the outcome.
  - A failed action logs `failed: <reason>` and continues with the next step, unless the action is marked `critical`. No retries.
- Runs for a client whose coach changed are stopped. Runs on paused clients (`crm.stage = paused`, if the fact exists) are deferred, except notify-coach and task actions.
- `client.offboarded` stops every active run of that client (logged "Stopped: coaching ended"); WP5's `offboarding` hook lists them first.
- **AI-derived triggers and conditions (6.3, D5).** An automation whose trigger event, `where` keys, `enters` rules, conditions or step `if` use anything marked
  `aiDerived` in the catalogue (every `voice.*` and `ai.*` event, `voice.sentiment14`) may contain **only** `coach.notify`, `task.create`, `tag.add`,
  `tag.remove` and `ai.draft` steps. Saving or turning on one with a client-facing step (`message.send`, `form.send`, `program.assign`, `offer.issue`,
  `campaign.enrol`, `pulse.send`, `accountability.nudge`, `invoice.create`, `lifecycle.*`) gives 400 "Steps that message clients can't run on AI judgements".
  The engine re-checks at run time and logs `refused: aiDerived` instead of acting. Actions declare `clientFacing: true|false` in their spec; unknown means true.
- `maxPerDay` caps starts per automation per London day. Overflow is logged and dropped, and the coach is notified once.
- Demo coach: automations run inside the demo world only. Pushes are skipped by `notify` (existing).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live','paused')),
  trigger TEXT NOT NULL, conditions TEXT, steps TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}',
  recipe TEXT, from_autoflow_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY, automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active','done','stopped','failed')),
  step_index INTEGER NOT NULL DEFAULT 0, next_at TEXT, trigger_seq INTEGER,
  log TEXT NOT NULL DEFAULT '[]',          -- [{stepId, at, outcome}] capped at 50 entries
  started_at TEXT NOT NULL, finished_at TEXT);
CREATE INDEX IF NOT EXISTS automation_runs_due ON automation_runs(status, next_at);
CREATE TABLE IF NOT EXISTS automation_state (
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inside INTEGER NOT NULL DEFAULT 0, last_started_at TEXT,
  PRIMARY KEY (automation_id, client_id));
CREATE TABLE IF NOT EXISTS automation_slots (
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  slot TEXT NOT NULL, PRIMARY KEY (automation_id, slot));   -- '2026-11-24T08:00' London
```

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/automations/catalogue` | none | `{events:[{type, label, payload, feature}], actions:[{id, label, params, feature}], facts:[…], variables:[…], lookups:{forms, programs, tags, segments, campaigns?, packages?, discounts?}}` |
| GET | `/api/automations/recipes` | none | `{recipes:[{id, name, description, automation}]}` |
| GET/POST | `/api/automations` | `{name, trigger, conditions?, steps, settings?, recipe?}` | `{automations:[…+stats]}` / `{automation}` |
| GET/PUT/DELETE | `/api/automations/:id` | same | |
| POST | `/api/automations/:id/status` | `{status:'live'\|'paused'\|'draft'}` | `{automation}` (live validates every action and param exists) |
| POST | `/api/automations/:id/test` | `{clientId, event?: {type, payload}}` | `{willRun:bool, reason?, timeline:[{at, stepId, description, rendered?, skipped?}]}`; **no side effects** |
| POST | `/api/automations/:id/enrol` | `{clientIds}` (manual trigger only) | `{started:n, skipped:[…]}` |
| GET | `/api/automations/:id/runs` | `?status=` | `{runs:[…]}` |
| POST | `/api/automations/runs/:runId/stop` | none | `{run}` |
| POST | `/api/automations/from-autoflow/:autoflowId` | none | `{automation}` (a draft: join → `client.joined`, manual → manual; steps become a wait plus an action) |

**Recipes (built in):**
1. Late-cancel follow-up.
2. No-show check-in (on `booking.noShow` from WP7).
3. Welcome series (`client.joined`: day 0 message, day 2 form, day 7 check).
4. Quiet 5 days nudge (enters `core.daysQuiet ≥ 5`).
5. At-risk alert (`client.stageChanged` to atRisk: notify coach plus task).
6. Session reminder (on `booking.upcoming` with `hoursBefore=24`, from WP7).
7. Payment thank-you (`payment.recorded`).
8. Package running low (`package.low`: message plus offer).
9. NPS at day 30 (enters `core.daysSinceJoined ≥ 30`: action `pulse.send` from WP8).
10. Campaign kickoff (`campaign.enrolled`).
11. Missed commitments (`commitment.reviewed` with `outcome=missed`).
12. Onboarding stalled 5 days (`onboarding.stalled`: message for the next step plus coach.notify; F27).
13. Package renewal offer (enters `billing.packageExpiresDays ≤ 14` or `billing.credits ≤ 1`: message with `{packageLeft}` plus a task).
14. Campaign finished, next offer (`campaign.completed`: wait 3 days, message, task "Offer the next block").
15. Win-back 60 days after ending (enters `crm.daysSinceEnded ≥ 60`: `offer.issue` plus message; F8).
16. Birthday message (enters `crm.birthdayInDays = 0`, at 09:00; F7).
17. Coaching anniversary (enters `core.anniversaryInDays = 0`, at 09:00: "{yearsCoached} year(s) together").
18. Voice flag follow-up (`voice.flagged`: **coach.notify plus task only**, the reference example of an AI-derived automation).

A recipe whose action or event is missing from the catalogue is shown greyed out, "Needs <feature>".

**Events.** Emits `automation.started`, `automation.finished`, `automation.failed`.

**Demo.**
- 6 live automations: Late-cancel, Welcome, Quiet 5 days, At-risk alert, Session reminder, Birthday message.
- About 30 historical runs with logs, and 2 active waiting runs.
- **No** automation in demo is `client.joined`-triggered and live *and* able to touch a non-demo client. Demo isolation is guaranteed by coach scoping; tests assert it.

**Tests.**
- Trigger matching with `where`.
- Conditions and step `if`.
- Waits with `at`, across the DST boundary (last Sunday of March and of October).
- Quiet-hours deferral.
- Re-entry and cooldown.
- `stopOn`.
- An enters trigger does not flood on first evaluation.
- A schedule fires once per slot across restarts.
- `maxPerDay`.
- Test mode has no side effects: no rows in messages, tasks or events.
- **Saving an automation that triggers on `voice.analysed` (or uses `voice.sentiment14`) with a `message.send` step gives 400; turning one on fails the same way;
  and a `voice.analysed` event with flags never creates a `messages`, `scheduled_messages`, `deferred_messages` or `broadcasts` row.**
- Every message step is governed: the 4th automated message of the day is deferred, and a paused client's step is skipped and logged.
- `client.offboarded` stops the client's runs.
- Converting an autoflow.
- Isolation: an event of coach A never starts coach B's automation.
- A throwing action logs the failure and continues.

#### F16 Message templates and snippets
**Story.** As JK, my best messages are one keystroke away. I type `/checkin` in any composer, and a personalised message drops in
with Sam's name and next session filled.

**Screens.**
- `/templates`:
  - a list grouped by category, with search and usage counts;
  - the editor has a live preview against a chosen client, with clickable variable chips. Missing variables are highlighted.
- Composer integration: `registerComposerTool` "Templates" opens a popover with search, and `registerSlash` adds a shortcut for each template.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS message_templates (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','welcome','onboarding','nudge','celebrate','billing','renewal','session','campaign','winback','checkin')),
  shortcut TEXT, uses INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_shortcut ON message_templates(coach_id, shortcut) WHERE shortcut IS NOT NULL;
```

**API.**
- `GET/POST /api/templates`
- `GET/PUT/DELETE /api/templates/:id`
- `POST /api/templates/render {templateId? | text?, clientId}` → `{text, missing}`
- `POST /api/templates/:id/used` → increments `uses`
- `GET /api/templates/variables` → `{variables:[{name, label, example}]}`

**Template action.** Templates are also chosen in `message.send` params: the builder offers "Insert template", which copies the text in.

**Demo.** 12 templates across the categories, with shortcuts: `/checkin`, `/welcome`, `/great`, `/missed`, `/invoice`, `/reschedule`, `/winback` and others.

**Tests.**
- Rendering with built-in and feature variables (stub a feature variable in the test through `allVariables`).
- `missing` is reported.
- The shortcut is unique per coach and may repeat across coaches.
- Isolation.

#### F17 Scheduled messages and segment broadcasts
**Story.** As JK, I write a message now and have it go out tomorrow at 07:00. I send a personalised message to a whole segment
("Everyone in Marathon Build: race-week plan is up"), with a preview of exactly who gets what, and I can see who read and replied.

**Screens.**
- Composer tool "Schedule" (a clock icon) opens a popover with suggestions (tomorrow 07:00, Monday 07:00, or pick). A scheduled message shows in the thread as a ghost bubble
  with "Scheduled · Tue 07:00", edit and cancel.
- `/broadcasts`:
  - list: name, audience, sent or scheduled, recipients, read %, reply %.
  - editor (`/broadcasts/:id`), a wizard:
    1. **Audience**: segment, tags, rules or hand-picked, with a live count and avatars.
    2. **Message**: the composer with templates and AI check. Voice notes are not allowed in broadcasts.
    3. **Preview**: renders for 5 sample recipients, and lists missing variables.
    4. **When**: now or scheduled.
    5. **Send**: a confirm box showing the recipient count.
- Stats: delivered, read (`messages.read_at`), and replied (a client message within 72 h).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,                     -- template text; rendered at send time
  media_id TEXT, send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sending','sent','cancelled','failed')),
  broadcast_id TEXT, message_id TEXT, error TEXT,
  created_at TEXT NOT NULL, sent_at TEXT);
CREATE INDEX IF NOT EXISTS scheduled_messages_due ON scheduled_messages(status, send_at);
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, audience TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  send_at TEXT, recipients INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, sent_at TEXT);
```

Rules:
- **Sending clock** (every 20 s):
  - claim due rows with `UPDATE … SET status='sending' WHERE id=? AND status='scheduled'`;
  - render;
  - `sendMessage` with `via:'scheduled'` or `'broadcast'`;
  - set `sent` and `message_id`.
- **Quiet hours and caps.** Broadcasts send with `via:'broadcast'`, so the governor (3.5) applies quiet hours, the daily cap and `noBroadcasts`; the audience is
  resolved with `purpose:'broadcast'` and the preview shows "2 skipped: no broadcasts". A one-off scheduled message (`via:'scheduled'`) is the coach's own
  choice of time and is sent exactly then, ungoverned.
- **End of coaching.** `client.offboarded` cancels the client's scheduled rows (`status='cancelled'`, `error='coaching ended'`).
- **Recipients.** A broadcast's recipients are frozen when it is sent or scheduled. At most 300 recipients, and one broadcast per coach per minute (rate limit).
- **Coach change.** If the client's coach changes before sending, the row fails with "no longer your client".

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/scheduled-messages` | `?clientId=&status=` | `{items:[…]}` |
| POST | `/api/scheduled-messages` | `{clientId, text, mediaId?, sendAt}` (`sendAt` in the future, ≤ 180 days) | `{item}` |
| PATCH | `/api/scheduled-messages/:id` | `{text?, sendAt?}` (only while scheduled) | `{item}` |
| DELETE | `/api/scheduled-messages/:id` | none | `{ok}` (cancels) |
| GET/POST | `/api/broadcasts` | `{name, audience, body}` | `{broadcasts}` / `{broadcast}` |
| GET/PUT/DELETE | `/api/broadcasts/:id` | | `{broadcast, stats?:{recipients, read, replied}}` |
| POST | `/api/broadcasts/preview` | `{audience, body}` | `{count, samples:[{client, text, missing}]}` |
| POST | `/api/broadcasts/:id/send` | `{sendAt?}` | `{broadcast}` |

**Events.** Emits `scheduled.sent`, `broadcast.sent {broadcastId, recipients}`.

**Inbox and timeline.** Scheduled messages show as timeline items, "Scheduled · Tue 07:00".

**Demo.** 2 scheduled messages (tomorrow 07:00) and 3 past broadcasts with stats, to the "Marathon 2027" tag and to "Everyone".

**Tests.**
- Claim-once sending under two concurrent ticks.
- Render at send time (a name change between schedule and send is reflected).
- Audience freeze.
- Cap and rate limit.
- Quiet-hours deferral and `noBroadcasts` for broadcasts; none for a scheduled one-off.
- `client.offboarded` cancels scheduled rows.
- Isolation: you cannot schedule to a foreign client (404).
- Cancel.
- Stats.

### AI and voice (WP6)

#### F18 AI second opinion (advice check before sending) and drafting assist
**Story.** As JK, before an important message goes out, I can ask the AI to check it:
- **safety** (am I giving medical advice, missing a red flag?);
- **consistency** with what I know about this client (their injury, plan, goal, what I said last week);
- **tone** and **clarity**.

I get a verdict, specific issues and a suggested rewrite. I decide; nothing is ever sent without me pressing Send. I can also ask for a
draft reply, or a summary of a client's last two weeks.

**Screens.**
- **Composer tool "Check"** (`auto_awesome`), and send guard `ai-review` (order 10):
  - review mode `off`: no guard;
  - `ask`: the Check button only;
  - `always`: every coach message, letter, broadcast and scheduled message is checked on Send.
- **Review panel** (shown above the composer by the guard, or in a popover from the button):
  - the verdict pill, worded and with a glyph: **Looks good** (`verified`, on-track), **Worth a look** (`gpp_maybe`, attention), **Stop and check** (`warning`, urgent);
  - a one-line summary;
  - the issues, each with a kind chip (Safety, Consistency, Tone, Clarity, Scope), the quoted fragment highlighted in the draft, and a note;
  - "What I checked against": the facts that were sent, listed openly;
  - a rewrite shown as a diff, word-level using LCS: insertions in accent, deletions struck through;
  - buttons: **Send original** · **Use rewrite** (loads it into the composer; it is not sent) · **Edit** · **Dismiss**.
    With a `stop` verdict, Send original needs a second click ("Send anyway") and records `overridden`.
- **Voice notes from the coach** (desk recorder, F19): after Stop, the preview offers **Transcribe & check before sending**. It uploads the recording
  (purpose `voice`, not yet sent), transcribes it through `ai.listen` with purpose `review`, and runs the review on the transcript; the panel is the same.
  The coach then sends the recording or re-records. On send, the voice queue (F19) finds the review by `media_id` and copies its transcript instead of calling
  the model again. Without the check, a coach voice note is
  transcribed only after it is sent.
- **Route to JK for approval** (D13, reserved): a send-guard option, off by default and shown only when prefs `review.routeToApproval` is on. Instead of sending,
  it stores the draft as an `ai_reviews` row with `decision='pendingApproval'` and puts a `draft:<reviewId>` item in the Inbox ("Draft awaiting approval: Sam").
  Approving opens the composer prefilled; JK presses Send. It exists so an assistant-coach role can be added later without a schema change; today JK can use it
  to park a sensitive message.
- **Draft assist** (composer tool "Draft"): an intent (Reply to last message, Nudge, Celebrate, Reschedule, Free text) plus an optional note. It returns a draft into the
  composer, marked with a small "AI draft" chip until the coach edits it.
- **Client summary**: a client 360 Overview tile, "Last 14 days in brief" (AI or stub), with a refresh button.
- **Settings › AI** (`registerSettingsSection`):
  - provider status, model, today's usage against the limits;
  - toggles: AI on, review mode, transcription, analysis, drafts;
  - a plain-English "What is sent to the AI" box (the 6.3 list);
  - a link to the review log (`/account/ai?log=1`), which shows past reviews with their decisions.

**Prompt contract** (`features/aireview.mjs`):
- **System**: "You are a careful second reader for a personal trainer called {coachFirst}. You never write to the client. You check a draft
  message from the trainer to a client for: (1) safety: medical diagnosis or treatment advice beyond a trainer's scope, ignoring reported
  pain, injury, illness or mental-health red flags, unsafe loads or nutrition; (2) consistency with the client facts given; (3) tone: warm, direct,
  British English, no shaming; (4) clarity: one clear ask. Return JSON only."
- **Schema**:
  `{verdict:'ok'|'caution'|'stop', summary:string≤200, issues:[{kind:'safety'|'consistency'|'tone'|'clarity'|'scope', severity:'low'|'medium'|'high', quote:string≤200, note:string≤300}] (≤6), rewrite:string|null (≤4000)}`.
- The rewrite keeps the coach's voice and length within ±30%, or is `null` when the verdict is ok.

**Context minimisation** (built server-side, only these fields):
- the client's first name;
- plan name;
- goal text and aim;
- `profile` injuries and limitations fields and training experience;
- pain flags and notes from the last 4 check-ins;
- current priorities and this week's commitments;
- the next session's date and kind;
- the last 8 thread messages (text only, each ≤ 500 chars, labelled coach or client, voice notes as their transcript if done);
- campaign name and day, if active.

Every text field goes through `redactForAi` (3.13) first. Never sent: surname, email, phone numbers, postcodes, URLs, health samples, photos, invoices or money.
The **health data** sent for advice checks is exactly: injuries and limitations from `profile`, pain flags and notes from the last 4 check-ins, and pain or
injury words inside the thread excerpts. The 6.3 privacy paragraph lists these.

**Stub reviewer** (deterministic):
- **stop** if the draft matches a medical-advice pattern (`/\b(diagnos\w*|prescri\w*|ibuprofen|paracetamol|naproxen|steroid|you (have|'ve got) (a )?(tear|fracture|sprain))\b/i`)
  **or** the client has a pain flag in the last 14 days and the draft does not mention pain, injury or the body part.
- **caution** for ALL-CAPS words, more than 3 exclamation marks, more than 1200 characters, or no question or clear ask.
- **ok** otherwise.
- The rewrite is the draft with "[Stub] " and the fixed phrasing for each rule.
- The summary starts "[Stub] ".

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS ai_reviews (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  surface TEXT NOT NULL,                  -- message|letter|broadcast|scheduled
  draft TEXT NOT NULL, verdict TEXT NOT NULL CHECK (verdict IN ('ok','caution','stop')),
  summary TEXT NOT NULL, issues TEXT NOT NULL, rewrite TEXT, facts_used TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT,
  decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','sentOriginal','usedRewrite','edited','dismissed','overridden','pendingApproval','approved','rejected')),
  message_id TEXT, media_id TEXT, transcript TEXT,          -- media_id/transcript: voice reviews only
  created_at TEXT NOT NULL, decided_at TEXT);
CREATE INDEX IF NOT EXISTS ai_reviews_coach ON ai_reviews(coach_id, created_at);
```
- The draft text is stored because it is the coach's own words and the audit needs it.
- Reviews are pruned after 180 days.
- Reviews of a client are included in that client's GDPR export (they concern the client).

**API (coach).**

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/ai/review` | `{clientId?, surface, text, audience?}` (`audience` for broadcasts: reviewed against generic context, no client facts) | `{id, verdict, summary, issues, rewrite, factsUsed:[label], provider, model}` |
| POST | `/api/ai/review/:id/decision` | `{decision, messageId?}` | `{ok}` (the review is loaded with `ownRow`; `messageId` must be a message in **the same client's thread**, reached through `clientFor`, or for a broadcast review a `broadcasts`/`scheduled_messages` id owned by the coach; else 404) |
| POST | `/api/ai/review/voice` | `{clientId, mediaId}` (an unsent voice upload of this coach for this client) | same as `/api/ai/review`, with `transcript` added |
| POST | `/api/ai/approvals` | `{clientId, surface, text}` | `{id}` (files a `pendingApproval` draft in the Inbox; never sends) |
| GET | `/api/ai/reviews` | `?clientId=&before=` | `{reviews:[…]}` |
| POST | `/api/ai/draft` | `{clientId, intent, note?}` | `{text, provider, model}` (never stored as a message) |
| POST | `/api/coach/clients/:id/ai-summary` | `{days:14}` | `{bullets:[string], provider, model, at}` |

**Actions.**
- `ai.draft {intent, note}` (for automations) creates an **inbox item** "Draft ready for Sam" (key `draft:<reviewId-like id>`). It is stored in `ai_reviews` with `surface='message'`,
  verdict `ok` and decision `pending`, and the draft goes in `rewrite`. Approving it opens the composer prefilled. **It never sends.**

**Events.** Emits `ai.reviewed {verdict, decision}` (no text), `ai.overridden`.

**Rate limits.** `limit('ai:'+coachId, {max: 30, perMs: 60_000})` on top of the daily caps.

**Demo.**
- Review mode `ask`, with 8 past reviews (mixed verdicts and decisions; the stub texts are clearly marked).
- 2 pending AI drafts in the inbox.

**Tests.**
- Stub verdicts for each rule.
- The context builder includes only the allowed fields (assert the exact key set and that no email or surname appears).
- OpenRouter path with a faked `fetchImpl`: the request carries the system and user messages, `provider.data_collection: 'deny'`, the model comes from config, and the JSON is parsed (including fenced JSON).
- A provider error is labelled and **not** stubbed.
- The demo coach always gets the stub.
- Decisions are recorded.
- **The review endpoint never creates a message row.**
- An `ai.draft` action creates no message.
- A `decision` with a `messageId` from another client's thread, or another coach's, gives 404.
- "Route to JK for approval" creates an inbox item and **no** message row.
- The voice review transcribes once and the later send reuses the transcript.
- The context builder output contains no email, phone number, postcode, URL or surname from a seeded message that contains all of them.
- The daily cap gives a 429.

#### F19 Voice notes both ways, with transcription and analysis (desk, iOS, Android)
**Story.** As JK, I record a quick voice note to a client from the desk or my phone, and clients can send me voice notes from the app.
Every voice note is transcribed, **if the client has agreed**. For clients' notes I also get a short summary, the mood, topics, action items and risk flags
(pain, injury, illness, low mood, wanting to cancel), so nothing said out loud gets missed, and I can search what people said.

**Consent (D16).** Before a client's first voice note, the apps show a one-time sheet:
> "Voice notes are transcribed and summarised for JK by an AI service (OpenRouter, using <provider of AI_AUDIO_MODEL>). The summary is seen only by JK."
> **[Allow]**  **[Send without transcription]**
- The choice is stored per client (`client_ai_consent.voice` = `on` | `off`; no row = `ask`) through `PUT /api/voice/consent {voice:'on'|'off'}` (client), and can be
  changed any time in the app's Account › Privacy. Withdrawing stops processing of new notes at once; it does not delete existing transcripts (the client can ask JK, or erase the account).
- The server **never** calls `listen()` for a client note without `on`: the row is `off` with reason `noConsent`, and nothing leaves the server.
- The coach's own notes are the coach's voice, covered by the coach's AI settings (Settings › AI), not by client consent. They are transcribed only;
  no analysis is ever run on coach notes.
- The Client 360 header shows the state (F5): `Voice AI: allowed`, `not asked`, `declined`.
- `me.features.voiceTranscription` ∈ `ask` | `on` | `off` tells the apps whether to show the sheet. `settings.mjs` `featuresOf` merges `hooks('meFeatures')`, which voice.mjs provides.

**Server (WP6 owns `media.mjs`, `messages.mjs`, `timeline.mjs`, `settings.mjs` in wave 1).**
- **`media.mjs`**:
  - `PURPOSES` adds `voice` and `guide`.
  - `TYPES` adds `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/wav`, `audio/aac` and an empty or unknown `audio/*` label: for purposes `voice` and `letter`
    the container is decided by `audio.sniffAudio(bytes)` (3.14), never by the label. `looksRight` uses the same sniffer, so HEIC or video in an `ftyp` box is refused.
  - **Early 413.** The route registers `rawBody` per purpose: for `voice` and `letter` it rejects on `content-length` above 10 MB **before** reading the body
    (today every purpose is read up to the 60 MB video limit). Test: an 11 MB voice upload gets 413 without the body being buffered.
  - **Coach uploads for `voice` and `letter` require `clientId`** (400 "Say which client this is for"), so `media.client_id` is always set and `canSeeMedia` limits the
    file to that client.
  - **Always converted.** For purposes `voice` and `letter`, every upload (m4a included) goes through `audio.toM4a` with the sniffed format, outside any tx.
    The stored row is the m4a (`mime audio/mp4`, ext `m4a`); temp files are deleted in `finally`.
    - No audio stream → 415 "No audio in that file".
    - The duration is the **probed** one. Longer than the purpose's cap + 2 s → 400 "Voice notes can be up to 5 minutes" (it is refused, not clamped).
    - Caps: `voice` 300 s, `letter` 90 s. The `durationSec` query parameter is validated against the purpose's cap (today `max: MAX_SECONDS` = 90 for all)
      and then only used when ffmpeg is missing.
    - **ffmpeg missing**: an m4a is accepted as-is if `sniffAudio` says `mov` with a major brand of `M4A `, `mp42` or `isom`; anything else gets 415
      "This server can't convert that recording; send m4a".
  - Per-user daily upload caps and the conversion queue limit (3.14): 429 and 503.
- **`messages.mjs`**:
  - `kind` accepts `voice`. `send()` requires that the media is `kind='audio'`, `purpose='voice'`, and `media.client_id === client.id` (the thread's client),
    and that no other message already uses that media (400 "That voice note is for someone else" / "That voice note has already been sent").
    `CREATE UNIQUE INDEX IF NOT EXISTS voice_analyses_media ON voice_analyses(media_id)` backs it.
  - Audio media is never inferred as `mealPhoto` again.
  - A client sending `voice` needs the coach toggle `voiceNotes` (`settings.mjs` `COACH_DEFAULTS.voiceNotes = true`, a whitelisted key, exposed in `me.features.voiceNotes`).
  - The fallback text is `Voice note · m:ss`, and the push body is the same.
  - **`messageOut(m, { coachView = false } = {})`**: the default is the **client view**. Analysis fields are attached only when the caller passes `coachView: true`,
    which a caller may do only after checking `ctx.user.role === 'coach'`. Extra fields come from `hooks('messageExtras')` (voice.mjs provides them), so
    `messages.mjs` never imports a feature file. Call sites to change: `messages.mjs` `threads`, `list` (`messages` and `updated`) and `send`'s response;
    `timeline.mjs`; WP1's inbox detail; `search.mjs` message results; `voice.mjs` `GET /api/voice`. Every other call site keeps the client view.
  - Every message with media gains `mediaKind` ∈ `image` | `video` | `audio`.
  - **Voice messages carry no top-level `mediaId`/`mediaUrl`** (`null`). Builds already in the field render any `mediaId` as an image or video
    (`MessageMedia(mediaId, isVideo: kind == "formCheck")`, iOS `Client/JKView.swift:349` and `MessagesView.swift:172`; Android `client/JKView.kt:361` and
    `MessagesView.kt:317`), which would download up to 10 MB of audio and spin forever. They therefore see only the text "Voice note · 0:42". The audio lives in
    `voice.mediaId`, `voice.url` and `voice.durationSec`.
- **`timeline.mjs`**: voice messages carry the same `voice` block, client view. `/api/timeline` accepts `since=<cursor>` and returns `updated:[item]` the same way as
  messages (3.15), so the client's chat can pick up a transcript that arrives later.
- **Transcription queue** (`features/voice.mjs`):
  - On `message.sent` and `message.received` with kind voice, insert a `voice_analyses` row with status `pending`, or `off` with a reason:
    `aiOff` (coach AI or transcription off), `noConsent` (client note without consent), `quota` (per-client or coach audio budget spent, 3.13).
    A coach note that already has a transcript from a voice review (F18, matched by `media_id`) is written as `done` at once.
  - The clock runs every 10 s and processes 1 row at a time:
    1. Load the client, then **the coach** (`users WHERE id = client.coach_id`), and pass the coach as `user` (3.13); `client.is_demo || coach.is_demo` means stub.
    2. `ai.listen()` with purpose `transcribe`, in a single call that returns the transcript **and**, for client-originated notes with analysis on, the analysis JSON.
       Coach-originated notes get the transcript and a one-line summary only. The temp mp3 is deleted in `finally`.
    3. After the await, write in **one tx** that re-selects the `voice_analyses` row and the message; if either is gone (erased, deleted, reassigned), stop quietly.
       Otherwise update the row, bump `messages.updated_at`, and emit `voice.analysed`.
    4. Call `notifyCoach` when flags exist and the client still exists (tone urgent for pain, injury, illness, mentalHealth or safeguarding, which also pushes, 3.3).
  - Failures go to status `failed` with an error, retried once after 5 min, then left. The coach can press "Retry transcription".
  - **Stub**: the transcript is `"[Stub transcript] Voice note from {first}, {m:ss} long. Transcription is off on this server."`
    The analysis is `{summary:"[Stub] No analysis without an AI provider.", mood:"unknown", sentiment:0, topics:[], actions:[], flags:[]}`.
    In the demo world, the builder writes rich, pre-written transcripts labelled with provider `stub`, so the UI can be judged.
  - **Retention**: analysis fields (summary, mood, sentiment, topics, actions, flags) and transcripts are deleted **12 months after End coaching** (voice consumes
    `client.offboarded` and keeps `voice_client_state(client_id PK, ended_at)`), and analysis fields of any note are deleted after **24 months** regardless. A daily clock does it;
    the audio itself follows the message.
- **Access** always goes through the **current** owner: every read joins `users u ON u.id = va.client_id AND u.coach_id = ?` (or goes through `clientFor`), and never
  trusts the stored `voice_analyses.coach_id`. `POST /api/voice/:messageId/retry` resolves the message, then calls `clientFor(ctx, message.client_id)`.
  After `admin.mjs assign` moves a client, the old coach gets 404 or empty lists and the new coach sees the rows.
- **Analysis schema**:
  `{transcript, language, summary(≤240), mood:'upbeat'|'steady'|'flat'|'low'|'stressed'|'unknown', sentiment:-1..1, topics:[≤5 short], actions:[{text, owner:'coach'|'client'}] (≤5), flags:[{kind:'pain'|'injury'|'illness'|'mentalHealth'|'safeguarding'|'cancelIntent'|'billing', quote, severity:'low'|'medium'|'high'}]}`.
- **AI-derived.** `voice.analysed`, `voice.flagged` and `voice.sentiment14` are declared `aiDerived: true` (F15 refuses client-facing steps on them; 6.3).

**The `voice` block** (published in `docs/api/wp6-ai-voice.md` on day one, with JSON fixtures both apps decode in unit tests):
```json
// client view (every viewer)
"mediaId": null, "mediaUrl": null, "mediaKind": "audio",
"voice": {
  "mediaId": "md_…" | null,          // null only when status = deleted
  "url": "/api/media/md_…" | null,
  "durationSec": 42,
  "status": "pending" | "done" | "failed" | "off" | "deleted",
  "reason": null | "aiOff" | "quota" | "noConsent",   // set only when status = off
  "transcript": "…" | null,           // non-null only when status = done
  "provider": "stub" | "openrouter" | null,           // null unless done
  "model": "…" | null                 // null unless done with openrouter
}
// coach view (coachView: true) adds, when status = done and the note is from the client:
  "summary": "…", "mood": "low", "sentiment": -0.4, "topics": ["knee","sleep"],
  "actions": [{"text":"Send a deload week","owner":"coach"}], "flags": [{"kind":"pain","quote":"my knee's been sore","severity":"medium"}]
```
App copy per state: `pending` "Transcribing…"; `done` "Automatic transcript, may contain mistakes" (or "Sample transcript (AI is off)" when `provider == "stub"`);
`failed` "Couldn't transcribe this one"; `off` + `aiOff` "Transcripts are off"; `off` + `quota` "Transcript not available today"; `off` + `noConsent` "Not transcribed"
(shown to the client as "You chose no transcription · Change"); `deleted` "Voice note deleted" (no player).

**Error table** (also in the contract):

| Call | Status | Message |
|---|---|---|
| `POST /api/media?purpose=voice` | 413 | "Voice notes are limited to 10 MB" |
| | 415 | "No audio in that file" / "This server can't convert that recording; send m4a" |
| | 400 | "Voice notes can be up to 5 minutes" / "Say which client this is for" (coach) |
| | 429 | "That's a lot of voice notes today" |
| | 503 | "Busy, try again in a minute" |
| `POST /api/messages` kind `voice` | 400 | "That voice note is for someone else" / "That voice note has already been sent" |
| | 403 `not_enabled` | "Voice notes are off" |

**Deleting.** `DELETE /api/media/:id` on a voice media deletes the file and (by cascade) its `voice_analyses` row; the message stays as a tombstone
(`kind:'voice'`, `voice.status:'deleted'`, text "Voice note deleted").

**Client refresh rule.** While any visible voice item is `pending`, the apps refetch with `since=<cursor>` every 10 s for up to 2 minutes (coach thread: `/api/messages`;
client chat: `/api/timeline`), merging `updated` by id.

**API.**
- `POST /api/media?purpose=voice&clientId=&durationSec=` (raw body). Accepts the audio types above.
- `POST /api/messages {clientId?, kind:'voice', mediaId, text?}` (`text` is an optional caption, stored as the message text instead of the fallback).
- `GET /api/messages?clientId&after&since` → `{messages, updated, cursor}` (3.15); `GET /api/timeline?since=` → `{items, updated, cursor}`.
- `PUT /api/voice/consent {voice:'on'|'off'}` (client) → `{voice}`. `GET /api/coach/clients/:id/ai-consent` (coach) → `{voice:'ask'|'on'|'off', at}`.
- `POST /api/voice/:messageId/retry` (coach) → `{voice}`.
- `GET /api/voice?clientId=&flagged=1&q=` (coach) → `{items:[{message, client, voice}]}`. This is the transcripts search and list behind the client 360 "Voice" tab.
- `me.features` gains `voiceNotes` (bool), `voiceMaxSec` (300) and `voiceTranscription` (`ask`|`on`|`off`); coaches always have `voiceNotes`.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS voice_analyses (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- informational only; access joins the CURRENT owner
  direction TEXT NOT NULL CHECK (direction IN ('toClient','fromClient')),
  status TEXT NOT NULL CHECK (status IN ('pending','done','failed','off')),
  reason TEXT CHECK (reason IN ('aiOff','quota','noConsent')),
  attempts INTEGER NOT NULL DEFAULT 0, next_try_at TEXT, audio_seconds REAL,
  transcript TEXT, language TEXT, summary TEXT, mood TEXT, sentiment REAL,
  topics TEXT NOT NULL DEFAULT '[]', actions TEXT NOT NULL DEFAULT '[]', flags TEXT NOT NULL DEFAULT '[]',
  provider TEXT, model TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS voice_analyses_status ON voice_analyses(status, next_try_at);
CREATE UNIQUE INDEX IF NOT EXISTS voice_analyses_media ON voice_analyses(media_id);
CREATE TABLE IF NOT EXISTS client_ai_consent (
  client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  voice TEXT NOT NULL CHECK (voice IN ('on','off')), at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_client_state (
  client_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, ended_at TEXT);
```

**Hooks and facts.**
- `needs`: a voice flag of pain, injury or illness in the last 7 days, not yet replied to, gives rank 1 (pain) with the text "Mentioned knee pain in a voice note".
- `inbox`: client voice notes not yet listened to (`voice:<messageId>`) with the actions Mark done and "Add actions as tasks" (calls `task.create` for each action, if registered).
- `search`: transcripts (coach only, current owner).
- `facts`: `voice.sentiment14` (number, the mean for the client's notes over 14 days, or `null`; `aiDerived`).
- `timeline`, `messageExtras`, `meFeatures`.
- `exportFor`: the client's transcripts **and** analyses, under `features.voice.analyses`: this is the one client-facing place analysis appears (a subject access
  request, 6.3).

**Desk (WP6 owns `messages.js`, `messages.css`, `letters.js`; new `f-voice.js/.css`, `f-ai.js/.css`).**
- **Thread redesign.**
  - Bubbles with day separators.
  - Media rendering for images (with a lightbox), video (an inline player with poster), and audio as a **VoiceBubble**: play/pause, a waveform (bars computed once from
    the decoded audio with `AudioContext.decodeAudioData` into 48 peaks, cached by media id), the elapsed time, and a 1×/1.5×/2× speed control.
    Under it: a "Transcript" disclosure, then for coach viewers the mood chip, topic chips, flag pills (worded, with a glyph) and an action-items checklist with "→ Task".
    Pending shows a shimmer, "Transcribing…". Every `voice.status`/`reason` has its copy (above).
  - A right context pane on ≥ 1280 px: the client mini 360 (health ring, stage, tags, next session, active campaign, AI consent), from `/api/facts/clients/:id` and
    `/api/coach/clients/:id/score` if present.
  - The thread polls with `since` (15 s), or refreshes on `live` events for that client.
  - `threadPane()` is kept, as the export WP1 uses.
- **Recorder** (`registerComposerTool` "Voice", `mic`):
  - It uses `navigator.mediaDevices.getUserMedia({audio:true})` and `MediaRecorder` with `mimeType` from the first supported of
    `audio/webm;codecs=opus`, `audio/ogg;codecs=opus` or `audio/mp4` (the server re-encodes everything, so the order only affects quality).
  - It shows a live level meter (an AnalyserNode), a timer, Cancel and Stop. After stopping, a preview with play, re-record, **Transcribe & check** (F18) and **Send**.
  - The cap is 5:00, with a warning at 4:30.
  - It uploads with `apiUpload('/api/media?purpose=voice&clientId=…&durationSec=…', blob, blob.type || 'application/octet-stream')`, then posts the message.
  - Without a secure context, or without `MediaRecorder`, the button shows "Recording needs HTTPS. Upload an audio file instead" plus a file input accepting `audio/*`.
- **Letters**: `letters.js` uses the same recorder for the letter's voice note (purpose `letter`, 90 s cap) instead of file upload only (the upload stays as a fallback).
  Its MIME helper (line ~33 maps any `audio/*` to `audio/mp4`) is replaced: the real `file.type` is sent, or `application/octet-stream` when empty, and the server sniffs.
- **Parity uncertainty to verify and record** in `docs/api/wp6-ai-voice.md`: what Chrome's `audio/mp4` MediaRecorder output contains (possibly Opus in fragmented MP4),
  what Safari's MediaRecorder produces, and that `blob.type` can be empty. The always-re-encode rule makes all three safe, so playback in AVPlayer and ExoPlayer is the m4a.

**Apps (WP9 iOS, WP10 Android). Same behaviour on both, all P1:**
1. Move `VoiceRecorder` out of the letter composer into a shared file, `Client/VoiceViews.swift` / `client/VoiceViews.kt`, with `init(cap:purpose:)`. Letters keep 90 s; chat uses `me.features.voiceMaxSec` (300).
2. **Client composer** (`JKComposer`): a mic button, shown when `me.features.voiceNotes`.
   - On first use, when `me.features.voiceTranscription == "ask"`, show the **consent sheet** (above) and `PUT /api/voice/consent` with the choice before recording.
   - Tap to record: a recording bar with timer, level and cancel. Stop gives a preview, then Send. It uploads `audio/mp4` with `purpose=voice`, then sends `kind:'voice'`.
   - Hold-to-record is optional on iOS only (P3).
   - Account › Privacy gets a "Transcribe my voice notes" switch (same endpoint).
3. **Coach thread composer** (`MessagesThreadView`): the same, uploading with `clientId`.
4. **`VoiceNoteBubble`**, chosen by `kind == "voice"` (not by `mediaId`):
   - play/pause of `voice.url` through one shared player per screen (stop others when one starts; configure the audio session once), the duration, and a simple level bar;
   - a "Transcript" disclosure with the per-state copy above;
   - the summary line, the mood and flag chips (worded) **when the server sent them**. The shape is decided by the server from the signed-in role; there are no
     "coach builds".
5. **Models**: `Message` gains optional `mediaKind`, `durationSec` and `voice: VoiceInfo?`; every `VoiceInfo` field except `status` is optional, and an unknown `status`
   decodes as `failed`. Decoder unit tests run against the contract's JSON fixtures (pending, done coach view, done client view, off with each reason, deleted).
   `MediaFiles` uses the `.m4a` extension for audio.
6. **Refresh**: the refresh rule above (coach thread on `/api/messages`, client chat on `/api/timeline`), merging `updated` by id.
7. **Copy**: `NSMicrophoneUsageDescription` becomes "JK Performance uses the microphone to record voice notes for your coach and letters."
   Android keeps `RECORD_AUDIO` with the runtime prompt (reuse `VoiceSection`'s launcher and its refusal copy).
8. **Previews**: the thread list preview reads "Voice note · 0:42".
9. **Old builds** in the field see `mediaId: null` on voice messages and render only the text "Voice note · 0:42" (or the caption). That is acceptable.
10. **Store paperwork** (WP9/WP10 list it, WP-Z puts it in the status doc, John does it **before** setting `OPENROUTER_API_KEY`): App Store Connect privacy label adds
    **Audio Data** (linked to the user, used for app functionality, shared with a third-party AI processor) and the consent copy is reviewed against Apple's App Review
    guideline 5.1.2(i) on sharing personal data with third-party AI (as updated in late 2025; verify the current wording); the Play Data safety form adds "Voice or sound recordings".

**Demo.**
- 6 voice notes across 3 demo clients (4 from clients, 2 from JK). A short real m4a fixture (`server/fixtures/voice-demo.m4a`, a ~3 s soft tone, ≤ 40 KB, generated
  with ffmpeg and committed) is stored **once** as `ctx.media('voice-demo')` and reused by every demo voice message.
- Pre-written transcripts and analyses, `provider:'stub'`: Tom mentions knee pain (flag), Priya is upbeat about a PB, Sam asks to move Thursday.
- Consent: Tom and Priya `on`, Sam not asked (so the sheet can be seen in the demo client app, which is Sam).

**Tests.**
- Upload accepts webm, ogg, mp3, wav and m4a magic bytes and converts each (fake ffmpeg: point `config.ffmpegPath` at a test script that copies a fixture m4a and
  prints a `Duration:` and `Audio:` line); HEIC and MP4 video in an `ftyp` box are refused; with ffmpeg missing, only a plain m4a is accepted.
- A probed duration over cap + 2 s gives 400; `durationSec` validation per purpose.
- A coach voice upload without `clientId` gives 400; a voice media of client A cannot be sent to client B (400); another client of the same coach gets 404 on its URL;
  a media cannot back two messages.
- `voice` kind validation; no `mealPhoto` inference for audio.
- A client sending voice with the toggle off gets 403 `not_enabled`.
- **Consent**: without `on`, the queue never calls `listen()` (a fake `fetchImpl` records zero calls) and the row is `off`/`noConsent`; switching to `on` processes the next note.
- **Quota**: past the per-client budget the row is `off`/`quota`, and F18 reviews still work (separate budgets).
- The queue processes with the stub, sets `updated_at`, and the message appears in `updated` for `since` on both `/api/messages` and `/api/timeline`.
- **Client view everywhere**: for `/api/timeline`, `GET` and `POST /api/messages`, `/api/me` and every client route, no `summary`, `mood`, `sentiment`, `topics`, `actions`
  or `flags` key appears anywhere in the JSON; `/api/me/export` **does** contain them under `features.voice.analyses`.
- Voice messages have `mediaId: null` at the top level and `voice.mediaId` set.
- A flag creates a needs reason, a notification and an urgent push.
- **Reassignment**: after `assign`, the old coach gets 404 or empty lists from `/api/voice`, retry, inbox and search; the new coach sees the rows.
- **Erase mid-call**: erase the client while a fake fetch is pending; no error, no rows, no notification.
- Deleting the media tombstones the message (`status: deleted`).
- Retention: transcripts of a client ended 13 months ago are gone after the daily clock; a client ended 11 months ago keeps them.
- Retry; erasure removes the media file and the analysis rows; the demo coach is always stub.
- An OpenRouter audio request is shaped with `input_audio` mp3 base64 and the provider block (faked fetch), and a 400 on `json_schema` retries once with `json_object`.
- An automation on `voice.analysed` with a message step cannot be saved (with WP5 present; WP6 asserts that `voice.*` entries carry `aiDerived`).

### Calendar and diary (WP7)

#### F20 Calendar connections, holds, conflicts, buffers and time off
**Story.** As JK, my Google, Outlook or iCloud calendar's busy time blocks out my bookable slots automatically. I set buffers between sessions and
time off for holidays. The desk warns me about every clash (double bookings, sessions over a personal event, no travel gap) before clients find it.

**Screens.**
- Settings › Calendars (`registerSettingsSection`):
  - "Connect a calendar" walks the coach through it per provider, with copy for where to find the **secret iCal address**:
    - Google: Settings › your calendar › "Secret address in iCal format";
    - Outlook: Settings › Shared calendars › Publish › ICS;
    - Apple: Calendar › Share › Public calendar (webcal link).
  - Paste the URL, a label and a colour token. "Show event titles to me" is off by default; when off, only "Busy" is stored.
  - Each source shows its status (last synced, number of events, error) with Sync now and Remove.
- **Availability and rules** (replaces the existing availability sheet, inside `schedule.js`):
  - weekly hours (existing rules);
  - buffer before and after (0–60 min);
  - minimum notice (hours);
  - maximum sessions per day;
  - travel gap for in-person after video (min).
- **Holds** (coach-only blocks that are not client bookings): consults and trials with prospects (from F6 "Plan consult"), and admin blocks such as
  "Programming time". Created by clicking empty space on `/schedule` ("Book a client" or "Hold this time"), from quick-create, or from a lead.
  A hold has a title, start, end, kind (`consult`, `trial`, `admin`) and an optional lead. It blocks client slots, shows in conflicts, on `/schedule` (a solid
  muted band with its title) and in the diary, and goes out in the outbound `/cal/<token>.ics` feed (titled "Consult", "Trial" or the admin title; lead names are
  not put in the feed).
- **Time off**: date ranges with a reason and an all-day option. A "Bank holidays (England)" quick-add is computed from fixed rules for the next 2 years:
  Easter via the computus algorithm, plus the fixed and Monday rules.
- **`/schedule`** (WP7 rewrites `schedule.js`, `schedule.css`):
  - week and day views keep the lanes;
  - external busy blocks are drawn as hatched bands in the source's colour token;
  - time off is a full-height muted band;
  - buffers show as faint extensions on sessions;
  - **conflict badges** (`warning`, attention or urgent) sit on any clashing item, and a "Conflicts (3)" chip opens the conflicts slide-over;
  - **drag a session** to move it: a live slot check runs during the drag (red if it conflicts) and a confirm dialog opens on drop (it calls reschedule, F21);
  - click empty space to book there.
- A **conflicts slide-over** lists each clash in words ("Sam 1:1 Tue 07:00 overlaps *Dentist* (Google)") with the fixes: Move (opens the slot finder), Cancel,
  "Ignore this clash" (stored), or "Edit time off".

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS calendar_sources (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL, url_enc TEXT NOT NULL,        -- AES-256-GCM(url) as base64 iv.tag.ciphertext
  url_hint TEXT NOT NULL,                            -- 'calendar.google.com/…/basic.ics' (host + last path part)
  color TEXT NOT NULL DEFAULT 'chart-4', show_titles INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT, last_error TEXT, event_count INTEGER NOT NULL DEFAULT 0, etag TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS busy_blocks (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, title TEXT);
CREATE INDEX IF NOT EXISTS busy_blocks_coach ON busy_blocks(coach_id, start);
CREATE TABLE IF NOT EXISTS time_off (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start TEXT NOT NULL, end TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', all_day INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_prefs (
  coach_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  buffer_before INTEGER NOT NULL DEFAULT 0, buffer_after INTEGER NOT NULL DEFAULT 10,
  min_notice_hours INTEGER NOT NULL DEFAULT 12, max_per_day INTEGER, travel_gap INTEGER NOT NULL DEFAULT 15,
  cancel_notice_hours INTEGER NOT NULL DEFAULT 24,          -- cancellation policy (F21)
  cancel_forfeit_credit INTEGER NOT NULL DEFAULT 1, cancel_fee_pence INTEGER NOT NULL DEFAULT 0, noshow_fee_pence INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS calendar_holds (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('consult','trial','admin')), title TEXT NOT NULL,
  start TEXT NOT NULL, end TEXT NOT NULL,
  lead_id TEXT,                                       -- no FK (WP11's table); cleared on lead.deleted
  booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL,   -- set when a trial hold is converted
  created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS calendar_holds_coach ON calendar_holds(coach_id, start);
CREATE TABLE IF NOT EXISTS conflict_ignores (
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (coach_id, key));
```

**Fetcher** (SSRF-safe, in `features/calsync.mjs`):
- `webcal://` is rewritten to `https://`. Only `https:` is allowed, and only on port 443.
- It uses `node:https` `request` with a custom `lookup` that resolves through `dns.lookup(host, {all:true})` and **rejects the request if any** returned address is in a private or special range:
  `0.0.0.0/8, 10/8, 100.64/10 (Tailscale CGNAT), 127/8, 169.254/16, 172.16/12, 192.168/16, 224/4, 240/4, ::1, fc00::/7, fe80::/10, ::ffff:mapped private`.
  Because the lookup is pinned, the connection goes to a vetted IP.
- **Both lookup call shapes.** Node 22 enables `autoSelectFamily` by default, so `net.connect` calls the custom lookup with `{all:true}` and expects
  `callback(err, [{address, family}])`; other paths call it expecting `callback(err, address, family)`. A lookup written for one shape breaks every connection
  ("Invalid IP address: undefined"). The lookup checks `options.all` and answers in the matching shape, vetting every address either way.
- At most 3 redirects, each re-validated. A 15 s timeout. A 5 MB body cap. `accept: text/calendar`. `if-none-match` with the stored etag.
- Demo coaches are refused with "The demo account can't connect calendars". Tests inject `config.calFetch` to bypass the network.
- The parser (no dependencies) handles:
  - VEVENT with `DTSTART` and `DTEND`, or `DURATION`;
  - `TZID` (converted with Intl, using `londonToUtc`-style offset search per zone). Outlook and Exchange feeds use **Windows zone names** ("GMT Standard Time",
    "W. Europe Standard Time", "Eastern Standard Time") that Intl does not know: a built-in table maps the common ones (at least the 25 most used, from CLDR's
    windowsZones) to IANA ids; an unknown TZID falls back to the offset in the feed's `VTIMEZONE` `STANDARD`/`DAYLIGHT` blocks, and as a last resort to UTC with a
    `last_error` warning;
  - all-day `VALUE=DATE`;
  - `RRULE` FREQ DAILY, WEEKLY or MONTHLY (BYMONTHDAY) or YEARLY, with INTERVAL, COUNT, UNTIL and BYDAY (weekly);
  - `EXDATE`; `RECURRENCE-ID` overrides;
  - `STATUS:CANCELLED` and `TRANSP:TRANSPARENT` are skipped.
  - It expands into the window today − 7 to today + 120 days, with a maximum of 5000 blocks per source.
- Unsupported RRULE parts are logged into `last_error` as a warning ("Some repeating events were simplified").

Encryption:
- The key is 32 bytes from `<DATA_DIR>/secrets/calendar.key`, created on first use (mode 600, dir 700).
- The URL is never returned to the browser after it is saved; only `url_hint` is.
- Logs never print the URL.

**Slot generation** (`bookings.mjs` `slotsFor`, WP7 edit). Busy is the union of:
- non-cancelled bookings, widened by the buffers;
- `busy_blocks`;
- `calendar_holds` (widened by the buffers);
- `time_off`.

On top of that:
- minimum notice from now;
- `max_per_day` (count the existing sessions that day);
- in-person after video needs `travel_gap`.

`createBooking` re-checks the slot with the same function, so a race gives a 409 "That time has just gone". The apps get the improved slots with no change.

**Conflicts** (`GET /api/calendar/conflicts?from&to`): pairs of
- booking × booking (overlap including buffers);
- booking × busy block;
- booking × time off;
- booking × hold, and hold × busy block (a consult over the dentist);
- a day over `max_per_day`;
- a travel gap.

Each is `{key, kind:'overlap'|'buffer'|'external'|'timeOff'|'capacity'|'travel', severity:'high'|'medium', a:{type,id,start,end,title}, b:{…}, text}`.
`key` is stable (sorted ids plus kind), so it can be ignored. The response also carries `ignored` keys.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/calendar/sources` | none | `{sources:[{id, label, urlHint, color, showTitles, active, lastSyncedAt, lastError, eventCount}]}` |
| POST | `/api/calendar/sources` | `{label, url, color?, showTitles?}` | `{source}` (fetches once and fails 400 with the reason if unusable) |
| PATCH | `/api/calendar/sources/:id` | `{label?, color?, showTitles?, active?}` | `{source}` |
| DELETE | `/api/calendar/sources/:id` | none | `{ok}` |
| POST | `/api/calendar/sources/:id/sync` | none | `{source}` |
| GET | `/api/calendar/busy` | `?from=&to=` (≤ 92 days) | `{blocks:[{id, sourceId, start, end, allDay, title\|null, color}], timeOff:[…]}` |
| GET/PUT | `/api/calendar/prefs` | prefs fields | `{prefs}` |
| GET/POST | `/api/calendar/time-off` | `{start, end, reason?, allDay?}` | `{items}` / `{item}` (warns with `conflicts` if bookings fall inside) |
| DELETE | `/api/calendar/time-off/:id` | none | `{ok}` |
| POST | `/api/calendar/time-off/bank-holidays` | `{years:[2026, 2027]}` | `{added:n}` |
| GET | `/api/calendar/conflicts` | `?from=&to=` | `{conflicts:[…], ignored:[key]}` |
| POST | `/api/calendar/conflicts/ignore` | `{key}` | `{ok}` |
| GET/POST | `/api/calendar/holds` | `?from=&to=` / `{kind, title, start, end, leadId?}` | `{holds}` / `{hold}` (409 when it overlaps a booking; `leadId` is stored as given, the lead page is the only caller that sets it) |
| PATCH/DELETE | `/api/calendar/holds/:id` | `{title?, start?, end?}` | `{hold}` / `{ok}` |
| POST | `/api/calendar/holds/:id/convert` | `{clientId, kind?}` | `{booking}` (a trial hold becomes a 1:1 booking for the new client at the same time; the hold is deleted; `booking.created` is emitted) |

**Clocks.**
- Sync each active source every 15 min. Sources are staggered, and one error backs off to 60 min.
- After each sync, compute conflicts for the next 14 days. Notify the coach for **new** high-severity conflicts (dedupe on key), and emit `calendar.conflict`.

The outbound feed (`calendar.mjs`, WP7) also includes time off as "Time off" events and holds (above).

**Events.** Emits `calendar.conflict`, `hold.created`. Consumes `lead.deleted` (clears `lead_id` and replaces a title containing the lead's name with "Consult").

**Demo.**
- One fake source: no network. The demo builder inserts the source row with `url_enc` of `https://example.invalid/demo.ics` and `last_error` NULL, plus busy blocks:
  a dentist, a school run, a "Family dinner" recurring event (titles shown).
- One time-off week, 3 weeks out.
- Buffers of 10 min.
- **One deliberate conflict** (a session over the dentist).

**Tests.**
- The ICS parser: a TZID event, all-day, weekly RRULE with EXDATE, COUNT, UNTIL, an override, cancelled events skipped, folding of long lines.
- The DST transition.
- Slot generation respects busy, time off, buffers, notice and the cap.
- `createBooking` gives a 409 on a clash.
- The SSRF guard rejects `https://127.0.0.1`, `https://10.0.0.1`, `https://100.83.68.108`, a hostname resolving to a private IP (use a fake lookup), and http and port 8443.
- The URL is never in any response.
- A demo coach gets 403.
- Conflicts are found for each kind, and an ignored key is excluded.
- A hold removes its time from `slotsFor`, appears in conflicts and in the outbound ICS feed without a lead name; converting a trial hold creates one booking.
- The custom lookup works when called with `{all:true}` (array callback) and without (single-address callback), and rejects when any returned address is private.
- A feed with `TZID=GMT Standard Time` and one with `TZID=W. Europe Standard Time` produce the right UTC instants across both DST changes; an unknown TZID uses the VTIMEZONE offset.
- Bank holidays for 2026 and 2027 are correct.

#### F21 Slot finder, standing sessions, reschedule, waitlist, reminders and cancellation policy
**Story.** As JK, when I need to move or fit someone in, the desk suggests the best times for both of us. When a session frees up, the people
waiting for one are offered it. Clients get reminders so fewer sessions are missed.

**Screens.**
- **Slot finder** (slide-over, from the client 360 "Book", the conflict fixes, the palette "Find a slot for…"):
  - inputs: client, kind, length, date range, preference (morning, midday, evening or any);
  - the top 8 suggestions as cards, each with a reason ("Matches Sam's usual Tue 07:00", "Free before your 08:00", "No buffer clash");
  - one click to book or to propose, or, in **hold mode** (from a lead, F6), to create a hold.
- **Standing sessions**: booking creation (slide-over and the `/schedule` click) gets **Repeat weekly for N weeks** (2–26). The server pre-checks every occurrence with
  `slotsFor`, books the free ones in one tx, and returns the skipped clashes ("Skipped Tue 23 Dec: time off; Tue 30 Dec: clash with *Dentist*"), each with "Find another
  time". The bookings share a `series_id` so they can be moved or cancelled together ("This one" / "This and following").
- **Cancellation policy** (Settings › Availability): notice hours (default 24), "late cancels forfeit the session credit" (default on), a late-cancel fee and a no-show fee
  (both default £0). The policy text is shown to clients in the booking confirmation message. WP7 owns the data; billing acts on it only through event payloads (F10).
- **Reschedule** (drag in the grid, or the button on a session) opens a confirm dialog with an optional message to the client (template `reschedule`).
- **Waitlist**: Calendar › Waitlist tab (a panel in `/schedule`): entries with the client, the window and their preferences. When a booking is cancelled, matching entries are
  highlighted with "Offer this slot", which sends a templated message. **The client books it in the app as normal; we never book on their behalf.**

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, from_day TEXT NOT NULL, to_day TEXT NOT NULL,
  prefer TEXT NOT NULL DEFAULT 'any', note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','closed')),
  offered_start TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS booking_reminders (
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours INTEGER NOT NULL, sent_at TEXT NOT NULL, PRIMARY KEY (booking_id, client_id, hours));
```

`bookings.series_id TEXT` is added with `addColumn` (WP7 owns `bookings.mjs`).

**Scoring the slot finder.** Each free slot from `slotsFor` gets a score:
- +3 if it matches the client's most common weekday and hour over their last 12 bookings;
- +2 if it matches `profile.time` (morning, midday or evening);
- +1 if it is adjacent to another session (it packs the day), but not inside the buffer;
- −2 if it is the last slot of the day;
- −1 per day further out.

**Reminders clock** (every 5 min). For each client on upcoming non-cancelled bookings, send a push at 24 h and at 2 h before the start (`kind:'booking'`, "Tomorrow 07:00 · 1:1 with JK").
- It respects `users.notifications_on` and skips demo users (through `notify`).
- It is idempotent through `booking_reminders`.
- It emits `booking.upcoming {bookingId, hoursBefore}`.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/calendar/find` | `?clientId=&kind=&minutes=&from=&to=&prefer=` | `{suggestions:[{start, end, score, reasons:[string]}]}` |
| POST | `/api/bookings/series` | `{clientId, kind, start, minutes, weeks}` | `{seriesId, booked:[booking], skipped:[{start, reason}]}` (emits `booking.created` per booking and `booking.series {seriesId, count}`) |
| POST | `/api/bookings/series/:seriesId/cancel` | `{from?: start}` | `{cancelled:n}` |
| POST | `/api/bookings/:id/reschedule` | `{start, message?}` | `{booking}`. Coach: any own booking. Client: own booking with ≥ 24 h notice, else 400. Re-checks slots (409). Emits `booking.rescheduled {bookingId, from, to, byRole}`. Push to the other side. |
| GET | `/api/waitlist` | none (coach) | `{items}` |
| POST | `/api/waitlist` | coach `{clientId, kind, fromDay, toDay, prefer?, note?}`; client the same without `clientId` | `{item}` |
| POST | `/api/waitlist/:id/offer` | `{start}` | `{item}` (sends a message) |
| DELETE | `/api/waitlist/:id` | none | `{ok}` |

**Events.**
- Consumes `booking.cancelled`: notifies the coach, "Slot freed Tue 07:00: 2 on the waitlist" (when matches exist).
- Emits `waitlist.matched`, `booking.series`.
- `bookings.mjs` adds `policy:{forfeitCredit, feePence}` to the payload of `booking.cancelled` when the cancel is late (inside `cancel_notice_hours`).

**Inbox hook.** `waitlist:<id>` items when a matching slot is free.

**Demo.** 2 waitlist entries. Reminders are not sent in demo (`notify` skips them), but `booking_reminders` rows exist for the past.

**Tests.**
- Suggestions exclude busy times and are ranked deterministically.
- Reschedule: notice rules, the 409 on a clash, the event.
- A client cannot reschedule another client's booking (404).
- Reminders fire once at each threshold (injected now), with none for cancelled bookings.
- The waitlist match on cancel.
- A 12-week series over a time-off week books 11 and reports 1 skip with its reason; "this and following" cancels the rest.
- A late cancel's event carries the policy; an early cancel's does not.

#### F22 Coach diary and session notes
**Story.** As JK, I have one place for my day: everything booked, busy, due or starting, and a journal for my own notes and reflections. After each
session I jot what we did, mark attendance or no-show, and optionally share a short recap with the client.

**Screens.**
- `/diary/:day?`, two columns:
  - **Agenda**: a time-ordered list of bookings (with attendance buttons), holds, busy blocks, time off, tasks due (WP8 hook), campaign milestones (WP4 hook), letters due,
    and birthdays and coaching anniversaries (WP2 hook, F7).
  - **Journal**: a Newsreader-styled writing area with autosave every 2 s (a saved tick), a mood dot (1–5), tags, and the history (a calendar heat strip of the days written).
  - Arrow keys `[` and `]` move between days, and `t` jumps to today.
- **Session notes** open from any booking (diary, schedule, client Sessions tab):
  - attendance (Attended, Late, No-show, Late cancel);
  - a structured template (Focus, What we did, Wins, Next time) or free text;
  - private notes;
  - "Share recap with client" sends Focus, Wins and Next time as a message.
- The client 360 Sessions tab lists past sessions with their notes and attendance stats (an attendance rate ring).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', mood INTEGER CHECK (mood BETWEEN 1 AND 5),
  tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (coach_id, day));
CREATE TABLE IF NOT EXISTS session_notes (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attendance TEXT CHECK (attendance IN ('attended','late','noShow','lateCancel')),
  focus TEXT NOT NULL DEFAULT '', did TEXT NOT NULL DEFAULT '', wins TEXT NOT NULL DEFAULT '', next TEXT NOT NULL DEFAULT '',
  private_note TEXT NOT NULL DEFAULT '', shared_message_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (booking_id, client_id));
```

**Diary hook contract.** `[{at|null, day, kind, icon, title, detail, path, tone}]`.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/diary/:day` | none | `{day, agenda:[…], entry:{body, mood, tags, updatedAt}\|null}` |
| PUT | `/api/diary/:day` | `{body, mood?, tags?}` | `{entry}` |
| GET | `/api/diary` | `?from=&to=` | `{days:[{day, words, mood}]}` (the heat strip) |
| GET | `/api/sessions/:bookingId/notes` | none | `{notes:[…]}` (one per attendee for group classes) |
| PUT | `/api/sessions/:bookingId/notes` | `{clientId, attendance?, focus?, did?, wins?, next?, privateNote?}` | `{note}` |
| POST | `/api/sessions/:bookingId/notes/share` | `{clientId}` | `{messageId}` |
| GET | `/api/coach/clients/:id/attendance` | none | `{rate, attended, noShow, lateCancel, sessions:[…]}` |

**Events.** Emits `booking.attended`, `booking.noShow` and `booking.lateCancel` (`{bookingId, policy:{forfeitCredit, feePence}}`, the policy from `calendar_prefs`
at the time, F10 acts on it) when attendance is first set or changed; also `diary.written` (no text).

**Facts.** Session notes provide `diary.noShows90` (number) and `diary.attendance90` (0–100).

**Quiet hook.** `quiet()` returns the booking ids marked `noShow` or `lateCancel`, so they never count as attended (3.4).

**Privacy.**
- Diary entries are the coach's own data (no client id). They go in the **coach's** export.
- Session notes, including `private_note`, are personal data about the client and go in the client's export. The desk labels the private field
  "Private: not shown in the app (but included if the client asks for their data)".

**Demo.**
- Journal entries for 20 of the last 30 days (short, plausible coach reflections).
- Session notes for the last 3 weeks of demo sessions.
- 1 no-show.

**Tests.**
- Diary upsert per day.
- Agenda merging with hooks.
- Note upsert per booking and client, including group attendees.
- Share sends exactly one message.
- Attendance events.
- Isolation.
- The coach export contains the diary; the client export contains their notes.

### Tasks, accountability and insights (WP8)

#### F23 Coach tasks
**Story.** As JK, I keep my to-dos next to my clients: "Call Tom about his knee", "Send Priya her race plan by Fri". Automations and voice notes can create them
for me, and the ones due today sit on my command centre.

**Screens.**
- `/tasks`: a kanban by due bucket (Overdue, Today, This week, Later, No date, Done this week). Drag between buckets to change the due date.
  - Quick add at the top with natural parsing: `Call Sam tomorrow 9am #billing !high`:
    - dates: today, tomorrow, weekday names, `dd Mon`, `in 3 days`;
    - times: `9am`, `14:30`;
    - `@`-free client matching on a full first name or full name present in `state.clients`, case-insensitive, shown as a chip the coach can remove;
    - `#tag` and `!high` or `!low`.
- A task slide-over: title, notes, client, due, priority, source (manual, automation, voice, AI, dunning) with a link to the source, Done, and snooze.
- The command centre widget `tasks` (s), and a client 360 tab through `registerClientTab` (key `tasks`, label "Tasks", order 85).

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  due_on TEXT, due_at TEXT, priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  tags TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  snoozed_until TEXT, source TEXT NOT NULL DEFAULT 'manual', source_ref TEXT,
  created_at TEXT NOT NULL, done_at TEXT, position REAL NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS tasks_coach_open ON tasks(coach_id, status, due_on);
```

**API.**
- `GET /api/tasks?status=&clientId=&bucket=`
- `POST /api/tasks {title, notes?, clientId?, dueOn?, dueAt?, priority?, tags?, source?, sourceRef?}`
- `PATCH /api/tasks/:id`
- `POST /api/tasks/:id/done` (with an undo endpoint `POST /api/tasks/:id/reopen`)
- `POST /api/tasks/:id/snooze {until}`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/parse {text}` → `{title, dueOn, dueAt, clientId, tags, priority}`. Server-side parsing so the apps could reuse it; the desk calls it on Enter.

**Actions.** `task.create {title:template, notes?:template, dueInDays?:number, priority?}`.

**Events.**
- Emits `task.created` and `task.done`.
- A clock emits `task.due` at the due time, or at 08:00 on the due day without a time, and calls `notifyCoach`.

**Hooks.** `diary` (due that day), `search`, `timeline` (client-linked tasks) and `exportFor` (client-linked tasks go to the client). No `needs` or `inbox` hook: tasks are the coach's own list.

**Demo.** 12 tasks across buckets: 2 overdue, 1 from a voice note, 1 from dunning, 2 done this week.

**Tests.**
- The parser table (≥ 15 cases, including "next mon", "fri 5pm" and "15 Dec").
- Bucket computation in London time.
- The due notification fires once.
- An action creates a task with the rendered title.
- Isolation, and `clientId` must be own.

#### F24 Accountability board
**Story.** As JK, I see across all my clients who kept their word this week (commitments, daily minimums, training, check-in), who is on a
streak, and who needs a nudge. I nudge one person or ten with one click.

**Screen.** `/accountability`:
- The week picker uses London Monday weeks.
- Filters: All, Missed something, No commitments set, Streak at risk (the day minimum not met and it is after 18:00), and Top streaks.
- **Board rows** (a `dataTable`):
  - the client;
  - **score ring** (0–100);
  - commitments (up to 3 chips with the outcome glyph: kept, mostly, missed, open);
  - day minimum met (7 dots);
  - workouts done/planned;
  - check-in (yes/no);
  - streak (`local_fire_department` + days);
  - an 8-week score sparkline;
  - a Nudge button.
- Bulk: nudge the selected people (the composer with category `nudge` templates and a per-person preview). Celebrate (category `celebrate`).
- A **Streaks** section: milestones reached this week (7, 14, 30, 60 and 100 days), each with "Send congrats".

**Score** = round(100 × (0.4·C + 0.3·H + 0.2·T + 0.1·K)), where:
- C = Σ(kept 1, mostly .5, missed 0) / commitments set, with open commitments counted only after the week ends; no commitments set gives C = 0.5 and the flag "no commitments";
- H = days minimum met / days elapsed in the week;
- T = workouts completed / workouts planned (1 if none planned);
- K = 1 if this week's check-in was submitted, else 0, applied only once the check-in is due, else 1.

The score is computed from existing tables (`commitments`, `habit_days`/`dayStates`, `workouts`, `checkins`). **No writes to them.**

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS accountability_nudges (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('nudge','celebrate')),
  message_id TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accountability_weeks (
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL, score INTEGER NOT NULL, parts TEXT NOT NULL, PRIMARY KEY (client_id, week));
```
`accountability_weeks` is a snapshot written when a week closes (Monday 05:00 clock), for history and trends. The current week is always computed live.

**API.**

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/accountability` | `?week=` | `{week, rows:[{client, score, commitments:[{text, outcome}], minimumDays:[bool×7], workouts:{done, planned}, checkin:bool, streak, trend:[8], flags:[…], lastNudgeAt}], milestones:[{client, streak}]}` |
| POST | `/api/accountability/nudge` | `{clientIds, text, kind:'nudge'\|'celebrate'}` (`text` is a template) | `{sent:n, deferred:n, skipped:[{clientId, reason}]}` (sends with `via:'nudge'`, so the governor applies, 3.5) |
| GET | `/api/coach/clients/:id/accountability` | `?weeks=12` | `{weeks:[{week, score, parts}]}` |

**Actions.** `accountability.nudge {text:template}`. **Facts.** `accountability.score` (number), `accountability.streak` (days).

**Events.**
- Emits `accountability.nudged`, and `accountability.milestone {streak}` (once per milestone per client).
- Consumes `commitment.reviewed` (recompute) and `day.started`.

**Needs hook.** A streak milestone gives rank 8, "14-day streak", with the action Celebrate.

**Demo.**
- Clients have varied commitments and outcomes over 8 weeks; `buildPar` already seeds part of this. Snapshot rows are written for the past 7 weeks.
- One 30-day streak.

**Tests.**
- The score formula for each part, including the no-commitments and check-in-not-yet-due cases on each weekday (run the test with an injected `today` for Mon through Sun: the Monday trap).
- The milestone fires once.
- A bulk nudge sends N messages with rendered names.
- Isolation.

#### F25 Engagement insights: cohorts, heatmaps and pulse/NPS surveys
**Story.** As JK, I understand engagement across the business: when clients are active, how long cohorts stay, how happy they are (NPS), and what
they say. I send quick pulse surveys automatically.

**Screen.** `/insights`, with three tabs.
- **Engagement**:
  - a 7×24 **heatmap** of client activity by London weekday and hour (messages from clients, sets logged, workouts completed, check-ins, habit ticks), over the last 30, 90 or 365 days;
  - a daily active clients line;
  - the engagement mix (a donut by activity type);
  - the top 10 most engaged and the 10 quietest, as two `dataTable`s;
  - the distribution of health bands, from facts `crm.band` when available.
- **Retention cohorts**: a `cohortGrid` by join month (rows) × months since joining (columns), where the % is active that month.
  Active means any client activity in the month, **or** a plan other than `none` with an activity in the last 30 days.
  It also shows the average lifetime and a survival line chart.
- **Pulse & NPS**:
  - the current NPS (the big number, with promoter, passive and detractor stacked bars);
  - the trend by month;
  - recent comments (with the client name, a coach view only);
  - surveys: create a pulse with a cadence (once, monthly, quarterly, or N days after joining) and an audience.

**Surveys use the existing forms machinery**, so the apps need no change:
- NPS is a `forms` row with a `choice` question (options "0"…"10", label "How likely are you to recommend JK to a friend? (0–10)") and a `long` question
  ("What's the main reason?").
- A pulse is 1–3 `scale` (1–5) questions.
- Sending uses `sendForm()`. Answers are read from `form_requests`.

**Tables.**
```sql
CREATE TABLE IF NOT EXISTS pulse_surveys (
  id TEXT PRIMARY KEY, coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('nps','pulse')),
  cadence TEXT NOT NULL CHECK (cadence IN ('once','monthly','quarterly','afterDays')),
  after_days INTEGER, audience TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pulse_sends (
  survey_id TEXT NOT NULL REFERENCES pulse_surveys(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                     -- '2026-11' | '2026-Q4' | 'once' | 'after'
  request_id TEXT, at TEXT NOT NULL, PRIMARY KEY (survey_id, client_id, period));
```

**API.**

| Method | Path | Response |
|---|---|---|
| GET | `/api/insights/engagement?days=90` | `{heatmap:[[n×24]×7], daily:[{day, active}], mix:[{kind, n}], top:[…], quiet:[…], bands?:{…}}` |
| GET | `/api/insights/cohorts?months=12` | `{cohorts:[{month, size, retained:[pct]}], avgLifetimeMonths}` |
| GET | `/api/insights/nps?months=12` | `{nps, promoters, passives, detractors, responses, trend:[{month, nps}], comments:[{client, score, text, at}]}` |
| GET/POST | `/api/insights/surveys` | `{kind, cadence, afterDays?, audience?, questions?}` → `{survey}` (creates the form too) |
| PATCH/DELETE | `/api/insights/surveys/:id` | `{status?, cadence?, audience?}` |

**Clock.** Daily at 10:00 London: send due surveys (idempotent via `pulse_sends`).

**Actions.** `pulse.send {surveyId}`.

**Events.** Emits `pulse.sent`, and `pulse.answered {surveyId, kind, score}` (on `form.submitted` whose form is a survey's form). It notifies the coach for detractors
(score ≤ 6, tone urgent). WP11 consumes `pulse.answered` with a score of 9 or more to suggest a testimonial ask (F28).
Survey sends use `form.send` through `sendForm` and skip clients with outreach paused.

**Demo.**
- An NPS survey with about 14 answers over 6 months (NPS around +45) and 4 comments.
- Activity history comes from `buildPerson` (already rich).
- Cohorts from the demo clients' join dates: the builder spreads `created_at` over 8 months, and the grid must show at least 6 cohorts.
  The demo builder must not change `users.created_at` of the existing demo accounts in a way that breaks other tests. If it would, compute cohorts from the first activity day instead,
  and document that.

**Tests.**
- Heatmap bucketing in London time across BST.
- The cohort maths on a fixture.
- NPS maths (0–6 detractor, 7–8 passive, 9–10 promoter).
- Survey cadence idempotence.
- A detractor notification.
- Isolation, including that the demo is excluded from a real coach's numbers.

---

## 5. Work packages: owned files, checklists and ports

Each package's agent:
- builds in its worktree;
- runs its own server on an assigned port bound to porkserv's Tailscale address;
- validates per section 7;
- commits on its branch;
- reports its links.

Run the server like this:
```bash
cd ~/jk-wt-<pkg> && PORT=<port> HOST=100.83.68.108 DATA_DIR=$(mktemp -d) SUPPORT_EMAIL=support@example.com \
  PUBLIC_URL=http://100.83.68.108:<port> DEMO_CODE=local-demo-client DEMO_COACH_CODE=local-demo-coach node server/main.mjs
```
- No `OPENROUTER_API_KEY`, ever, in any local run.
- ffmpeg: use the host's if installed. If it is not, voice conversion paths answer 415, and that is a documented parity gap.

**Owned** files may be edited. **New** files must match the package's prefixes (3.11). Anything else is read-only. Ownership is per wave: a file owned by
a wave-0 package may be owned by a different package in wave 1 (the wave-0 work is merged first).

**Shared files nobody edits in wave 1:**
- `scripts/lint-design-allow.txt`: no edits. A package that needs an exception uses the inline trailing comment `lint-design: allow <reason>` (already
  supported by `scripts/lint-design.sh`) and lists it under "Integration requests"; WP-Z decides whether to move it to the allow-list.
- `server/desk/symbols.js`, `Dockerfile`, `docs/API.md`, `docs/design/decisions.md`, `server/features/README.md`, `docs/api/README.md`.

### WP0-S: foundation, server (wave 0) · port 5680
Branch `desk-v2-foundation-server`.

**Owns (edits):**
- `server/app.mjs`, `server/main.mjs`, `server/store.mjs`, `server/config.mjs`;
- `server/access.mjs`, `server/demo.mjs`, `server/account.mjs`, `server/auth.mjs`;
- `server/messages.mjs`, `server/bookings.mjs`, `server/daily.mjs`, `server/forms.mjs`;
- `server/training.mjs`, `server/reports.mjs`, `server/par.mjs`, `server/needs.mjs`;
- `server/autoflows.mjs` (only `doStep`'s message branch, which calls `sendMessage(…, {via:'autoflow'})`);
- `server/media.mjs` (only splitting `storeMedia` into `writeMediaFile` + `insertMediaRow` for 3.10; `storeMedia` keeps its signature);
- `Dockerfile`, `docs/API.md` (index only).

**New:**
- `server/registry.mjs`, `server/features.mjs`, `server/events.mjs`, `server/facts.mjs`, `server/templating.mjs`, `server/notifications.mjs`;
- `server/ai.mjs`, `server/audio.mjs`, `server/stream.mjs`, `server/search.mjs`, `server/ratelimit.mjs`, `server/rng.mjs`;
- `server/features/README.md` (the namespaces table from 3.11), `server/test/helpers.mjs`, `server/test/foundation.test.mjs`, `server/test/demo-features.test.mjs`;
- `docs/api/README.md` (conventions, OpenRouter findings with dates, the ffmpeg version, image size and memory figure).

**Delivers:** sections 3.1–3.8, 3.10, 3.11 (server), 3.13–3.15, the emits table, the outreach governor, `afterCommit`, urgent coach push, and the
`capabilities` and `badges` endpoints.

**Exit criteria:**
- All existing tests pass, with no change to their assertions except added ones.
- A sample feature file in a test temp dir proves the loader, namespaces validation (a bad id, a clash and a reserved id each throw), schema, routes, clocks,
  events (eager cursors), facts, actions, needs, demo and export hooks. The test copies a fixture feature into a temp `features` dir via `FEATURES_DIR`.
- The spawn test (`await import('./server/app.mjs')` exits 0 within 5 s) passes with the fixture feature importing `store.mjs`, `messages.mjs` and `registry.mjs`.
- The `docker build` succeeds with ffmpeg; the README records its version, the image size and the memory spot-check.
- The local preview (rebuilt) works unchanged for the existing desk.

### WP0-D: foundation, desk (wave 0) · port 5679, then 5680
Branch `desk-v2-foundation-desk`.

**Owns (edits):**
- `server/desk.mjs`, `server/desk/main.js`, `server/desk/core.js`, `server/desk/app.css`, `server/desk/symbols.js`;
- `server/desk/guides.js` (only the `/account` settings-section refactor and the kit harness routes);
- `server/desk/clients.js` (wave 0 only: tabs, client actions and bulk actions drawn from the registries, 3.9);
- `server/desk/today.js` (wave 0 only: the plain widget grid, 3.9);
- `server/desk/messages.js` (wave 0 only: the real `threadPane` extraction with `composer.js` mounted, 3.9);
- `server/test/desk.test.mjs`;
- `scripts/export-symbols.mjs` (`--desk` mode), `scripts/contrast-check.mjs` (`--desk` mode), `scripts/lint-design.sh` (the desk rule also flags `rgb(`/`rgba(`/`hsl(` literals outside `:root` blocks);
- `docs/design/decisions.md`.

**New:** `server/desk/ui.js`, `ui.css`, `charts.js`, `charts.css`, `composer.js`, `composer.css`, `live.js`, `palette.js`.

**Delivers:** sections 1.3, 2 and 3.9, 3.12 and 3.16, the `h()` CSP fix, the fixed stylesheet order, the registry hosts, plus the kit page and harness `/account/kit`.

**Exit criteria:**
- Every existing screen works in the new shell, in both themes, on desktop and mobile.
- `lint-design.sh desk` is clean, and `desk.test.mjs` asserts the stylesheet order and the absence of `setAttribute('style'`.
- The harness draws a dummy widget, client tab, client action, bulk action, composer tool and send guard registered by a test-only module.
- **Final validation runs after WP0-S is merged into `desk-v2`**: rebase, run on port 5680, and `desk-shot` with zero console errors on `/today`, `/clients`,
  `/schedule`, `/messages`, `/programs`, `/account` and `/account/kit`, at desktop and `--mobile`. (Before that merge, foundation endpoints answer 404 and Chrome logs
  each 404 as a console error, so a clean shot is impossible on 5679; work there is checked by eye only.)

### WP1: Command (F1, F2, F3 defaults, F4) · port 5681
**Owns:** `server/desk/today.js`, `server/desk/today.css`.
**New:** `server/features/command.mjs`, `server/test/command.test.mjs`, `server/desk/f-command*.{js,css}`, `docs/api/wp1-command.md`.
**Registers:**
- nav: today, inbox;
- widgets: needs, today-sessions, inbox, letters, activity;
- commands: go-to commands for every nav item, "Mark all inbox done", "Brief me";
- settings section: notifications (including urgent push and coach quiet hours).

### WP2: Clients and lifecycle (F5, F7, F8, F27) · port 5682
**Owns:** `server/desk/clients.js`, `clients.css`, `overview.js`, `par.js`, `par.css`, `server/coach.mjs` (only to add `stage` and `health` to `clientSummary` if needed; prefer `/api/crm/clients`).
**New:** `server/features/crm.mjs`, `server/features/onboarding.mjs`, `server/test/crm.test.mjs`, `server/test/onboarding.test.mjs`, `server/desk/f-crm*.{js,css}`, `f-onboard*.{js,css}`, `docs/api/wp2-crm.md`.
**Registers:**
- nav: clients, segments, retention;
- client tabs: overview, timeline, notes (and keeps drawing every registered tab);
- client actions: message, book, note, pause, tag, end coaching;
- bulk actions: tag, export CSV;
- widgets: at-risk, onboarding, renewals;
- settings: tags, onboarding template;
- actions: lifecycle.set, lifecycle.pause.

### WP11: Growth: leads and marketing (F6, F28) · port 5689
**Owns:** nothing existing.
**New:** `server/features/leads.mjs`, `server/features/marketing.mjs`, `server/test/leads.test.mjs`, `server/test/marketing.test.mjs`, `server/desk/f-growth*.{js,css}`, `docs/api/wp11-growth.md`.
**Registers:**
- nav: pipeline, marketing;
- widget: pipeline;
- quick-create: lead;
- settings: enquiry form;
- inbox providers: new leads, testimonial asks.

### WP3: Billing & revenue (F9, F10, F11, F12, F26) · port 5683
**Owns:** `server/desk/plans.js`, `plans.css`.
**New:** `server/features/billing.mjs`, `offers.mjs`, `revenue.mjs`, `server/test/billing.test.mjs`, `offers.test.mjs`, `revenue.test.mjs`, `server/desk/f-billing*.{js,css}`, `f-offers*.{js,css}`, `f-revenue*.{js,css}`, `docs/api/wp3-billing.md`.
**Registers:**
- nav: billing, offers, revenue, plans;
- client tab: billing;
- client action: invoice;
- widgets: revenue, overdue;
- quick-create: invoice;
- settings: billing (including the receipt template);
- actions: invoice.create, offer.issue;
- hooks: renewals, offboarding.

### WP4: Campaigns & guidebook (F13, F14) · port 5684
**Owns:** nothing existing.
**New:** `server/features/campaigns.mjs`, `guidebook.mjs`, tests `campaigns.test.mjs`, `guidebook.test.mjs`, `plan-page.test.mjs`, `server/desk/f-campaigns*.{js,css}`, `f-guidebook*.{js,css}`, `docs/api/wp4-campaigns.md`.
**Registers:**
- nav: campaigns, guidebook;
- client tab: campaigns;
- client action: enrol;
- bulk action: enrol (invite);
- widget: campaigns-live;
- quick-create: campaign;
- action: campaign.enrol;
- public routes: `/plan/<token>` (and its guide and media sub-paths);
- hooks: renewals, offboarding, publicOffers.

**Apps contract:** publish `invitationOut`, the enrolment and guide shapes, and JSON fixtures in `docs/api/wp4-campaigns.md` on the first day.

### WP5: Automations & outreach (F15, F16, F17) · port 5685
**Owns:** nothing existing (`programs.js` stays untouched; its autoflow editor remains).
**New:** `server/features/automations.mjs`, `templates.mjs`, `outreach.mjs`, tests `automations.test.mjs`, `templates.test.mjs`, `outreach.test.mjs`, `server/desk/f-auto*.{js,css}`, `f-templates*.{js,css}`, `f-outreach*.{js,css}`, `docs/api/wp5-automations.md`.
**Registers:**
- nav: automations, broadcasts, templates;
- composer tools: templates, schedule; slash items;
- bulk actions: message (opens a broadcast with `clientIds`), start automation;
- widget: scheduled;
- quick-create: broadcast, automation;
- settings: outreach (daily cap, quiet hours);
- hooks: offboarding.

### WP6: AI & voice (F18, F19 server and desk) · port 5686
**Owns:** `server/messages.mjs`, `server/media.mjs`, `server/timeline.mjs`, `server/settings.mjs`, `server/desk/messages.js`, `messages.css`, `letters.js`.
**New:** `server/features/aireview.mjs`, `voice.mjs`, `server/fixtures/voice-demo.m4a`, tests `aireview.test.mjs`, `voice.test.mjs`, `voice-media.test.mjs`, `server/desk/f-ai*.{js,css}`, `f-voice*.{js,css}`, `docs/api/wp6-ai-voice.md` (plus `docs/api/fixtures/voice-*.json`).
`messages.mjs`, `timeline.mjs` and `settings.mjs` reach `voice.mjs` only through the `messageExtras` and `meFeatures` hooks; they never import a feature file.
**Registers:**
- nav: messages;
- composer tools: voice, attach, AI draft, AI check;
- send guards: ai-review, route-to-approval (off by default);
- client tab: voice;
- widget: voice-review;
- settings: AI;
- action: ai.draft.

**Must:** keep the `threadPane` export and the `sendMessage` signature (3.5).

**Apps contract:** publish the final JSON shapes, the error table, the per-state copy, the refresh rule and the JSON fixtures in `docs/api/wp6-ai-voice.md` on the first day, as WP9 and WP10 build against them.

### WP7: Calendar & diary (F20, F21, F22) · port 5687
**Owns:** `server/bookings.mjs`, `server/calendar.mjs`, `server/desk/schedule.js`, `schedule.css`.
**New:** `server/features/calsync.mjs`, `diary.mjs`, tests `calsync.test.mjs`, `ics.test.mjs`, `diary.test.mjs`, `server/desk/f-calendar*.{js,css}`, `f-diary*.{js,css}`, `docs/api/wp7-calendar.md`.
**Registers:**
- nav: schedule, diary;
- widgets: diary, conflicts;
- client action: book (slot finder);
- commands: find a slot, hold time;
- quick-create: booking, hold;
- settings: calendars, availability (including the cancellation policy);
- inbox provider: waitlist;
- hooks: quiet (no-shows).

`bookings.mjs` may import `features/calsync.mjs` (same package). `calsync.mjs` must not import `bookings.mjs` back at module top level in a way that needs
its exports during evaluation (a static cycle between them is allowed; neither may import `features.mjs`).

### WP8: Tasks, accountability & insights (F23, F24, F25) · port 5688
**Owns:** nothing existing.
**New:** `server/features/tasks.mjs`, `accountability.mjs`, `insights.mjs`, tests for each, `server/desk/f-tasks*.{js,css}`, `f-account*.{js,css}` (accountability; not to be confused with `/account`), `f-insights*.{js,css}`, `docs/api/wp8-tasks-insights.md`.
**Registers:**
- nav: tasks, accountability, insights;
- widgets: tasks, accountability;
- client action: add task;
- quick-create: task;
- actions: task.create, accountability.nudge, pulse.send.

### WP9: iOS (F19 apps, F13 client view; all P1)
Worktree `~/jk-wt-ios`, branch `desk-v2-ios` (see 3.0 for removing the old worktree). **Owns:** `ios/**`.
- **P1**: voice notes in chat per F19 "Apps" (including the consent sheet and the privacy switch); the campaign **invitation card** with Accept / Not this time,
  the **campaign card** on the Today tab, the campaign detail (activities with ticks, spend entry, the kit list) and the native **guide renderer** for F14 blocks;
  tappable `https` links in message bubbles (so the `/plan` links work).
- **Later batch** (listed in section 9): the AI Check button in the coach composer.
- It builds against the shapes and fixtures in `docs/api/wp6-ai-voice.md` and `docs/api/wp4-campaigns.md`, falling back to this spec until those exist.
- **Compile:** push the branch and run `gh workflow run check.yml --ref desk-v2-ios`. Do not merge to main (that would upload to TestFlight).
- `scripts/lint-design.sh ios` and `node scripts/contrast-check.mjs` must pass.
- Lists the App Store Connect privacy-label change and the consent copy for WP-Z (F19 item 10).

### WP10: Android (same scope as WP9)
Worktree `~/jk-wt-android`, branch `desk-v2-android`. **Owns:** `android/**`.
- Build with `scripts/android-build.sh` (`assembleDebug -PapiBase=http://100.83.68.108:5671`).
- Exercise it with `ANDROID_SERIAL=emulator-5560 scripts/android-emulator.sh start|install|shot` and `scripts/android-tap.py`.
- The emulator runs `-no-audio`, so recording cannot be exercised there. Test playback, upload (push a fixture m4a with `adb push`, then pick it through a debug-only "send test clip" path guarded by `BuildConfig.DEBUG`) and transcript rendering, and report the parity gap.
- `scripts/lint-design.sh android` must pass.
- Lists the Play Data safety change for WP-Z.

### WP-Z: integration (wave 2, one agent, in the main checkout on `desk-v2`)
1. Merge the wave-1 branches in this order:
   1. WP6
   2. WP2
   3. WP11
   4. WP3
   5. WP7
   6. WP8
   7. WP4
   8. WP5
   9. WP1
   10. WP9 and WP10
   
   Resolve conflicts, which should be limited to `docs/` and nothing else. If code conflicts appear, a package broke ownership: fix it and note which.
2. Apply every package's "Integration requests" (including any lint allow-list entries).
3. Remove legacy duplicates:
   - `/business` redirects to `/revenue`;
   - the old availability sheet is removed if WP7 replaced it;
   - the `?kit=1` page link is hidden.
4. Run the full validation (section 7) on the merged tree, including `demo-features.test.mjs` with every feature loaded, rebuild the local preview at
   `~/docker/local/compose.jk-performance.yaml`, and force a demo rebuild:
   ```bash
   docker exec <container> node -e "…DELETE FROM meta WHERE key='demo_built'"   # or delete via sqlite, then restart
   ```
5. Take desktop and mobile screenshots of every nav item, and of `/plan/<token>` for a demo enrolment.
6. Write `docs/design/desk-v2-status.md` with a feature × status table, known gaps, parity gaps, the drafted privacy paragraph (6.3) and the store-paperwork checklist.
7. **Stop.** No PR and no deploy until the owner asks (the cumulative-batch rule in AGENTS.md).

---

## 6. Security and privacy rules (every package)

### 6.1 Isolation
- **Coach isolation is per query.**
  - Every coach endpoint calls `requireCoach`. Every row read or written is scoped by `coach_id = ctx.user.id`, or reached through `clientFor` or `ownRow`.
  - A foreign or missing id is a **404**.
  - Bulk endpoints check **every** id. One foreign id fails the whole request with a 404 and writes nothing.
  - **A stored `coach_id` on a client-linked row is never trusted for access.** `admin.mjs assign` can move a client to another coach, so every read of
    client-linked data joins the **current** owner (`JOIN users u ON u.id = x.client_id AND u.coach_id = ?`) or goes through `clientFor`. Each package
    adds one reassignment test for its client-linked tables (the old coach gets 404 or empty lists, the new coach sees the rows).
- **Demo isolation.**
  - The demo coach is a separate coach (`is_demo=1`).
  - Audience resolution adds `u.is_demo = coach.is_demo`.
  - Business, revenue and insights numbers keep that filter.
  - Demo accounts: **AI is always stub**, outbound fetches (calendar sources) are refused, push is skipped (existing), and voice uploads are limited to 5 a day of 60 s each.
  - The public enquiry form for a demo coach is refused.
- **Tests per package:**
  - Two coaches, one client each: every new endpoint is proved to give a 404 across coaches (one table-driven test per feature file listing its routes).
  - A client calling a coach endpoint gets a 403 from `requireCoach`.

### 6.2 Erasure and export
- Every personal table has an FK `ON DELETE CASCADE` to `users` (client and/or coach). **No client id lives only in JSON**: audiences and run logs may mention ids, but those rows also carry a real `client_id` FK or are coach-owned and get purged when the coach is deleted.
  `audience.clientIds` inside broadcasts and segments is the single exception. The real recipients are `scheduled_messages` rows with an FK, so they cascade.
  A bare id left in a stored audience is not personal data once the user row is gone. `resolveAudience` ignores unknown ids, and WP5 strips them when a broadcast is next saved.
- Files (voice notes, guide media, campaign proof photos) are `media` rows, so `eraseMedia` deletes the files and the demo wipe removes demo uploads nightly (3.10).
- Every feature implements `exportFor(db, user)` for the data it holds about a client. `server/test/<feature>.test.mjs` asserts the export contains it and that `DELETE /api/me` leaves no rows (a generic helper in `helpers.mjs`: `assertNoRowsFor(db, userId)` scans every table that has a `client_id`/`user_id` column).

### 6.3 The AI
- **It never sends anything by itself (D5).** No code path may insert into `messages`, `scheduled_messages`, `deferred_messages` or `broadcasts` from an AI
  result without a coach request that carries the final text. Tests assert this for each AI endpoint and the `ai.draft` action.
- **Nothing AI-derived can make something else send.** Every event, fact or variable whose value comes from a model is declared `aiDerived: true`
  (all `voice.*` and `ai.*` events, `voice.sentiment14`). Automations that use one may only notify the coach, create tasks, tag, or create inbox drafts (F15);
  the save is refused otherwise and the engine re-checks at run time. Templating refuses AI-derived variables, so no automated message can quote a transcript,
  summary or draft. Segments and broadcast audiences may filter on `voice.sentiment14` only for **reading** (a list in the desk); `resolveAudience` with purpose
  `broadcast` or `automated` refuses rules that reference an `aiDerived` fact (400).
- **Consent (D16).** A client's voice is sent to a model only with `client_ai_consent.voice = 'on'` (F19). Text about the client (advice checks, summaries, briefs)
  is the coach's own working material and is covered by the privacy paragraph below, not by the voice consent.
- **What goes to the LLM** (all client-derived text passes through `redactForAi` first, 3.13):
  - for advice checks: the minimised context listed in F18, including these **health** fields: injuries and limitations from `profile`, pain flags and notes from the
    last 4 check-ins, and pain or injury words inside thread excerpts;
  - for voice: the audio of a voice note **as recorded** (it cannot be redacted) and the first name;
  - for briefs and summaries: first names, counts, and short redacted message excerpts.
  - **We remove** e-mail addresses, phone numbers, URLs, postcodes and surnames from text. We **never** send health samples (Apple Health, Health Connect), photos,
    invoices or money.
- The OpenRouter request sets `provider.data_collection: 'deny'` (plus `zdr` if it exists, and `require_parameters` with a schema; to be verified, 3.13). If no provider
  meets those settings the call fails visibly; the settings are never relaxed.
- **Retention.** `ai_calls` keeps metadata only. `ai_reviews` keeps the coach's draft (their own words) for audit, pruned at 180 days. Voice transcripts and analyses are
  deleted 12 months after End coaching, and analysis fields after 24 months regardless (F19). Tests cover each.
- **Analysis of a client's voice (mood, flags) is coach-only.** It is never returned by a client endpoint, with **one exception**: `/api/me/export` includes it under
  `features.voice.analyses`, because it is data about the client and belongs in a subject access response. The "never in client JSON" test covers every client route
  except the export; a separate test asserts the export contains it.
- **The privacy page** (`pages.mjs` `/privacy`) needs a paragraph about AI processing **before** a key is set in prod. WP-Z drafts it into
  `docs/design/desk-v2-status.md` for the owner (it does not deploy it). It must name OpenRouter and the vendor of the chosen `AI_AUDIO_MODEL` (Claude cannot take
  audio, so this is another vendor), list the health fields above, say that voice analysis needs the client's consent and can be withdrawn in the app, and give the
  retention periods.
- **Store paperwork** before the key is set: App Store privacy label (Audio Data), Apple guideline 5.1.2(i) consent check, Play Data safety (F19 item 10).
- Prod stays stub until John sets `OPENROUTER_API_KEY`, `AI_MODEL` and `AI_AUDIO_MODEL` himself.
- **Local preview always stub.** No production credential ever goes into `~/docker/local/compose.jk-performance.yaml` or a worktree run. The stub labels its output in the data (`provider:'stub'`) and in the UI (`AI · stub`, "[Stub]", "Sample transcript").

### 6.4 Outbound network
- Only two features make outbound requests: `ai.mjs` (OpenRouter, fixed host) and `calsync.mjs` (coach-supplied iCal URLs, through the SSRF-safe fetcher in F20).
  ffmpeg is run with `-protocol_whitelist file` so it cannot fetch either (3.14). No email is sent (D14).
- Nothing else fetches external URLs. In particular, campaign kit links and guide links are stored and shown as links, never fetched.
- Calendar URLs are encrypted at rest and never echoed back.

### 6.5 Public surface
The new public routes are `GET`/`POST /enquire/:slug` and `/enquire.css` (F6), and `GET`/`POST /plan/<token>` with its `guide` and `media` sub-paths (F13, F14).
- The enquiry form is rate-limited, protected by a honeypot, consent-gated, served with a strict CSP and no JS, and size-capped at 8 KB. Lead data is purged after
  12 months unconverted. `?campaign=` shows only live campaigns the coach marked public.
- The plan page is reachable only with an HMAC-signed, expiring token bound to one enrolment (or one client and guide); it is read-only apart from Accept/Decline
  (a POST with a per-token CSRF field, rate-limited to 10 per token per hour), carries the same CSP plus `referrer-policy: no-referrer`, `x-robots-tag: noindex` and
  `cache-control: no-store`, shows first names only, and answers 404 for anything invalid, expired, dropped or erased. Media through it are checked against the
  guide's blocks like F14's client route.

### 6.6 Desk CSP
- The CSP is unchanged: no `unsafe-*`, no inline scripts or styles, no third-party scripts besides Google sign-in.
- All DOM is built through `h()` with `textContent`. User-supplied text (guides, templates, transcripts, AI output) is **never** set as HTML.
- Inline styles only through CSSOM (`h()` maps `style` to `el.style`, 3.9). `setAttribute('style', …)` and SVG presentation attributes carrying `var()` are not used (2.4).
- Links from coach data (`kit.url`, guide links) must be `https:` and open with `rel="noopener noreferrer" target="_blank"`.

### 6.7 Money
- Integers in pence. No card data is ever stored. There are no payment provider calls.
- Invoice numbers are unique per coach and assigned atomically.
- Nothing in billing changes `users.plan` or gates a service.

### 6.8 Clocks and idempotence
- Every clock and handler is idempotent across restarts (claim-then-act, or a unique key).
- Tests prove that two ticks, and a re-open of the store, never double-send.

### 6.9 Prod migration safety
- All schema work is additive (`CREATE TABLE IF NOT EXISTS`, `addColumn`). No table rebuilds of existing tables in this batch.
- The start-up migration cost must stay under 1 s on a copy of the prod DB. WP-Z measures it against the latest `backup-before-*.sqlite` copy, read-only, in a temp dir. It never touches prod.

---

## 7. Validation and the definition of done

Every package, before it says it is done:
1. `node --test server/test` passes (all files, not only the package's), **run on two different `today` values**:
   - the real day;
   - `TZ=Europe/London` with the test helper's `fakeToday` for a Monday and a Sunday, where the package has date logic.
   
   Date-dependent tests take `today` or `now` injected, never the wall clock.
2. Syntax checks: `node --check` on every new `.mjs`/`.js` (desk modules too: `node --input-type=module --check < file`).
3. `scripts/lint-design.sh desk` is clean (WP9: `ios`; WP10: `android`).
4. Desk screenshots against the package's own running server, for every new route, at desktop and mobile, in the dark and light themes:
   ```bash
   node scripts/desk-shot.mjs http://100.83.68.108:<port> /<route> /tmp/claude-1000/<pkg>-<route>.png --code local-demo-coach
   node scripts/desk-shot.mjs http://100.83.68.108:<port> /<route> /tmp/claude-1000/<pkg>-<route>-m.png --mobile --code local-demo-coach
   ```
   - Each shot must exit 0, which means no console errors.
   - The agent **looks at** the screenshots and fixes visual defects: overflow at 390 px, clipped text, empty tiles in the demo, and contrast.
5. Keyboard pass: every new interactive element is reachable with Tab, has a visible focus ring, and drag-and-drop has its keyboard alternative.
6. The demo world shows the feature richly after a rebuild (delete `meta.demo_built`, restart). The builder runs inside the demo tx and emits nothing.
7. `docs/api/<package>.md` documents every endpoint, event, action, fact and variable the package adds, plus "Integration requests", "Parity gaps" and "Design notes".
8. **Feature-specific done conditions:**
   - **Campaigns (F13)** count as done only when a demo client can see today's activities and a full guide on **at least one** client surface (the `/plan` page
     always; the apps when their CI is green), and can accept an invitation there.
   - **Voice (F19)** counts as done only with the consent gate in place (no `listen()` call without consent, proved by test) and the client-view test passing on
     every client route.
   - **End coaching (F8)** counts as done only when the cross-package tests pass after WP-Z's merge: no recurring invoice, no dunning, no nudge, no run after `client.offboarded`.
9. A final report (the agent's return text) lists:
   - the commits;
   - the test count;
   - the screenshot paths;
   - the `http://100.83.68.108:<port>/desk#/<route>` links;
   - any gap: for example, voice recording cannot be tested over plain-http local (not a secure context), so the upload fallback was used.

The **parity gaps known in advance**:
- the desk microphone needs HTTPS (the local preview is http);
- the coach's own phone push for urgent notifications is not exercised locally (no APNs/FCM credentials in the local stack; the recorder transport proves it in tests);
- the Android emulator has no audio input;
- iOS only compiles in CI;
- real OpenRouter transcription is never exercised locally (the stub only);
- real iCal URLs are not fetched in tests (`calFetch` fake). WP7 may run one manual fetch of a public, non-personal ICS (for example a public UK holidays feed) from its worktree to prove the fetcher, and must report it.

---

## 8. Feature index

"New" means the capability does not exist today; "rework" means an existing screen redesigned, with new parts noted. Foundation plumbing (event bus,
live stream, theming, component kit, tags and segments, ffmpeg, outreach governor) is **not** counted.

| # | Feature | New / rework | Package | Primary route(s) | Key tables |
|---|---|---|---|---|---|
| F1 | Command Centre (bento Today, brief) | rework of Today, + brief and activity feed | WP1 | `/today` | (reads) |
| F2 | Command palette, global search, shortcuts | new | WP0-D + WP1 | ⌘K | — |
| F3 | Notification centre, live updates, urgent push to the coach | new | WP0-S/D + WP1 | bell, `/api/coach/stream` | `coach_notifications` |
| F4 | Unified inbox | new | WP1 | `/inbox` | `inbox_state` |
| F5 | Client 360: health score, timeline, notes, consent and outreach chips | rework of client page, + score, timeline, notes | WP2 | `/clients/:id` | `client_scores`, `client_notes` |
| F6 | Leads pipeline and public enquiry form | new | WP11 | `/pipeline`, `/enquire/:slug` | `leads`, `lead_activities`, `lead_forms` |
| F7 | Lifecycle stages, tags, segments, birthdays | new | WP2 (+WP0-S tables) | `/segments` | `client_lifecycle`, `lifecycle_history`, `tags`, `client_tags`, `segments` |
| F8 | Retention radar, renewals, pause, End coaching, win-back | new | WP2 | `/retention` | (`client_lifecycle`) |
| F9 | Invoices, payments, refunds, receipts, CSV export | new | WP3 | `/billing` | `billing_settings`, `invoices`, `invoice_lines`, `payments`, `credit_notes`, `refunds` |
| F10 | Packages, credits, recurring billing, discount cycles, cancellation charges | new | WP3 | `/billing/packages` | `packages`, `client_packages`, `credit_moves`, `billing_schedules`, `billing_client_state` |
| F11 | Dunning (overdue chasing) | new | WP3 | `/billing/invoices/:id` | `dunning_log` |
| F12 | Discounts, promo codes, referrals | new | WP3 | `/offers` | `discounts`, `discount_redemptions`, `referral_settings`, `referral_codes`, `referrals` |
| F13 | Bespoke campaigns: invitations with spend, capacity, fees, plan page | new | WP4 (+WP9/WP10) | `/campaigns`, `/plan/<token>` | `campaigns`, `campaign_phases`, `campaign_activities`, `campaign_kit`, `campaign_enrolments`, `campaign_progress`, `campaign_nudges` |
| F14 | Guidebook (block-based guides) | new | WP4 (+apps renderer) | `/guidebook` | `coach_guides` |
| F15 | Automation builder (18 recipes, AI-derived guard) | new (autoflows kept) | WP5 | `/automations` | `automations`, `automation_runs`, `automation_state`, `automation_slots` |
| F16 | Message templates and snippets | new | WP5 | `/templates` | `message_templates` |
| F17 | Scheduled messages and segment broadcasts | new | WP5 | `/broadcasts` | `scheduled_messages`, `broadcasts` |
| F18 | AI second opinion, voice check, drafting, approval routing | new | WP6 (+WP0-S `ai.mjs`) | composer, Settings › AI | `ai_reviews`, `ai_calls`, `ai_settings` |
| F19 | Voice notes with consent, transcription and analysis | new (extends letter voice) | WP6 + WP9 + WP10 | threads, apps | `voice_analyses`, `client_ai_consent`, `voice_client_state` (+ `media`, `messages.updated_at`) |
| F20 | Calendar connections, holds, conflicts, buffers, time off | new | WP7 | `/schedule`, Settings › Calendars | `calendar_sources`, `busy_blocks`, `calendar_holds`, `time_off`, `calendar_prefs`, `conflict_ignores` |
| F21 | Slot finder, standing sessions, reschedule, waitlist, reminders, cancellation policy | new | WP7 | slide-over, `/schedule` | `waitlist`, `booking_reminders` (+ `bookings.series_id`) |
| F22 | Coach diary and session notes | new | WP7 | `/diary` | `diary_entries`, `session_notes` |
| F23 | Coach tasks | new | WP8 | `/tasks` | `tasks` |
| F24 | Accountability board | new | WP8 | `/accountability` | `accountability_nudges`, `accountability_weeks` |
| F25 | Engagement insights: cohorts, heatmap, NPS/pulse | new | WP8 | `/insights` | `pulse_surveys`, `pulse_sends` |
| F26 | Revenue insights and forecast | rework of `/business` MRR, + forecast and LTV | WP3 | `/revenue` | (reads) |
| F27 | Onboarding checklist | new | WP2 | Client 360, Settings › Onboarding | `onboarding_templates`, `onboarding_clients`, `onboarding_steps` |
| F28 | Marketing: sources, follow-ups, testimonials, offer pages | new | WP11 | `/marketing` | `followup_templates`, `testimonials` |

Count: 28 features, 25 new and 3 reworks. Leaving out F2 and F3 as shell infrastructure still leaves 23 new client-management features, over the brief's floor of 15.

---

## 9. Open points for the owner (do not block the build)

1. **AI provider and models.** Set `OPENROUTER_API_KEY`, `AI_MODEL` and `AI_AUDIO_MODEL` in prod when you are happy. Until then, everything runs on the labelled stub.
   Before you do: the privacy paragraph (drafted by WP-Z), the App Store privacy label (Audio Data) and Play Data safety form, and a check of the consent sheet
   against Apple's guideline 5.1.2(i). The audio model cannot be Claude; the privacy text names whichever vendor you pick.
2. **"Coach to JK" (D13).** I read the brief as an AI check on your own messages. If you meant an assistant coach whose messages you approve, the approval queue
   (`pendingApproval`, the Inbox `draft:` item, "Route to JK for approval") is in place; adding assistant-coach accounts and roles is a later batch.
3. **Email (D14).** Leads and lapsed clients are reached by copy and `mailto:` only. Sending email (nurture sequences, receipts by email, win-back to people who
   deleted the app) needs a mail provider and a decision from you.
4. **Remaining marketing gaps.** No public testimonial wall, no social posting, no ad or UTM tracking beyond `?ref=` and `?campaign=`.
5. **Retention periods.** Voice transcripts and analyses: deleted 12 months after coaching ends; analysis fields after 24 months regardless; AI reviews 180 days;
   unconverted leads 12 months. Change them if your privacy notice should say otherwise.
6. **Outreach defaults.** At most 3 automated messages per client per day, quiet hours 21:00–07:30 for clients and 22:00–06:30 for your own urgent pushes.
7. **Cancellation policy.** Defaults: 24 h notice, a late cancel forfeits the credit, no fees. Fees only ever create a **draft** invoice line for you to confirm.
8. **AI Check in the apps' coach composer.** The desk has it; the iPhone and Android coach composers get it in a later batch.
9. **Invoice details.** The business name, address and bank details are entered in Billing › Settings. Nothing is pre-filled from real data.
10. **VAT.** The default is 0%. Set it if you register.
11. **Enquiry page slug.** The proposed default is `jk`, giving `https://jk.strangeramblings.com/enquire/jk`.
12. **Prod test clients.** The 10 made-up clients under your real account will show in onboarding (as complete), retention and marketing numbers until removed
    (`admin.mjs test-clients remove`).
