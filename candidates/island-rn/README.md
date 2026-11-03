# React Native islands candidate

The shared native host owns Selection, navigation, authoritative state, persistence, restoration and replay.
One React Native/Hermes runtime renders **List (including its summary), Detail and Insights**. List opens at startup,
so the default `mb.engine=lazy` includes runtime initialization in time to fully drawn. `prewarm` starts that same
runtime earlier during launch. The native header/status row may appear before the island, so first frame and fully
drawn remain distinct measurements.

The island holds a render cache of host snapshots and per-row updates. Taps send intents to the host; the host
updates selection and returns the row and summary. Fully drawn requires the island's actual list layout, visible
row paints and summary paint. Navigation and restoration continue to use the native host.

## Build and check

Requirements are the root requirements plus JDK 17, Android SDK 37, Xcode 27.1 and CocoaPods 1.17.

```sh
make check-island-rn
make build-island-rn-android
make build-island-rn-ios
make artifacts-island-rn-android
make artifacts-island-rn-ios
```

The Android build first creates `rn/android/islands/build/outputs/aar/islands-release.aar`, then links it into the
minified arm64 release host APK. The iOS build generates its Xcode project deterministically, installs the pinned
React Native pods and creates an arm64 release simulator app.

## Benchmark registration

The candidate id is `island-rn`. Include it with other candidates only after the exact built artifact has passed the
shared acceptance contract and has an artifact-bound receipt:

```sh
node tools/early-bench/session.mjs \
  --platform android --repo . \
  --out results/local/sessions --artifacts results/local/artifacts \
  --candidates native,island-rn \
  --acceptance-receipt native:android=results/acceptance/native-android/receipt.json \
  --acceptance-receipt island-rn:android=results/acceptance/island-rn-android/receipt.json \
  --run-id android-native-vs-islands
```

The runner records `architectureClass=native-shell-cross-platform-ui-islands`, the complete shared-host/UI build
inputs, replay stream source, instrumentation id and artifact hash. Consequently it compares the candidate within the
same replay/method/environment cell without pooling it with server-stream or differently instrumented observations.

## Current limitations

- Independently delivered remote island code and the bridge micro-benchmark are not implemented.
- Instrumentation is an interim candidate-local host core plus RN forwarder, so sessions are descriptive.
- A passing shared acceptance receipt is still required; registration never bypasses behavioral equivalence.

The Android AAR uses Gradle 9.4.1 with RN's Kotlin 2.2.0 plugin (AGP 9.2.1). The native host uses the native
candidate's Gradle 9.8.2 wrapper, AGP 9.4.1 and Kotlin 2.4.21. These are separate builds: Gradle 9.8's embedded
Kotlin metadata cannot be read by RN's Kotlin 2.2 compiler. Both toolchains are recorded in `candidate.json`.
