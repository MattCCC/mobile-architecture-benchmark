#!/bin/sh
# Android release build of the `repack` candidate: verified assets -> code-signing key pair (public key compiled
# into the host bundle) -> Gradle assembleRelease. The React Native Gradle plugin calls `react-native bundle`,
# which react-native.config.js routes to Re.Pack (Rspack); Hermes compiles the bundle to bytecode; R8 + resource
# shrinking on; arm64-v8a only (gradle.properties); signed with the local non-distribution key.
# Output: candidates/repack/build/android/app-arm64-release.apk
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
shared="$here/../_rn-shared"
eval "$(sh "$shared/tools/android-env.sh")"
cd "$here"
node "$shared/tools/gen-assets.mjs" .mb-assets
node "$shared/tools/ensure-signing-keys.mjs" "${MB_REMOTE_KEYS_DIR:-$shared/.keys}"
sh "$shared/tools/ensure-keystore.sh" "$shared/.keys"
MB_KEYSTORE_PROPERTIES="${MB_KEYSTORE_PROPERTIES:-$shared/.keys/keystore.properties}"
export MB_KEYSTORE_PROPERTIES
cd android
./gradlew --console=plain :app:assembleRelease </dev/null
mkdir -p "$here/build/android"
cp app/build/outputs/apk/release/app-release.apk "$here/build/android/app-arm64-release.apk"
echo "artifact: candidates/repack/build/android/app-arm64-release.apk"
