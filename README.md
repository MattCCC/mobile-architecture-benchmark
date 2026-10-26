# Mobile Architecture Benchmark

A vendor-neutral, reproducible benchmark of mobile app architectures. Each candidate implements the same neutral
reference app: a long, live-updating list of items with selectable options, a detail screen and a remote-capable
feature. All candidates are measured with one shared method, the same deterministic workload and the same functional
acceptance checks.

> **Status: work in progress.** No results are published yet. Early runs on the Android emulator and the iOS
> simulator are pipeline validation only. They are not representative of physical devices and are not part of
> this repository.

## Candidates

| Id | Architecture |
| --- | --- |
| `expo` | React Native with Expo |
| `repack` | React Native with Re.Pack and remote modules |
| `nativescript` | NativeScript |
| `flutter` | Flutter |
| `native` | Fully native: Jetpack Compose (Android) and UIKit (iOS) |
| `island` | Native shell with cross-platform UI islands (planned) |

Shared React Native code lives in `candidates/_rn-shared`. Each candidate's README lists its versions, its build
configuration and what has been verified on each platform.

## Repository layout

- `fixtures/`: the deterministic workload generator (seeded, integer fixed-point values) and the generated
  fixtures with their checksums.
- `candidates/<id>/`: one directory per candidate, with `candidate.json` (self-description), `candidate.mk` (make
  targets) and a README.
- `tools/`: benchmark tooling. Node.js built-ins only, managed with npm.
- `tools/acceptance/`: shared black-box check contract and verifier for artifact-bound acceptance receipts.
- `tools/eligibility/`: fail-closed audit separating descriptive implementations from independently reviewed,
  publishable comparison cells.
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
