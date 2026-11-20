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

This repo is **private**. GitHub-hosted minutes for private repos have been blocked since 2026-09-23,
and there is no self-hosted Mac runner. So no macOS archive or TestFlight upload runs yet. Options:
make the repo public (like SR-AppleApp), restore minutes, or add a Mac runner.

Signing secrets it will need (same names as SR-AppleApp): `ASC_KEY_ID`, `ASC_ISSUER_ID`,
`ASC_PRIVATE_KEY`, `DISTRIBUTION_P12_BASE64`, `DISTRIBUTION_P12_PASSWORD`, `PROVISION_PROFILE_BASE64`.
