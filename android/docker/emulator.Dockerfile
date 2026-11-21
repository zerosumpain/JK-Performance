# A headless Android emulator for screenshots on porkserv (needs /dev/kvm):
#   docker build -t jk-android-emulator:1 -f android/docker/emulator.Dockerfile android/docker
# Used by scripts/android-screens.sh.
FROM jk-android-build:1
USER root
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends libpulse0 libnss3 libxcomposite1 libxcursor1 libxdamage1 libxi6 libxtst6 libasound2t64 libgl1 libxkbfile1 >/dev/null 2>&1 || apt-get install -y -qq --no-install-recommends libpulse0 libnss3 libgl1 libasound2 >/dev/null; rm -rf /var/lib/apt/lists/*
RUN sdkmanager "emulator" "platform-tools" "system-images;android-35;google_apis;x86_64" >/dev/null \
 && echo no | avdmanager create avd -n jk -k "system-images;android-35;google_apis;x86_64" -d pixel_7 \
 && chmod -R a+rwX /home/circleci
