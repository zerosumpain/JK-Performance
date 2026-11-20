# JK Performance

iPhone app. App Store Connect record: **JK Performance**, bundle ID `com.jkperformance.app`.

SwiftUI, iOS 17, iPhone only, XcodeGen:

```bash
xcodegen generate --spec ios/project.yml
```

## Status

All 24 screens from the JK Performance Coach designs are scaffolded in SwiftUI on **mock data**
(`ios/JKPerformance/Model/Mock.swift`). Nothing talks to a server yet; sign-in, payments (StoreKit),
HealthKit and messaging are placeholders.

- **Welcome** — choose *I'm a client* / *I'm a coach*; "Sign out" (Account / Guides) returns here.
- **Client tabs** — Home (Morning, Sam → Daily habits, Progress, Challenges, Weekly check-in, Membership),
  Plan (Workout plan → logger, Exercise library), Calendar (month → Book a session), Messages, Account
  (Membership, Health & devices).
- **Coach tabs** — Today (→ Business), Clients (→ client detail, Programs), Schedule (week grid),
  Messages, Guides.

Design reference: `docs/coach/` (`screens-v1.webp` is the first sheet; the second, 24-screen sheet still
needs adding). Code layout: `Design/Theme.swift` (tokens, cards, chrome button, chips, segmented),
`Client/`, `Coach/`, `Model/`.

Only `swiftc -parse` has been run (Linux, on porkserv); it has **not** been compiled with Xcode yet.

## CI / TestFlight

The repo is **public** (since 2026-11-20) so GitHub's hosted macOS runners are free for it. Logs are
public too: never echo a secret.

- `check.yml` builds Debug and Release for the simulator on PRs and on main, when `ios/` changes.
- `testflight.yml` archives, signs and uploads on every main push that changes the app, or by hand
  (with *verify only* to sign without uploading). Build number = run number, version `0.1.<run>`.
- The provisioning profile is NOT a secret: `scripts/asc-app-profile.py` asks Apple for a fresh App
  Store profile each run ("JK CI com.jkperformance.app"). It also fails with a clear message if the
  App Store Connect record is missing.

Environment `testflight` holds:

| Name | Kind | Value |
|---|---|---|
| `APPLE_TEAM_ID` | variable | V74Q4X66B7 (set) |
| `APPLE_BUNDLE_ID` | variable | com.jkperformance.app (set) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` | secrets | the same App Store Connect API key as SR-AppleApp (Admin role) |
| `DISTRIBUTION_P12_BASE64`, `DISTRIBUTION_P12_PASSWORD` | secrets | the same Apple Distribution certificate as SR-AppleApp |

App icon: `python3 scripts/app-icon.py` (placeholder silver JK mark).
