# Acceptance receipts

## Running the drivers

```sh
make acceptance-android   # every candidate on the running AVD mobilebench_api37
make acceptance-ios       # every candidate on the simulator mobilebench-iphone (iPhone 17, iOS 27.0)
node tools/acceptance/android.mjs --candidate native     # one candidate
node tools/acceptance/ios.mjs --candidate native --udid <id>
```

The drivers are black-box: they install the frozen artifact (`make artifacts-<id>-<platform>`), operate the app
through its accessibility tree and read its marker mirror (`mb.markerMirror=all`), exactly as a user and the runner
see it. Every check is decided in `checks.mjs` against `model.mjs`, which replays the committed fixture and the
generator's update stream:

| Check | What is verified |
| --- | --- |
| `initial-state` | FUI at seq 0 with the golden selection count; visible labels and selected options exact; values and total consistent with the stream window |
| `build-policy` | declared and actual minimum OS / SDK, target, ABI or arch, package or bundle id, not debuggable (Android) |
| `instrumentation-overhead` | waived for early sessions (see below) |
| `list-geometry` | 72 dp/pt rows; fully visible row count equals the FUI payload and `floor(listHeight / 72)` |
| `navigation` | List → Selection → List → Detail → List with live, consistent state |
| `insights` | top 5 by option A and the option-B buckets equal the reference at a sequence in the window; `Source: embedded`; `remote.ready` |
| `selection-semantics` | select, replace and deselect an option; count and total follow |
| `live-update` | the background checkpoint's state digest equals the reference digest at its sequence |
| `background-foreground` | resume continues at checkpoint + 1; the next checkpoint digest equals the reference |
| `restore` | process-cold restore returns to `detail/2` with its state and resumes at checkpoint + 1 |
| `error-behavior` | unknown launch key -> `launch-config` error; unreadable restore record -> `persist-read` and the initial fixture |

Android dumps the accessibility tree with `android-dump/MbDump.java` (built with the SDK's `javac`/`d8` and run
through `app_process`), because `uiautomator dump` gives up on continuously updating screens. iOS runs an XCUITest
command server (`ios-driver/`) that the Node adapter drives through files in the simulator-shared file system.
Receipts and evidence are written to `results/local/acceptance/<id>-<platform>/`; `make early-bench-<platform>`
passes every receipt that still matches its artifact to the runner (`session-args.mjs`).

## Receipt format

The platform acceptance drivers produce `mobilebench.acceptance-receipt/1.0.0` JSON only after executing every check
in `contract.json` against one frozen artifact. The receipt binds the outcome to the candidate, platform, artifact
SHA-256 and normative design SHA-256. It also hashes at least one retained evidence file.

The early runner requires one passing receipt per candidate:

```sh
node tools/early-bench/session.mjs ... \
  --acceptance-receipt native:android=results/acceptance/native-android/receipt.json
```

Receipt shape:

```json
{
  "schema": "mobilebench.acceptance-receipt/1.0.0",
  "suiteId": "mobilebench.acceptance/1",
  "status": "passed",
  "candidateId": "native",
  "platform": "android",
  "artifactSha256": "<64 hex>",
  "designSha256": "<64 hex>",
  "checks": [{ "id": "initial-state", "status": "passed" }],
  "evidence": [{ "path": "evidence.jsonl", "sha256": "<64 hex>" }]
}
```

`checks` must contain every id in `contract.json`. A missing or failed check, changed evidence file, mismatched artifact
or mismatched design rejects the candidate.

A check listed in the contract's `descriptiveWaivable` may instead carry `"status": "waived"` with a non-empty
`reason`. Today that is only `instrumentation-overhead`: design §6.7 makes a result without the A/B overhead
experiment descriptive, not inadmissible. A waived receipt admits the build to early (descriptive) sessions; the
session manifest records the waiver and the eligibility audit rejects every result set that contains one. Receipts and evidence belong under ignored local results until a complete
result set is deliberately published.
