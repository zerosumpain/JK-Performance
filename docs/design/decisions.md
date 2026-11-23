# Atelier redesign: owner decisions (22 November 2026)

The owner approved the Atelier direction in `atelier-spec.md` and asked for it to be built as proposed, taking the
recommended answer to every open question:

- Direction: approved as specified (warm off-black, bone, one champagne accent, Newsreader serif for JK's voice only).
- Third client tab is named **JK**. Until a portrait exists it shows a drawn JK monogram, falling back to `bubble.left` / `chat_bubble`.
- No portrait or professional monogram yet: draw an interim JK monogram (single vector: SF custom symbol / Android vector / SVG). Avatars use initials on `raised`.
- App icon and BrandIntro move from silver chrome to bone and champagne.
- Letter rhythm: Elite weekly with a voice or video note, Performance weekly written, Foundation messages only, Free none; fortnightly is a per-client switch.
- Coach editors (Programs, Forms, Autoflows, Plans & prices, Business, availability) are hidden on the phone behind a coach setting "Show studio tools" (default off) and stay on the web desk. Not deleted yet.
- Day minimum default: ceil(60% of active habits), JK can change it per client.
- Food logging stays gated on 'nutrition'. Challenges stay, behind a coach toggle, default off.
- Letters deliver Monday 07:00 Europe/London.
- Light "paper" mode: tokens defined now, dark ships; no light-mode switch in this batch.
- Serif: Newsreader (OFL) for now.
- Phase 4 ("later options") is NOT in this batch.

# Desk v2 foundation (WP0-D): "Atelier Night" (23 November 2026)

Recorded by WP0-D for `docs/design/desk-v2.md` section 2.6. The palette is unchanged: every existing token in
`server/desk/app.css` keeps its value, including `--accent:#C8A970` (D8). What changed, and why:

**Atelier rules relaxed (desk only; the apps are untouched).**
1. Shadows on floating layers only: the palette, slide-overs, menus and popovers, toasts, sheets and the dragged card
   (`--shadow-float`, `--shadow-drag`). Tiles and cards stay flat, with a hairline edge (`--tile-edge`).
2. Gradients only as tokens: `--sheen` on hero tiles and `--shimmer` on skeletons.
3. Glass (`--glass` + `backdrop-filter: blur(var(--blur)) saturate(1.2)`) only on the top bar, the command palette and the phone's bottom bar.
4. Serif display type up to 44 px (`--t-display`); screen titles use `--t-display-s` (32 px Newsreader). The italic accent word in a title is champagne.

**New tokens** (both `:root` blocks; light values mirror dark): `--glass --glass-light-edge --blur --tile --tile-hover --tile-edge --sheen
--shimmer --shadow-float --shadow-drag --focus --chart-1..6 --chart-grid --chart-area --heat-0..4 --r-bento --r-float --dur-fast --dur-slow
--spring --t-display --t-display-s --t-number --sidebar (now 248px) --rail --topbar`. Colour literals live only in the `:root` blocks;
`scripts/lint-design.sh desk` now also rejects `rgb()`/`rgba()`/`hsl()` elsewhere. Local colours are derived with `var()` and `color-mix()`.

**Light theme ships.** Chosen in the avatar menu or Settings › Desk (System, Dark, Light), stored in coach prefs `desk.theme` and mirrored in the
browser so it applies before the first request; `data-theme` sits on `<html>`. `node scripts/contrast-check.mjs --desk` measures 154 pairs in both
themes from `app.css` itself (text 4.5:1, UI 3:1), including text on glass, on the accent wash, badge numbers on the accent, the focus ring and the
chart tones. Two Atelier consequences, kept on purpose:
- `--input-border` on `--raised` is 2.85:1, so fields on raised layers (sheets, slide-overs, the palette) are filled with `--surface`, and the
  boundary is measured against that fill instead.
- Tertiary text is never on raised: raised layers remap `--text-tertiary` (and the older `--faint`) to `--text-secondary`.

**Motion.** Hover lift 1 px over 120 ms, press 0.99, slide-overs 24 px plus fade over 240 ms, palette 0.98 → 1 over 160 ms, toasts rise 8 px,
chart lines draw in over 600 ms, badges pop on `--spring`, live rows flash the accent wash. `prefers-reduced-motion` keeps only opacity
transitions (one block in `app.css`).

**Information architecture.** The sidebar is grouped (Command, Clients, Engage, Schedule, Business, Build, Settings) and built from
`registerNav`; it folds to a 72 px rail with ⌘\ (`desk.shell.rail`). The selected item is an accent-wash pill with a 2 px champagne bar and a filled
glyph. The glass top bar carries breadcrumbs, the ⌘K search trigger, + New, the bell, the AI chip and the avatar menu. Phones get a glass bottom bar
(four items by slot, then More). "Schedule" is labelled **Calendar** in the nav, as the spec's IA table has it. Account becomes **Settings**
(`/account/:section`), and Guides becomes **Library**.

**Implementation choices a later package should know.**
- Every `register*` call takes an optional second argument `{fallback: true}`: it only fills keys that are not set yet. `main.js` registers the
  existing nav items this way because its body runs after `features.js` (imports are hoisted), so a package's refinement of `messages` or
  `schedule` is never overwritten. Packages register normally (later wins per key).
- `registerNav` items may carry `path` (default `/<id>`), `tabs: [{id, label, path}]` (palette Jump to) and `mobile: true | slot` (bottom bar; lower
  slot first, four shown). Defaults: Today 10, Clients 30, Calendar 40, Messages 45, so an Inbox registered at 20 pushes Messages into More.
- Added beyond 3.9: `registerPanel(kind, id => ({title, build, wide}))` with `openPanel(kind, id)` in `ui.js`, which is how `?panel=<kind>:<id>`
  deep links reopen after a reload (a default `client` panel is registered with `fallback`); `setClientScorer(fn)` in `palette.js` for WP1's
  scorer; `splitView`, `pageHead`, `flash`, `clientQuickView` in `ui.js`.
- The hash query (`#/route?panel=…&kit=1&tab=…`) is never part of the route: changing only the query does not redraw the screen
  (`setHashQuery`, `onHashQuery`, `view.query` in `core.js`).
- A send guard continues only through `ctx.proceed(meta)` from the coach's click (ignored without a user gesture, `navigator.userActivation`)
  or stops with `ctx.dismiss()`.
- Glyphs: `scripts/export-symbols.mjs --desk` writes `symbols.js` (174 glyphs). Google's repository files `card_giftcard` under `redeem`, and
  `auto_awesome` is drawn on a 24-unit grid, so a `symbols.js` entry may carry its viewBox as a third item, which `icon()` honours.
- `/account/kit?kit=1` is the living style guide; `/account/kit/widgets`, `/account/kit/client-tab/:key` and `/account/kit/composer` are the
  registry harness. Opening any desk route with `?kit=1` registers the kit's test-only widget, client tab, client action, bulk action, composer
  tool, slash item and send guard. Settings shows a "Design kit" link, which WP-Z hides.
