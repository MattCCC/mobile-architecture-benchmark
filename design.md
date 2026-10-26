# Mobile Architecture Benchmark Design

Status: normative draft 1. Every eligible result set records the SHA-256 of these exact bytes. A change to a
normative rule creates a new design revision; existing results keep their recorded hash.

## 1. Purpose and claims

The benchmark compares implementations of one reference mobile application. Results describe a named candidate,
artifact, platform, device, operating-system build, scenario, method and fixture. They do not establish that one
programming language or architecture is universally faster.

Android and iOS are separate populations. Results from virtual devices, debug builds, different method ids, different
stream sources or different fixture versions are never ranked together. Eligible result sets contain no composite
score.

## 2. Fairness principles

1. Equal observable behavior is an admission requirement, not an assumption.
2. Candidate-specific implementation choices are allowed; candidate-specific workloads and measurement boundaries
   are not.
3. All exclusions, failures, unavailable measurements and deviations remain visible.
4. The artifact that passes acceptance is the artifact that is measured, identified by its content hash.
5. Candidate ordering is blocked and randomized. A result intended for comparison uses shared device sessions.
6. Framework-native constraints are reported as results or limitations, never silently repaired by a substitute
   build or code path.

## 3. Eligible and descriptive result sets

An eligible result set requires release builds on physical devices, the core acceptance suite, shared BenchKit
instrumentation with its overhead check, registered benchmark scenarios and methods, a complete environment record,
and no unresolved eligibility deviation. Emulator, simulator, debug, interim-instrumentation and `early.*` sessions
are descriptive only.

## 4. Reference application

Every candidate exposes the same four screens: List, Selection, Detail and Insights. It uses the committed fixture,
three options per item, one selection at most per item, fixed-point integer values, and the state and Insights digest
formats specified in `fixtures/README.md`.

The List has a 72 dp/pt row extent, a persistent summary, navigation to Selection and Insights, and navigation from an
item label to Detail. Visible text, accessibility identifiers and interaction semantics are acceptance requirements;
visual implementation details native to a toolkit are not scored.

## 5. State and lifecycle

### 5.9 Restoration

The app atomically persists route, detail item when applicable, selection, values and last applied sequence on the
defined background checkpoint. A restore launch renders the restored state before reconnecting from the next
sequence. Corrupt or incompatible records fail closed to the initial fixture and emit the specified error marker.

## 6. Launch configuration and instrumentation

### 6.1 Marker record

A marker contains the journey id, event name, monotonic timestamp, ordinal and event payload. Candidate code cannot
backdate a marker or derive a benchmark duration itself.

### 6.2 Clocks

Durations use the platform monotonic clock or a named system instrument. Wall time is provenance only, except for the
documented iOS process-start correlation.

### 6.3 BenchKit

Eligible artifacts use the shared platform BenchKit. Candidate-local copies are permitted only in descriptive runs
and must be declared as deviations.

### 6.5 Launch keys

The required launch keys are `mb.journey`, `mb.journeyMode`, `mb.profile`, `mb.source`, `mb.server`, `mb.session`,
`mb.token`, `mb.dataset`, `mb.restore`, `mb.remote`, `mb.bridgeBench` and `mb.layoutProbe`. Unknown `mb.*` keys and
unsupported non-default values emit an error and make the affected acceptance scenario fail.

### 6.6 First usable UI

FUI occurs only after the summary and every fully visible initial list row have laid out and painted with initial
state (`seq=0`). The required row count is `floor(listHeight / 72)` and is at least one. Stream connection begins only
after FUI. The acceptance driver independently checks the list bounds and visible accessibility tree.

### 6.7 Instrumentation overhead

Before eligibility, matched instrumented and non-instrumented builds run an A/B overhead experiment. The registered
threshold and raw observations are published. Failure or absence of this experiment makes the result descriptive.

## 7. Data, stream and Insights

### 7.1 Insights

Insights shows the five highest option-A values with lower item index breaking ties, plus the five option-B buckets
specified by the fixture contract.

### 7.2 Dataset

The default dataset is `representative`. `small` is for functional checks; `stress` is a separately reported scaling
scenario. A result always records the fixture version, profile and checksum.

### 7.5 Stream

The eligible live-update scenario uses the common local WebSocket server and identical wire frames. Bundled replay is
a separate transport scenario and must not be pooled or ranked with WebSocket results.

### 7.6 Digests

State and Insights digests match the golden vectors at sequences 0, 100, 1000 and 10000.

### 7.7 Ordering and recovery

Duplicates are ignored, gaps reconnect from the next required sequence, restoration resumes from `lastSeq + 1`, and
checkpoint/end frames are applied only after preceding updates.

## 8. Functional acceptance

### 8.1 Screens

The four reference screens and their required accessibility identifiers must be reachable by the black-box driver.

### 8.2 Initial state

Labels, values, selected count and total equal the golden sequence-zero state.

### 8.3 List geometry

Rows have the fixed extent and the independently observed visible-row count matches the FUI payload.

### 8.4 Navigation

List-to-Selection, List-to-Detail, List-to-Insights and back navigation preserve live state.

### 8.5 Selection

Tapping an unselected option selects it; tapping another option replaces it; tapping the selected option deselects
it. Count and total update after the rendered response.

### 8.6 Live updates

An update changes exactly its target row and all derived visible values. Checkpoint digests match the reference.

### 8.7 Background and foreground

The app checkpoints on background and resumes without losing or double-applying state.

### 8.8 Restore

A process-cold restore returns to the recorded route and state and continues at the next stream sequence.

### 8.10 Remote feature

Insights is the reference feature. Embedded delivery is required for every candidate. Independently delivered remote
code is tested only where the architecture supports it and is reported as a separate capability, not a universal
performance score.

### 8.12 Error behavior

Invalid configuration, corrupt persistence, stream gaps and remote verification failures emit stable error codes and
do not silently fall back to a different measured workload.

## 9. Reset procedures

R-INSTALL installs the frozen accepted artifact. R-DATA clears application data. R-PROC terminates the candidate
process. Each scenario declares its reset sequence; runners record every completed reset.

## 10. Scenarios

### 10.1 Startup

Process-cold, offline process-cold, network-dataset process-cold and Android activity-warm startup are separate
scenarios. FUI and first-frame methods retain distinct ids.

### 10.6 Memory

Idle memory is read after process-cold FUI and a fixed idle window while the common stream workload runs. The
checkpoint and memory type are method properties.

## 11. Measurements

Each method id is `<metric>/<instrument>/<version>`. A procedure change increments the version. Raw observations cite
their source records. Missing values are unavailable, failed or not measured; they are never zero-filled.

## 12. Experimental design

Candidates run in randomized complete blocks on one device session. A Latin square balances positions when possible.
The schedule is frozen before device contact. Thermal state, power, host activity, device settings and tool versions
are recorded. Confirmatory reports predeclare sample counts and exclusion rules; incomplete blocks remain descriptive.

## 13. Builds

### 13.1 Android

Measurement APKs are release, minified where supported, profileable, arm64-only and built for the same declared
minimum and target SDK policy. Store AABs are additional build units and are not substituted for APK measurements.

### 13.2 iOS

Eligible measurements use signed release device builds for the same minimum deployment target and device family.
Simulator bundles and unsigned device bundles are descriptive size/build artifacts only.

### 13.3 Candidate identity

Candidate ids are stable report keys. `repack` is the canonical id of the React Native Re.Pack candidate.

## 14. Candidate policy

### 14.1–14.4 Implementations

Native, Flutter, NativeScript and React Native candidates may use their production toolkit primitives. Shared app
code is allowed where it is an intentional property of the candidate family and is recorded in build provenance.

### 14.6 Versions

Exact framework, dependency and toolchain versions live in `candidate.json` and lockfiles. A measured artifact is
bound to those files by the build-input hash. Version upgrades create new artifacts and comparison cells.

### 14.7 Capability applicability

Unsupported remote-code or bridge capabilities are `not-applicable` with a technical reason. They do not receive zero
cost, a synthetic score or an embedded substitute under the remote-capability method.

## 15. Artifacts and size

### 15.2 Size reporting

Raw artifact bytes, installed bytes and download estimates are distinct methods. Reports show benchmark-payload bytes
separately where extractable. Cross-format values such as APK, AAB and simulator `.app` are never ranked as one metric.

## 20. Reporting

### 20.4 Statistics

Reports show every candidate, status and limitation. Descriptive reports give per-session summaries and distribution
statistics without significance claims. Confirmatory analysis uses the preregistered unit of analysis and retains the
session/block structure. No composite score is permitted.

## 31. Eligibility checklist

An eligible result requires: committed design bytes; registered methods and schemas; shared acceptance drivers;
passing acceptance for the exact artifact; shared calibrated BenchKit; physical-device release builds; complete
blocks; common fixture and stream source; recorded resets and environment; immutable raw evidence; and independent
review of candidate-specific deviations. Any unmet item is recorded and makes the result descriptive.
