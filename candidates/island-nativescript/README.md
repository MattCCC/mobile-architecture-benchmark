# NativeScript islands candidate

The shared native host owns Selection, navigation, authoritative state, persistence, restoration and replay.
One NativeScript/V8 runtime renders **List (including its summary), Detail and Insights**. List opens at startup,
so the default `mb.engine=lazy` includes runtime initialization in time to fully drawn. `prewarm` starts that same
runtime earlier during launch. The native header/status row may appear before the island, so first frame and fully
drawn remain distinct measurements.

The island holds a render cache of host snapshots and per-row updates. Taps send intents to the host; the host
updates selection and returns the row and summary. Fully drawn requires the island's actual list layout, visible
row paints and summary paint. Navigation and restoration continue to use the native host.

The island protocol parser and view model are the shared pure-TypeScript modules of `candidates/_island-rn-ui`, so
every island runtime handles host messages identically. Unlike the RN and Flutter islands, the bridge is
synchronous: the host calls a JavaScript-implemented `android.os.Handler.Callback`
(`App_Resources/Android/.../EmbeddingProvider.kt`), and the islands call the host's `IslandBenchApi` directly for
markers and draw probes (`app/bridge.android.ts`).

```sh
make check-island-nativescript
make build-island-nativescript-android
make artifacts-island-nativescript-android
```

## Android toolchain

The NativeScript CLI (`ns prepare`) bundles the islands and generates `platforms/android`, but the APK's
application, manifest and sources are the shared host's (`App_Resources/Android/app.gradle`). The shared host's
Compose BOM 2026.09 needs AGP 9.1, so `scripts/build-android.sh` builds the generated project on Gradle 9.3.1 /
AGP 9.1.0 like the other island hosts, with AGP's built-in Kotlin and new DSL turned off and two edits:
`BuildToolTask` is declared abstract (Gradle 9 managed task types), and `cleanupAllJars` declares its dependency
on AGP's generated `R.jar` (in `app.gradle`).

## iOS project

`ns prepare ios` generates the Xcode project (NativeScript runtime via SwiftPM, metadata generation, island
bundle); `scripts/generate-ios-project.rb` adds the shared UIKit host, `MobileBenchCore` and the fixtures, and
uses the host's `Info.plist`. `NS_SWIFTUI_BOOT=1` (`App_Resources/iOS/build.xcconfig`) removes the template's
`main.m`, so the host's `@main` owns the process; `ios/App/EmbeddingProvider.swift` boots NativeScript through
`NativeScriptStart`. Host and islands exchange synchronous `NSNotificationCenter` posts, and the host container's
layout passes drive NativeScript layout (`app/bridge.ios.ts`). @nativescript/core's `NativeScriptMainWindow.swift`
(NativeScript's own window boot) is left out of the target.

```sh
make build-island-nativescript-ios
make artifacts-island-nativescript-ios
```

## Status

- Android: release APK built and run on an API 36 emulator: launch, FUI, Detail with live values and the animated
  panel, Insights with `remote.ready`, back navigation and `mb.engine=prewarm`.
- iOS: release simulator app built and run on an iOS 26 simulator: launch, FUI, Detail and Insights opened through
  restoration with their `screen`, `restore` and `remote.ready` markers.
- Like every candidate, it needs an artifact-bound acceptance receipt before the runner measures it.
