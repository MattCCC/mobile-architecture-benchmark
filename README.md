# Mobile Architecture Benchmark

A vendor-neutral, reproducible benchmark of mobile app architectures. Each candidate implements the same neutral
reference app: a long, live-updating list of items with selectable options, a detail screen and a remote-capable
feature. All candidates are measured with one shared method, the same deterministic workload and the same functional
acceptance checks.

> **Status: work in progress.** No results are published yet. Early runs on the Android emulator and the iOS
> simulator are pipeline validation only. They are not representative of physical devices and are not part of
> this repository.

## What is being compared

The benchmark compares **whole mobile architectures**, not languages or UI toolkits in isolation. A candidate is
everything that ships: framework, runtime, build configuration, navigation, state management and packaging. Every
candidate runs the same reference app on the same workload, so differences in the numbers come from the
architecture, not from the app doing different work.

| Id | Architecture | Status |
| --- | --- | --- |
| `native` | Fully native: Jetpack Compose (Android) and UIKit (iOS) | runnable |
| `flutter` | Flutter | runnable |
| `expo` | React Native with Expo | runnable |
| `repack` | React Native with Re.Pack and remote modules | runnable |
| `nativescript` | NativeScript | runnable |
| `island-rn` | Native shell with React Native Detail and Insights islands | planned |

`island-rn` is a brownfield setup: native List and Selection screens, with Detail and Insights as React Native
islands sharing one runtime. The native host owns data, streaming, navigation, restoration and state; the RN code
ships as an Android AAR and an iOS XCFramework via React Native Brownfield. Work lives in
`candidates/_island-host`, `candidates/_island-rn-ui` and `candidates/island-rn`; it is not yet registered in the
Makefile and cannot be built or measured through the standard interface.

Shared React Native code lives in `candidates/_rn-shared`. Each candidate's README lists its versions, its build
configuration and what has been verified on each platform.

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

Example for `native` and `flutter` on the Android emulator (AVD `mobilebench_api37`). On iOS use
`--platform ios` with the simulator `mobilebench-iphone`. Write outputs under `results/local/`, which git ignores.

```sh
# 1. Build the release artifacts and print their paths
make build-native-android build-flutter-android
make artifacts-native-android artifacts-flutter-android

# 2. Each artifact needs a passing acceptance receipt from the platform acceptance driver
#    (see tools/acceptance/README.md), e.g. results/acceptance/native-android/receipt.json

# 3. Dry run: resolve candidates, hash artifacts and print the schedule without touching a device
node tools/early-bench/session.mjs --platform android --repo . \
  --out results/local/sessions --artifacts results/local/frozen \
  --candidates native,flutter --run-id my-run \
  --acceptance-receipt native:android=results/acceptance/native-android/receipt.json \
  --acceptance-receipt flutter:android=results/acceptance/flutter-android/receipt.json \
  --plan-only

# 4. Run it for real: the same command without --plan-only

# 5. Combine one or more sessions into a Markdown summary
node tools/early-bench/combine.mjs --in results/local/sessions --out results/local/summary.md
```

Useful options: `--budget-min` caps session time, `--expect-artifact <id>:<platform>=<sha256>` requires an exact
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
values are pooled only when the method, environment, artifact and fixture all match. No session results are
committed to this repository yet.

## What is measured today

| Measurement | Android emulator | iOS simulator |
| --- | --- | --- |
| Cold startup to first usable / fully drawn UI | yes | yes |
| Activity-warm startup | yes | not applicable |
| Idle memory on the List screen | PSS | physical footprint |
| Artifact size | APK (arm64) and AAB | simulator `.app` |

**Not measured yet:** frame performance and jank, energy, thermals, installed or download size, and anything on
physical devices. There is **no composite score or overall ranking**; results are descriptive, per metric. A
candidate/platform cell becomes rankable only after accepted independent review and a passing eligibility audit
(`tools/eligibility/`). Method details: `tools/early-bench/README.md`.

## Repository layout

- `fixtures/`: the deterministic workload generator (seeded, integer fixed-point values) and the generated
  fixtures with their checksums.
- `candidates/<id>/`: one directory per candidate, with `candidate.json` (self-description), `candidate.mk` (make
  targets) and a README.
- `tools/`: benchmark tooling. Node.js built-ins only, managed with npm.
- `tools/acceptance/`: shared black-box check contract and verifier for artifact-bound acceptance receipts.
- `tools/eligibility/`: fail-closed audits for candidate readiness and publishable physical-device result sets.
- `design.md`: the normative workload, eligibility and reporting contract; every session records its content hash.

## Quick start

Requirements: Node.js 24.11.1 (see `.nvmrc`), npm and GNU Make. To build candidates you also need the platform
toolchains listed in each candidate's README (JDK 17, Android SDK, Xcode, Flutter, CocoaPods).

```sh
make help
make check
```

## Provenance and potential bias

The initial implementations were ported from the maintainers' earlier prototypes. Optimisation expertise may differ
between candidates. Framework experts are invited to review and improve any candidate through pull requests. Changes
are judged by the same acceptance checks and measurement method. Candidate/platform cells remain ineligible for
ranking until their manifest records accepted independent review and the eligibility audit passes.

## License

Apache License 2.0, see [LICENSE](LICENSE).
