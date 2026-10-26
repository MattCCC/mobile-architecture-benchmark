# React Native islands inside a native Compose/UIKit shell.
MB_CANDIDATES += island-rn

MB_ISLAND_RN_DIR := candidates/island-rn
MB_ISLAND_RN_RN := $(MB_ISLAND_RN_DIR)/rn
MB_ISLAND_RN_GRADLE := $(MB_ISLAND_RN_RN)/android/gradlew -p $(MB_ISLAND_RN_DIR)/android --console=plain
MB_ISLAND_RN_APK := $(MB_ISLAND_RN_DIR)/android/app/build/outputs/apk/release/app-release.apk
MB_ISLAND_RN_APP := $(MB_ISLAND_RN_DIR)/build/ios/Build/Products/Release-iphonesimulator/MBIslandRn.app

.PHONY: deps-island-rn prepare-island-rn check-island-rn package-island-rn-android \
	build-island-rn-android build-island-rn-ios clean-island-rn artifacts-island-rn-android artifacts-island-rn-ios

deps-island-rn:
	cd $(MB_ISLAND_RN_RN) && npm ci --no-audit --no-fund

prepare-island-rn:
	node candidates/_island-host/tools/prepare-assets.mjs

check-island-rn: deps-island-rn prepare-island-rn
	cd $(MB_ISLAND_RN_RN) && npx tsc -p tsconfig.json --noEmit
	cd $(MB_ISLAND_RN_RN) && npx eslint --config .eslintrc.js index.js BuildProbe.ts '../../_island-rn-ui/src/**/*.{ts,tsx}' '../../_island-rn-ui/benchkit/src/**/*.ts'
	node --test candidates/_island-rn-ui/test/*.test.ts
	cd candidates/_island-host/ios/Core && swift test
	cd $(MB_ISLAND_RN_DIR)/android && ../rn/android/gradlew --console=plain :app:testDebugUnitTest
	node candidates/_island-host/tools/host-hash.mjs --check $(MB_ISLAND_RN_DIR)/candidate.json

package-island-rn-android: deps-island-rn
	cd $(MB_ISLAND_RN_RN) && npx --no-install brownfield package:android

build-island-rn-android: prepare-island-rn package-island-rn-android
	@test -f out/keys/keystore.properties || sh candidates/_island-host/tools/make-keystore.sh
	$(MB_ISLAND_RN_GRADLE) :app:assembleRelease
	@echo "island-rn: $(MB_ISLAND_RN_APK)"

build-island-rn-ios: deps-island-rn prepare-island-rn
	sh $(MB_ISLAND_RN_DIR)/scripts/build-ios.sh
	@echo "island-rn: $(MB_ISLAND_RN_APP)"

clean-island-rn:
	rm -rf $(MB_ISLAND_RN_DIR)/build $(MB_ISLAND_RN_DIR)/android/.gradle $(MB_ISLAND_RN_DIR)/android/app/build \
		$(MB_ISLAND_RN_DIR)/ios/MBIslandRn.xcodeproj $(MB_ISLAND_RN_DIR)/ios/MBIslandRn.xcworkspace \
		$(MB_ISLAND_RN_DIR)/ios/Pods $(MB_ISLAND_RN_RN)/android/islands/build \
		candidates/_island-host/generated candidates/_island-host/ios/Core/.build

artifacts-island-rn-android:
	@test -f $(MB_ISLAND_RN_APK) || { echo "not-verified: not-built ($(MB_ISLAND_RN_APK))" >&2; exit 1; }
	@echo $(MB_ISLAND_RN_APK)

artifacts-island-rn-ios:
	@test -d $(MB_ISLAND_RN_APP) || { echo "not-verified: not-built ($(MB_ISLAND_RN_APP))" >&2; exit 1; }
	@echo $(MB_ISLAND_RN_APP)
