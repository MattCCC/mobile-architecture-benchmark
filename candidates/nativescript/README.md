# Candidate `nativescript`: NativeScript core + TypeScript

A NativeScript implementation of the reference application, written against `@nativescript/core` and
TypeScript, without a UI framework layer. JavaScript runs on V8 on both platforms and drives the platform UI
toolkits directly: Android Views on Android, UIKit on iOS.

Application id / bundle id: `org.example.mobilebench.nativescript`. Display name: `MB NativeScript`.

## Architecture

```
app/
├── app.ts                 entry: Application.run, lifecycle events
├── app.css                equal-work visual specification (light theme, one accent colour)
├── core/                  platform-independent logic (unit-tested in Node)
│   ├── fixture.ts         parses and validates the bundled fixture (mobilebench.fixture/1.0.0)
│   ├── store.ts           values, selection, revision, stream counters
│   ├── wire.ts            stream frames: hello, update, end, checkpoint, resume
│   ├── stream-client.ts   client rules: seq order, dup/gap counting, stale/reconnect timers, six status words
│   ├── replay.ts          default transport: in-app replay of the bundled stream on the monotonic clock
│   ├── digest.ts, sha256.ts   canonical state / Insights texts and a pure-JS SHA-256
│   ├── fui-gate.ts        first-usable-UI gate and probe-token bookkeeping
│   ├── restore.ts         restoration record v2
│   ├── launch-config.ts   mb.* launch keys
│   ├── markers.ts         marker encoding
│   └── format.ts          display formatting without locale APIs
├── platform/              direct native calls (one implementation per platform, selected by the bundler)
│   ├── native.{android,ios}.ts      clocks, trace/log markers, files, assets, accessibility state
│   ├── probe-view.{android,ios}.ts  1 x 1 draw-probe native views (View.onDraw / drawRect:)
│   ├── draw-probe.ts      NativeScript view wrapping the probe
│   ├── benchkit.ts        BenchKit contract implemented in the candidate (see Deviations)
│   └── assets.ts          bundled fixture JSON (inlined by webpack)
└── ui/
    ├── session.ts         launch, navigation, lifecycle, checkpoints, restoration, marker logic
    ├── screens.ts         List, Selection, Detail, Insights and Error screens (built in code)
    └── item-vm.ts         per-item observable view model bound by the list row template
App_Resources/             Android and iOS resources (starting point: the official blank TypeScript template)
scripts/prepare-assets.mjs verified fixture copies + golden-checked replay stream (generated, gitignored)
test/                      Node unit tests (node:test) of app/core
typecheck/                 compile-time check that both platform implementations satisfy the facades
```

- List: `@nativescript/core` `ListView` (Android `android.widget.ListView` with a `BaseAdapter`, iOS
  `UITableView`), `rowHeight` 72, one row template with data bindings. Every item has its own `Observable`
  view model, so an update message re-binds only the labels of that item; the list items source is a plain
  array-like object, never an `ObservableArray` (any `ObservableArray` change would refresh every visible row).
- Navigation: one `Frame`, default transitions; the List page hides the action bar, the other pages use the
  default action bar with its back control.
- Animated interaction: the Detail info panel uses `View.animate` (translateY 240 → 0 and opacity 0 → 1, 300 ms,
  `CoreTypes.AnimationCurve.cubicBezier(0.42, 0, 0.58, 1)`; hide reverses it).
- Data source: `Transport` interface (`app/core/stream-client.ts`). The default `ReplayTransport` sends the same
  wire frames the local server would send (hello, updates in seq order, end) on the absolute schedule
  `t0 + (k − from) / rate`, measured on the platform monotonic clock. While the app is in the background the
  schedule keeps running, so the reconnect after foreground first catches up with every message already due, as
  with a server. A WebSocket transport can implement the same interface (not part of this version).
- Bundled data: `app/generated/fixtures/<profile>.json` are byte copies of `fixtures/v1/` made by the verifying
  copy command of `fixtures/README.md`; webpack inlines the parsed JSON (the documented JS-bundler path). The
  replay stream is the first 10 000 update frames of each profile from the shared generator, checked byte for
  byte against `golden.json` (`stream.sha256`). Android reads it from APK assets, outside the app folder that the
  runtime extracts on the first launch; iOS reads it from the app folder.
- State restoration: record v2 (values at `lastSeq`, selection, route stack, scroll anchor) written on
  background with a temp file + rename (Android) or an atomic write (iOS); restored on launch with `mb.restore=1`.

## Toolkits and versions

Exact pins are in `package.json` / `package-lock.json` (public registry only, `.npmrc`).

| Component | Version | Note |
|---|---|---|
| NativeScript CLI (`nativescript`, project-local devDependency, run with `npx --no-install ns`) | 9.1.2 | no global install |
| `@nativescript/core` | 9.1.3 | |
| `@nativescript/android` (runtime, V8) | 9.1.1 | pins Gradle 8.14.3 and AGP 8.12.1 for the generated project |
| `@nativescript/ios` (runtime, V8) | 9.1.0 | fetched by Xcode from the `NativeScript/ios-spm` Swift package at build time |
| `@nativescript/webpack` | 5.0.39 | resolves webpack 5.112.0 |
| `@nativescript/types` | 9.1.4 | |
| TypeScript | 6.0.3 | 7.0.2 is the latest release; the NativeScript 9 templates and the loaders of `@nativescript/webpack` target 6.0 |
| ESLint / typescript-eslint / @eslint/js | 10.13.0 / 8.72.0 / 10.0.1 | |
| `@types/node` (tests only) | 24.19.2 | matches the Node 24 LTS runtime of the repository tooling |
| `androidx.profileinstaller:profileinstaller` | 1.4.1 | latest release on Google Maven (checked 2026-10-22) |
| Android compileSdk / targetSdk / minSdk | 36 / 36 / 24 | template defaults; minSdk 24 per design |
| iOS deployment target | 16.4 | design |

Versions were resolved from the public registry on 2026-10-22 (`npm view <pkg> dist-tags`).

## Build commands

From the repository root (GNU Make 3.81 or later; the root Makefile includes `candidate.mk`, or call it
directly with `-f candidates/nativescript/candidate.mk`):

| Target | What it does |
|---|---|
| `make deps-nativescript` | `npm ci` from the committed lockfile |
| `make check-nativescript` | type-check (`tsc --noEmit`), lint (`eslint .`), unit tests (`npm test`); no app build, no device |
| `make prepare-nativescript` | verified fixture copies and the golden-checked replay stream |
| `make keystore-nativescript` | local non-distribution release key in `build/keys/` (random password, gitignored) |
| `make build-nativescript-android` | `ns build android --release`, R8 on, `arm64-v8a` only, signed with the local key → `build/android/app-arm64-release.apk` |
| `make build-nativescript-ios` | `ns build ios --release` for the simulator → `build/ios/MBNativeScript.app` |
| `make artifacts-nativescript-<android\|ios>` | prints the artifact path |
| `make clean-nativescript` | removes `platforms/`, `build/` and the generated assets |

Variables: `MB_NATIVESCRIPT_JAVA_HOME` (default: Homebrew `openjdk@17` when present, else `JAVA_HOME`),
`MB_NATIVESCRIPT_ANDROID_HOME` (default `ANDROID_HOME` or `~/Library/Android/sdk`), `MB_NATIVESCRIPT_ABIS`
(default `arm64-v8a`; CI acceptance builds pass `x86_64`), `MB_NATIVESCRIPT_KEYSTORE_PROPERTIES` (properties file
with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`), `MB_NATIVESCRIPT_GEM_PATH` (see Toolchain needs).

The signing passwords are passed to the CLI as command-line arguments (the CLI has no other way); the key is a
local throwaway key, and the recipe does not echo them.

## Release settings

- JavaScript: `ns build … --release` implies the webpack production mode with Terser; the default Terser options
  of `@nativescript/webpack` are kept (they drop `console.*`; markers do not use the console).
- `nativescript.config.ts` keeps the values the CLI writes into every new project: `android.v8Flags: '--expose_gc'`
  and `android.markingMode: 'none'`. V8 snapshots and code cache are off (framework defaults).
- Android: R8 on (`minifyEnabled true`) with keep rules for the runtime, `androidx`, material and kotlin packages
  and no renaming (`App_Resources/Android/src/main/proguard-rules.pro`), because JavaScript reaches Java classes by
  name. Resource shrinking is off: NativeScript resolves resources by name from JavaScript, which the resource
  shrinker cannot see. ABIs: `ndk.abiFilters` replaced by `arm64-v8a` in `App_Resources/Android/app.gradle` (the
  runtime pre-fills four ABIs, so the set is cleared first). `profileinstaller` and `<profileable android:shell="true"/>`
  are added; network security allows cleartext only to `localhost`, `127.0.0.1` and `10.0.2.2`.
- iOS: deployment target 16.4, `CADisableMinimumFrameDurationOnPhone`, `NSAllowsLocalNetworking`,
  `NSLocalNetworkUsageDescription`, light appearance, portrait only, plain white launch screen.

## Deviations from the functional spec

| Item | Deviation |
|---|---|
| BenchKit | The shared BenchKit libraries do not exist yet, so the contract is implemented in the candidate (`app/platform/benchkit.ts`): markers are synchronous direct native calls on the UI thread. Android writes a zero-length atrace section `mb\|<event>\|<n>\|<payload>` through `android.os.Trace` and mirrors the driver-visible set to logcat (tag `MobileBench`). iOS appends to an in-memory buffer (flushed to `Library/Caches/mobilebench/markers-<journey>.jsonl` at checkpoints, on background and at 75 % fill), mirrors the driver-visible set to standard error and posts the Darwin notification. Missing on iOS: `OSSignposter` events, the window touch observer (`input.*`), `proc.anchor`, `memoryCheckpoint`. The mirror line adds a candidate-local `t=<monotonic ns>` field. When the shared libraries exist, `benchkit.ts` forwards to their facade |
| Stream transport | The default source is the in-app replay (see Architecture), not the local server. There is no control channel, so checkpoints come from the end frame (after `mb.replayCount` messages, a candidate-local launch key) and from background only; checkpoint/resume frames are implemented in the client and unit-tested but only a server can send them |
| Launch keys | `mb.server`, `mb.token`, `mb.dataset=network`, `mb.remote=remote`, `mb.bridgeBench` other than `0` and `mb.layoutProbe` are not implemented; such values are reported once with `err code=launch-config-invalid` and the defaults are used. Unknown `mb.*` keys are reported with `err code=launch-config-unknown` |
| Bridge micro-benchmark (C6) | `bridge.sync` is declared (direct native call); the measurement loop behind `mb.bridgeBench=sync` is not implemented |
| Insights | Embedded only (no remote mechanism, see `candidate.json` `remoteLoading`); `remote.request`, `remote.source src=embedded` and `remote.ready` are emitted for the embedded screen |
| Activity-warm start (A3) | A new root UI in a live process resets the session to the fixture at seq 0 and re-arms the FUI gate in the candidate (the shared BenchKit would do it on `onActivityCreated`) |
| Template | `@nativescript/theme` and the template splash and launch images are not used; storage permissions removed; `allowBackup` off; portrait only |

Candidate-local diagnostic markers, in addition to the v1 catalogue: `list.rendered` (rows `0…kReq−1` drawn,
usually the same frame as `fui`), `update.applied` (first update after each connection and every 100th seq). The
navigation-done marker is the catalogue's `screen` (first draw of the destination's root probe).

Design revision 2 (§31) adoption: items 1–3, 6, 6a (candidate-side), 7–8, 10–13, 16–18, 20–21, 23, 29 and 30 are
adopted; item 9 holds (no platform restoration mechanism is used, the Android `launch` marker reports `ss`);
items 14–15 are partly covered by the candidate-local BenchKit (Android `a11y` listener, logcat mirror; iOS touch
observer missing); items 22 and 24 are partly adopted (keys parsed and validated; server and token transport not
implemented); item 28 is declared but not measured; items 4, 5, 19, 25–27 and 31 do not apply to this candidate.

## Instrument validity

Expected (to be confirmed by the harness pilot): Android `FrameTimeline` and layer-present instruments are valid,
because content is drawn by HWUI into the activity window (`contentLayerPattern` in `candidate.json`); on iOS the
list is a `UITableView`, so `XCTOSSignpostMetric` scrolling is expected to be valid and `XCTHitchMetric` needs the
pilot. Marker timestamps are draw-time timestamps from the probes' draw callbacks (`View.onDraw`, `drawRect:`).

## Known issues

- JavaScript runs on the main thread; a long JavaScript task delays rendering and the start of animations
  (inherent to NativeScript's architecture).
- The NativeScript Android build installs `platforms/` on demand and, on a clean machine, downloads Gradle 8.14.3
  and may auto-install SDK build-tools requested by the runtime (35.0.1 here); do this outside measurement windows.
- Accessibility identifiers on Android are exposed through NativeScript's accessibility delegate, installed one
  microtask after a view loads; acceptance waits must tolerate that.
- The bundled replay streams (about 0.46 MB per profile, uncompressed) are part of the artifact; size reports must
  subtract the `benchmark-data` category.

## Toolchain needs

- Node 24 LTS and npm (project-local CLI, no global install).
- Android: JDK 17, Android SDK with platform-tools; the runtime's Gradle wrapper downloads Gradle 8.14.3 and AGP
  provisions missing build-tools.
- iOS: Xcode with an iOS simulator runtime, network access to github.com for the `NativeScript/ios-spm` Swift
  package, and Ruby with the `xcodeproj` gem (the CLI merges `App_Resources/iOS/build.xcconfig` with it). The
  Homebrew CocoaPods keg ships the gem; `MB_NATIVESCRIPT_GEM_PATH` defaults to
  `$(brew --prefix cocoapods)/libexec:$(gem env gempath)`. The CLI's environment check also runs `pod --version`,
  so a working `pod` must be on `PATH`, but no Podfile is used.
- The CLI asks for usage-reporting consent only in interactive shells and reports nothing unless a user enabled
  it before; the app contains no analytics.

## Status

Verification of this authoring step (2026-10-22, macOS on Apple silicon, Node 24.11.1, npm 11.16.0):

| Command (in `candidates/nativescript`) | Outcome |
|---|---|
| `npm install --no-audit --no-fund` | lockfile v3 written; 770 `resolved` URLs, all on `https://registry.npmjs.org` |
| `node scripts/prepare-assets.mjs` | exit 0; fixture copies verified; streams of 10 000 frames per profile match `golden.json` |
| `npx --no-install tsc -p tsconfig.json --noEmit` | exit 0 |
| `npx --no-install eslint .` | exit 0 |
| `npm test` | 33 tests, 33 passed |
| `make -n -f candidates/nativescript/candidate.mk …` (repository root) | all targets resolve |

App builds and device checks are recorded below as they are run.
