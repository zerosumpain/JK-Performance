#!/bin/bash
# Put the Apple Distribution certificate and the App Store Connect API key on
# the runner. The provisioning profile comes from Apple (asc-app-profile.py).
set -euo pipefail
umask 077
printf '%s' "$DISTRIBUTION_P12_BASE64" | base64 --decode > "$RUNNER_TEMP/certificate.p12"
printf '%s' "$ASC_PRIVATE_KEY" > "$RUNNER_TEMP/AuthKey.p8"
SIGNING_PASSWORD=$(openssl rand -hex 32)
echo "::add-mask::$SIGNING_PASSWORD"
KEYCHAIN="$RUNNER_TEMP/signing.keychain-db"
security create-keychain -p "$SIGNING_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$SIGNING_PASSWORD" "$KEYCHAIN"
security import "$RUNNER_TEMP/certificate.p12" -P "$DISTRIBUTION_P12_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN"
security set-key-partition-list -S apple-tool:,apple: -k "$SIGNING_PASSWORD" "$KEYCHAIN" >/dev/null
security list-keychains -d user -s "$KEYCHAIN"
