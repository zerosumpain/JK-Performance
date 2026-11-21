# The Android build image for scripts/android-build.sh: CircleCI's Android
# image plus the exact build tools AGP 8.7 wants, with the SDK readable by
# any user so builds can run as the host user.
FROM cimg/android:2024.11
RUN (yes || true) | sdkmanager --licenses >/dev/null; sdkmanager "build-tools;34.0.0" "build-tools;35.0.0" "platforms;android-35" >/dev/null \
 && chmod -R a+rX /home/circleci && chmod a+rx /home/circleci
