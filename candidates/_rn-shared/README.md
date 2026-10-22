# `_rn-shared`: shared code of the React Native candidates

Support directory (no `candidate.json`; skipped by candidate discovery). The `expo` and `repack` candidates render
the same screens from this code, so differences between them reflect the architecture (Expo + Metro + expo-router
vs Re.Pack + Rspack + Module Federation + React Navigation), not the UI code.

| Path | Content |
|---|---|
| `ui/src/domain/` | Neutral domain model, pure TypeScript: fixture types, store with per-item subscriptions, selection rules, Insights, state / Insights digest text, pure-JS SHA-256, display formatting without locale APIs, launch configuration parsing and validation, restoration record v2 |
| `ui/src/stream/` | Data-source interface (`FrameSource`), the in-app replay source (default), the WebSocket source for the local server, and the stream client rules (order, duplicates, gaps, six status words, stale / reconnect timers, checkpoint and resume frames) |
| `ui/src/app/` | Session (startup sequence, FUI / restore gate before the stream connects, checkpoints, background record, foreground resume, activity-warm reset), React runtime and contexts, assets, AsyncStorage persistence |
| `ui/src/bench/` | JS facade over the BenchKit TurboModule and the draw-probe component |
| `ui/src/components/`, `ui/src/screens/` | List (normative bands), Selection, Detail (animated panel), Insights (self-contained, also built into the Re.Pack remote), Error |
| `ui/test/` | Unit tests (`node --test`, no dependencies): digests against `fixtures/v1/golden.json`, stream schedule and catch-up, client rules, restoration |
| `rn-benchkit/` | `@mobilebench/rn-benchkit`, linked into each app with `file:../_rn-shared/rn-benchkit`: TurboModule `MobileBenchKit` (synchronous JSI methods + one Promise method) and Fabric component `MobileBenchProbe`; Android Kotlin, iOS Objective-C++ |
| `tools/` | `gen-assets.mjs` (verified fixture copy + verified stream asset), `check-lock.mjs` (public registry + exact pins), `pin-exact.mjs`, `android-env.sh` (JDK 17 / SDK resolution), `ensure-keystore.sh` (local Android release key), `ensure-signing-keys.mjs` (remote-module code-signing keys) |
| `rn-shared.mk` | Shared make logic (`check-rn-shared`), included by both candidate.mk files with an include guard |

Shared code has no `node_modules`: every bare import resolves from the consuming app (Metro `resolveRequest`,
Rspack `resolve.modules`, TypeScript `paths`), so each app bundles it against its own pinned dependencies.
`.keys/` (local signing material) is gitignored and never committed.

## Instrumentation (wrapper of design §6)

`MobileBenchKit` implements the BenchKit calls the RN apps need until the shared C-ABI core
(`instrumentation/android-benchkit`, `instrumentation/ios-benchkit`) exists; the integration step then makes the
TurboModule and the probe forward to that core.

- Markers: Android zero-length `android.os.Trace` sections `mb|event|n|payload` plus a logcat mirror (tag
  `MobileBench`); iOS a pre-allocated ring buffer on `CLOCK_UPTIME_RAW`, os_signpost events, an os_log mirror and a
  Darwin notification per driver-visible marker, flushed to `Library/Caches/mobilebench/markers-<journey>.jsonl`.
  Every JS call is synchronous (JSI); the timestamp is taken inside the call.
- FUI gate in native code: the list probe reports the list container height at native layout, every row probe
  (`fui0`) and the summary probe report their first draw from the draw callback; `fui` is emitted from the draw that
  completes rows `0 … kReq−1` + summary, followed by `reportFullyDrawn()` (Android, posted to the main thread).
- Token markers from core state: `resp` (`rev:<n>`), `screen` (`nav:<n>`), `resume` (`fg:<n>`), `restore`
  (`restore:<route>:<anchor>`), `remote.ready` (`ready:<version>:<open>`); a token change forces a redraw.
- Lifecycle: an Android `ContentProvider` registers activity callbacks at process start (`launch ss=<0|1>`, `bg`,
  `fg`, launch configuration from the Intent extras) and the accessibility listener (`a11y`); iOS observes the
  application notifications from `+load` and reads `-mb.<key> <value>` launch arguments.

PoC additions to the contract (recorded as deviations in each candidate.json): the mirror line carries
`t=<monotonic ns> w=<wall us>` after the payload; `state` payloads start with `k=<k>;`; diagnostic markers
`list.layout` and `bridge`; `err code=launch-config-unknown-key;n=<count>` for unknown launch keys.

## Accessibility ids

`testID` maps to the Android resource-id and the iOS `accessibilityIdentifier` (design §8.12). A `testID` alone keeps
a Fabric view but its children are still mounted into the nearest ancestor that forms a stacking context, so the
id-bearing node would have no children in the accessibility tree. Containers whose children are part of their
contract (`mb.insights.top`, `mb.summary`) therefore set `collapsable={false}`. Rows are unchanged (no extra
stacking context per list cell): `mb.row.<i>` is a leaf in the native tree, drivers address `mb.row.<i>.label` and
`mb.row.<i>.opt.<a|b|c>` directly. Screen roots set `collapsable={false}` (`ScreenRoot`).

## Data source

Default: `ReplaySource` replays the first 10000 messages of the profile's deterministic stream, generated at build
time by `tools/gen-assets.mjs` with `updateStream` from `fixtures/generator/lib.mjs` and verified against the
`stream.sha256` in `fixtures/v1/golden.json`; message k is due at t0 + (k − from) / rate on the monotonic clock, so
a reconnect after background catches up like the server. `mb.count=<n>` ends the replay after n messages (end frame,
then a checkpoint 500 ms later). `mb.source=websocket` with `mb.server=ws://<host>:<port>` switches to the local
server's stream without any other change.

## Checks

`make check-rn-shared` (from the repository root, after the root Makefile includes the candidate files) or
`cd candidates/_rn-shared/ui && node --test test/domain.test.ts test/stream.test.ts test/session.test.ts`.
