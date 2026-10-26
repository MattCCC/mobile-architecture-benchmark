# Early benchmark sessions: combined summary

**EARLY SESSIONS: emulator/simulator, host busy, descriptive**

**Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices**

**not comparable with legacy or pilot numbers**

Descriptive only: no significance tests, no rankings, no composite score. Values are pooled only when
method id, environment (class, platform, host, device configuration and settings) and artifact SHA-256 all
match; each session is one block (two-stage session/block structure); stream source, fixture and build class are
part of the key too. Percentiles: Hyndman-Fan type 7. † p95 with N < 20 is dominated by the maximum.
ms = ns / 1e6; MiB = bytes / 1048576. Journeys a session never started are `not-measured`, never failures.

## Sessions

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| session | platform | status | started (UTC) | duration s | candidates | journeys run / planned | design sha256 | host load 1-min start → end | power | environment flags | block design | observations.jsonl sha256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20261026T145605Z-android-333e | android | completed | 2026-10-26T14:56:05.272Z | 4301 | expo, flutter, island-flutter, island-nativescript, island-rn, native, nativescript, repack | 240 / 240 | f7de5709b053 | 4.49 → 3.23 | AC Power | – | all requested | cd6ed4c2d32e |
| 20261026T160803Z-ios-e44a | ios | completed | 2026-10-26T16:08:03.757Z | 2977 | flutter@debug, island-flutter@debug, island-nativescript, island-rn, native, nativescript | 120 / 120 | f7de5709b053 | 7.9 → 2.45 | AC Power | – | all requested | ca414b1fe3a5 |
| 20261026T165855Z-ios-a580 | ios | completed | 2026-10-26T16:58:55.566Z | 3983 | expo, flutter@debug, island-flutter@debug, island-nativescript, island-rn, native, nativescript, repack | 160 / 160 | f7de5709b053 | 13.12 → 2.54 | AC Power | – | all requested | c99c5d610025 |

Excluded sessions (files kept):

- 20261026T145421Z-android-4974: session status not-started (other-devices-running (adb 0, simulators 1))
- 20261026T145506Z-android-dbc2: session status failed (buildPolicy is not defined)

## Release builds

### Android emulator

#### early.cold (scenario ref A1; process-cold)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expo | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | e710cef9c24d | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 348.5 (n=10) | 10 | 348.5 | 424.8 † | 274.0 | 427.0 | measured: 10 |
| flutter | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | e964b443295e | env-a3a226c6b559 | replay, 1.0.0/representative | flutter-local-interim/1 | 20261026T145605Z-android-333e: 667.0 (n=10) | 10 | 667.0 | 718.5 † | 647.0 | 746.0 | measured: 10 |
| island-flutter | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 206b9d10b690 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T145605Z-android-333e: 156.0 (n=10) | 10 | 156.0 | 224.3 † | 143.0 | 227.0 | measured: 10 |
| island-nativescript | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 414a4cc4a5f8 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T145605Z-android-333e: 162.5 (n=10) | 10 | 162.5 | 336.4 † | 142.0 | 390.0 | measured: 10 |
| island-rn | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | b27667f70b8e | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T145605Z-android-333e: 166.0 (n=10) | 10 | 166.0 | 190.3 † | 134.0 | 202.0 | measured: 10 |
| nativescript | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 0be98fd9e17d | env-a3a226c6b559 | replay, 1.0.0/representative | nativescript-local-interim/1 | 20261026T145605Z-android-333e: 322.5 (n=10) | 10 | 322.5 | 415.9 † | 296.0 | 420.0 | measured: 10 |
| native | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | d4e881c2f149 | env-a3a226c6b559 | replay, 1.0.0/representative | native-android-local-interim/1 | 20261026T145605Z-android-333e: 163.0 (n=10) | 10 | 163.0 | 208.0 † | 140.0 | 231.0 | measured: 10 |
| repack | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 95c47e266873 | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 369.5 (n=10) | 10 | 369.5 | 495.4 † | 283.0 | 522.0 | measured: 10 |
| expo | `startup.ttff/early-am-start-w/1` | ms | e710cef9c24d | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 151.5 (n=10) | 10 | 151.5 | 167.6 † | 130.0 | 168.0 | measured: 10 |
| flutter | `startup.ttff/early-am-start-w/1` | ms | e964b443295e | env-a3a226c6b559 | replay, 1.0.0/representative | flutter-local-interim/1 | 20261026T145605Z-android-333e: 667.0 (n=10) | 10 | 667.0 | 718.5 † | 647.0 | 746.0 | measured: 10 |
| island-flutter | `startup.ttff/early-am-start-w/1` | ms | 206b9d10b690 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T145605Z-android-333e: 154.5 (n=10) | 10 | 154.5 | 222.3 † | 142.0 | 225.0 | measured: 10 |
| island-nativescript | `startup.ttff/early-am-start-w/1` | ms | 414a4cc4a5f8 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T145605Z-android-333e: 160.5 (n=10) | 10 | 160.5 | 332.2 † | 140.0 | 388.0 | measured: 10 |
| island-rn | `startup.ttff/early-am-start-w/1` | ms | b27667f70b8e | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T145605Z-android-333e: 164.5 (n=10) | 10 | 164.5 | 188.4 † | 132.0 | 201.0 | measured: 10 |
| nativescript | `startup.ttff/early-am-start-w/1` | ms | 0be98fd9e17d | env-a3a226c6b559 | replay, 1.0.0/representative | nativescript-local-interim/1 | 20261026T145605Z-android-333e: 320.5 (n=10) | 10 | 320.5 | 415.4 † | 295.0 | 419.0 | measured: 10 |
| native | `startup.ttff/early-am-start-w/1` | ms | d4e881c2f149 | env-a3a226c6b559 | replay, 1.0.0/representative | native-android-local-interim/1 | 20261026T145605Z-android-333e: 160.5 (n=10) | 10 | 160.5 | 206.7 † | 137.0 | 231.0 | measured: 10 |
| repack | `startup.ttff/early-am-start-w/1` | ms | 95c47e266873 | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 145.0 (n=10) | 10 | 145.0 | 202.8 † | 119.0 | 210.0 | measured: 10 |

#### early.idle-memory (scenario ref D1; process-cold)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expo | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | e710cef9c24d | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 107.02 (n=10) | 10 | 107.02 | 107.53 † | 104.16 | 107.71 | measured: 10 |
| flutter | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | e964b443295e | env-a3a226c6b559 | replay, 1.0.0/representative | flutter-local-interim/1 | 20261026T145605Z-android-333e: 66.71 (n=10) | 10 | 66.71 | 67.45 † | 65.45 | 67.72 | measured: 10 |
| island-flutter | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | 206b9d10b690 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T145605Z-android-333e: 23.92 (n=10) | 10 | 23.92 | 24.31 † | 23.34 | 24.35 | measured: 10 |
| island-nativescript | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | 414a4cc4a5f8 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T145605Z-android-333e: 46.68 (n=10) | 10 | 46.68 | 47.68 † | 46.45 | 47.69 | measured: 10 |
| island-rn | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | b27667f70b8e | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T145605Z-android-333e: 26.94 (n=10) | 10 | 26.94 | 27.60 † | 25.80 | 27.62 | measured: 10 |
| nativescript | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | 0be98fd9e17d | env-a3a226c6b559 | replay, 1.0.0/representative | nativescript-local-interim/1 | 20261026T145605Z-android-333e: 77.97 (n=10) | 10 | 77.97 | 79.43 † | 75.08 | 79.50 | measured: 10 |
| native | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | d4e881c2f149 | env-a3a226c6b559 | replay, 1.0.0/representative | native-android-local-interim/1 | 20261026T145605Z-android-333e: 23.59 (n=10) | 10 | 23.59 | 24.48 † | 22.78 | 24.49 | measured: 10 |
| repack | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | MiB | 95c47e266873 | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 97.01 (n=10) | 10 | 97.01 | 98.21 † | 96.49 | 98.36 | measured: 10 |

#### early.warm (scenario ref A3; activity-warm)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expo | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | e710cef9c24d | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 180.5 (n=10) | 10 | 180.5 | 2356.3 † | 132.0 | 3939.0 | measured: 10 |
| flutter | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | e964b443295e | env-a3a226c6b559 | replay, 1.0.0/representative | flutter-local-interim/1 | 20261026T145605Z-android-333e: 712.0 (n=10) | 10 | 712.0 | 753.3 † | 642.0 | 760.0 | measured: 10 |
| island-flutter | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 206b9d10b690 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T145605Z-android-333e: 90.5 (n=10) | 10 | 90.5 | 208.8 † | 49.0 | 284.0 | measured: 10 |
| island-nativescript | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 414a4cc4a5f8 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T145605Z-android-333e: 77.0 (n=10) | 10 | 77.0 | 185.1 † | 58.0 | 222.0 | measured: 10 |
| island-rn | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | b27667f70b8e | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T145605Z-android-333e: 93.5 (n=10) | 10 | 93.5 | 160.2 † | 48.0 | 180.0 | measured: 10 |
| nativescript | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 0be98fd9e17d | env-a3a226c6b559 | replay, 1.0.0/representative | nativescript-local-interim/1 | 20261026T145605Z-android-333e: 179.5 (n=10) | 10 | 179.5 | 255.6 † | 123.0 | 284.0 | measured: 10 |
| native | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | d4e881c2f149 | env-a3a226c6b559 | replay, 1.0.0/representative | native-android-local-interim/1 | 20261026T145605Z-android-333e: 89.0 (n=10) | 10 | 89.0 | 127.2 † | 49.0 | 129.0 | measured: 10 |
| repack | `startup.ttfd_system/early-logcat-fully-drawn/1` | ms | 95c47e266873 | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 160.0 (n=10) | 10 | 160.0 | 2644.4 † | 96.0 | 4628.0 | measured: 10 |
| expo | `startup.ttff/early-am-start-w/1` | ms | e710cef9c24d | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 94.0 (n=10) | 10 | 94.0 | 1085.1 † | 59.0 | 1824.0 | measured: 10 |
| flutter | `startup.ttff/early-am-start-w/1` | ms | e964b443295e | env-a3a226c6b559 | replay, 1.0.0/representative | flutter-local-interim/1 | 20261026T145605Z-android-333e: 712.0 (n=10) | 10 | 712.0 | 753.3 † | 642.0 | 760.0 | measured: 10 |
| island-flutter | `startup.ttff/early-am-start-w/1` | ms | 206b9d10b690 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T145605Z-android-333e: 90.0 (n=10) | 10 | 90.0 | 207.2 † | 47.0 | 281.0 | measured: 10 |
| island-nativescript | `startup.ttff/early-am-start-w/1` | ms | 414a4cc4a5f8 | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T145605Z-android-333e: 76.0 (n=10) | 10 | 76.0 | 182.4 † | 51.0 | 218.0 | measured: 10 |
| island-rn | `startup.ttff/early-am-start-w/1` | ms | b27667f70b8e | env-a3a226c6b559 | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T145605Z-android-333e: 90.0 (n=10) | 10 | 90.0 | 157.5 † | 48.0 | 180.0 | measured: 10 |
| nativescript | `startup.ttff/early-am-start-w/1` | ms | 0be98fd9e17d | env-a3a226c6b559 | replay, 1.0.0/representative | nativescript-local-interim/1 | 20261026T145605Z-android-333e: 175.5 (n=10) | 10 | 175.5 | 254.7 † | 122.0 | 284.0 | measured: 10 |
| native | `startup.ttff/early-am-start-w/1` | ms | d4e881c2f149 | env-a3a226c6b559 | replay, 1.0.0/representative | native-android-local-interim/1 | 20261026T145605Z-android-333e: 88.5 (n=10) | 10 | 88.5 | 126.3 † | 49.0 | 129.0 | measured: 10 |
| repack | `startup.ttff/early-am-start-w/1` | ms | 95c47e266873 | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T145605Z-android-333e: 74.5 (n=10) | 10 | 74.5 | 1393.9 † | 49.0 | 2464.0 | measured: 10 |

#### early.size (build-unit observations: one exact value per artifact, not pooled)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | artifact sha256 | bytes (exact) | MiB | recorded in sessions | observation status |
| --- | --- | --- | --- | --- | --- | --- |
| expo | `size.android.aab/file-bytes/1` | e710cef9c24d | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| expo | `size.android.apk_arm64/file-bytes/1` | e710cef9c24d | 29093688 | 27.75 | 20261026T145605Z-android-333e | measured: 1 |
| expo | `size.android.benchmark_payload_compressed/zip-central-directory/1` | e710cef9c24d | – | – | 20261026T145605Z-android-333e | unavailable (fixture and replay objects are bundled into the Hermes application bundle): 1 |
| expo | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | e710cef9c24d | – | – | 20261026T145605Z-android-333e | unavailable (fixture and replay objects are bundled into the Hermes application bundle): 1 |
| flutter | `size.android.aab/file-bytes/1` | 82b5e136cf95 | 45721958 | 43.60 | 20261026T145605Z-android-333e | measured: 1 |
| flutter | `size.android.apk_arm64/file-bytes/1` | e964b443295e | 16202196 | 15.45 | 20261026T145605Z-android-333e | measured: 1 |
| flutter | `size.android.benchmark_payload_compressed/zip-central-directory/1` | e964b443295e | 435964 | 0.42 | 20261026T145605Z-android-333e | measured: 1 |
| flutter | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | e964b443295e | 1604141 | 1.53 | 20261026T145605Z-android-333e | measured: 1 |
| island-flutter | `size.android.aab/file-bytes/1` | 206b9d10b690 | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| island-flutter | `size.android.apk_arm64/file-bytes/1` | 206b9d10b690 | 16932794 | 16.15 | 20261026T145605Z-android-333e | measured: 1 |
| island-flutter | `size.android.benchmark_payload_compressed/zip-central-directory/1` | 206b9d10b690 | 435964 | 0.42 | 20261026T145605Z-android-333e | measured: 1 |
| island-flutter | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | 206b9d10b690 | 1604141 | 1.53 | 20261026T145605Z-android-333e | measured: 1 |
| island-nativescript | `size.android.aab/file-bytes/1` | 414a4cc4a5f8 | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| island-nativescript | `size.android.apk_arm64/file-bytes/1` | 414a4cc4a5f8 | 36252796 | 34.57 | 20261026T145605Z-android-333e | measured: 1 |
| island-nativescript | `size.android.benchmark_payload_compressed/zip-central-directory/1` | 414a4cc4a5f8 | 435964 | 0.42 | 20261026T145605Z-android-333e | measured: 1 |
| island-nativescript | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | 414a4cc4a5f8 | 1604141 | 1.53 | 20261026T145605Z-android-333e | measured: 1 |
| island-rn | `size.android.aab/file-bytes/1` | b27667f70b8e | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| island-rn | `size.android.apk_arm64/file-bytes/1` | b27667f70b8e | 16173169 | 15.42 | 20261026T145605Z-android-333e | measured: 1 |
| island-rn | `size.android.benchmark_payload_compressed/zip-central-directory/1` | b27667f70b8e | 435964 | 0.42 | 20261026T145605Z-android-333e | measured: 1 |
| island-rn | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | b27667f70b8e | 1604141 | 1.53 | 20261026T145605Z-android-333e | measured: 1 |
| nativescript | `size.android.aab/file-bytes/1` | 0be98fd9e17d | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| nativescript | `size.android.apk_arm64/file-bytes/1` | 0be98fd9e17d | 31558707 | 30.10 | 20261026T145605Z-android-333e | measured: 1 |
| nativescript | `size.android.benchmark_payload_compressed/zip-central-directory/1` | 0be98fd9e17d | 392883 | 0.37 | 20261026T145605Z-android-333e | measured: 1 |
| nativescript | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | 0be98fd9e17d | 1417924 | 1.35 | 20261026T145605Z-android-333e | measured: 1 |
| native | `size.android.aab/file-bytes/1` | d4e881c2f149 | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| native | `size.android.apk_arm64/file-bytes/1` | d4e881c2f149 | 1397084 | 1.33 | 20261026T145605Z-android-333e | measured: 1 |
| native | `size.android.benchmark_payload_compressed/zip-central-directory/1` | d4e881c2f149 | 435964 | 0.42 | 20261026T145605Z-android-333e | measured: 1 |
| native | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | d4e881c2f149 | 1604141 | 1.53 | 20261026T145605Z-android-333e | measured: 1 |
| repack | `size.android.aab/file-bytes/1` | 95c47e266873 | – | – | 20261026T145605Z-android-333e | not-measured (artifact-not-provided): 1 |
| repack | `size.android.apk_arm64/file-bytes/1` | 95c47e266873 | 20096133 | 19.17 | 20261026T145605Z-android-333e | measured: 1 |
| repack | `size.android.benchmark_payload_compressed/zip-central-directory/1` | 95c47e266873 | – | – | 20261026T145605Z-android-333e | unavailable (fixture and replay objects are bundled into the Hermes application bundle): 1 |
| repack | `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | 95c47e266873 | – | – | 20261026T145605Z-android-333e | unavailable (fixture and replay objects are bundled into the Hermes application bundle): 1 |

### iOS simulator

#### early.cold (scenario ref A1; process-cold)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expo | `startup.process_to_fui/early-ios-markers/1` | ms | 432abf3aaad5 | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T165855Z-ios-a580: 1677.9 (n=10) | 10 | 1677.9 | 1710.5 † | 1664.7 | 1717.4 | measured: 10 |
| island-nativescript | `startup.process_to_fui/early-ios-markers/1` | ms | e26aa529f00d | env-2bff91eb9eac | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T160803Z-ios-e44a: 388.3 (n=10)<br>20261026T165855Z-ios-a580: 386.1 (n=10) | 20 | 387.0 | 392.6 | 378.5 | 402.9 | measured: 20 |
| island-rn | `startup.process_to_fui/early-ios-markers/1` | ms | ecb389f611ca | env-2bff91eb9eac | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T160803Z-ios-e44a: 394.1 (n=10)<br>20261026T165855Z-ios-a580: 397.3 (n=10) | 20 | 395.2 | 404.2 | 390.4 | 404.9 | measured: 20 |
| nativescript | `startup.process_to_fui/early-ios-markers/1` | ms | be5d81a11bda | env-2bff91eb9eac | replay, 1.0.0/representative | nativescript-local-interim/1 | – | 0 | – | – | – | – | unavailable (marker-missing:proc.anchor): 20 |
| native | `startup.process_to_fui/early-ios-markers/1` | ms | 630e0008e592 | env-2bff91eb9eac | replay, 1.0.0/representative | native-ios-local-interim/1 | 20261026T160803Z-ios-e44a: 375.0 (n=10)<br>20261026T165855Z-ios-a580: 373.2 (n=10) | 20 | 373.9 | 380.6 | 368.3 | 381.4 | measured: 20 |
| repack | `startup.process_to_fui/early-ios-markers/1` | ms | bfbacbdb8b47 | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T165855Z-ios-a580: 447.9 (n=10) | 10 | 447.9 | 455.9 † | 435.9 | 456.6 | measured: 10 |

#### early.idle-memory (scenario ref D1; process-cold)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| expo | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | 432abf3aaad5 | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T165855Z-ios-a580: 74.14 (n=10) | 10 | 74.14 | 75.10 † | 73.69 | 75.14 | measured: 10 |
| island-nativescript | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | e26aa529f00d | env-2bff91eb9eac | replay, 1.0.0/representative | island-host-nativescript-direct-interim/1 | 20261026T160803Z-ios-e44a: 18.57 (n=10)<br>20261026T165855Z-ios-a580: 18.59 (n=10) | 20 | 18.58 | 18.68 | 18.46 | 18.71 | measured: 20 |
| island-rn | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | ecb389f611ca | env-2bff91eb9eac | replay, 1.0.0/representative | island-host-rn-forwarder-interim/1 | 20261026T160803Z-ios-e44a: 18.75 (n=10)<br>20261026T165855Z-ios-a580: 18.76 (n=10) | 20 | 18.76 | 18.82 | 18.56 | 18.83 | measured: 20 |
| nativescript | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | be5d81a11bda | env-2bff91eb9eac | replay, 1.0.0/representative | nativescript-local-interim/1 | – | 0 | – | – | – | – | unavailable (marker-missing:mem): 20 |
| native | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | 630e0008e592 | env-2bff91eb9eac | replay, 1.0.0/representative | native-ios-local-interim/1 | 20261026T160803Z-ios-e44a: 17.97 (n=10)<br>20261026T165855Z-ios-a580: 17.93 (n=10) | 20 | 17.96 | 18.02 | 17.80 | 18.06 | measured: 20 |
| repack | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | bfbacbdb8b47 | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | 20261026T165855Z-ios-a580: 70.12 (n=10) | 10 | 70.12 | 70.82 † | 69.75 | 71.02 | measured: 10 |

#### early.size (build-unit observations: one exact value per artifact, not pooled)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | artifact sha256 | bytes (exact) | MiB | recorded in sessions | observation status |
| --- | --- | --- | --- | --- | --- | --- |
| expo | `size.ios.simulator_app/app-dir-file-bytes/1` | 432abf3aaad5 | 40168782 | 38.31 | 20261026T165855Z-ios-a580 | measured: 1 |
| island-nativescript | `size.ios.simulator_app/app-dir-file-bytes/1` | e26aa529f00d | 74794958 | 71.33 | 20261026T160803Z-ios-e44a, 20261026T165855Z-ios-a580 | measured: 2 |
| island-rn | `size.ios.simulator_app/app-dir-file-bytes/1` | ecb389f611ca | 24137198 | 23.02 | 20261026T160803Z-ios-e44a, 20261026T165855Z-ios-a580 | measured: 2 |
| nativescript | `size.ios.simulator_app/app-dir-file-bytes/1` | be5d81a11bda | 74371445 | 70.93 | 20261026T160803Z-ios-e44a, 20261026T165855Z-ios-a580 | measured: 2 |
| native | `size.ios.simulator_app/app-dir-file-bytes/1` | 630e0008e592 | 2179971 | 2.08 | 20261026T160803Z-ios-e44a, 20261026T165855Z-ios-a580 | measured: 2 |
| repack | `size.ios.simulator_app/app-dir-file-bytes/1` | bfbacbdb8b47 | 25385796 | 24.21 | 20261026T165855Z-ios-a580 | measured: 1 |

## Debug and unclassified builds (separate; never compared with release builds)

Limitation: Flutter builds only debug (JIT) for the iOS simulator (variant `flutter@debug`), and Flutter
enables its semantics tree unconditionally on the simulator (`flutter-semantics-forced-on-simulator`).

### iOS simulator

#### early.cold (scenario ref A1; process-cold)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flutter@debug | `startup.process_to_fui/early-ios-markers/1` | ms | a761b769783f | env-2bff91eb9eac | replay, 1.0.0/representative | flutter-local-interim/1 | – | 0 | – | – | – | – | unavailable (marker-missing:proc.anchor): 20 |
| island-flutter@debug | `startup.process_to_fui/early-ios-markers/1` | ms | 7f66eefc3695 | env-2bff91eb9eac | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T160803Z-ios-e44a: 431.1 (n=10)<br>20261026T165855Z-ios-a580: 431.8 (n=10) | 20 | 431.1 | 442.5 | 425.0 | 444.0 | measured: 20 |

#### early.idle-memory (scenario ref D1; process-cold)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | unit | artifact sha256 | environment | stream, fixture | instrumentation | per-session median (n) | pooled N | median | p95 | min | max | observation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flutter@debug | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | a761b769783f | env-2bff91eb9eac | replay, 1.0.0/representative | flutter-local-interim/1 | – | 0 | – | – | – | – | unavailable (marker-missing:mem): 20 |
| island-flutter@debug | `memory.ios.phys_footprint/early-mem-marker-background/1` | MiB | 7f66eefc3695 | env-2bff91eb9eac | replay, 1.0.0/representative | island-host-flutter-channel-interim/1 | 20261026T160803Z-ios-e44a: 19.03 (n=10)<br>20261026T165855Z-ios-a580: 19.04 (n=10) | 20 | 19.03 | 19.10 | 18.94 | 19.13 | measured: 20 |

#### early.size (build-unit observations: one exact value per artifact, not pooled)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| candidate | method id | artifact sha256 | bytes (exact) | MiB | recorded in sessions | observation status |
| --- | --- | --- | --- | --- | --- | --- |
| flutter@debug | `size.ios.simulator_app/app-dir-file-bytes/1` | a761b769783f | 103013172 | 98.24 | 20261026T160803Z-ios-e44a, 20261026T165855Z-ios-a580 | measured: 2 |
| island-flutter@debug | `size.ios.simulator_app/app-dir-file-bytes/1` | 7f66eefc3695 | 103911152 | 99.10 | 20261026T160803Z-ios-e44a, 20261026T165855Z-ios-a580 | measured: 2 |

## Shared sessions and the timing confound

Candidates that became verified later joined later sessions. Sessions differ in time of day, host load and
other work on the host, so pooled values of candidates with different session sets are not side by side.
Read candidates together only within sessions they share.

### Android emulator: candidate coverage per session (artifact sha256 prefix)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| session | expo | flutter | island-flutter | island-nativescript | island-rn | native | nativescript | repack |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20261026T145605Z-android-333e | e710cef9c24d | e964b443295e | 206b9d10b690 | 414a4cc4a5f8 | b27667f70b8e | d4e881c2f149 | 0be98fd9e17d | 95c47e266873 |

One line per pool cell (candidate x artifact). Each comparison group has one method, environment, stream
source, fixture, instrumentation id and build class; its shared sessions are those in which every candidate of the group has data.
Values are medians of per-session medians over those sessions (descriptive, no ranking).

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| scenario | method id | environment | stream, fixture | instrumentation | candidate | artifact sha256 | shared sessions used | journeys | median of session medians |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| early.cold | `startup.ttfd_system/early-logcat-fully-drawn/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | e710cef9c24d | 20261026T145605Z-android-333e | 10 | 348.5 ms |
| early.cold | `startup.ttfd_system/early-logcat-fully-drawn/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | 95c47e266873 | 20261026T145605Z-android-333e | 10 | 369.5 ms |
| early.cold | `startup.ttff/early-am-start-w/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | e710cef9c24d | 20261026T145605Z-android-333e | 10 | 151.5 ms |
| early.cold | `startup.ttff/early-am-start-w/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | 95c47e266873 | 20261026T145605Z-android-333e | 10 | 145.0 ms |
| early.idle-memory | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | e710cef9c24d | 20261026T145605Z-android-333e | 10 | 107.02 MiB |
| early.idle-memory | `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | 95c47e266873 | 20261026T145605Z-android-333e | 10 | 97.01 MiB |
| early.warm | `startup.ttfd_system/early-logcat-fully-drawn/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | e710cef9c24d | 20261026T145605Z-android-333e | 10 | 180.5 ms |
| early.warm | `startup.ttfd_system/early-logcat-fully-drawn/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | 95c47e266873 | 20261026T145605Z-android-333e | 10 | 160.0 ms |
| early.warm | `startup.ttff/early-am-start-w/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | e710cef9c24d | 20261026T145605Z-android-333e | 10 | 94.0 ms |
| early.warm | `startup.ttff/early-am-start-w/1` | env-a3a226c6b559 | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | 95c47e266873 | 20261026T145605Z-android-333e | 10 | 74.5 ms |

### iOS simulator: candidate coverage per session (artifact sha256 prefix)

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| session | expo | island-flutter@debug | island-nativescript | island-rn | native | repack |
| --- | --- | --- | --- | --- | --- | --- |
| 20261026T160803Z-ios-e44a |  | 7f66eefc3695 | e26aa529f00d | ecb389f611ca | 630e0008e592 |  |
| 20261026T165855Z-ios-a580 | 432abf3aaad5 | 7f66eefc3695 | e26aa529f00d | ecb389f611ca | 630e0008e592 | bfbacbdb8b47 |

One line per pool cell (candidate x artifact). Each comparison group has one method, environment, stream
source, fixture, instrumentation id and build class; its shared sessions are those in which every candidate of the group has data.
Values are medians of per-session medians over those sessions (descriptive, no ranking).

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| scenario | method id | environment | stream, fixture | instrumentation | candidate | artifact sha256 | shared sessions used | journeys | median of session medians |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| early.cold | `startup.process_to_fui/early-ios-markers/1` | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | 432abf3aaad5 | 20261026T165855Z-ios-a580 | 10 | 1677.9 ms |
| early.cold | `startup.process_to_fui/early-ios-markers/1` | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | bfbacbdb8b47 | 20261026T165855Z-ios-a580 | 10 | 447.9 ms |
| early.idle-memory | `memory.ios.phys_footprint/early-mem-marker-background/1` | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | expo | 432abf3aaad5 | 20261026T165855Z-ios-a580 | 10 | 74.14 MiB |
| early.idle-memory | `memory.ios.phys_footprint/early-mem-marker-background/1` | env-2bff91eb9eac | replay, 1.0.0/representative | rn-benchkit-interim/1 | repack | bfbacbdb8b47 | 20261026T165855Z-ios-a580 | 10 | 70.12 MiB |

## Methods and scenarios not yet in design

Early methods are harness-free procedures of early sessions. They are not yet registered in the core
`config/methods.json` and are never pooled with the driver methods of the same metric.

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| method id | metric | procedure | basis |
| --- | --- | --- | --- |
| `memory.android.pss_total/early-dumpsys-meminfo-idle/1` | memory.android.pss_total | process-cold launch, FUI, idle on List for the session idle time with the candidate's default stream, then `dumpsys meminfo <pkg>` TOTAL PSS (KB) x 1024; no checkpoint request, so NOT the D1 script | early-session instrument: dumpsys meminfo (own id: the D1 script is not followed) |
| `memory.ios.phys_footprint/early-mem-marker-background/1` | memory.ios.phys_footprint | process-cold launch, FUI, idle on List for the session idle time, background (another app launched), `mem` marker fp=<bytes> written by BenchKit at the background checkpoint; NOT the D1 checkpoint | early-session instrument: mem marker (own id: the D1 script is not followed) |
| `size.android.aab/file-bytes/1` | size.android.aab | byte length of the frozen release AAB | delivery size: artifact bytes |
| `size.android.apk_arm64/file-bytes/1` | size.android.apk_arm64 | byte length of the frozen arm64 release APK that was installed | delivery size: artifact bytes |
| `size.android.benchmark_payload_compressed/zip-central-directory/1` | size.android.benchmark_payload_compressed | sum of compressed member sizes classified as benchmark-payload or benchmark-data in the installed APK central directory | payload accounting: compressed ZIP members |
| `size.android.benchmark_payload_uncompressed/zip-central-directory/1` | size.android.benchmark_payload_uncompressed | sum of uncompressed member sizes classified as benchmark-payload or benchmark-data in the installed APK central directory | payload accounting: uncompressed ZIP members |
| `size.ios.simulator_app/app-dir-file-bytes/1` | size.ios.simulator_app | sum of regular-file byte lengths below the frozen simulator .app directory (symlinks not followed); descriptive | delivery size: simulator .app bytes (descriptive only) |
| `startup.process_to_fui/early-ios-markers/1` | startup.process_to_fui | process-cold launch with `xcrun simctl launch`; from the BenchKit marker buffer only: (t[fui] - t[proc.anchor]) + (ws - ps) x 1000, where proc.anchor carries ws = wall µs at the anchor and ps = sysctl process start (wall µs); t = CLOCK_UPTIME_RAW ns | early-session instrument: proc.anchor -> fui markers |
| `startup.ttfd_system/early-logcat-fully-drawn/1` | startup.ttfd_system | same launch; value = the system logcat line "Fully drawn <component>: +<duration>" produced by Activity.reportFullyDrawn(), which every candidate calls at FUI; integer ms x 1e6 | early-session instrument: system "Fully drawn" logcat line |
| `startup.ttff/early-am-start-w/1` | startup.ttff | process-cold or activity-warm launch with `am start -W -f 0x10008000 -n <component>`; value = TotalTime (time to initial display, integer ms, measured by the system from launch start to the first frame) x 1e6 | early-session instrument: am start -W TotalTime |

_EARLY SESSIONS: emulator/simulator, host busy, descriptive · Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices · not comparable with legacy or pilot numbers_

| early scenario | scenario ref | differences from the benchmark scenario |
| --- | --- | --- |
| early.cold | A1 | ends at fui + 2 s: no tap, no TTFI; launched with `am start -W` (Android) / `xcrun simctl launch` (iOS), not the benchmark drivers |
| early.idle-memory | D1 | process-cold launch, FUI, idle on List, memory read without a checkpoint request (Android) / at the background checkpoint (iOS); no CPU window |
| early.size | E1-E3 | one build-unit observation per frozen artifact; installed and download sizes need the driver or signing |
| early.warm | A3 | per block and candidate one tool-warmup launch to FUI (retained, not analysed); before each measured launch HOME stops the activity, then `am start -W -f 0x10008000` (NEW_TASK | CLEAR_TASK) in the live process; ends at fui + 2 s; Android only |

## Limitations

- android / expo: bundles-replay-stream
- android / flutter: bundles-replay-stream, framework-unsupported-on-emulator
- android / island-flutter: bundles-replay-stream
- android / island-nativescript: bundles-replay-stream
- android / island-rn: bundles-replay-stream
- android / native: bundles-replay-stream
- android / nativescript: bundles-replay-stream
- android / repack: bundles-replay-stream
- ios / expo: bundles-replay-stream, descriptive-simulator-build, simulator-host-process
- ios / flutter@debug: bundles-replay-stream, descriptive-simulator-build, flutter-semantics-forced-on-simulator
- ios / island-flutter@debug: bundles-replay-stream, descriptive-simulator-build, simulator-host-process
- ios / island-nativescript: bundles-replay-stream, descriptive-simulator-build, simulator-host-process
- ios / island-rn: bundles-replay-stream, descriptive-simulator-build, simulator-host-process
- ios / native: bundles-replay-stream, descriptive-simulator-build, simulator-host-process
- ios / nativescript: bundles-replay-stream, descriptive-simulator-build
- ios / repack: bundles-replay-stream, descriptive-simulator-build, simulator-host-process
- All sessions: emulator/simulator on a shared Apple silicon host that ran other workflows (builds) between
  sessions; host load is recorded per session. Frame, energy and thermal metrics are not part of early sessions.
- Early sessions use shell-level instruments (`early.*`), not the benchmark drivers; their values are not
  interchangeable with the driver instruments of the same metric.

## Traceability

Every value above comes from `measured` rows of `<session>/observations.jsonl`; each row lists `rawRefs`
(file, 1-based line, exact text) inside the session directory.

