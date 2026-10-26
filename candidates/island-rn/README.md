# React Native islands candidate

This candidate keeps the application shell native and embeds React Native only for Detail and Insights. Android uses
Jetpack Compose and packages the RN islands as a Brownfield AAR. iOS uses UIKit and links the same RN/Brownfield island
runtime through CocoaPods. One Hermes runtime serves both island screens; `mb.engine=lazy` (the default) starts it on
the first island open, while `mb.engine=prewarm` starts it during launch.

The native shell owns the fixture, live state, selection, list, navigation, persistence, restoration and replay
stream. Islands receive versioned JSON snapshots and updates and never become a second source of truth.

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
