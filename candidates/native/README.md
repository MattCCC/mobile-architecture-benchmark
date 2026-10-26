# Candidate `native`: fully native Android (Jetpack Compose) and iOS (UIKit)

The fully native reference implementation of the benchmark's reference application. It has no cross-platform
runtime: Android is Kotlin with Jetpack Compose, iOS is Swift with UIKit. Both apps implement the shared functional
specification (List, Selection, Detail with the animated panel, Insights, Error), read the committed fixture bytes,
apply the deterministic update stream and publish the markers and state digests of the shared contract.

Provenance: parts of the UI technique were ported from the maintainers' earlier prototypes, partly with
AI-assisted tooling; the domain, instrumentation and screens were rewritten against this repository's contracts.
Framework experts are invited to review and improve this candidate through the contribution process.

## Architecture

```
candidates/native/
├── candidate.json  candidate.mk  README.md  .gitignore
├── tools/
│   ├── prepare-assets.mjs   # verified copy of fixtures/v1 + replay streams -> generated/assets/fixtures
│   ├── verify-assets.mjs    # checks a bundled fixtures dir against fixtures/v1/golden.json
│   └── make-keystore.sh     # local, non-distribution Android signing key (gitignored)
├── generated/               # gitignored output of prepare-assets.mjs, shared by both platforms
├── android/                 # standalone Gradle project (wrapper, lockfiles)
│   └── app/src/main/java/org/example/mobilebench/nativeapp/
│       ├── AppRuntime.kt AppStore.kt MainActivity.kt MobileBenchApp.kt BuildProbe.kt
│       ├── bench/   BenchKit.kt (candidate-local BenchKit), LaunchConfig.kt
│       ├── domain/  Fixture, StateModel, Insights, RestoreRecord, StreamFrame, Format, Sha256
│       ├── stream/  UpdateSource (data-source seam), ReplaySource, StreamController
│       └── ui/      AppRoot (Navigation Compose), ListScreen, SelectionScreen, DetailScreen, InsightsScreen, ...
└── ios/                     # committed Xcode project generated from project.yml
    ├── project.yml  MobileBenchNative.xcodeproj
    ├── Core/        Swift package MobileBenchCore (domain: fixture, state, digests, record, frames, launch config)
    ├── App/         AppDelegate, AppRuntime, AppStore, Bench/BenchKit, Stream/{ReplaySource,StreamController}, UI/
    └── SmokeUITests/  pre-harness XCUITest smoke journey (superseded by the core acceptance suite)
```

Both platforms share one structure:

- `AppRuntime` loads the embedded fixture for `mb.profile`, applies a restoration record when `mb.restore=1`, starts
  the update stream only after the first usable UI (or after the restored screen was drawn, or after `resume`),
  writes the restoration record v2 on background and publishes checkpoints.
- `StateModel` holds values, selection, the last applied update and the stream counters, and produces the
  `mb-state-v1` and `mb-insights-v1` digests. It has no UI dependency and is unit-tested against
  `fixtures/v1/golden.json`.
- `StreamController` implements the client rules of the stream protocol (seq order, duplicates, gaps with
  reconnect from `lastApplied + 1`, Stale after 2 s, reconnect after 3 s, back-off 250/500/1000/2000 ms, the `c`,
  `r` and `e` frames, checkpoint after 500 ms of quiet). It talks to an `UpdateSource`.
- `UpdateSource` is the data-source seam. The default and only implementation today is `ReplaySource`: an in-app
  replay of the bundled stream file (`stream-<profile>.jsonl`, the first 10 000 update frames of the profile) on the
  design's absolute schedule, message k due at `t0 + (k - from) / rate` on the monotonic clock
  (`SystemClock.elapsedRealtime()` / `DispatchTime` uptime), with catch-up after a reconnect and an `e` frame after
  the last bundled message. A WebSocket source for the local server (OkHttp / `URLSessionWebSocketTask`) plugs into
  the same interface and is not implemented yet.
- `BenchKit` is a candidate-local implementation of the design's BenchKit semantics (markers, FUI gate, draw
  probes and tokens, lifecycle markers, checkpoints). The shared `instrumentation/*-benchkit` libraries can replace
  it with small call-site changes: the facade has one method per probe kind (`rowDrawn(i)`, `summaryDrawn(...)`,
  `rootDrawn(...)`, `insightsDrawn()`) where the design has `probeDrawn(kind, i, token)`.

Android: one `ComponentActivity` hosting a Navigation Compose `NavHost` with the framework's default transitions;
`LazyColumn` with stable keys; per-row Compose state so one update recomposes one row; the Detail panel animates
with `animateFloatAsState` + `graphicsLayer`. Edge-to-edge with system-bar inset padding; light platform theme; the
Android 12+ system splash is the only launch screen.

iOS: `UINavigationController` with default push/pop; `UITableView` with `UITableViewDiffableDataSource`, value
updates reconfigure the visible cell (`reconfigureItems`); frame-laid-out cells; the Detail panel animates with
`UIViewPropertyAnimator` + `UICubicTimingParameters(0.42, 0, 0.58, 1)`. The header band is the navigation bar plus
an additional top safe-area inset, 56 pt in total.

## Toolkits and versions

Exact versions; resolved Android dependencies are pinned in `android/buildscript-gradle.lockfile` and
`android/app/gradle.lockfile`.

| Platform | Component | Version |
|---|---|---|
| Android | Gradle (wrapper, `distributionSha256Sum` pinned) | 9.8.2 |
| Android | Android Gradle Plugin (built-in Kotlin) | 9.4.1 |
| Android | Kotlin Gradle plugin / Compose compiler plugin | 2.4.21 / 2.4.21 |
| Android | Compose BOM (resolved Compose UI / foundation / runtime) | 2026.09.00 (1.12.1) |
| Android | activity-compose / navigation-compose / profileinstaller | 1.13.0 / 2.10.2 / 1.4.1 |
| Android | compileSdk / targetSdk / minSdk | 37 / 36 / 24 |
| Android | JDK | 17 |
| Android | Unit tests: JUnit / org.json (JVM tests only) | 4.13.2 / 20260814 |
| iOS | Xcode / iOS SDK | 27.1 (27A9275) / 27.1 |
| iOS | Swift language mode (app, Core) / smoke UI tests | 6 / 5 |
| iOS | Deployment target | 16.4 |
| iOS | Project generator | xcodegen 2.46.0 (see Deviations) |
| iOS | Simulator used for verification | `mobilebench-iphone`: device type iPhone 17 on the iOS 27.0 runtime (24A434); the iOS 27.1 runtime that ships with Xcode 27.1 (24A94425) supports only the iPhone Duo device type |
| both | Node.js (asset preparation only) | 24.11.1 |

No third-party runtime dependency on either platform beyond AndroidX/Compose; iOS uses only system frameworks.

## Build commands

Run from the repository root. Until the root `Makefile` includes this file, call it directly with
`make -f candidates/native/candidate.mk <target>`. Android recipes need these exports (example paths for a Homebrew
JDK 17 on macOS; any JDK 17 works):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

| Target | Does |
|---|---|
| `prepare-native` | `node candidates/native/tools/prepare-assets.mjs`: verified copy of `fixtures/v1/*.json` and the replay streams into `generated/assets/fixtures` |
| `deps-native` | Gradle dependency resolution, rewrites the lockfiles (`:app:dependencies --write-locks`) |
| `check-native` | Android unit tests + lint (`:app:testDebugUnitTest :app:lintRelease`), iOS `swift test` in `ios/Core` and a Swift 6 type-check of the app sources against the iOS simulator SDK; no app build, no device |
| `build-native-android` | local signing key if needed, then `:app:assembleRelease` -> `android/app/build/outputs/apk/release/app-release.apk` |
| `build-native-ios` | `xcodebuild -configuration Release -sdk iphonesimulator ARCHS=arm64 build` -> `ios/build/Build/Products/Release-iphonesimulator/MobileBenchNative.app`, then verifies the bundled fixtures |
| `build-native-ios-device` | Release build for devices; needs `MB_IOS_TEAM_ID`, optional `MB_BUNDLE_PREFIX` (not verified, see Status) |
| `clean-native` | removes in-repo build outputs and `generated/` |
| `artifacts-native-android` / `artifacts-native-ios` | print the artifact paths |
| `keystore-native` | creates `android/.keys/` (gitignored) unless the repository-wide `out/keys/keystore.properties` exists |
| `xcodeproj-native` / `xcodeproj-check-native` | regenerate the Xcode project from `ios/project.yml` / verify that it is up to date |

Run the apps (launch keys of design §6.5; Android: Intent string extras, iOS: launch arguments):

```sh
adb install -r candidates/native/android/app/build/outputs/apk/release/app-release.apk
adb shell am start -W -n org.example.mobilebench.nativeapp/.MainActivity --es mb.journey j1 --es mb.profile representative
xcrun simctl install <udid> candidates/native/ios/build/Build/Products/Release-iphonesimulator/MobileBenchNative.app
xcrun simctl launch <udid> org.example.mobilebench.nativeapp -mb.journey j1 -mb.profile representative
```

Device builds on iOS: change the team and the bundle id. Set `MB_IOS_TEAM_ID` to your Apple team and
`MB_BUNDLE_PREFIX` to a prefix you own (the default `org.example.mobilebench` only works for simulator builds);
`make -f candidates/native/candidate.mk build-native-ios-device` passes them as build settings. Nothing about
signing is committed.

## Release settings

- Android: R8 (`isMinifyEnabled = true`, `isShrinkResources = true`, `proguard-android-optimize.txt`, no app keep
  rules); measurement ABI arm64-v8a through `ndk.abiFilters` (the only native library,
  `libandroidx.graphics.path.so`, comes from a Compose dependency); `profileinstaller` 1.4.1 and
  `<profileable android:shell="true"/>`; network security config allows cleartext only for `localhost`,
  `127.0.0.1` and `10.0.2.2`; no `INTERNET` permission yet (the replay source needs no network); backup and device
  transfer disabled; release signed with the repository-wide local key (`out/keys/keystore.properties`), an explicit
  `MB_KEYSTORE_PROPERTIES` file, or the candidate-local key from `tools/make-keystore.sh`, in that order.
- iOS: Release configuration, `-O` whole-module; simulator builds `ARCHS=arm64`; deployment target 16.4;
  `CADisableMinimumFrameDurationOnPhone = YES`; ATS `NSAllowsLocalNetworking`; `NSLocalNetworkUsageDescription`
  "Connects to the local benchmark server."; light appearance; platform launch screen (`UILaunchScreen`); ad-hoc
  signing for simulator builds.
- Display name `MB Native`; no icons beyond the platform defaults.

## Deviations from the functional spec

| Id | Deviation | Consequence |
|---|---|---|
| `benchkit-candidate-local` | BenchKit (markers, probes, FUI gate, lifecycle and checkpoint markers) is candidate-local code with the design's API and semantics, because the shared libraries do not exist yet. Android emits markers with `android.os.Trace` (the same atrace data the NDK `ATrace_*` API writes) instead of a C core over JNI. Mirrored logcat / unified-log lines carry an extra diagnostic `t=<monotonic ns>` field; the Android `launch` marker carries an extra `pst=` (process start, `Process.getStartElapsedRealtime()`). | Replace with the shared libraries before eligible runs; the overhead A/B check (design §6.7) must use the shared version. |
| `stream-source-replay` | The default data source is the in-app replay of the bundled stream; `mb.server` is rejected with `err code=launch-config-invalid` (Error screen) until the WebSocket source exists. The replay ends with `e` after 10 000 messages (500 s at the representative rate). | No local-server sessions, fault injection or server-side byte accounting yet; the checkpoint (`c`) and resume (`r`) frames are handled and unit-tested but never sent by the replay. |
| `network-dataset-not-implemented` | `mb.dataset=network` is rejected. | Scenario A1n not runnable yet. |
| `ios-touch-observer-missing` | The candidate-local iOS BenchKit has no key-window touch observer (`input.*` markers). | iOS input-to-X metrics need the shared iOS BenchKit. |
| `android-selected-as-checked` | Compose reports the `selected` semantics of a non-Tab role as AccessibilityNodeInfo checkable/checked, not `isSelected` (AndroidX `AndroidComposeViewAccessibilityDelegateCompat`). Each option button is one accessibility node carrying the id, the text `A 12.34` and that state. | The Android driver must read selected OR checked. |
| Xcode project generator | The iOS project is generated by xcodegen 2.46.0 from the committed `ios/project.yml`; the generated `MobileBenchNative.xcodeproj` is committed. The repository-local generator `tools/xcodeproj` (design §20.4) does not exist yet. Regeneration is deterministic (two runs, identical bytes). | Switch to `tools/xcodeproj` when it exists; xcodegen is needed only to regenerate, not to build. |
| Remote loading, bridge | Insights is embedded only (`remote.source src=embedded`); `mb.remote=remote` and `mb.bridgeBench` are rejected. | By design: R2–R9 and R8s/R8a are not applicable to a fully native app (design §14.7 notes 4–6). |

Contract items of design §31 and their state in this candidate:

| §31 item | State |
|---|---|
| 1–3 normative bands, `listLayout(h)`, row and summary probes, FUI gate | adopted on both platforms (gate is candidate-local) |
| 5 platform launch screen only | adopted (Android 12+ system splash, iOS `UILaunchScreen`) |
| 6 `reportFullyDrawn()` posted by the gate | adopted (Android) |
| 6a activity-warm start resets the session at seq 0, gate re-armed | adopted (Android); not exercised by the smoke run |
| 7–9 restoration record v2, `persist-read` fallback, no platform restoration | adopted; Navigation Compose keeps its framework-default saved state on configuration changes only |
| 10–13 probe tokens, forced redraw, reconnect after `resume`, `anim.*` diagnostic | adopted |
| 14 core-only items | `a11y` (Android listener, iOS once at start) and the logcat / unified-log mirror are implemented candidate-locally; the iOS touch observer and the C-ABI core are not (core work) |
| 16–18 six status words, `mb.state.digest` text, `mb.insights.digest` | adopted |
| 20–21 `c` / `r` / `e` frames, checkpoint triggers | adopted in the stream client; only `e` occurs with the replay source |
| 22 token on HTTP / WebSocket | not applicable until the WebSocket source exists; `mb.token` and the `*.local`-only-with-token rule are validated |
| 23 `NSLocalNetworkUsageDescription` | adopted |
| 24 launch keys | all keys parsed and validated; unsupported values fail loudly (see above) |
| 28 bridge classes | declared not applicable in `candidate.json` |
| 29 arm64-only measurement builds | adopted |
| 30 `candidate.json` fields | adopted |
| 4, 15, 19, 25–27, 31 | not applicable to this candidate |

## Instrument validity

| Platform | Instrument | Expectation |
|---|---|---|
| Android | SurfaceFlinger FrameTimeline (A-F1) | expected valid: Compose draws through HWUI into the activity window; pilot-validate |
| Android | Layer present fences (A-F2), `contentLayerPattern` `*org.example.mobilebench.nativeapp/*MainActivity*` | expected valid; pilot-validate the layer name |
| Android | Macrobenchmark `FrameTimingMetric` | diagnostic only |
| Android | `dumpsys meminfo` PSS, `/proc` RSS | valid |
| iOS | `XCTHitchMetric` | pilot (iOS 27.1 runtime installed) |
| iOS | `XCTOSSignpostMetric` scroll / navigation | expected valid (`UITableView`, `UINavigationController`) |
| iOS | `phys_footprint` (`mem` marker at checkpoints) | valid on devices; simulator values are host-process accounting |

## Known issues

- The data source is the in-app replay (see Deviations); this is the main open item before benchmark runs. The
  replay ends after 10 000 messages (500 s at 20 msg/s); a journey that runs longer sees status `Ended` and an
  end checkpoint (observed once when a UI test stalled on an overloaded host).
- iOS: `mb.nav.back` is set on `backBarButtonItem`, but UIKit does not expose it on the visible back button
  (confirmed by the smoke run). Drivers use the first navigation-bar button, as §8.12 of the design allows.
- iOS: `UITableView` exposes an accessibility element for every row (300 for the representative profile), so
  per-cell XCUITest queries are slow; read one snapshot of `mb.list` instead (the smoke test does).
- Android lint reports one remaining warning (DataExtractionRules: `fullBackupContent` for API < 31); backup is
  already disabled with `android:allowBackup="false"`.
- The smoke UI test target (`SmokeUITests`) is a temporary pre-harness check and is removed once `drivers/ios`
  runs the acceptance suite.
- Gradle prints "Deprecated Gradle features were used in this build, making it incompatible with Gradle 10" for
  this project (not investigated; AGP 9.4.1 with Gradle 9.8.2).

## Toolchain needs

`node` (asset preparation), `jdk17` + `android-sdk` (platform `android-37.0`; AGP 9.4.1 defaults to build-tools
36.0.0) for Android, `xcode` 27.1 + an iOS simulator runtime ≥ 16.4 for iOS. CocoaPods is not needed. xcodegen is
needed only to regenerate the Xcode project.

## Status

Verification actually run on 2026-10-22 on one Apple silicon Mac (macOS 26.7.1) shared with other builds; host load
average was between about 100 and 400 during the device runs. No benchmark measurements were taken: everything
below is build, unit-test and functional evidence. The functional smoke runs are black-box pre-harness checks
(Android: `adb` input + `uiautomator dump`; iOS: the `SmokeUITests` XCUITest journey) whose markers, dumps and
digests were compared with the reference model computed from `fixtures/v1` by a private script; they are not the
acceptance suite of the design, which does not exist yet.

Android (emulator `mobilebench_api37`: `system-images;android-37.0;google_apis;arm64-v8a`, 1080 x 2400 at
420 dpi, 4 cores, 4096 MB, emulator 37.2.12, cold boot without snapshot):

| Command (from `candidates/native/android` unless noted) | Outcome |
|---|---|
| `node candidates/native/tools/prepare-assets.mjs` (repo root) | ok: fixture bytes copied and verified; replay streams of all three profiles match the stream SHA-256 in `golden.json` |
| `gradle wrapper --gradle-version 9.8.2 --distribution-type bin --gradle-distribution-sha256-sum 21bd5da2de49b642904077f38c0efdc7778e92b3ed0889392dca61b97e389607` | wrapper generated with the pinned checksum |
| `./gradlew :app:dependencies --write-locks` | BUILD SUCCESSFUL, lockfiles written |
| `./gradlew :app:testDebugUnitTest` | BUILD SUCCESSFUL, 10/10 tests passed: `ConformanceTest` (state and Insights digests at seq 0, 100, 1000 and 10 000 and the stream checksum for all three profiles against `golden.json`) and `DomainTest` (9 tests: formatting, selection rules, update rules, Insights, restoration record, stream frames, fixture and launch-config validation) |
| `./gradlew :app:lintRelease` | first run: 2 errors (restricted `NavController.currentBackStack`, `remember` returning `Unit`), fixed; final run: 0 errors, 1 warning (see Known issues) |
| `./gradlew :app:assembleRelease` | BUILD SUCCESSFUL; `app-release.apk` 1 397 084 bytes, 83 entries, one native library (`lib/arm64-v8a/libandroidx.graphics.path.so`), signed with a local key |
| Emulator functional smoke, attempt 1 | 44/54 checks: the route state lagged one navigation behind, so `screen` markers named the previous route, `resume` was never emitted after foreground (no stream reconnect) and the restoration record stored a stale route; option buttons exposed their text on a child node. Fixed |
| Emulator functional smoke, attempt 2 | 68/69 checks: after background and foreground the replay lost the frame that was in flight at close and then reconnected in a loop on `stream-gap`. Fixed (replay rewinds; back-off restarts only after data flows) |
| Emulator functional smoke, attempt 3 | 71/71 checks passed |

Attempt 3 checked: one `fui` with `rows=10;h=730;sel=50;seq=0` and the stream connecting only afterwards; one
`resp` (`rev=1`) for one option tap, with the selected state and `Selected 51` in the UI; `screen` markers
`list` 0, `selection` 1, `list` 2, `detail/3` 3, `list` 4, `insights` 5, `list` 6; panel `anim.*` show/hide
pairs; embedded Insights markers and texts; the accessibility ids and texts of §8.12; background checkpoint
digests equal to the reference model at seq 920, 1250 and 1527; after foreground `resume` on List, reconnect from
seq 921 and updates applied again; restoration after `am force-stop` with `mb.restore=1`: `launch ss=0`, no `fui`,
`restore r=detail/8;a=6`, `screen` detail then list, stream from `lastSeq + 1`, List with row 6 at the top and the
modified selection.

iOS:

| Command | Outcome |
|---|---|
| `swift test` (in `ios/Core`) | 10/10 XCTest tests passed (1 conformance test against `golden.json`, 9 domain tests) |
| Swift 6 type-check of the app sources against the iOS 27.1 simulator SDK (target iOS 16.4), as in `check-native-ios` | ok, no diagnostics |
| `make -f candidates/native/candidate.mk check-native-ios` (repo root) | ok (runs both of the above) |
| `xcodegen generate --spec project.yml`, twice | identical bytes (`project.pbxproj`, shared scheme) |
| `xcodebuild -list -project MobileBenchNative.xcodeproj` | targets MobileBenchNative, MobileBenchNativeSmokeUITests; scheme MobileBenchNative |
| `xcodebuild -project MobileBenchNative.xcodeproj -scheme MobileBenchNative -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build ARCHS=arm64 ONLY_ACTIVE_ARCH=NO build` | BUILD SUCCEEDED (10 to 19 s with warm caches); arm64 executable 589 104 bytes; `.app` 2 198 115 bytes of files, of which 1 604 141 bytes are the bundled fixtures and replay streams; `tools/verify-assets.mjs` on `MobileBenchNative.app/fixtures`: 6 files match `golden.json` |
| same with `build-for-testing` | ok; the app executable is byte-identical before and after |
| XCUITest smoke, attempts 1 and 2 | attempt 1 did not start (no iPhone 17 device type on the iOS 27.1 runtime); attempt 2 stopped at `mb.summary.count`: the summary labels were laid out before their superview and kept zero frames. Fixed |
| XCUITest smoke, attempt 3 | stopped by hand after 11 minutes: per-cell queries over the 300 row elements were too slow on the overloaded host (fixed with a table snapshot). Everything up to the second background passed: ids and texts, selection, Selection / Detail / panel / Insights navigation, `fui` `rows=8;h=642;sel=50;seq=0`, `screen` markers 0–6, background checkpoint digest at seq 1358 and end checkpoint at seq 10 000 equal to the reference model, `resume` on List and reconnect from 1359 |
| `xcodebuild test-without-building -xctestrun <MobileBenchNative_*.xctestrun> -destination id=<mobilebench-iphone> -only-testing:MobileBenchNativeSmokeUITests/SmokeUITests/testSmokeJourney`, attempt 4 | TEST EXECUTE SUCCEEDED (test case 123 s); 67/67 checks passed |

iOS attempt 4 checked: the ids and texts of §8.12 (except `mb.nav.back`, see Known issues); option A of item 1
selected after one tap, `Selected 51`, `Selection (51)`; one `fui` with `rows=8;h=642;sel=50;seq=0`, stream after
FUI; one `resp` (`rev=1`); `screen` markers `list` 0, `selection` 1, `list` 2, `detail/3` 3, `list` 4,
`insights` 5, `list` 6, `detail/12` 7; panel `anim.*` show/hide pairs and the panel element present only while
shown; embedded Insights markers and texts; background checkpoint digests equal to the reference model at seq 1208
and 1563, `mem` markers with `phys_footprint`; after foreground `resume` on List, reconnect from seq 1209 and
updates applied again; relaunch with `mb.restore=1` after `terminate()`: no `fui`, `restore r=detail/12;a=9`,
`screen` detail then list, stream from `lastSeq + 1`, List with row 9 at the top, `Selected 51`, checkpoint digest
equal to the reference at seq 1724.

Not verified: device builds (`build-native-ios-device`, needs a team and a device), the activity-warm start path
(A3) on Android, the `c` and `r` stream frames at run time (the replay source never sends them), and any
benchmark measurement.
