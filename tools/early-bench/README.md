# early-bench: early benchmark sessions on emulator / simulator

A small runner for early, descriptive benchmark sessions, written with Node.js built-ins only (no npm
dependencies). It measures every verified candidate with the same harness-free instruments, so that results are
comparable across candidates long before the full harness exists. The core harness adopts its method ids verbatim
and imports its sessions as `early-session` result sets, which are never eligible.

Every output of this tool carries these labels (summary, every table, every manifest and observation):

- EARLY SESSIONS: emulator/simulator, host busy, descriptive
- Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices
- not comparable with legacy or pilot numbers

Each session selects one explicit stream source (`--stream-source replay|server`). Candidates must declare the same
source in `candidate.json`; prose is never used to infer it, and mixed-source candidates are not measured together.
The runner also checks each candidate's machine-readable build declaration against `config/build-policy.json`; on
Android it independently verifies minimum SDK, target SDK and packaged ABI from the frozen APK with `aapt2`.
Instrumentation identity is also a comparison boundary. Candidate-local and shared implementations receive different
ids, so the shared-session table never places their timings side by side. A shared id requires an acceptance receipt
containing the instrumentation-overhead check.

## What a session is

One session = one device session on one platform (Android emulator AVD `mobilebench_api37`, or the iOS
simulator `mobilebench-iphone`, iPhone 17 on iOS 27.0). It covers the candidates passed with `--candidates`. Every
candidate must have a passing, artifact-bound receipt from the repository acceptance contract; missing, failed, stale
or mismatched receipts are `not-measured`. Runs use a seeded, blocked, randomized order: a randomized Latin square
when the block count is a multiple of the candidate count, otherwise
one Fisher-Yates permutation per block. Each block runs every candidate once. Debug-build variants
(`<id>@debug`, e.g. `flutter@debug` on the iOS simulator, where Flutter builds only debug) get their own blocks
after the release blocks of each scenario group, so they never take a position in a release block. The schedule
is frozen in `schedule.json` before the device is touched.

If the planned time exceeds `--budget-min`, a seeded subset of candidates is used (the `--anchor` candidate
first, then those with the fewest pooled journeys). The subset is recorded as an incomplete-block design.

The runner does not take any cross-process lock and never builds anything. It copies each artifact into
`--artifacts <dir>/<candidate>/<platform>/<sha256>/` and installs from that frozen copy.
`--expect-artifact <id>:<platform>=<sha256>` (full, or the abbreviated `<prefix>…<suffix>` form of a status
table) makes a candidate whose current artifact differs from the verified build `not-measured`.

Foreign emulators or booted simulators at session start abort the session by default (`--other-devices abort`;
`wait` waits up to `--other-devices-wait-s`, `record` continues and flags `other-devices-running`). The runner
never shuts down a device it did not boot.

## Scenarios and methods

| Scenario | Ref | Android | iOS simulator |
| --- | --- | --- | --- |
| `early.cold` (process-cold) | A1 | `startup.ttff/early-am-start-w/1`, `startup.ttfd_system/early-logcat-fully-drawn/1` | `startup.process_to_fui/early-ios-markers/1` |
| `early.warm` (activity-warm) | A3 | same two methods | not applicable (Android-only scenario) |
| `early.idle-memory` | D1 | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | `memory.ios.phys_footprint/early-mem-marker-background/1` |
| `early.size` (build unit) | E1–E3 | `size.android.apk_arm64/file-bytes/1`, `size.android.aab/file-bytes/1` | `size.ios.simulator_app/app-dir-file-bytes/1` (descriptive) |

Method ids have the form `<metricId>/<instrument>/<version>`; `lib/methods.mjs` holds each procedure. Early
scenario ids never equal benchmark scenario ids, and early methods are never pooled with driver methods of the
same metric. Metrics the early runner cannot produce (for example Android `startup.fui`, which needs Perfetto
trace processing; the logcat marker mirror is a control signal, never a timing source) are listed in the
manifest's `notCollected` with status and reason.

Journey details (every launch passes `mb.journey`, `mb.journeyMode=1` and `mb.profile`, recorded in
`launchConfig`):

- Android cold: `am force-stop`, 2 s, `logcat -c`, `am start -W -f 0x10008000 -n <component> --es mb.journey <id>
  --es mb.journeyMode 1 --es mb.profile <p>`, wait for the next `fui` line, 2 s, then the logcat dump. The wait
  listens to one long-lived `adb logcat -v epoch -s MobileBench:I` reader per session (restarted from the last
  seen timestamp if it exits); nothing is polled during a measured launch.
- Android warm: at every block start all candidates are force-stopped, so each measured warm journey is preceded
  by one tool-warmup launch to FUI (`role: tool-warmup`, retained, not analysed); then HOME stops the activity,
  2 s, and the same launch (NEW_TASK | CLEAR_TASK recreates the activity in the live process); `LaunchState`
  must be `WARM`.
- iOS cold: `simctl terminate`, 2 s, `simctl launch <udid> <bundle> -mb.journey <id> -mb.journeyMode 1
  -mb.profile <p>`, wait for the `fui` control line in the unified log, 2 s, background (another app is launched)
  so BenchKit flushes its marker buffer, read `Library/Caches/mobilebench/markers-<id>.jsonl`.
- Idle memory: as cold, then `--idle-s` seconds on the List screen before the memory read.
- FUI payload check: `rows == floor(h / 72) >= 1`, `sel` = the profile's selection count, `seq == 0`; on iOS also
  no `stream.connect` before `fui` in the marker buffer. Not checked, and recorded as such: `|h - h_ref| <= 1`
  (no layout reference without the calibration app) and, on Android, the `stream.connect` order (not mirrored to
  logcat; needs the trace).
- Resets: R-PROC (every candidate) at the start of every block and before each priming launch, plus per cold
  journey; R-DATA before each scenario group (Android `pm clear`; iOS uninstall + install + verify); R-INSTALL from
  the frozen copy with an installed-hash check (a mismatch makes the candidate `not-measured`); one unmeasured
  priming launch per candidate and group.
- Android ART: a shell equivalent of Macrobenchmark `CompilationMode.Partial(UseIfAvailable,
  warmupIterations = 0)`: `cmd package compile --reset`, the profile-installer broadcast,
  `cmd package compile -f -m speed-profile`, applied identically to every candidate. The dexopt state (parsed from
  the full `dumpsys package <pkg>` output) is read before and after every block; a change fails that candidate's
  journeys with `environment-violation` and the block is re-run once. An unreadable state never passes as
  "unchanged": the affected observations carry the limitation `art-state-unknown`.
- Device settings: the animation scales, font scale, accessibility state and always-finish-activities are read at
  session start and enter the environment's comparability key with the emulator's effective cores and memory;
  a change by the end of the session is flagged `device-settings-changed`. The stay-awake setting the runner
  switches on is restored at the end.

## Status taxonomy and raw data

Every observation is `measured`, `failed` (with a failure class), `unavailable`, `not-applicable` or
`not-measured` (with a reason); values are never zero-filled. A marker a candidate never emits makes the metric
`unavailable: marker-missing:*`; a marker that is missing in only some journeys is a `failed` journey. Crash
evidence is `candidate-crash`, ANR evidence `candidate-anr`. Journeys a session never started (watchdog, signal,
host sleep) are `not-measured` with reason `out-of-time:watchdog` or `session-aborted:<cause>`, and their journey
records have status `not-attempted`: they are never counted as candidate failures. Each measured observation lists
`rawRefs`: file, 1-based line and exact text of every line its value was read from.

Sizes are build-unit observations (`buildId`, no `journeyId`): one exact value per frozen artifact; the summary
prints exact bytes per build and never pools them into an N. Android APK reports also show compressed and
uncompressed bytes of entries classified as benchmark payload. If a bundler has fused that payload into app code,
the payload metric is explicitly unavailable rather than guessed or subtracted.

Session directory layout:

```
<out>/<sessionId>/
  manifest.json        session manifest: labels, design SHA-256, plan, seed, source identity, tool versions,
                       environment start/end, builds, resets, counts
  schedule.json        frozen blocked order
  source-manifest.txt  "<sha256>  <path>" per published file (tree-manifest algorithm, below)
  journeys.jsonl       one journey record per line (measured, priming, tool-warmup)
  observations.jsonl   one observation per line
  progress.json        live progress
  harness.log.jsonl    harness events
  raw/                 every raw command output a value was parsed from, the MobileBench logcat stream,
                       the emulator log (when this session booted it), the iOS unified-log stream
```

Privacy: every file the runner writes, including everything under `raw/`, passes through one redactor that
replaces the repository, output and artifact paths, the home directory, the host name, device serials, simulator
UDIDs and app container paths, in plain and slash-escaped (JSON) form. Serials and UDIDs become salted hashes
(not linkable across sessions). Raw values are parsed from the redacted text, so `rawRefs` match the files.

Environment manifests record the device configuration (AVD hardware profile, image, GPU mode, effective cores and
memory, reported refresh rate, or simulator device type and runtime build), host hardware class, OS, load average,
power source and `pmset -g therm` at session start and end. A gap of more than 5 s between the wall clock and the
uptime clock (host sleep) fails the session. `--watchdog-min` stops starting journeys and finalizes the files; the
caller enforces the hard stop (SIGTERM, then SIGKILL). SIGHUP is logged and ignored, so a detached session
survives the end of the terminal that started it. A killed session keeps `status: running` and is excluded by
`combine.mjs` until `finalize.mjs` rebuilds it (Android): every value is re-parsed from `raw/` with the live
parsers and classification rules; the journey in progress becomes `not-measured` / `interrupted`, journeys never
started `not-measured` / `not-attempted`, and facts only the killed process knew are recorded as not recorded
(limitations `environment-reconstructed-post-hoc`, `process-liveness-not-recorded`). The runner writes the
environment into the manifest as soon as the device is ready and appends one line per launch to `journal.jsonl`
(liveness, pid, FUI wait), which `finalize.mjs` uses when present.

Build provenance:

- Artifacts: SHA-256 (iOS bundles: `early-bench.entries-sha256/1`, a hash over sorted paths, kinds, lengths and
  contents) and bytes, build class (Android: from `aapt2 dump badging`; iOS: declared in `candidate.json`, an
  undeclared class makes the candidate `not-measured`).
- Source identity, algorithm `mobilebench-tree-manifest/1`: one line `<SHA-256 of the bytes>  <path>` per file of
  `git ls-files -co --exclude-standard` (read-only git), sorted by path bytes; `repoTreeSha256` (all lines),
  `scopeTreeSha256` (measurement scope, at start and end), `candidateTreeSha256[<id>]` and
  `buildInputSha256[<id>]` (own directory, `sharedBuildInputs` or `adapters[].path` from `candidate.json`, and
  `instrumentation/`, `domain-ports/`, `fixtures/`), executables and symlinks listed; `gitCommit: null` with
  `gitCommitReason: uncommitted-tree` while there is no commit.
- Per candidate: directory and shared-input hashes, lockfile hashes, versions and the `candidate.json` hash; tool
  versions (Node, adb, emulator, aapt2, xcodebuild) and the runner's own source hash.

## Usage

```
node tools/early-bench/session.mjs --platform android --repo . --out <sessions> --artifacts <frozen> \
  --candidates native,flutter --run-id <id> [--design design.md] \
  --acceptance-receipt native:android=<receipt.json> [--plan-only]
node tools/early-bench/combine.mjs --in <sessions> --out <summary.md> [--invalid-from <json>]
node tools/early-bench/finalize.mjs --session <sessions>/<id> --repo . --abort-reason <cause> [--ended-at <ISO>]
node tools/early-bench/dry-run.mjs --package <pkg> --am <file> --logcat <file> --meminfo <file>
node --test tools/early-bench/test/
```

The runner reads and hashes the design file itself; callers cannot attach an arbitrary design digest. `--plan-only`
resolves candidates, hashes artifacts and prints the plan and schedule without touching a device.
`combine.mjs` is deterministic (identical input gives byte-identical output). It pools observations only when
method id, environment (class, platform, host, device configuration and settings), artifact SHA-256, stream
source, fixture and build class match, treats each session as a block, prints per-session medians and pooled
N / median / p95 (Hyndman-Fan type 7) / min / max, keeps debug builds in a separate section and shows a
shared-session view for candidates that joined later: one line per candidate × artifact within each comparison
group, over the sessions every candidate of the group shares. It is descriptive only: no tests, rankings or
composite scores.
