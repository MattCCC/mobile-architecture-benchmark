# Make targets of the `repack` candidate, included by the root Makefile (`-include candidates/*/candidate.mk`).
# GNU Make 3.81 compatible. Paths are relative to the repository root.
MB_CANDIDATES += repack

MB_REPACK_DIR := candidates/repack
MB_REPACK_NPM_ENV := npm_config_registry=https://registry.npmjs.org/
MB_REPACK_VERSION ?= 1

include candidates/_rn-shared/rn-shared.mk

.PHONY: deps-repack assets-repack check-repack build-repack-android build-repack-ios clean-repack \
	artifacts-repack-android artifacts-repack-ios remote-repack-android remote-repack-ios

# Dependency install from the committed lockfile (the only install allowed during parallel authoring).
deps-repack:
	cd $(MB_REPACK_DIR) && $(MB_REPACK_NPM_ENV) npm ci --no-audit --no-fund

# Verified fixture copy + verified stream asset into the gitignored .mb-assets/.
assets-repack:
	node $(MB_RN_SHARED_DIR)/tools/gen-assets.mjs $(MB_REPACK_DIR)/.mb-assets

# Type-check, lint, unit tests, pins. No app build, no device.
check-repack: assets-repack check-rn-shared
	node $(MB_RN_SHARED_DIR)/tools/check-lock.mjs $(MB_REPACK_DIR)
	cd $(MB_REPACK_DIR) && npx tsc -p tsconfig.json --noEmit
	cd $(MB_REPACK_DIR) && npx eslint index.js src insights-remote
	cd $(MB_RN_SHARED_DIR) && ../repack/node_modules/.bin/eslint --no-eslintrc -c ../repack/.eslintrc.js \
		--resolve-plugins-relative-to ../repack --ext .ts,.tsx ui/src rn-benchkit/src

build-repack-android:
	sh $(MB_REPACK_DIR)/scripts/build-android.sh

build-repack-ios:
	sh $(MB_REPACK_DIR)/scripts/build-ios.sh

# Remote Insights module (Module Federation 2 container, Hermes bytecode, code-signed) into
# build/remote/<platform>/$(MB_REPACK_VERSION)/; MB_REPACK_VERSION=<n> builds another version next to it.
remote-repack-android:
	sh $(MB_REPACK_DIR)/scripts/build-remote.sh android $(MB_REPACK_VERSION)

remote-repack-ios:
	sh $(MB_REPACK_DIR)/scripts/build-remote.sh ios $(MB_REPACK_VERSION)

clean-repack:
	rm -rf $(MB_REPACK_DIR)/build $(MB_REPACK_DIR)/.mb-assets $(MB_REPACK_DIR)/android/app/build \
		$(MB_REPACK_DIR)/android/build $(MB_REPACK_DIR)/android/.gradle $(MB_REPACK_DIR)/ios/Pods \
		$(MB_REPACK_DIR)/ios/build

artifacts-repack-android:
	@echo $(MB_REPACK_DIR)/build/android/app-arm64-release.apk

artifacts-repack-ios:
	@echo $(MB_REPACK_DIR)/build/ios/MBRnRepack.app
