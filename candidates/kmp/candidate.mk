# Kotlin Multiplatform: all screens and state in shared/commonMain.
MB_CANDIDATES += kmp
MB_KMP_DIR := candidates/kmp
MB_KMP_GRADLE := $(MB_KMP_DIR)/gradlew -p $(MB_KMP_DIR) --console=plain
.PHONY: prepare-kmp deps-kmp check-kmp check-kmp-android check-kmp-ios build-kmp-android build-kmp-ios artifacts-kmp-android artifacts-kmp-ios clean-kmp
prepare-kmp:
	node $(MB_KMP_DIR)/tools/prepare-assets.mjs
deps-kmp:
	$(MB_KMP_GRADLE) :shared:dependencies :androidApp:dependencies
check-kmp: check-kmp-android check-kmp-ios
check-kmp-android: prepare-kmp
	$(MB_KMP_GRADLE) :shared:testAndroidHostTest :androidApp:lintRelease
check-kmp-ios: prepare-kmp
	$(MB_KMP_GRADLE) :shared:iosSimulatorArm64Test
build-kmp-android: prepare-kmp keystore-kmp
	$(MB_KMP_GRADLE) :androidApp:assembleRelease
build-kmp-ios: prepare-kmp
	$(MB_KMP_GRADLE) :shared:linkReleaseFrameworkIosSimulatorArm64
	sh $(MB_KMP_DIR)/scripts/generate-ios-project.sh
	xcodebuild -project $(MB_KMP_DIR)/ios/MobileBenchKmp.xcodeproj -scheme MobileBenchKmp -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath $(MB_KMP_DIR)/ios/build ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build
	node $(MB_KMP_DIR)/tools/verify-assets.mjs $(MB_KMP_DIR)/ios/build/Build/Products/Release-iphonesimulator/MobileBenchKmp.app/fixtures
artifacts-kmp-android:
	@echo $(MB_KMP_DIR)/androidApp/build/outputs/apk/release/androidApp-release.apk
artifacts-kmp-ios:
	@echo $(MB_KMP_DIR)/ios/build/Build/Products/Release-iphonesimulator/MobileBenchKmp.app
clean-kmp:
	rm -rf $(MB_KMP_DIR)/build $(MB_KMP_DIR)/androidApp/build $(MB_KMP_DIR)/shared/build $(MB_KMP_DIR)/ios/build $(MB_KMP_DIR)/generated

.PHONY: keystore-kmp build-kmp-ios-device
keystore-kmp:
	@test -f out/keys/keystore.properties || sh $(MB_KMP_DIR)/tools/make-keystore.sh
build-kmp-ios-device: prepare-kmp
	@test -n "$$MB_IOS_TEAM_ID" || { echo "Set MB_IOS_TEAM_ID for physical iOS signing" >&2; exit 2; }
	$(MB_KMP_GRADLE) :shared:linkReleaseFrameworkIosArm64
	sh $(MB_KMP_DIR)/scripts/generate-ios-project.sh
	xcodebuild -project $(MB_KMP_DIR)/ios/MobileBenchKmp.xcodeproj -scheme MobileBenchKmp -configuration Release -destination 'generic/platform=iOS' -derivedDataPath $(MB_KMP_DIR)/ios/build KMP_FRAMEWORK_TARGET=iosArm64 DEVELOPMENT_TEAM="$$MB_IOS_TEAM_ID" CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY="Apple Development" -allowProvisioningUpdates build
