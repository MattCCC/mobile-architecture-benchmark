#!/bin/sh
# Builds the iOS simulator app (Release, arm64): `ns prepare ios` bundles the islands and generates the Xcode
# project with the NativeScript runtime; generate-ios-project.rb makes it the shared UIKit island host.
set -eu

candidate=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$candidate/../.." && pwd)

node "$repo/candidates/_island-host/tools/prepare-assets.mjs"
gem_home=$(sed -n 's/^GEM_HOME="\([^"]*\)".*/\1/p' "$(command -v pod)")
test -n "$gem_home" && test -d "$gem_home"
cd "$candidate"
GEM_PATH="$gem_home:$(gem env gempath)" npx --no-install ns prepare ios --release
GEM_HOME="$gem_home" ruby "$candidate/scripts/generate-ios-project.rb"
xcodebuild -project "$candidate/platforms/ios/islandnativescript.xcodeproj" -scheme islandnativescript \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$candidate/build/ios-derived" ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build
app="$candidate/build/ios-derived/Build/Products/Release-iphonesimulator/MBIslandNativeScript.app"
node "$repo/candidates/_island-host/tools/verify-assets.mjs" "$app/fixtures"
rm -rf "$candidate/build/ios/MBIslandNativeScript.app"
mkdir -p "$candidate/build/ios"
cp -R "$app" "$candidate/build/ios/MBIslandNativeScript.app"
du -sk "$candidate/build/ios/MBIslandNativeScript.app"
