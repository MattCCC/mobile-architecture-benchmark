# Fully native candidate: Android (Kotlin + Jetpack Compose) and iOS (Swift + UIKit).
# Included by the root Makefile with `-include $(wildcard candidates/*/candidate.mk)`; every path is relative to the
# repository root. GNU Make 3.81 compatible: no .ONESHELL, $(file ...), ::=, !=, pattern rules or undefine; every
# recipe line is self-contained. The recipes never install anything.
#
# Android recipes need JAVA_HOME (JDK 17) and ANDROID_HOME (or android/local.properties); see README.md.

MB_CANDIDATES += native

MB_NATIVE_DIR := candidates/native
MB_NATIVE_ANDROID_DIR := $(MB_NATIVE_DIR)/android
MB_NATIVE_IOS_DIR := $(MB_NATIVE_DIR)/ios
MB_NATIVE_APK := $(MB_NATIVE_ANDROID_DIR)/app/build/outputs/apk/release/app-release.apk
MB_NATIVE_APP := $(MB_NATIVE_IOS_DIR)/build/Build/Products/Release-iphonesimulator/MobileBenchNative.app
MB_NATIVE_GRADLE := ./gradlew --console=plain
MB_NATIVE_XCODEBUILD_SIM := xcodebuild -project MobileBenchNative.xcodeproj -scheme MobileBenchNative \
  -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build ARCHS=arm64 ONLY_ACTIVE_ARCH=NO
MB_NATIVE_SWIFTC_SIM := xcrun --sdk iphonesimulator swiftc -swift-version 6 -target arm64-apple-ios16.4-simulator

MB_NATIVE_REQUIRE_JDK = test -n "$$JAVA_HOME" || { echo "not-verified: toolchain-missing:jdk17 (set JAVA_HOME to a JDK 17, see $(MB_NATIVE_DIR)/README.md)" >&2; exit 3; }
MB_NATIVE_REQUIRE_SDK = test -n "$$ANDROID_HOME" || test -n "$$ANDROID_SDK_ROOT" || test -f $(MB_NATIVE_ANDROID_DIR)/local.properties || { echo "not-verified: toolchain-missing:android-sdk (set ANDROID_HOME)" >&2; exit 3; }
MB_NATIVE_REQUIRE_XCODE = command -v xcodebuild >/dev/null 2>&1 || { echo "not-verified: toolchain-missing:xcode" >&2; exit 3; }

.PHONY: deps-native check-native check-native-android check-native-ios build-native-android build-native-ios \
  build-native-ios-device clean-native artifacts-native-android artifacts-native-ios prepare-native \
  keystore-native xcodeproj-native xcodeproj-check-native

# Bundled workload: committed fixture bytes + replay streams, verified against fixtures/v1/golden.json (gitignored).
prepare-native:
	node $(MB_NATIVE_DIR)/tools/prepare-assets.mjs

# Dependency resolution; rewrites the Gradle lockfiles. The iOS project has no external packages.
deps-native:
	@$(MB_NATIVE_REQUIRE_JDK)
	@$(MB_NATIVE_REQUIRE_SDK)
	cd $(MB_NATIVE_ANDROID_DIR) && $(MB_NATIVE_GRADLE) :app:dependencies --write-locks > /dev/null
	@echo "native: Gradle dependencies resolved, lockfiles written"

# Type-check, lint and unit tests; no app build, no device.
check-native: check-native-android check-native-ios

check-native-android: prepare-native
	@$(MB_NATIVE_REQUIRE_JDK)
	@$(MB_NATIVE_REQUIRE_SDK)
	cd $(MB_NATIVE_ANDROID_DIR) && $(MB_NATIVE_GRADLE) :app:testDebugUnitTest :app:lintRelease

check-native-ios: prepare-native
	@$(MB_NATIVE_REQUIRE_XCODE)
	cd $(MB_NATIVE_IOS_DIR)/Core && swift test
	@tmp=$$(mktemp -d) && \
	  $(MB_NATIVE_SWIFTC_SIM) -parse-as-library -module-name MobileBenchCore -emit-module \
	    -emit-module-path $$tmp/MobileBenchCore.swiftmodule $(MB_NATIVE_IOS_DIR)/Core/Sources/MobileBenchCore/*.swift && \
	  $(MB_NATIVE_SWIFTC_SIM) -typecheck -I $$tmp -module-name MobileBenchNative \
	    $(MB_NATIVE_IOS_DIR)/App/*.swift $(MB_NATIVE_IOS_DIR)/App/*/*.swift; \
	  rc=$$?; rm -rf $$tmp; \
	  if [ $$rc -eq 0 ]; then echo "native: iOS app sources type-check (Swift 6, iphonesimulator)"; fi; exit $$rc

# Local non-distribution signing key, unless the repository-wide one (out/keys) exists. Never committed.
keystore-native:
	@$(MB_NATIVE_REQUIRE_JDK)
	@test -f out/keys/keystore.properties || sh $(MB_NATIVE_DIR)/tools/make-keystore.sh

build-native-android: prepare-native keystore-native
	@$(MB_NATIVE_REQUIRE_SDK)
	cd $(MB_NATIVE_ANDROID_DIR) && $(MB_NATIVE_GRADLE) :app:assembleRelease
	@echo "native: $(MB_NATIVE_APK)"

build-native-ios: prepare-native
	@$(MB_NATIVE_REQUIRE_XCODE)
	cd $(MB_NATIVE_IOS_DIR) && $(MB_NATIVE_XCODEBUILD_SIM) build
	node $(MB_NATIVE_DIR)/tools/verify-assets.mjs $(MB_NATIVE_APP)/fixtures
	@echo "native: $(MB_NATIVE_APP)"

# Device build (not verified by the maintainers: no device and no team). Needs MB_IOS_TEAM_ID; MB_BUNDLE_PREFIX
# defaults to org.example.mobilebench.
build-native-ios-device: prepare-native
	@$(MB_NATIVE_REQUIRE_XCODE)
	@test -n "$$MB_IOS_TEAM_ID" || { echo "native: set MB_IOS_TEAM_ID (and optionally MB_BUNDLE_PREFIX) for device builds" >&2; exit 2; }
	cd $(MB_NATIVE_IOS_DIR) && xcodebuild -project MobileBenchNative.xcodeproj -scheme MobileBenchNative \
	  -configuration Release -destination 'generic/platform=iOS' -derivedDataPath build \
	  DEVELOPMENT_TEAM="$$MB_IOS_TEAM_ID" CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" \
	  PRODUCT_BUNDLE_IDENTIFIER="$${MB_BUNDLE_PREFIX:-org.example.mobilebench}.nativeapp" -allowProvisioningUpdates build

clean-native:
	rm -rf $(MB_NATIVE_ANDROID_DIR)/build $(MB_NATIVE_ANDROID_DIR)/app/build $(MB_NATIVE_ANDROID_DIR)/.gradle \
	  $(MB_NATIVE_ANDROID_DIR)/.kotlin $(MB_NATIVE_IOS_DIR)/build $(MB_NATIVE_IOS_DIR)/Core/.build $(MB_NATIVE_DIR)/generated

artifacts-native-android:
	@echo "$(MB_NATIVE_APK)"

artifacts-native-ios:
	@echo "$(MB_NATIVE_APP)"

# The Xcode project is generated from ios/project.yml by xcodegen (fallback until tools/xcodeproj exists).
xcodeproj-native:
	@command -v xcodegen >/dev/null 2>&1 || { echo "not-verified: toolchain-missing:xcodegen" >&2; exit 3; }
	cd $(MB_NATIVE_IOS_DIR) && xcodegen generate --quiet --spec project.yml

xcodeproj-check-native:
	@command -v xcodegen >/dev/null 2>&1 || { echo "not-verified: toolchain-missing:xcodegen" >&2; exit 3; }
	@cd $(MB_NATIVE_IOS_DIR) && \
	  files="MobileBenchNative.xcodeproj/project.pbxproj MobileBenchNative.xcodeproj/xcshareddata/xcschemes/MobileBenchNative.xcscheme" && \
	  before=$$(shasum -a 256 $$files) && xcodegen generate --quiet --spec project.yml && after=$$(shasum -a 256 $$files) && \
	  if [ "$$before" = "$$after" ]; then echo "native: Xcode project matches project.yml"; \
	  else echo "native: the Xcode project was out of date and has been regenerated" >&2; exit 1; fi
