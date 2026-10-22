# Candidate `repack`: React Native with Re.Pack and a Module Federation remote

## Architecture

Bare React Native app (template `@react-native-community/template` 0.88.0, converted with
`@callstack/repack-init@5.4.2 -b rspack`) bundled by Re.Pack 5 with Rspack 1 instead of Metro
(`react-native.config.js` routes the CLI `bundle`/`start` commands to Re.Pack). Navigation is React Navigation
native-stack (`src/App.tsx`); the UI is the shared RN UI in `../_rn-shared/ui`; instrumentation is the shared
BenchKit wrapper `../_rn-shared/rn-benchkit` (linked as `@mobilebench/rn-benchkit`, autolinked by the RN CLI).

Remote-loadable module: **Insights**. The host (`rspack.config.mjs`, Module Federation 2 name `MbHost`) reads the
server's indirection `/v1/modules/repack/<platform>/current/manifest.json` (`{"version":"<v>"}`; design §15.2 leaves
the document format open, so this format is the PoC's proposal), registers the remote `MbInsights` from
`/v1/modules/repack/<platform>/<v>/mf-manifest.json` at run time (server address from `mb.server`) and loads
`MbInsights/InsightsView` through Re.Pack's ScriptManager (`src/InsightsRoute.tsx`). Every artifact URL contains the
version, so a newly activated version is a new ScriptManager locator and is downloaded, while a relaunch on the same
version is served from ScriptManager's cache. The remote
(`rspack.insights.config.mjs`) exposes the same shared `InsightsView` component and is compiled to Hermes bytecode
and code-signed (Re.Pack `CodeSigningPlugin`). The bytecode step is the project plugin `rspack.hermes.mjs`, which
runs inside the compilation before signing: Re.Pack 5.4.2's `HermesBytecodePlugin` compiles after emit, i.e. after
signing, and the shipped bytecode then carries no signature. `scripts/verify-remote.mjs` fails the remote build
unless every served chunk is bytecode whose signature verifies against the host's public key. The host's runtime plugin (`src/mfRuntimePlugin.ts`) resolves every
remote script with `verifyScriptSignature: "strict"`, the public key compiled into the host bundle, and the token
header; an unavailable or rejected remote resolves to an empty module, the screen then shows the embedded copy as
`Source: embedded-fallback` and emits `remote.error` (never counted as a remote load). `mb.remote=embedded`
(default) always shows the embedded copy; ScriptManager's cache is persisted with AsyncStorage (cached loads after a
restart), `mb.clearModuleCache=1` invalidates it.

## Toolkits and versions

Exact pins in `package.json` / `package-lock.json` (every `resolved` URL on registry.npmjs.org, one local link to
`../_rn-shared/rn-benchkit`); verified on 2026-10-22:

| Component | Version |
|---|---|
| react-native / react | 0.88.0 / 19.3.0 (same as `expo`: the Expo SDK 58 pins) |
| @callstack/repack / @rspack/core | 5.4.2 / 1.7.12 (`latest-v1`; Re.Pack's initializer pins Rspack 1, design §14.4) |
| @module-federation/enhanced / runtime | 2.9.2 / 2.9.2 |
| @react-navigation/native / native-stack | 7.5.1 / 7.21.0 |
| react-native-screens / safe-area-context | 4.30.0 / 5.10.1 (Expo SDK 58 selection) |
| @react-native-async-storage/async-storage | 2.2.0 (Expo SDK 58 selection) |
| @react-native-community/cli | 20.2.0 (template pin) |
| @react-native/js-polyfills | 0.88.0 (dev dependency: RN ≥ 0.87 no longer depends on it, but Re.Pack's `RepackNativeEntryPlugin` must resolve it to put the RN polyfills into the bundle) |
| Hermes | V1 (hermes-compiler 260318099.0.4) |
| Gradle / AGP / Kotlin | 9.4.1 / 9.2.1 / 2.2.0 (RN 0.88 template); compileSdk 37, targetSdk 36, minSdk 24, NDK 27.1.12297006 |
| TypeScript / ESLint | 6.0.3 / 8.57.1 with @react-native/eslint-config 0.88.0 |

No RN version mismatch with `expo` (design §14.4 stop rule not triggered): both use RN 0.88.0, Hermes V1 and the
New Architecture.

## Build commands

From the repository root (the root Makefile includes `candidates/*/candidate.mk`):

| Target | Does |
|---|---|
| `make deps-repack` | `npm ci` from the committed lockfile |
| `make check-repack` | verified assets, shared unit tests, pins/registry check, `tsc`, ESLint (app + shared) |
| `make build-repack-android` | `scripts/build-android.sh`: assets → code-signing keys → local key → `./gradlew :app:assembleRelease` (Re.Pack bundle, Hermes) → `build/android/app-arm64-release.apk` |
| `make build-repack-ios` | `scripts/build-ios.sh`: assets → keys → `pod install` → `xcodebuild` Release, iOS simulator arm64, unsigned → `build/ios/MBRnRepack.app` |
| `make remote-repack-android` / `-ios` `[MB_REPACK_VERSION=n]` | `scripts/build-remote.sh`: Insights remote version n (default 1) → `build/remote/<platform>/<n>/` (mf-manifest.json, container, chunks), then `scripts/verify-remote.mjs` (bytecode + signature check); serve `build/remote/<platform>/` as `/v1/modules/repack/<platform>/` |
| `make clean-repack` | removes build outputs, Pods and assets |
| `make artifacts-repack-android` / `-ios` | print artifact paths |

The host must be built after the key pair exists (the public key is compiled into the host bundle); both build
scripts create it with `../_rn-shared/tools/ensure-signing-keys.mjs` (gitignored `../_rn-shared/.keys/`). Serving
the remote is the local server's job (design §15.2; not part of this directory).

Run (functional use): `adb shell am start -n org.example.mobilebench.repack/.MainActivity --es mb.profile representative`
(`--es mb.remote remote --es mb.server ws://10.0.2.2:8787` for the remote module) or
`xcrun simctl launch <udid> org.example.mobilebench.repack -mb.profile representative`.

## Release settings

Android: R8 minify + `shrinkResources` (`enableProguardInReleaseBuilds = true`), Hermes V1 bytecode, arm64-v8a only
(`reactNativeArchitectures`), `androidx.profileinstaller:profileinstaller:1.4.1`,
`<profileable android:shell="true"/>`, cleartext only for `localhost`, `127.0.0.1`, `10.0.2.2`, light AppCompat
theme, local non-distribution key from `MB_KEYSTORE_PROPERTIES` (template debug keystore removed). iOS: Release,
deployment target 16.4 for the app and every pod, iPhone only, `CADisableMinimumFrameDurationOnPhone`,
`NSAllowsLocalNetworking`, `NSLocalNetworkUsageDescription`, `UIUserInterfaceStyle = Light`, template launch-screen
text removed (platform launch screen only).

## Deviations from the functional spec

Listed in `candidate.json` (`deviations`, `confounds`), including the id (`repack` here, `rn-repack` in the design).
Design §31 items not adopted yet: 14/15 (shared C-ABI core), the iOS `URLCache.shared` clear of item 25, the
`mb.nav.back` id (toolkit).

## Instrument validity

Android: native Views in the activity window, so FrameTimeline (A-F1) and layer presents (A-F2) are expected valid
(pilot-validate). iOS: UIKit views; `XCTOSSignpostMetric` expected valid, `XCTHitchMetric` pilot.

## Known issues

- Status of builds and checks: see the section below; anything not listed was not run.
- Pilot: superseded by early-bench sessions (decision 29).

## Toolchain needs

node 24 + npm, JDK 17, Android SDK (platform 37, build-tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1), Xcode 27.1
with an iOS simulator runtime ≥ 16.4, CocoaPods 1.17.

## Status (verification actually run)

To be completed with the commands and outcomes of this branch (see below).
