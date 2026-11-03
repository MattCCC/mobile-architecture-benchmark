# Kotlin Multiplatform with shared Compose UI

`kmp` is a whole-app candidate. Android and iOS use the same Kotlin state model, per-row observable state,
List, Selection, Detail, Insights, navigation, animation, replay scheduler and restoration logic in
`shared/src/commonMain`. Android runs Jetpack Compose on ART; iOS runs Compose Multiplatform with Kotlin/Native
and Skia. The List is part of the first shared composition and the fully drawn gate waits for its summary and
every fully visible initial row to draw at sequence zero. Replay starts only after that gate (or the restored
screen's draw).

The common screens and domain rules are adapted from this repository's native Android reference implementation.
Native adapters supply file access, SHA-256, monotonic clocks, lifecycle callbacks and candidate-local BenchKit.
They do not implement a separate application state model. iOS launch configuration and instrumentation are adapted
from the native iOS reference; the UI draw callbacks come from Compose `drawWithContent`.

## Build and validate

Requires JDK 17, Android SDK 37, Xcode, an iOS simulator runtime, Node and the Ruby `xcodeproj` gem (the existing CocoaPods installation supplies it). Set `JAVA_HOME` and
`ANDROID_HOME` as for the native candidate. Gradle resolves the pinned dependencies; the first iOS build downloads
the Kotlin/Native compiler and LLVM toolchain.

```sh
make build-kmp-android
make build-kmp-ios
make check-kmp
node tools/acceptance/android.mjs --candidate kmp --serial <device-serial>
node tools/acceptance/ios.mjs --candidate kmp
```

Android produces an arm64-only, minified, profileable release APK with minSdk 24 and targetSdk 36, signed with the
repository's local measurement key. The iOS simulator app links the optimized release Kotlin/Native framework;
it is a release build. `make build-kmp-ios-device MB_IOS_TEAM_ID=<team>` builds the `iosArm64` release framework and signed device app.
Physical iOS signing requires your team and provisioning; no physical iOS run is claimed.

`prepare-kmp` generates the same bundled replay bytes as other candidates and verifies every fixture and stream
against `fixtures/v1/golden.json`. Shared tests cover selection, stream ordering, formatting, restoration, Insights
and platform SHA-256. The same conformance test runs on Android/JVM and iOS and verifies all three profiles at the golden checkpoints
0, 100, 1000 and 10000. Black-box acceptance is required for the exact artifact before any measured session.

## Versions and boundaries

Versions are recorded in `candidate.json`: Kotlin/Compose compiler 2.4.21, Compose Multiplatform 1.12.2, Gradle
9.7.0, AGP 9.3.1, and the Navigation 2.10.0-rc01 published with that Compose release. The library uses the
[Android KMP plugin](https://developer.android.com/kotlin/multiplatform/plugin) and a separate Android application
module. Pins follow the [Kotlin compatibility table](https://kotlinlang.org/docs/multiplatform/multiplatform-compatibility-guide.html)
and [Compose release components](https://github.com/JetBrains/compose-multiplatform/releases/tag/v1.12.2).
The installed Xcode 27.1 is newer than the Xcode version listed in Kotlin's compatibility table; this is recorded
as a toolchain confound, alongside the Navigation release-candidate version.

Bundled replay is the only update transport. Files are read and parsed on a coroutine worker; delivery and state
mutation occur on the main dispatcher. The absolute monotonic schedule survives background/foreground reconnects.
Network datasets, a WebSocket server and independent remote executable features are unsupported. Unsupported
launch values emit an error. The canonical restoration record is written via a temporary file and atomic rename.

Instrumentation is candidate-local and uncalibrated, and independent review is pending. Results are descriptive
until the shared instrumentation and physical-device eligibility requirements are met. Android DEX combines app
and Compose code; the iOS executable statically links Kotlin/Native and Compose/Skia. Size reports cannot separate
those framework bytes from application code.

## Validation (2026-11-03)

Android release and iOS simulator release builds pass. Shared tests pass on Android/JVM and iOS (10 tests each,
including the three-profile golden conformance test); Android release lint and root `make check` pass.
The exact signed Android APK passes black-box acceptance on Galaxy A16 (SM-A165F, Android 16); the release iOS
bundle passes on `mobilebench-iphone` (iPhone 17, iOS 27.0). Every functional/build check passes; the existing
instrumentation-overhead waiver keeps these receipts descriptive. Physical iOS signing and device execution
remain unverified. Local build logs and artifact-bound receipts are under `results/local/kmp-validation/`.
