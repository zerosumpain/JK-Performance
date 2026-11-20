#!/usr/bin/env python3
"""Get the app's App Store provisioning profile from Apple, and write
ExportOptions.plist, so nobody has to make and paste a profile by hand.

Run by testflight.yml after install-signing.sh has put the distribution
certificate in the job's keychain. It:

1. confirms App Store Connect has an app record for BUNDLE_ID (the first run is
   the check that "JK Performance" exists);
2. finds that certificate on the developer account, matched by its bytes;
3. replaces this script's own profile ("JK CI <bundle>") with a fresh one, so
   capabilities ticked on the App ID since the last run are carried;
4. installs it, puts PROFILE_UUID in $GITHUB_ENV and writes ExportOptions.plist.

Token and API helpers are copied from SR-AppleApp scripts/asc-watch-profiles.py.
Standard library plus `openssl` and `security`, both on the macOS runner.
Any failure exits non-zero with what to fix.
"""
from __future__ import annotations

import base64
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com/v1"
NAME_PREFIX = "JK CI "


class Refused(Exception):
    """A reason to fall back to the iPhone-only upload, worded for the owner."""


# MARK: - The API token


def der_to_raw(der: bytes, size: int = 32) -> bytes:
    """An ECDSA signature from openssl (DER: SEQUENCE { INTEGER r, INTEGER s })
    as JWS wants it: r and s, each left-padded to `size` bytes, end to end."""
    if der[0] != 0x30:
        raise ValueError("not a DER sequence")
    index = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        if der[index] != 0x02:
            raise ValueError("not a DER integer")
        length = der[index + 1]
        value = der[index + 2 : index + 2 + length]
        index += 2 + length
        value = value.lstrip(b"\x00")
        if len(value) > size:
            raise ValueError("integer too long")
        parts.append(value.rjust(size, b"\x00"))
    return parts[0] + parts[1]


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def token(key_id: str, issuer: str, private_key_pem: str, now: int | None = None) -> str:
    now = int(time.time()) if now is None else now
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    claims = {"iss": issuer, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"}
    signing_input = b64url(json.dumps(header).encode()) + "." + b64url(json.dumps(claims).encode())
    with tempfile.NamedTemporaryFile("w", suffix=".p8", delete=False) as handle:
        handle.write(private_key_pem)
        key_path = handle.name
    try:
        os.chmod(key_path, 0o600)
        der = subprocess.run(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=signing_input.encode(), capture_output=True, check=True,
        ).stdout
    finally:
        os.unlink(key_path)
    return signing_input + "." + b64url(der_to_raw(der))


# MARK: - Calls


class Client:
    def __init__(self, bearer: str):
        self.bearer = bearer

    def call(self, method: str, path: str, body: dict | None = None, query: dict | None = None):
        url = API + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Authorization", "Bearer " + self.bearer)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:400]
            if error.code in (401, 403):
                raise Refused(
                    f"App Store Connect refused the API key ({error.code}) for {method} {path}. "
                    "The key needs the Admin role (or App Manager with access to Certificates, "
                    "Identifiers & Profiles): App Store Connect → Users and Access → Integrations. "
                    f"Apple said: {detail}"
                ) from None
            raise Refused(f"App Store Connect answered {error.code} for {method} {path}: {detail}") from None



def decode_profile(data: bytes) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".mobileprovision", delete=False) as handle:
        handle.write(data)
        path = handle.name
    try:
        out = subprocess.run(["security", "cms", "-D", "-i", path], capture_output=True, check=True).stdout
    finally:
        os.unlink(path)
    return plistlib.loads(out)


def keychain_certificates(keychain: str) -> set[bytes]:
    pem = subprocess.run(["security", "find-certificate", "-a", "-p", keychain],
                         capture_output=True, check=True, text=True).stdout
    blocks = re.findall(r"-----BEGIN CERTIFICATE-----(.+?)-----END CERTIFICATE-----", pem, re.S)
    return {base64.b64decode("".join(b.split())) for b in blocks}


def main() -> int:
    env = os.environ
    team, bundle = env["APPLE_TEAM_ID"], env["BUNDLE_ID"]
    temp = Path(env["RUNNER_TEMP"])
    client = Client(token(env["ASC_KEY_ID"], env["ASC_ISSUER_ID"], env["ASC_PRIVATE_KEY"]))

    apps = client.call("GET", "/apps", query={"filter[bundleId]": bundle, "limit": "10"})
    record = next((a for a in apps.get("data", []) if a["attributes"].get("bundleId") == bundle), None)
    if not record:
        raise Refused(f"App Store Connect has no app record for {bundle}. Create it under Apps, +, New App.")
    print(f"App Store Connect record: {record['attributes'].get('name')} ({bundle}, id {record['id']}).")

    ids = client.call("GET", "/bundleIds", query={"filter[identifier]": bundle, "limit": "200"})
    bundle_ref = next((i["id"] for i in ids.get("data", []) if i["attributes"].get("identifier") == bundle), None)
    if not bundle_ref:
        raise Refused(f"No App ID {bundle} on the developer account (Certificates, Identifiers & Profiles).")

    wanted = keychain_certificates(str(temp / "signing.keychain-db"))
    certs = client.call("GET", "/certificates", query={"limit": "200"})
    certificate = None
    for item in certs.get("data", []):
        content = item["attributes"].get("certificateContent")
        if content and base64.b64decode(content) in wanted:
            certificate = item["id"]
            break
    if not certificate:
        raise Refused("The certificate in DISTRIBUTION_P12_BASE64 is not on this developer account (revoked or another team).")

    name = NAME_PREFIX + bundle
    existing = client.call("GET", "/profiles", query={"filter[name]": name, "limit": "200"})
    for item in existing.get("data", []):
        if item["attributes"].get("name") == name:
            client.call("DELETE", f"/profiles/{item['id']}")
    created = client.call("POST", "/profiles", body={
        "data": {
            "type": "profiles",
            "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
            "relationships": {
                "bundleId": {"data": {"type": "bundleIds", "id": bundle_ref}},
                "certificates": {"data": [{"type": "certificates", "id": certificate}]},
            },
        }
    })
    data = base64.b64decode(created["data"]["attributes"]["profileContent"])
    profile = decode_profile(data)
    if profile["Entitlements"].get("application-identifier") != f"{team}.{bundle}":
        raise Refused(f"Apple made a profile for {profile['Entitlements'].get('application-identifier')}, not {team}.{bundle}.")
    uuid = profile["UUID"]
    for folder in (Path.home() / "Library/MobileDevice/Provisioning Profiles",
                   Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles"):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{uuid}.mobileprovision").write_bytes(data)
    options = {"method": "app-store-connect", "destination": "upload", "teamID": team,
               "signingStyle": "manual", "provisioningProfiles": {bundle: uuid}}
    (temp / "ExportOptions.plist").write_bytes(plistlib.dumps(options))
    with open(env["GITHUB_ENV"], "a") as out:
        out.write(f"PROFILE_UUID={uuid}\n")
    print(f"Installed App Store profile {name} ({uuid}).")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as reason:
        print(f"::error::{reason}")
        sys.exit(1)
