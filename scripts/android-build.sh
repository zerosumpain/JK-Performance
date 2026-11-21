#!/usr/bin/env bash
# Build the Android app in Docker (no SDK on the host). Usage:
#   scripts/android-build.sh                       # assembleDebug
#   scripts/android-build.sh compileDebugKotlin    # just compile
#   scripts/android-build.sh assembleDebug -PapiBase=http://100.83.68.108:5671
# Image: android/docker/Dockerfile (docker build -t jk-android-build:1 android/docker).
# The Gradle cache lives in ~/.cache/jk-android so repeat builds are quick.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
cache="${JK_ANDROID_CACHE:-$HOME/.cache/jk-android}"
mkdir -p "$cache/gradle" "$cache/home"
args=("$@"); [ ${#args[@]} -eq 0 ] && args=(assembleDebug)
exec docker run --rm -u "$(id -u):$(id -g)" \
  -e HOME=/cache/home -e GRADLE_USER_HOME=/cache/gradle -e ANDROID_HOME=/home/circleci/android-sdk -e ANDROID_SDK_ROOT=/home/circleci/android-sdk \
  -v "$cache:/cache" -v "$here/android:/work" -w /work \
  jk-android-build:1 gradle --console=plain -q "${args[@]}"
