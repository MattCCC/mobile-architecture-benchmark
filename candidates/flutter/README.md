# Flutter candidate

The reference application of the benchmark written in Flutter: one Dart code base for Android and iOS,
drawn by Flutter's own renderer (Impeller), Dart AOT in release builds. Application id and bundle id:
`org.example.mobilebench.flutter`. Display name: `MB Flutter`.

## Architecture

| Concern | Implementation |
|---|---|
| Entry | `lib/main.dart`: launch configuration, embedded fixture parsed at run time, optional restoration record, then `runApp`. The first frame already shows the full List screen (no placeholder, no Dart splash; only the platform launch screen). |
| Screens | `lib/ui/`: List (`list`), Selection (`selection`), Detail (`detail/<i>`), Insights (`insights`, embedded), Error (`error`) |
| List | `ListView.builder` with `itemExtent: 72`, one row widget per item (`ItemRow`) |
| State | `lib/domain/store.dart`: values as `Int32List` (fixed point), selection as `Int8List`; one lazily created `ValueNotifier<RowState>` per built row, one for the selection summary. An update rebuilds only its row, plus the summary when the item is selected. |
| Navigation | `Navigator` 1.0 + `MaterialPageRoute` (platform default transitions), system back on Android, app-bar back button (`mb.nav.back`) on both |
| Animation | Detail panel: `AnimationController` (300 ms / 300 ms) + `CurvedAnimation(Curves.easeInOut)` = cubic-bezier(0.42, 0, 0.58, 1), `SlideTransition` (+240 dp = 2.0 panel heights of 120 dp) + `FadeTransition` |
| Update stream | `lib/stream/`: `FrameSource` interface (transport of wire-form text frames) + `StreamClient` (protocol rules: seq order, duplicates, gap reconnect, stale 2 s / reconnect 3 s, back-off 250/500/1000/2000 ms, `c`/`r`/`e` frames, checkpoint 500 ms after `c`/`e`, six status words). Default transport: `ReplayFrameSource`, an in-app replay of the bundled stream bytes on a monotonic absolute schedule. A WebSocket transport for the local server implements the same interface. |
| Digests | `lib/domain/digest.dart`: `mb-state-v1` and `mb-insights-v1` texts, SHA-256 with `package:crypto` |
| Restoration | `lib/domain/restore_record.dart`: record v2 (route stack, anchor, selection, `lastSeq`, all values) written on background with temp file + atomic rename, restored with `mb.restore=1`. No Flutter `restorationScopeId`. |
| Instrumentation | `lib/benchkit/`: BenchKit facade (markers, FUI gate, probe tokens) and interim `dart:ffi` backends, see below |
| Native code | Android `MainActivity.kt` (forwards `mb.*` Intent extras as Dart entry-point arguments, `reportFullyDrawn()` channel, keep-awake for `mb.journeyMode=1`); iOS `AppDelegate.swift` (keep-awake for `mb.journeyMode=1`). No plugins, no CocoaPods. |

### Data

The app bundles the committed fixture bytes and, per profile, the first 10000 update frames:

- `assets/fixtures/<profile>.json`: copied byte-identically from `fixtures/v1/` by the verifying copy command of
  `fixtures/generator/cli.mjs` (gitignored, never committed here).
- `assets/fixtures/<profile>.stream.jsonl`: update frames seq 1..10000 in wire form, LF-terminated, written by
  `tool/stream_asset.mjs` from the shared Node generator (`fixtures/generator/lib.mjs`). The bytes are exactly what
  `golden.json` `profiles.<profile>.stream.sha256` hashes; the tool refuses to write a file whose SHA-256 differs.
  The app never runs the PRNG.

`make fixtures-flutter` (also a prerequisite of `deps-flutter`) does both. Unit tests check the bundled bytes
against `golden.json` again.

Replay semantics (one session, like the local server): a hello frame on every connection; message k due at
`t0 + (k − from0) / rate` on a monotonic clock (`Stopwatch`), rate from the profile (5 / 20 / 100 msg/s); a
reconnect gets every already-due message at once (catch-up), then real time; an end frame `{"t":"e","last":10000}`
follows the last bundled message (500 s at the representative rate). Each frame is handed to the client as text and
parsed on receipt, as from a socket.

## Accessibility ids

Every id of the accessibility-id contract is a Flutter `Semantics(identifier:, container: true)` node, which
Flutter exposes as the Android resource-id and the iOS `accessibilityIdentifier`:
`mb.screen.list|selection|detail|insights|error`, `mb.list`, `mb.row.<i>`, `mb.row.<i>.label`,
`mb.row.<i>.opt.a|b|c` (button, selected state), `mb.summary`, `mb.summary.count` (text `Selected <n>`),
`mb.summary.total` (text `Total <fmt>`), `mb.nav.selection`, `mb.nav.insights`, `mb.nav.back`, `mb.stream.status`,
`mb.state.digest` (`k=<k>;seq=<n>;d=<12 hex>`, every screen), `mb.detail.values.a|b|c`, `mb.detail.panel.toggle`,
`mb.detail.panel` (present only while shown or animating), `mb.insights.top`, `mb.insights.buckets`,
`mb.insights.source` (`Source: embedded`), `mb.insights.digest`, `mb.error.code`.

Notes: `mb.list` is a container around the scrollable (Flutter's `Scrollable` owns its own semantics node, one
level below). On Android, Flutter reports visible text as the node's content description: a UiAutomator dump
shows `text=""` and, for example, `content-desc="Live"` on `mb.stream.status` or `content-desc="A 44.60"` on an
option button (class `android.widget.Button`), so drivers read `content-desc` when `text` is empty.
Flutter builds its semantics tree only while an accessibility client is active (UiAutomator on Android; on iOS
devices VoiceOver, Switch Control or Speak Screen; always on the iOS simulator). `mb.semantics=on`
calls `SemanticsBinding.instance.ensureSemantics()` before `runApp`.

## Instrumentation

Markers follow the instrumentation contract (names, ordinals, payloads, probe tokens). They are emitted by the Dart
BenchKit facade (`lib/benchkit/benchkit.dart`) through an interim backend that calls public platform C APIs directly with `dart:ffi`,
because the core BenchKit C ABI does not exist yet:

| Platform | Timing record | Control mirror | Clock |
|---|---|---|---|
| Android | zero-length atrace slice `mb\|<event>\|<n>\|<payload>` (`ATrace_beginSection` / `ATrace_endSection`, libandroid) | logcat tag `MobileBench`: `MB <journeyId> <event> <n> <payload> t=<ns>` (`__android_log_write`), for `fui`, `resume`, `restore`, `remote.ready`, `remote.error`, `state`, `ctr`, `err`, `a11y`, `launch`; every marker with `mb.markerMirror=all` | `clock_gettime(CLOCK_BOOTTIME)` (= `SystemClock.elapsedRealtimeNanos()`) |
| iOS | in-memory ring buffer (4096), flushed to `Library/Caches/mobilebench/markers-<journeyId>.jsonl` at checkpoints and on background | `syslog` line (same format) + Darwin notification `org.example.mobilebench.<event>` | `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)` |

The `t=<ns>` field of the log line is an addition of this interim backend for manual inspection; the contract treats
the mirror as a control signal, never as a timing source.

Required measurement points and their marker names:

| Measurement point | Marker | Emitted when |
|---|---|---|
| first usable UI | `fui` `rows=<kReq>;h=<dp>;sel=<S>;seq=0` | FUI gate: the list container reported its height at first layout (`listLayout`), and the 1 × 1 dp draw probes of rows `0…kReq−1` and of the summary bar have painted with token `fui0` (`CustomPainter.paint`). A layout without height and paints while the view has no size (Flutter’s warm-up frame before the platform reports the window metrics) do not count. Android then calls `reportFullyDrawn()`. The stream connects only after this frame. |
| list rendered | `screen` `r=list;nav=0` | first paint of the List screen's root probe |
| update applied | `stream.live` `s=<seq>` (first applied update after a connection opens) and `state` / `ctr` at checkpoints (`s=<last applied seq>`, received / applied / duplicates / gaps / row builds) | the instrumentation contract excludes per-message markers |
| navigation done | `screen` `r=<route>;nav=<navSeq>` | first paint of the destination's root probe after a push or pop started (`navSeq` increments at transition start) |

Also emitted: `resp` (summary probe, first paint with a new selection revision), `resume` (top screen's root probe
after `fg`, then the stream reconnects), `restore`, `bg` / `fg`, `launch` (Android, `ss=<0|1>`), `stream.connect` /
`stream.open` / `stream.closed` / `stream.stale`, `scroll.idle`, `anim.start` / `anim.end`, `remote.request` /
`remote.source src=embedded` / `remote.ready v=1`, `err`. `--dart-define=MB_BENCHKIT=noop` builds the
overhead-comparison variant: no markers, probes still paint but make no calls.

## Toolkits and versions

Exact pins (latest stable releases, checked on 2026-10-22):

| Item | Version | Source of truth |
|---|---|---|
| Flutter / Dart | 3.47.7 (framework `abaf9c523780a608bd46686fd5e53740a07077f8`, engine `deb287481e3ce9468f3434937ced4240a70539ca`, engine content hash `d8a2d6c768c334d53e16277f837970ffa1e2de81`) / 3.13.5 | `pubspec.yaml` `environment` (exact), `.metadata` |
| `crypto` / `ffi` | 3.0.7 / 2.2.0 | `pubspec.yaml`, `pubspec.lock` |
| `flutter_lints` / `fake_async` (dev) | 6.0.0 / 1.3.3 | `pubspec.yaml`, `pubspec.lock` |
| `androidx.profileinstaller:profileinstaller` | 1.4.1 | `android/app/build.gradle.kts` |
| AGP / Kotlin Gradle plugin / Gradle wrapper | 9.1.0 / 2.4.0 / 9.3.1 (Flutter 3.47.7 template values) | `android/settings.gradle.kts`, `android/gradle/wrapper/gradle-wrapper.properties` |
| Android compileSdk / targetSdk / minSdk / NDK | 36 / 36 / 24 / 28.2.13676358 (Flutter Gradle plugin defaults; minSdk set explicitly) | `android/app/build.gradle.kts` |
| iOS deployment target | 16.4 | `ios/Runner.xcodeproj/project.pbxproj` |

`pubspec.lock` resolves 26 hosted packages, all from `https://pub.dev`. The platform projects were generated with
`flutter create --empty --org org.example.mobilebench --project-name mobilebench_flutter --platforms android,ios -a kotlin`
(Flutter 3.47.7) and then edited: ids, Kotlin package path, `MainActivity`, manifest (INTERNET, `<profileable
android:shell="true"/>`, network security config with cleartext only for `localhost`, `127.0.0.1`, `10.0.2.2`,
portrait), no `values-night` launch theme (light only), Info.plist (`MB Flutter`, `NSAllowsLocalNetworking`,
`NSLocalNetworkUsageDescription`, portrait on iPhone), deployment target 16.4. Template icons are the framework
defaults.

## Build commands

From the repository root (the root Makefile includes `candidate.mk`; until it exists, use
`make -f candidates/flutter/candidate.mk <target>`):

| Target | What it runs |
|---|---|
| `make fixtures-flutter` | verified fixture copy + stream asset generation |
| `make deps-flutter` | `flutter pub get --enforce-lockfile` |
| `make check-flutter` | `flutter analyze --fatal-infos`, `dart format --output=none --set-exit-if-changed lib test`, `flutter test` (host only) |
| `make build-flutter-android` | `flutter build apk --release --split-per-abi --target-platform android-arm64` and `flutter build appbundle --release` |
| `make build-flutter-ios` | `flutter build ios --simulator --debug` (simulator builds can only be debug) |
| `make build-flutter-ios-device` | `flutter build ios --release --no-codesign` (unsigned, for size inspection) |
| `make artifacts-flutter-android` / `-ios` | prints the artifact paths |
| `make clean-flutter` | `flutter clean` and removes the generated assets |

Every `flutter` call runs with `--suppress-analytics` and `FLUTTER_SUPPRESS_ANALYTICS=true`. flutter_tools looks for
Java in Android Studio's bundled runtime before `JAVA_HOME`; the targets therefore pass `MB_FLUTTER_JDK`
(default `$JAVA_HOME`) through a candidate-local Flutter settings file (`XDG_CONFIG_HOME` pointing into `build/`),
without touching the user's Flutter configuration. `MB_FLUTTER_DEFINES` adds build flags.

Run on a device or emulator (examples):

```sh
adb install candidates/flutter/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
adb shell am start -W -n org.example.mobilebench.flutter/.MainActivity --es mb.profile representative --es mb.markerMirror all
adb logcat -s MobileBench:I
xcrun simctl install booted candidates/flutter/build/ios/iphonesimulator/Runner.app
xcrun simctl launch booted org.example.mobilebench.flutter -mb.profile representative
```

## Release settings

- Android: Dart AOT; R8 and resource shrinking are enabled by the Flutter Gradle plugin for release builds; Impeller
  (Vulkan, OpenGL ES fallback); `FlutterActivity` default render mode (SurfaceView); no `--obfuscate` or
  `--split-debug-info`; measurement APK arm64-v8a only (`--split-per-abi --target-platform android-arm64`); App
  Bundle with the default ABIs for size reporting. Signing: a local non-distribution key from
  `$MB_KEYSTORE_PROPERTIES` or `out/keys/keystore.properties` (`storeFile`, `storePassword`, `keyAlias`,
  `keyPassword`); without it the build falls back to the debug key and prints a warning.
- iOS: device builds Release (Dart AOT, Metal / Impeller); simulator builds Debug (Dart JIT) only. Device signing
  needs your own team and bundle id (`MB_IOS_TEAM_ID` / `MB_BUNDLE_PREFIX` are not wired yet).

## Deviations from the functional specification

- Interim BenchKit (see Instrumentation): `bg` / `fg` come from Flutter's `AppLifecycleListener` (paused / leaving
  paused) instead of platform lifecycle callbacks; marker ordinals restart when Android recreates the activity,
  because the default `FlutterActivity` starts a new engine and Dart isolate; `a11y`, `input.*`, `proc.anchor`,
  `mem` and the iOS `OSSignposter` events are not implemented.
- Update source: in-app replay only. `mb.server`, `mb.session`, `mb.token` and `mb.dataset=network` are parsed but
  not used; there is no WebSocket transport yet, so fault injection, `c` / `r` frames and server byte accounting are
  not exercised in the app (the client handles them; unit tests cover them).
- The replay ends after 10000 messages (`Ended`, then a checkpoint `k=0`).
- `mb.bridgeBench` is parsed; the C6 bridge micro-benchmark (`dart:ffi` sync call, `MethodChannel` async message) is
  not implemented.
- Unknown `mb.*` launch keys are reported as `err code=launch-config-unknown` (the contract names no code for them).
- Initial status text is `Connecting` (the stream connects right after the first usable UI).
- Touch feedback: none (`GestureDetector` buttons, `NoSplash`), so no Material ink or sparkle shader work.
- `mb.journeyMode=1` keeps the screen awake (Android `FLAG_KEEP_SCREEN_ON`, iOS `isIdleTimerDisabled`).
- Restore launches do not call `reportFullyDrawn()` (the FUI gate is not armed; `restore` is the marker).

## Instrument validity (expectations, to be confirmed by the harness self-validation runs)

- Android: FrameTimeline does not cover SurfaceView content, so A-F1 is expected `unavailable`; per-layer presents
  (A-F2) for the `SurfaceView[...]` layer are the frame source; `FrameTimingMetric` / `dumpsys gfxinfo` do not see
  Flutter frames. Marker slices are emitted on the platform main thread (Dart runs on it in 3.47.7).
- iOS: `XCTHitchMetric` validity for the Flutter Metal layer is still to be validated; `XCTOSSignpostMetric` scroll signposts
  do not exist for Flutter. Simulator runs are debug builds with semantics forced on.

## Known issues

- Flutter does not officially support release mode on emulators; Android emulator results of the release APK carry
  that limitation.
- `dart:io` sockets do not consult Android's network security config or iOS ATS (relevant once the WebSocket
  transport exists).
- The template AGP (9.1.0) differs from the native candidates' AGP, so R8 versions differ.
- `libapp.so` / `App.framework` hold app code and the Flutter framework together; size categories cannot separate them.
- The bundled stream adds about 0.47 MB per profile (uncompressed) to the artifact; every candidate that bundles the
  stream carries the same bytes.

## Toolchain needs

Node 24 (fixture copy and stream generation), GNU Make ≥ 3.81, Flutter 3.47.7 (includes Dart 3.13.5), JDK 17
(Gradle), Android SDK (platform-tools, emulator, `platforms;android-36`, NDK 28.2.13676358, build-tools as AGP
requests), Xcode 27.1 with an iOS simulator runtime ≥ 16.4. No CocoaPods (no plugins; SwiftPM integration of the
template).

## Status

Implemented on Android and iOS. Only commands that were actually run are listed. No measurement was taken in the
authoring phase; the sizes below are build-log values, not measurements.

### Verification (authoring phase, 2026-10-22, macOS host)

| # | Command (from `candidates/flutter` unless noted) | Outcome |
|---|---|---|
| 1 | `flutter create --no-pub --empty --org org.example.mobilebench --project-name mobilebench_flutter --platforms android,ios -a kotlin …` (in `candidates/`) | 74 files written |
| 2 | `node fixtures/generator/cli.mjs copy candidates/flutter/assets/fixtures --profiles small,representative,stress` (repo root) | 5 files copied and verified |
| 3 | `node candidates/flutter/tool/stream_asset.mjs candidates/flutter/assets/fixtures --profiles small,representative,stress` (repo root) | 3 stream files, 10000 frames each, SHA-256 equal to `golden.json` |
| 4 | `flutter pub get` | resolved 26 hosted packages from pub.dev; `pubspec.lock` written |
| 5 | `flutter analyze` | `No issues found!` |
| 6 | `dart format --output=none --set-exit-if-changed lib test` | 0 files changed |
| 7 | `flutter test` | `All tests passed!` (42 tests: golden digests at seq 0/100/1000/10000 for all three profiles, bundled bytes vs golden, formatting, selection rules, restoration record, stream client rules, replay schedule, BenchKit gate/tokens/markers incl. the zero-size warm-up frame, `getenv` via `dart:ffi`, launch configuration, widget tests of FUI, ids, selection, navigation, animation, Insights, background/foreground and restore) |
| 8 | `make -f candidates/flutter/candidate.mk -n check-flutter build-flutter-android build-flutter-ios artifacts-flutter-android` (repo root, GNU Make 3.81) | all targets resolve |
| 9 | `make -f candidates/flutter/candidate.mk check-flutter` (repo root) | exit 0 (analyze: no issues; format: 0 changed; tests passed) |

### Device builds and functional checks (2026-10-22, host Apple M1 Pro, macOS 26.7.1, other builds running)

| # | Command / procedure | Outcome |
|---|---|---|
| 10 | `make -f candidates/flutter/candidate.mk build-flutter-android` (`JAVA_HOME` = JDK 17) | first attempt: APK built, `flutter build appbundle` stopped with "Release app bundle failed to strip debug symbols": flutter_tools checks the bundle with the SDK's `cmdline-tools` `apkanalyzer`, which was not installed. After `sdkmanager --sdk_root="$HOME/Library/Android/sdk" "cmdline-tools;latest"` (23.0): exit 0, `app-arm64-v8a-release.apk` 16202196 B, `app-release.aab` 45721967 B (default ABIs), 64 s with warm caches |
| 11 | Functional smoke on the Android emulator (AVD `mobilebench_api37`: `android-37.0;google_apis;arm64-v8a`, 1080 × 2400, 420 dpi, 4 cores, 4 GB, 60 Hz; cold boot, `-gpu host -no-window`): fresh install, `am start` with `mb.profile small` and `mb.markerMirror all`, `uiautomator dump` + `input tap` on the dumped bounds, HOME / relaunch, `am force-stop` + `mb.restore 1` | attempt 1 exposed a defect: `fui` fired in Flutter's warm-up frame, which runs before the platform reports the window size (`rows=1;h=0`). Fixed (the gate ignores a list layout without height and probes skip paints while the view has no size; regression test added). Attempt 2: `fui rows=10;h=730;sel=5;seq=0` (h equals the dumped list bounds), all checked ids present, tap → `resp rev=1`, navigation list → selection → list → detail → list → insights with `screen` markers, panel `anim.*` show/hide, `remote.ready`, `bg` + `state` + `ctr`, `fg` + `resume` + reconnect from `lastApplied + 1`, restore launch `launch ss=0` + `restore r=detail/3;a=0` + stream from `lastSeq + 1`, no crash. Not verified: Insights ids in a dump (UiAutomator never got an idle second while the replay keeps Insights live; covered by the host widget tests) |
| 12 | `make -f candidates/flutter/candidate.mk build-flutter-ios` | exit 0, simulator Debug `Runner.app` 147633764 B in the final build (Debug/JIT; not a release size) |
| 13 | Functional smoke on the iOS simulator (`mobilebench-iphone`, iPhone 17, iOS 27.0; the iOS 27.1 runtime here supports only the iPhone Duo device type): `simctl install`, `simctl launch … -mb.markerMirror all`, `log stream` on the syslog mirror, background by launching another app, relaunch, `simctl terminate` + `-mb.restore 1` | attempt 2: `fui rows=8;h=642;sel=50;seq=0`, `screen`, stream markers, `bg` / `state` / `fg` / `resume` passed; the restoration record and the marker file were not written, because Dart's `Platform.environment` is empty on iOS (HOME unresolved). Fixed by reading `getenv("HOME")` through `dart:ffi` (host test added). Attempt 3 (rebuilt, 42 s): all checks passed: `fui rows=8;h=642;sel=50;seq=0`, `screen r=list;nav=0`, stream from seq 1, `bg` + `state` + `ctr`, `fg` + `resume` + reconnect from `lastApplied + 1`, marker file `Library/Caches/mobilebench/markers-func.jsonl` flushed (18 lines), restoration record v2 written, restore launch `restore r=list;a=0` with the stream from `lastSeq + 1`, no `err` marker |

UI taps and accessibility-id checks on iOS need the repository’s XCUITest driver, so the simulator smoke covers launch,
markers, lifecycle and restoration only. The Android functional check ran on the APK built before the iOS-only
`getenv` fix (`app-arm64-v8a-release.apk` SHA-256 `dc4bb018…87c5`, still the artifact in `build/`); that fix
changes no Android code path.

Not verified yet: the WebSocket transport (not implemented), the bridge micro-benchmark (not implemented), iOS
device builds (`build-flutter-ios-device` not run; needs signing to install), Insights ids in an Android dump (see
row 11), iOS accessibility ids and taps on the simulator (needs XCUITest), measurements of any kind.
