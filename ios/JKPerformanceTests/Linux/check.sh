#!/usr/bin/env bash
# Run the app's decoder and text-rule tests on Linux, in Docker (no Xcode here).
#
#   ios/JKPerformanceTests/Linux/check.sh
#
# Builds a throwaway SwiftPM package whose library module is named
# `JKPerformance` (so `@testable import JKPerformance` is untouched) from the
# Foundation-only files in ios/JKPerformance/Net, plus Linux/Shims.swift for
# the two design-layer names they mention, and runs every XCTest file in
# ios/JKPerformanceTests against the contract fixtures in Fixtures/.
# Every other Swift file in the app goes through `swiftc -parse`: no types are
# checked, but an unbalanced brace or a broken interpolation fails here before
# the macOS CI job. Swift 5 language mode, as the app.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS="$(cd "$HERE/../.." && pwd)"
APP="$IOS/JKPerformance"
TESTS="$IOS/JKPerformanceTests"
IMAGE="${IOS_CHECK_IMAGE:-swift:6.0-jammy}"

command -v docker >/dev/null || { echo "check: docker is not installed" >&2; exit 2; }
docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null

WORK="$(mktemp -d "${TMPDIR:-/tmp}/jk-ios-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/Sources/JKPerformance" "$WORK/Tests/JKPerformanceTests" "$WORK/parse"

compiled=0
for file in "$APP"/Net/*.swift; do
  imports="$(grep -E '^import ' "$file" | awk '{print $2}' | sort -u | tr '\n' ' ')"
  if [ "$imports" = "Foundation " ]; then
    cp "$file" "$WORK/Sources/JKPerformance/"
    compiled=$((compiled + 1))
  fi
done
cp "$HERE/Shims.swift" "$WORK/Sources/JKPerformance/"
cp "$TESTS"/*.swift "$WORK/Tests/JKPerformanceTests/"
cp -R "$TESTS/Fixtures" "$WORK/Tests/JKPerformanceTests/Fixtures"
find "$APP" -name '*.swift' -exec cp --parents {} "$WORK/parse" \;

cat >"$WORK/Package.swift" <<'SWIFT'
// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "JKPerformance",
  targets: [
    .target(name: "JKPerformance", path: "Sources/JKPerformance"),
    .testTarget(name: "JKPerformanceTests", dependencies: ["JKPerformance"], path: "Tests/JKPerformanceTests",
                exclude: ["Fixtures"]),
  ]
)
SWIFT

echo "check: $compiled Foundation-only model files compiled; parsing the rest"
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK:/w" -w /w "$IMAGE" bash -c '
  set -e
  find parse -name "*.swift" -print0 | xargs -0 swiftc -frontend -parse -swift-version 5
  if ! swift build --build-tests -Xswiftc -swift-version -Xswiftc 5 >build.log 2>&1; then
    grep -E "error" build.log | head -40; echo "check: build failed" >&2; exit 1
  fi
  swift test --skip-build 2>&1 | grep -vE "^Test Case .* (started|passed)" | tail -n 40
  swift test --skip-build >/dev/null 2>&1
'
