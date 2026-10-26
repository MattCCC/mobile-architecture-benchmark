#!/bin/sh
# Builds the Android island APK: `ns prepare` bundles the islands and generates platforms/android, then Gradle runs
# with the arguments `ns build` passes, on the toolchain of the other island hosts (Gradle 9.3.1, AGP 9.1.0) instead
# of the runtime template's (Gradle 8.14.3, AGP 8.12.1): the shared host's Compose BOM 2026.09 needs AGP 9.1.
# The template needs two compatibility edits for that (see README "Android toolchain").
#   build-android.sh debug|release [keystore.properties]
set -eu

candidate=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mode=${1:-release}
props=${2:-}
platform="$candidate/platforms/android"

cd "$candidate"
if [ "$mode" = release ]; then
  npx --no-install ns prepare android --release
else
  npx --no-install ns prepare android
fi

# Gradle 9 instantiates task types through managed injection, which needs the JavaExec subclass to be abstract.
helper="$platform/app/gradle-helpers/BuildToolTask.gradle"
if ! grep -q '^abstract class BuildToolTask' "$helper"; then
  tmp="$helper.tmp"
  sed 's/^class BuildToolTask extends JavaExec/abstract class BuildToolTask extends JavaExec/' "$helper" > "$tmp"
  mv "$tmp" "$helper"
fi
grep -q '^abstract class BuildToolTask' "$helper"

cat > "$platform/gradle/wrapper/gradle-wrapper.properties" <<'EOF'
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-9.3.1-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
EOF

set -- --console=plain -PappPath="$candidate/app" -PappResourcesPath="$candidate/App_Resources" \
  -PmbAbis="${MB_ISLAND_NATIVESCRIPT_ABIS:-arm64-v8a}" -PandroidBuildToolsVersion=9.1.0 \
  -Pandroid.builtInKotlin=false -Pandroid.newDsl=false
cd "$platform"
if [ "$mode" = release ]; then
  test -n "$props" || { echo "keystore.properties required for release" >&2; exit 2; }
  dir=$(CDPATH= cd -- "$(dirname -- "$props")" && pwd)
  store=$(sed -n 's/^storeFile=//p' "$props")
  case "$store" in /*) ;; *) store="$dir/$store" ;; esac
  echo "gradlew assembleRelease (signing arguments not echoed)"
  ./gradlew "$@" assembleRelease -Prelease -PksPath="$store" \
    -Palias="$(sed -n 's/^keyAlias=//p' "$props")" -Ppassword="$(sed -n 's/^keyPassword=//p' "$props")" \
    -PksPassword="$(sed -n 's/^storePassword=//p' "$props")"
  apk="$platform/app/build/outputs/apk/release/app-release.apk"
else
  ./gradlew "$@" assembleDebug
  apk="$platform/app/build/outputs/apk/debug/app-debug.apk"
fi
mkdir -p "$candidate/build/android"
cp "$apk" "$candidate/build/android/app-arm64-$mode.apk"
ls -l "$candidate/build/android/app-arm64-$mode.apk"
