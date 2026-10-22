#!/bin/sh
# iOS simulator Release build of the `expo` candidate: verified assets -> `npx expo prebuild --clean` (CNG) ->
# `pod install` -> xcodebuild Release for the arm64 simulator, unsigned (CODE_SIGNING_ALLOWED=NO).
# Device builds need MB_IOS_TEAM_ID and your own bundle id (REPRODUCIBILITY.md); they are not scripted here.
# Output: candidates/expo/build/ios/MBExpo.app
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
shared="$here/../_rn-shared"
cd "$here"
node "$shared/tools/gen-assets.mjs" .mb-assets
CI=1 EXPO_NO_TELEMETRY=1 npx expo prebuild --clean --platform ios --no-install </dev/null
cd ios
COCOAPODS_DISABLE_STATS=true pod install </dev/null
workspace=$(ls -d ./*.xcworkspace | head -n 1)
scheme=$(basename "$workspace" .xcworkspace)
xcodebuild -workspace "$workspace" -scheme "$scheme" -configuration Release -sdk iphonesimulator -arch arm64 \
  -derivedDataPath "$here/build/ios/DerivedData" CODE_SIGNING_ALLOWED=NO build </dev/null
rm -rf "$here/build/ios/MBExpo.app"
cp -R "$here/build/ios/DerivedData/Build/Products/Release-iphonesimulator/$scheme.app" "$here/build/ios/MBExpo.app"
echo "artifact: candidates/expo/build/ios/MBExpo.app (scheme $scheme)"
