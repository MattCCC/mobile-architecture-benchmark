# Flutter islands inside the shared native Compose/UIKit shell.
MB_CANDIDATES += island-flutter

MB_ISLAND_FLUTTER_DIR := candidates/island-flutter
MB_ISLAND_FLUTTER_MODULE := $(MB_ISLAND_FLUTTER_DIR)/flutter
MB_ISLAND_FLUTTER_BIN ?= flutter
MB_ISLAND_FLUTTER_DART ?= $(patsubst %/flutter,%/dart,$(MB_ISLAND_FLUTTER_BIN))
MB_ISLAND_FLUTTER_RUN := cd $(MB_ISLAND_FLUTTER_MODULE) && FLUTTER_SUPPRESS_ANALYTICS=true $(MB_ISLAND_FLUTTER_BIN) --suppress-analytics
MB_ISLAND_FLUTTER_GRADLE := $(MB_ISLAND_FLUTTER_MODULE)/.android/gradlew -p $(MB_ISLAND_FLUTTER_DIR)/android --console=plain
MB_ISLAND_FLUTTER_APK := $(MB_ISLAND_FLUTTER_DIR)/android/app/build/outputs/apk/release/app-release.apk
MB_ISLAND_FLUTTER_APP := $(MB_ISLAND_FLUTTER_DIR)/build/ios/Build/Products/Debug-iphonesimulator/MBIslandFlutter.app

.PHONY: deps-island-flutter prepare-island-flutter check-island-flutter build-island-flutter-android \
	build-island-flutter-ios clean-island-flutter artifacts-island-flutter-android artifacts-island-flutter-ios

deps-island-flutter:
	$(MB_ISLAND_FLUTTER_RUN) pub get --enforce-lockfile

prepare-island-flutter:
	node candidates/_island-host/tools/prepare-assets.mjs

check-island-flutter: deps-island-flutter prepare-island-flutter
	$(MB_ISLAND_FLUTTER_RUN) analyze --fatal-infos
	cd $(MB_ISLAND_FLUTTER_MODULE) && $(MB_ISLAND_FLUTTER_DART) format --output=none --set-exit-if-changed lib test
	$(MB_ISLAND_FLUTTER_RUN) test
	cd candidates/_island-host/ios/Core && swift test
	$(MB_ISLAND_FLUTTER_GRADLE) :app:testDebugUnitTest
	node candidates/_island-host/tools/host-hash.mjs --check $(MB_ISLAND_FLUTTER_DIR)/candidate.json

build-island-flutter-android: deps-island-flutter prepare-island-flutter
	@test -f out/keys/keystore.properties || sh candidates/_island-host/tools/make-keystore.sh
	$(MB_ISLAND_FLUTTER_GRADLE) :app:assembleRelease
	@echo "island-flutter: $(MB_ISLAND_FLUTTER_APK)"

build-island-flutter-ios: deps-island-flutter prepare-island-flutter
	MB_ISLAND_FLUTTER_BIN="$(MB_ISLAND_FLUTTER_BIN)" sh $(MB_ISLAND_FLUTTER_DIR)/scripts/build-ios.sh
	@echo "island-flutter@debug: $(MB_ISLAND_FLUTTER_APP)"

clean-island-flutter:
	rm -rf $(MB_ISLAND_FLUTTER_DIR)/build $(MB_ISLAND_FLUTTER_DIR)/android/.gradle $(MB_ISLAND_FLUTTER_DIR)/android/app/build \
		$(MB_ISLAND_FLUTTER_DIR)/ios/MBIslandFlutter.xcodeproj $(MB_ISLAND_FLUTTER_DIR)/ios/MBIslandFlutter.xcworkspace \
		$(MB_ISLAND_FLUTTER_DIR)/ios/Pods candidates/_island-host/generated candidates/_island-host/ios/Core/.build
	cd $(MB_ISLAND_FLUTTER_MODULE) && $(MB_ISLAND_FLUTTER_BIN) clean

artifacts-island-flutter-android:
	@test -f $(MB_ISLAND_FLUTTER_APK) || { echo "not-verified: not-built ($(MB_ISLAND_FLUTTER_APK))" >&2; exit 1; }
	@echo $(MB_ISLAND_FLUTTER_APK)

artifacts-island-flutter-ios:
	@test -d $(MB_ISLAND_FLUTTER_APP) || { echo "not-verified: not-built ($(MB_ISLAND_FLUTTER_APP))" >&2; exit 1; }
	@echo $(MB_ISLAND_FLUTTER_APP)
