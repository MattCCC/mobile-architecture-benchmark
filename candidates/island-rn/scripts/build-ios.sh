#!/bin/sh
set -eu

candidate=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
repo=$(CDPATH= cd -- "$candidate/../.." && pwd)
ios="$candidate/ios"

node "$repo/candidates/_island-host/tools/prepare-assets.mjs"
gem_home=$(sed -n 's/^GEM_HOME="\([^"]*\)".*/\1/p' "$(command -v pod)")
test -n "$gem_home" && test -d "$gem_home"
GEM_HOME="$gem_home" ruby "$candidate/scripts/generate-ios-project.rb"
pod install --project-directory="$ios"
xcodebuild -workspace "$ios/MBIslandRn.xcworkspace" -scheme MBIslandRn -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$candidate/build/ios" ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build
node "$repo/candidates/_island-host/tools/verify-assets.mjs" \
  "$candidate/build/ios/Build/Products/Release-iphonesimulator/MBIslandRn.app/fixtures"
