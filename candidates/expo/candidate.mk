# Make targets of the `expo` candidate, included by the root Makefile (`-include candidates/*/candidate.mk`).
# GNU Make 3.81 compatible. Paths are relative to the repository root.
MB_CANDIDATES += expo

MB_EXPO_DIR := candidates/expo
MB_EXPO_NPM_ENV := npm_config_registry=https://registry.npmjs.org/ EXPO_NO_TELEMETRY=1 CI=1

include candidates/_rn-shared/rn-shared.mk

.PHONY: deps-expo assets-expo check-expo build-expo-android build-expo-ios clean-expo \
	artifacts-expo-android artifacts-expo-ios

# Dependency install from the committed lockfile (the only install allowed during parallel authoring).
deps-expo:
	cd $(MB_EXPO_DIR) && $(MB_EXPO_NPM_ENV) npm ci --no-audit --no-fund

# Verified fixture copy + verified stream asset into the gitignored .mb-assets/.
assets-expo:
	node $(MB_RN_SHARED_DIR)/tools/gen-assets.mjs $(MB_EXPO_DIR)/.mb-assets

# Type-check, lint, unit tests, pins and SDK compatibility. No app build, no device.
check-expo: assets-expo check-rn-shared
	node $(MB_RN_SHARED_DIR)/tools/check-lock.mjs $(MB_EXPO_DIR)
	cd $(MB_EXPO_DIR) && npx tsc -p tsconfig.json --noEmit
	cd $(MB_EXPO_DIR) && npx eslint app plugins BuildProbe.ts metro.config.js eslint.config.js
	cd $(MB_RN_SHARED_DIR) && ../expo/node_modules/.bin/eslint -c ../expo/eslint.config.js \
		--report-unused-disable-directives-severity off ui/src rn-benchkit/src tools
	cd $(MB_EXPO_DIR) && $(MB_EXPO_NPM_ENV) npx expo install --check

# Release builds (CNG: `npx expo prebuild --clean` regenerates android/ and ios/ every time).
build-expo-android:
	sh $(MB_EXPO_DIR)/scripts/build-android.sh

build-expo-ios:
	sh $(MB_EXPO_DIR)/scripts/build-ios.sh

clean-expo:
	rm -rf $(MB_EXPO_DIR)/android $(MB_EXPO_DIR)/ios $(MB_EXPO_DIR)/build $(MB_EXPO_DIR)/.mb-assets $(MB_EXPO_DIR)/.expo

artifacts-expo-android:
	@echo $(MB_EXPO_DIR)/build/android/app-arm64-release.apk

artifacts-expo-ios:
	@echo $(MB_EXPO_DIR)/build/ios/MBExpo.app
