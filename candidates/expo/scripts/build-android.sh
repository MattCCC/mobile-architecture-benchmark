#!/bin/sh
# Android release build of the `expo` candidate: verified assets -> `npx expo prebuild --clean` (CNG) ->
# Gradle assembleRelease (R8 + resource shrinking, Hermes V1 bytecode, arm64-v8a only, local non-distribution key).
# Output: candidates/expo/build/android/app-arm64-release.apk
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
shared="$here/../_rn-shared"
eval "$(sh "$shared/tools/android-env.sh")"
cd "$here"
node "$shared/tools/gen-assets.mjs" .mb-assets
sh "$shared/tools/ensure-keystore.sh" "$shared/.keys"
MB_KEYSTORE_PROPERTIES="${MB_KEYSTORE_PROPERTIES:-$shared/.keys/keystore.properties}"
export MB_KEYSTORE_PROPERTIES
CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --clean --platform android --no-install </dev/null
cd android
./gradlew --console=plain :app:assembleRelease </dev/null
mkdir -p "$here/build/android"
cp app/build/outputs/apk/release/app-release.apk "$here/build/android/app-arm64-release.apk"
echo "artifact: candidates/expo/build/android/app-arm64-release.apk"
