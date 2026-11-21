#!/usr/bin/env bash
# A headless Android emulator on porkserv for checking screens (needs /dev/kvm).
#   scripts/android-emulator.sh start            # boots "jk-emu" (Pixel 7, Android 15)
#   scripts/android-emulator.sh install <apk>    # installs and launches the app
#   scripts/android-emulator.sh shot <name.png>  # screenshot into android/screens/
#   scripts/android-emulator.sh adb <args…>      # anything else (input tap x y, …)
#   scripts/android-emulator.sh stop
# Image: android/docker/emulator.Dockerfile. Host networking, so the app can
# reach the local preview at http://100.83.68.108:5671.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
name=jk-emu
case "${1:-}" in
  start)
    docker rm -f $name >/dev/null 2>&1 || true
    docker run -d --name $name --network host --device /dev/kvm jk-android-emulator:1 \
      bash -c 'emulator -avd jk -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot -memory 3072 -cores 2 -port 5560' >/dev/null
    docker exec -e ANDROID_SERIAL=emulator-5560 $name adb wait-for-device
    until [ "$(docker exec -e ANDROID_SERIAL=emulator-5560 $name adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 3; done
    docker exec -e ANDROID_SERIAL=emulator-5560 $name adb shell settings put global window_animation_scale 1 >/dev/null
    echo "Emulator booted" ;;
  install)
    docker cp "$2" $name:/tmp/app.apk
    docker exec -e ANDROID_SERIAL=emulator-5560 $name adb install -r /tmp/app.apk >/dev/null
    docker exec -e ANDROID_SERIAL=emulator-5560 $name adb shell am start -n com.jkperformance.app/.MainActivity >/dev/null
    echo "Installed and launched" ;;
  shot)
    mkdir -p "$here/android/screens"
    docker exec -e ANDROID_SERIAL=emulator-5560 $name adb exec-out screencap -p > "$here/android/screens/$2"
    echo "android/screens/$2" ;;
  adb) shift; docker exec -e ANDROID_SERIAL=emulator-5560 $name adb "$@" ;;
  stop) docker rm -f $name >/dev/null; echo stopped ;;
  *) sed -n 2,9p "$0"; exit 1 ;;
esac
