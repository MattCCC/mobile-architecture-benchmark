# Flutter islands candidate

This candidate keeps List, Selection, navigation, state, persistence, restoration and replay in the byte-identical
native island host. A single Flutter add-to-app engine renders only Detail and Insights and exchanges versioned JSON
messages with the host over one `MethodChannel`. `mb.engine=lazy` starts it at the first island; `prewarm` starts it
during launch.

```sh
make check-island-flutter MB_ISLAND_FLUTTER_BIN=/path/to/flutter-3.47.7/bin/flutter
make build-island-flutter-android MB_ISLAND_FLUTTER_BIN=/path/to/flutter-3.47.7/bin/flutter
make build-island-flutter-ios MB_ISLAND_FLUTTER_BIN=/path/to/flutter-3.47.7/bin/flutter
```

Android produces a minified arm64 release APK. Flutter only supports debug mode for iOS simulator builds, so that
artifact is registered as `island-flutter@debug` and is never pooled with release builds. A physical-device release
artifact remains the route to an eligible iOS comparison.

Both artifacts need the same artifact-bound acceptance receipt as every other candidate before the runner measures
them. The island protocol is shared with the other island candidates; only the embedding and island UI runtime vary.
