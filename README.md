# JK Performance

iPhone app. App Store Connect record: **JK Performance**, bundle ID `com.jkperformance.app`.

SwiftUI, iOS 17, iPhone only, XcodeGen:

```bash
xcodegen generate --spec ios/project.yml
```

## Status

Skeleton only. Screens will be scaffolded from the JK Performance Coach artefacts.

## CI / TestFlight

This repo is **private**. GitHub-hosted minutes for private repos have been blocked since 2026-09-23,
and there is no self-hosted Mac runner. So no macOS archive or TestFlight upload runs yet. Options:
make the repo public (like SR-AppleApp), restore minutes, or add a Mac runner.

Signing secrets it will need (same names as SR-AppleApp): `ASC_KEY_ID`, `ASC_ISSUER_ID`,
`ASC_PRIVATE_KEY`, `DISTRIBUTION_P12_BASE64`, `DISTRIBUTION_P12_PASSWORD`, `PROVISION_PROFILE_BASE64`.
