# Flutter islands candidate

The shared native host owns Selection, navigation, authoritative state, persistence, restoration and replay.
One Flutter/Dart runtime renders **List (including its summary), Detail and Insights**. List opens at startup,
so the default `mb.engine=lazy` includes runtime initialization in time to fully drawn. `prewarm` starts that same
runtime earlier during launch. The native header/status row may appear before the island, so first frame and fully
drawn remain distinct measurements.

The island holds a render cache of host snapshots and per-row updates. Taps send intents to the host; the host
updates selection and returns the row and summary. Fully drawn requires the island's actual list layout, visible
row paints and summary paint. Navigation and restoration continue to use the native host.

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
