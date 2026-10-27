# Mobile Architecture Benchmark

A vendor-neutral, reproducible benchmark of mobile app architectures. Each candidate implements the same neutral
reference app: a long, live-updating list of items with selectable options, a detail screen and a remote-capable
feature. All candidates are measured with one shared method, the same deterministic workload and the same functional
acceptance checks.

> **Status: work in progress.** All eight candidates build and pass black-box acceptance on the Android emulator
> and the iOS simulator; descriptive early results from a Galaxy A16 phone, the emulator and the simulator are below
> (see [Results](#results-early-sessions-2026-102627)). No result is a ranking yet.

## What is being compared

The benchmark compares **whole mobile architectures**, not languages or UI toolkits in isolation. A candidate is
everything that ships: framework, runtime, build configuration, navigation, state management and packaging. Every
candidate runs the same reference app on the same workload, so differences in the numbers come from the
architecture, not from the app doing different work.

### Whole-app candidates

The entire app, every screen, is written in one framework.

| Id | Architecture | Android build | iOS simulator build |
| --- | --- | --- | --- |
| `native` | Fully native: Jetpack Compose (Android) and UIKit (iOS) | release | release |
| `flutter` | Flutter | release | debug (Flutter has no release simulator build) |
| `expo` | React Native with Expo | release | release |
| `repack` | React Native with Re.Pack and remote modules | release | release |
| `nativescript` | NativeScript (core + TypeScript) | release | release |

### Island candidates (native shell + cross-platform UI islands)

A brownfield architecture: the app is native, and a cross-platform runtime renders only some screens. All three
island candidates share one byte-identical native host (`candidates/_island-host`: Jetpack Compose on Android,
UIKit on iOS) that owns the List and Selection screens, navigation, data, the stream, persistence and restoration.
Only the Detail and Insights screens are islands: one embedded runtime renders both, from versioned JSON state
messages the host sends. Islands never hold their own copy of the data. The runtime starts at the first island open
(`mb.engine=lazy`, default) or during launch (`mb.engine=prewarm`).

| Id | Island runtime | Host ↔ island bridge | Android build | iOS simulator build |
| --- | --- | --- | --- | --- |
| `island-rn` | React Native (Hermes) via React Native Brownfield | asynchronous messages | release | release |
| `island-flutter` | Flutter add-to-app engine | asynchronous MethodChannel | release | debug (Flutter limitation) |
| `island-nativescript` | NativeScript V8 runtime, `@nativescript/core` views | synchronous native calls | release | release |

Comparing an island candidate with `native` shows what one embedded runtime costs inside an otherwise native app.
Comparing the island candidates with each other isolates the runtime, since the shell is identical. The island
protocol parser and view model are shared pure TypeScript (`candidates/_island-rn-ui`), used by the RN and
NativeScript islands; Flutter ports the same model to Dart.

Shared React Native code lives in `candidates/_rn-shared`. Each candidate's README lists its versions, its build
configuration, its deviations and what has been verified on each platform.

Debug builds (`island-flutter@debug` on the iOS simulator) are reported in their own section and never pooled with
release builds.

## The reference app (the workload)

Every candidate implements the same app:

- **List**: a long, live-updating item list with fixed 72 dp/pt rows, fed by a stream (replayed or from a server).
- **Selection**: three selectable options per item, with a persistent running total.
- **Detail**: a per-item screen.
- **Insights**: embedded in every candidate; delivered remotely only where the architecture supports it (for
  example Re.Pack remote modules).
- **Lifecycle**: navigation, background/foreground, process death and restoration, and stream recovery.

Fixtures are generated deterministically (seeded, integer fixed-point values) and every app reports a state
digest, so each candidate is shown to do equivalent work. See `design.md` for the normative contract.

## How it is run

1. **Build** each candidate with its own toolchain (`candidates/<id>/candidate.mk`). The benchmark runner never
   builds; it freezes each artifact by SHA-256 and installs from that copy.
2. **Acceptance gate**: each artifact must pass the shared black-box functional checks (`tools/acceptance/`) and
   hold an artifact-bound receipt. Acceptance is admission, not a score; without a valid receipt a candidate is
   reported `not-measured`.
3. **Session**: `tools/early-bench/` runs all admitted candidates on one device (Android emulator or iOS
   simulator) in a seeded, randomized, blocked order that is frozen before the device is touched. The apps emit
   timing markers that the runner collects.
4. **Report**: every output is labelled as an early, descriptive emulator/simulator session.

## Running a benchmark session

Reference devices: the Android emulator AVD `mobilebench_api37` (API 37, arm64) and the iOS simulator
`mobilebench-iphone` (iPhone 17, iOS 27.0). Outputs go under `results/local/`, which git ignores.

```sh
# 1. Build every candidate (per candidate: make build-<id>-android / build-<id>-ios)
make build-native-android build-native-ios   # ... and so on for each candidate

# 2. Acceptance: the black-box drivers check every built artifact on the running reference device and write
#    artifact-bound receipts to results/local/acceptance/<id>-<platform>/ (see tools/acceptance/README.md)
make acceptance-android
make acceptance-ios

# 3. Dry run: hash artifacts, verify receipts and print the schedule without measuring
make early-bench-android EARLY_BENCH_ARGS="--plan-only"

# 4. Measure. The default 30-minute budget covers a seeded subset of candidates (about 12 minutes each); give a
#    longer budget to measure all of them in one session
make early-bench-android EARLY_BENCH_ARGS="--budget-min 110 --watchdog-min 120"
make early-bench-ios EARLY_BENCH_ARGS="--budget-min 110 --watchdog-min 120"

# 5. Combine sessions into the Markdown report
node tools/early-bench/combine.mjs --in results/local/sessions --out results/local/summary.md
```

Rebuilding a candidate changes its artifact hash and invalidates its receipt, so rerun its acceptance before the next
session. Useful options: `--budget-min` caps session time, `--expect-artifact <id>:<platform>=<sha256>` requires an exact
build, and `--stream-source replay|server` selects the stream. If a session is killed, rebuild it with
`tools/early-bench/finalize.mjs`. The full option list is in `tools/early-bench/README.md`.

## Outcome and reports

Each session writes `results/local/sessions/<sessionId>/` containing:

- `manifest.json`: labels, design hash, plan, seed, environment, builds and counts
- `schedule.json`: the frozen run order
- `observations.jsonl`: one measured value (or a `failed` / `not-measured` status with its reason) per line, each
  linked to the raw lines it was parsed from
- `journeys.jsonl`, `harness.log.jsonl`, `progress.json`, and `raw/` holding every raw command output, redacted
  for privacy

`combine.mjs` reads those files and writes the **human-readable report** (`summary.md`): per-session medians and
pooled N / median / p95 / min / max for each candidate and metric, exact artifact sizes, debug builds in their own
section, and a shared-session view for comparing candidates side by side. The output is deterministic, and
values are pooled only when the method, environment, artifact and fixture all match. The current combined summary is
committed in `results/early-2026-10-27/` (the first, emulator/simulator only, in `results/early-2026-10-26/`).

## Results (early sessions, 2026-10-26/27)

Descriptive only, not a ranking: two Galaxy A16 phone sessions, two Android emulator sessions and up to four iOS
simulator sessions on one Apple silicon host, with no independent review and the instrumentation-overhead check
waived. Values are pooled medians (10–20 process-cold runs per startup/memory cell, 5 scroll runs of 8 seeded flings,
3 energy runs of 60 s). Full tables with p95, min/max, warm start, every frame metric, artifact hashes and
traceability: [results/early-2026-10-27/summary.md](results/early-2026-10-27/summary.md).

**Galaxy A16 phone (SM-A165F, Android 16), 2 sessions**

| Candidate | Cold first frame | Cold fully drawn | Idle PSS | Scroll janky | Scroll p99 frame | Energy, 60 s scroll | Skin temp after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| native | 257.0 ms | 260.5 ms | 48.69 MiB | 1.98 % | 33.5 ms | 0.635 mAh | 29.600 °C |
| island-flutter | 261.0 ms | 264.0 ms | 48.60 MiB | 2.41 % | 47.5 ms | 0.639 mAh | 29.650 °C |
| island-rn | 266.5 ms | 270.5 ms | 51.54 MiB | 2.31 % | 48.2 ms | 0.639 mAh | 29.650 °C |
| island-nativescript | 297.5 ms | 301.5 ms | 70.75 MiB | 2.79 % | 50.0 ms | 0.687 mAh | 29.750 °C |
| expo | 292.5 ms | 604.5 ms | 122.57 MiB | 2.05 % | 50.1 ms | 1.970 mAh | 29.750 °C |
| repack | 274.5 ms | 697.0 ms | 118.51 MiB | 1.72 % | 50.1 ms | 1.850 mAh | 29.700 °C |
| nativescript | 902.5 ms | 906.0 ms | 99.49 MiB | 1.28 % | 34.0 ms | 0.633 mAh | 29.800 °C |
| flutter | 458.5 ms | 458.5 ms | 108.29 MiB | 2.32 % | 50.1 ms | 0.548 mAh | 29.600 °C |

**Android emulator (API 37), 2 sessions**

| Candidate | Cold first frame | Cold fully drawn | Idle PSS | Scroll janky | Scroll p99 frame |
| --- | --- | --- | --- | --- | --- |
| native | 162.5 ms | 164.5 ms | 23.41 MiB | 5.24 % | 64.3 ms |
| island-flutter | 162.5 ms | 163.5 ms | 24.02 MiB | 9.56 % | 67.0 ms |
| island-rn | 165.0 ms | 167.0 ms | 26.88 MiB | 8.28 % | 66.3 ms |
| island-nativescript | 169.0 ms | 169.5 ms | 46.84 MiB | 9.90 % | 64.1 ms |
| expo | 160.5 ms | 348.5 ms | 107.23 MiB | 6.86 % | 52.9 ms |
| repack | 162.0 ms | 461.0 ms | 97.06 MiB | 7.13 % | 64.2 ms |
| nativescript | 321.5 ms | 324.5 ms | 77.99 MiB | 2.84 % | 56.7 ms |
| flutter | 667.0 ms | 667.0 ms | 66.64 MiB | 29.46 % | 84.0 ms |

**iOS simulator (iPhone 17, iOS 27)**

| Candidate | Cold to first usable UI | Idle footprint |
| --- | --- | --- |
| native | 376.1 ms | 17.95 MiB |
| island-flutter@debug | 432.1 ms | 19.03 MiB |
| island-rn | 394.4 ms | 18.74 MiB |
| island-nativescript | 387.0 ms | 18.58 MiB |
| expo | 1697.9 ms | 74.24 MiB |
| repack | 448.0 ms | 70.27 MiB |
| nativescript | 1787.7 ms | 44.94 MiB |
| flutter@debug | 785.3 ms | 109.16 MiB |

**Sizes (exact per artifact, MiB)**

| Candidate | APK | Android installed | Android download est. | iOS sim .app | iOS sim zip-9 est. |
| --- | --- | --- | --- | --- | --- |
| native | 1.33 MiB | 6.47 MiB | 1.26 MiB | 2.08 MiB | 0.57 MiB |
| island-flutter | 16.15 MiB | 21.74 MiB | 8.35 MiB | – | – |
| island-flutter@debug | – | – | – | 99.10 MiB | 30.95 MiB |
| island-rn | 15.42 MiB | 23.14 MiB | 7.16 MiB | 23.02 MiB | 6.12 MiB |
| island-nativescript | 34.57 MiB | 65.38 MiB | 17.08 MiB | 71.33 MiB | 22.52 MiB |
| expo | 27.75 MiB | 33.58 MiB | 11.16 MiB | 38.31 MiB | 10.09 MiB |
| repack | 19.17 MiB | 22.61 MiB | 7.65 MiB | 24.21 MiB | 6.73 MiB |
| nativescript | 30.10 MiB | 41.01 MiB | 12.72 MiB | 70.93 MiB | 22.42 MiB |
| flutter | 15.45 MiB | 16.11 MiB | 7.36 MiB | – | – |
| flutter@debug | – | – | – | 98.27 MiB | 30.76 MiB |

Notes:

- Scroll frames come from SurfaceFlinger presented-frame gaps on the app layer (works for every toolkit, Flutter
  included); janky = gap over 1.5× the refresh period, pauses over 100 ms between flings excluded (a lower bound).
- Energy is Android's batterystats power-model estimate for the app UID (software-unplugged over USB), not measured
  current. Thermals are the HAL skin temperature after the energy run.
- The two phone sessions agree within a few percent on every metric above.
- `expo` and `repack` energy (~3× the others) is app user-space CPU (~43 s vs ~14 s for native in a 60 s run; system
  CPU, wakelocks and network equal). `island-rn` loads the same React Native runtime with a native List and costs the
  same as native, so the cost sits in the React Native List under scrolling, most likely the default FlatList
  virtualization (`windowSize` 21, no cell recycling) in `candidates/_rn-shared/ui/src/screens/ListScreen.tsx`.
  These are untuned defaults, like every other candidate's standard list; not profiled per thread yet.
- Island candidates measure the native shell at startup (islands load lazily on first open).
- `@debug` iOS simulator builds (Flutter has no release simulator build) are never comparable with release builds,
  and are unstable: `flutter@debug` cold start was 2.29 s in one session and 0.78 s in the next on the same build,
  the whole difference before the first Dart code runs (debug engine start-up). Treat them as unreliable.
- One `island-flutter` phone scroll run ended with the app process gone (failed, not counted).
- Missing: Android installed size on the emulator (the DiskStats cache did not refresh; the phone has it), iOS
  scroll frames (the simulator reports no hitch or frame data), AAB download estimates (needs bundletool), and
  energy/thermals on the emulator and simulator (no battery or thermal model). Physical iPhone runs need code signing.

## What is measured today

| Measurement | Android phone | Android emulator | iOS simulator |
| --- | --- | --- | --- |
| Cold startup to first frame / fully drawn (FUI on iOS) | yes | yes | yes |
| Activity-warm startup | yes | yes | not applicable |
| Idle memory on the List screen | PSS | PSS | physical footprint |
| Scroll frames: count, janky %, p50/p90/p99 | yes | yes | unavailable |
| Energy (power-model estimate) | yes | not collected | not collected |
| Thermals (skin temperature, thermal status per block) | yes | not collected | not collected |
| Artifact, installed and download-estimate sizes | yes | artifact + download | `.app`, installed, zip-9 estimate |

There is **no composite score or overall ranking**; results are descriptive, per metric. A candidate/platform cell
becomes rankable only after accepted independent review and a passing eligibility audit (`tools/eligibility/`).
Method details: `tools/early-bench/README.md`.

## Current status

| Area | State |
| --- | --- |
| Candidates | 8 implemented; all build for Android and the iOS simulator (`flutter` and `island-flutter` iOS simulator builds are debug, a Flutter limitation) |
| Unit and contract tests | `make check` passes |
| Acceptance | Black-box drivers for Android and iOS (`tools/acceptance`); all 8 candidates pass all checks on both platforms, with `instrumentation-overhead` waived (design §6.7), which keeps results descriptive |
| Benchmark runner | Implemented (`tools/early-bench`); a dry run admits all 8 candidates on both platforms |
| Reference devices | Android AVD `mobilebench_api37` (API 37), physical Samsung Galaxy A16 (SM-A165F, Android 16, `--serial`) and iOS simulator `mobilebench-iphone` (iPhone 17, iOS 27.0) |
| Published results | Early sessions (2026-10-26/27), see [Results](#results-early-sessions-2026-102627) |

Next steps: early sessions on both platforms and their `summary.md` tables; then the shared BenchKit with its
A/B overhead experiment and physical devices, which are needed for eligible (rankable) results.

## Repository layout

- `fixtures/`: the deterministic workload generator (seeded, integer fixed-point values) and the generated
  fixtures with their checksums.
- `candidates/<id>/`: one directory per candidate, with `candidate.json` (self-description), `candidate.mk` (make
  targets) and a README.
- `candidates/_island-host/`, `candidates/_island-rn-ui/`, `candidates/_rn-shared/`: code shared between
  candidates (the native island host, the island protocol and view model, the React Native UI).
- `tools/`: benchmark tooling. Node.js built-ins only, managed with npm.
- `tools/acceptance/`: shared black-box check contract and verifier for artifact-bound acceptance receipts.
- `tools/eligibility/`: fail-closed audits for candidate readiness and publishable physical-device result sets.
- `design.md`: the normative workload, eligibility and reporting contract; every session records its content hash.

## Quick start

Requirements: Node.js 24.11.1 (see `.nvmrc`), npm and GNU Make. To build candidates you also need the platform
toolchains listed in each candidate's README (JDK 17, Android SDK, Xcode, Flutter, CocoaPods).

```sh
make help                                  # all targets and registered candidates
make check                                 # fixture, acceptance, eligibility and runner tests
make check-<id>                            # one candidate's checks, e.g. make check-island-nativescript
make build-<id>-android build-<id>-ios     # build one candidate
make artifacts-<id>-android                # print the built artifact path
```

## Provenance and potential bias

The initial implementations were ported from the maintainers' earlier prototypes. Optimisation expertise may differ
between candidates. Framework experts are invited to review and improve any candidate through pull requests. Changes
are judged by the same acceptance checks and measurement method. Candidate/platform cells remain ineligible for
ranking until their manifest records accepted independent review and the eligibility audit passes.

## License

Apache License 2.0, see [LICENSE](LICENSE).
