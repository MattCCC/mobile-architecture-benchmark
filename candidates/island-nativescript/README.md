# NativeScript islands candidate

This candidate keeps List, Selection, navigation, state, persistence, restoration and replay in the shared native
island host (`candidates/_island-host`). One NativeScript V8 runtime renders only Detail and Insights, built from
`@nativescript/core` views. `mb.engine=lazy` (default) starts the runtime at the first island open; `prewarm`
starts it during launch.

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

## Status

- Android: release APK built and run on an API 36 emulator: launch, FUI, Detail with live values and the animated
  panel, Insights with `remote.ready`, back navigation and `mb.engine=prewarm`.
- iOS: not implemented. The route is `NativeScriptEmbedder` in the UIKit host with `NS_SWIFTUI_BOOT=1`.
- Like every candidate, it needs an artifact-bound acceptance receipt before the runner measures it.
