# NativeScript islands inside the shared native Compose / UIKit shell.
MB_CANDIDATES += island-nativescript

MB_ISLAND_NS_DIR := candidates/island-nativescript
MB_ISLAND_NS_APK := $(MB_ISLAND_NS_DIR)/build/android/app-arm64-release.apk
MB_ISLAND_NS_APP := $(MB_ISLAND_NS_DIR)/build/ios/MBIslandNativeScript.app
MB_ISLAND_NS_KEYS := $(firstword $(wildcard out/keys/keystore.properties) candidates/_island-host/android/.keys/keystore.properties)
MB_ISLAND_NS_ENV := export ANDROID_HOME="$${ANDROID_HOME:-$$HOME/Library/Android/sdk}"

.PHONY: deps-island-nativescript prepare-island-nativescript check-island-nativescript \
	build-island-nativescript-android build-island-nativescript-ios clean-island-nativescript \
	artifacts-island-nativescript-android artifacts-island-nativescript-ios

deps-island-nativescript:
	cd $(MB_ISLAND_NS_DIR) && npm ci --no-audit --no-fund

prepare-island-nativescript:
	node candidates/_island-host/tools/prepare-assets.mjs

check-island-nativescript: deps-island-nativescript prepare-island-nativescript
	cd $(MB_ISLAND_NS_DIR) && npm run typecheck && npm run lint
	node --test candidates/_island-rn-ui/test/model.test.ts
	cd candidates/_island-host/ios/Core && swift test
	node candidates/_island-host/tools/host-hash.mjs --check $(MB_ISLAND_NS_DIR)/candidate.json

build-island-nativescript-android: deps-island-nativescript prepare-island-nativescript
	@test -f out/keys/keystore.properties || sh candidates/_island-host/tools/make-keystore.sh
	$(MB_ISLAND_NS_ENV) && sh $(MB_ISLAND_NS_DIR)/scripts/build-android.sh release "$(abspath $(MB_ISLAND_NS_KEYS))"
	@echo "island-nativescript: $(MB_ISLAND_NS_APK)"

build-island-nativescript-ios: deps-island-nativescript prepare-island-nativescript
	sh $(MB_ISLAND_NS_DIR)/scripts/build-ios.sh
	@echo "island-nativescript: $(MB_ISLAND_NS_APP)"

clean-island-nativescript:
	rm -rf $(MB_ISLAND_NS_DIR)/platforms $(MB_ISLAND_NS_DIR)/build $(MB_ISLAND_NS_DIR)/hooks

artifacts-island-nativescript-android:
	@test -f $(MB_ISLAND_NS_APK) || { echo "not-verified: not-built ($(MB_ISLAND_NS_APK))" >&2; exit 1; }
	@echo $(MB_ISLAND_NS_APK)

artifacts-island-nativescript-ios:
	@test -d $(MB_ISLAND_NS_APP) || { echo "not-verified: not-built ($(MB_ISLAND_NS_APP))" >&2; exit 1; }
	@echo $(MB_ISLAND_NS_APP)
