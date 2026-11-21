#!/usr/bin/env bash
# Put the newest Android build on the private download page. Runs on porkserv
# (a systemd timer, or by hand): finds the latest successful "Android" run on
# main, and if its commit isn't the one already published, downloads the APK
# artifact and swaps it in atomically. The server serves it at
# /android/<ANDROID_DOWNLOAD_TOKEN>.
set -euo pipefail
repo="${JK_REPO:-zerosumpain/JK-Performance}"
dest="${JK_ANDROID_DIR:-/var/lib/jk-performance/android}"

# Filter here rather than with gh's --branch/--status/--event: combined, those
# return nothing (gh 2.105), and an empty list must not read as run "null".
run=$(gh run list -R "$repo" --workflow android.yml --limit 30 --json databaseId,headSha,headBranch,event,conclusion \
  -q '[.[] | select(.headBranch == "main" and .event == "push" and .conclusion == "success")][0] // empty | "\(.databaseId) \(.headSha)"')
[ -n "$run" ] || { echo "No successful Android build on main yet"; exit 0; }
read -r id sha <<<"$run"
current=$(sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p' "$dest/version.json" 2>/dev/null || true)
[ "$current" = "$sha" ] && exit 0

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
gh run download "$id" -R "$repo" -n jk-performance-apk -D "$tmp"
# A real APK is a zip; refuse anything else rather than serve it.
[ "$(head -c 2 "$tmp/jk-performance.apk")" = "PK" ] || { echo "Downloaded file is not an APK" >&2; exit 1; }
mkdir -p "$dest"
cp "$tmp/jk-performance.apk" "$dest/.jk-performance.apk.new" && mv -f "$dest/.jk-performance.apk.new" "$dest/jk-performance.apk"
cp "$tmp/version.json" "$dest/version.json"
echo "Published Android build $(cat "$dest/version.json")"
