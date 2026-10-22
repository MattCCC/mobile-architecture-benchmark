# Flutter candidate: make targets. The root Makefile includes every candidates/*/candidate.mk with
# -include and runs from the repository root. GNU Make 3.81 compatible (no .ONESHELL, $(file),
# .RECIPEPREFIX, undefine, ::=, != or pattern rules). Installs nothing system-wide.

MB_CANDIDATES += flutter

MB_FLUTTER_DIR := candidates/flutter
MB_FLUTTER_BIN ?= flutter
MB_FLUTTER_DART ?= dart
MB_FLUTTER_NODE ?= node
MB_FLUTTER_PROFILES ?= small,representative,stress
# Extra build flags, e.g. MB_FLUTTER_DEFINES=--dart-define=MB_BENCHKIT=noop (overhead A/B build).
MB_FLUTTER_DEFINES ?=
# JDK for Gradle. flutter_tools prefers Android Studio's bundled JBR over JAVA_HOME, so the build
# targets point the tool at this JDK through a candidate-local Flutter settings file
# (XDG_CONFIG_HOME); the user's global Flutter configuration is never touched.
MB_FLUTTER_JDK ?= $(JAVA_HOME)
MB_FLUTTER_CONFIG_DIR := $(CURDIR)/$(MB_FLUTTER_DIR)/build/flutter-config
MB_FLUTTER_RUN := cd $(MB_FLUTTER_DIR) && FLUTTER_SUPPRESS_ANALYTICS=true XDG_CONFIG_HOME="$(MB_FLUTTER_CONFIG_DIR)" $(MB_FLUTTER_BIN) --suppress-analytics

MB_FLUTTER_APK := $(MB_FLUTTER_DIR)/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
MB_FLUTTER_AAB := $(MB_FLUTTER_DIR)/build/app/outputs/bundle/release/app-release.aab
MB_FLUTTER_IOS_SIM_APP := $(MB_FLUTTER_DIR)/build/ios/iphonesimulator/Runner.app
MB_FLUTTER_IOS_DEVICE_APP := $(MB_FLUTTER_DIR)/build/ios/iphoneos/Runner.app

.PHONY: deps-flutter fixtures-flutter config-flutter check-flutter build-flutter-android build-flutter-ios \
	build-flutter-ios-device clean-flutter artifacts-flutter-android artifacts-flutter-ios

# Copies the committed fixture bytes (verified) and writes the bundled update stream (verified
# against golden.json) into the gitignored asset dir.
fixtures-flutter:
	$(MB_FLUTTER_NODE) fixtures/generator/cli.mjs copy $(MB_FLUTTER_DIR)/assets/fixtures --profiles $(MB_FLUTTER_PROFILES)
	$(MB_FLUTTER_NODE) $(MB_FLUTTER_DIR)/tool/stream_asset.mjs $(MB_FLUTTER_DIR)/assets/fixtures --profiles $(MB_FLUTTER_PROFILES)

# Dependency install from the committed pubspec.lock.
deps-flutter: fixtures-flutter config-flutter
	$(MB_FLUTTER_RUN) pub get --enforce-lockfile

config-flutter:
	@mkdir -p "$(MB_FLUTTER_CONFIG_DIR)"
	@printf '%s\n' '$(if $(MB_FLUTTER_JDK),{"jdk-dir": "$(MB_FLUTTER_JDK)"},{})' > "$(MB_FLUTTER_CONFIG_DIR)/settings"

# Analyzer, formatting and host unit/widget tests: no app build, no device.
check-flutter: deps-flutter
	$(MB_FLUTTER_RUN) analyze --fatal-infos
	cd $(MB_FLUTTER_DIR) && $(MB_FLUTTER_DART) format --output=none --set-exit-if-changed lib test
	$(MB_FLUTTER_RUN) test

# Release: Dart AOT, R8 (Flutter Gradle plugin default), arm64-v8a APK for measurements plus the
# default-ABI App Bundle for size reporting.
build-flutter-android: deps-flutter
	$(MB_FLUTTER_RUN) build apk --release --split-per-abi --target-platform android-arm64 $(MB_FLUTTER_DEFINES)
	$(MB_FLUTTER_RUN) build appbundle --release $(MB_FLUTTER_DEFINES)

# iOS simulator: Flutter builds only debug (JIT) for simulators; results are buildClass debug.
build-flutter-ios: deps-flutter
	$(MB_FLUTTER_RUN) build ios --simulator --debug $(MB_FLUTTER_DEFINES)

# iOS device release build without signing (size inspection only; not installable).
build-flutter-ios-device: deps-flutter
	$(MB_FLUTTER_RUN) build ios --release --no-codesign $(MB_FLUTTER_DEFINES)

clean-flutter: config-flutter
	$(MB_FLUTTER_RUN) clean
	rm -rf $(MB_FLUTTER_DIR)/assets/fixtures

artifacts-flutter-android:
	@echo $(MB_FLUTTER_APK)
	@echo $(MB_FLUTTER_AAB)

artifacts-flutter-ios:
	@echo $(MB_FLUTTER_IOS_SIM_APP)
	@echo $(MB_FLUTTER_IOS_DEVICE_APP)
