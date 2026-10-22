#!/bin/sh
# iOS simulator Release build of the `repack` candidate: verified assets -> code-signing key pair -> `pod install`
# -> xcodebuild Release for the arm64 simulator, unsigned. The Xcode bundling phase runs Re.Pack via the
# @react-native-community/cli CLI_PATH export added by repack-init.
# Device builds need MB_IOS_TEAM_ID and your own bundle id (REPRODUCIBILITY.md); they are not scripted here.
# Output: candidates/repack/build/ios/MBRnRepack.app
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
shared="$here/../_rn-shared"
cd "$here"
node "$shared/tools/gen-assets.mjs" .mb-assets
node "$shared/tools/ensure-signing-keys.mjs" "${MB_REMOTE_KEYS_DIR:-$shared/.keys}"
cd ios
COCOAPODS_DISABLE_STATS=true pod install </dev/null
xcodebuild -workspace MBRnRepack.xcworkspace -scheme MBRnRepack -configuration Release -sdk iphonesimulator -arch arm64 \
  -derivedDataPath "$here/build/ios/DerivedData" CODE_SIGNING_ALLOWED=NO build </dev/null
rm -rf "$here/build/ios/MBRnRepack.app"
cp -R "$here/build/ios/DerivedData/Build/Products/Release-iphonesimulator/MBRnRepack.app" "$here/build/ios/MBRnRepack.app"
echo "artifact: candidates/repack/build/ios/MBRnRepack.app"
