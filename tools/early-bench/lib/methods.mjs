// Method registry of the early-bench runner.
//
// A method id is "<metricId>/<instrument>/<version>": metricId is the benchmark's metric id verbatim, instrument
// names how the value is collected, version changes whenever the procedure changes (old ids are retired, never
// reused). Instruments starting with "early-" are harness-free procedures of early sessions; they are never pooled
// with the driver methods of the same metric. Observations are pooled only when the full method id matches.

// Printed on every summary and table, and stored in every manifest and observation.
export const LABELS = [
  'EARLY SESSIONS: emulator/simulator, host busy, descriptive',
  'Android emulator / iOS simulator on an Apple silicon host: not representative of physical devices',
  'not comparable with legacy or pilot numbers',
];

export const METHODS = {
  'startup.ttff/early-am-start-w/1': {
    metricId: 'startup.ttff', platform: 'android', unit: 'ns', unitOfObservation: 'journey',
    procedure: 'process-cold or activity-warm launch with `am start -W -f 0x10008000 -n <component>`; value = TotalTime '
      + '(time to initial display, integer ms, measured by the system from launch start to the first frame) x 1e6',
    resolution: '1 ms', clock: 'system (ActivityTaskManager)', designRef: 'early-session instrument: am start -W TotalTime',
  },
  'startup.ttfd_system/early-logcat-fully-drawn/1': {
    metricId: 'startup.ttfd_system', platform: 'android', unit: 'ns', unitOfObservation: 'journey',
    procedure: 'same launch; value = the system logcat line "Fully drawn <component>: +<duration>" produced by '
      + 'Activity.reportFullyDrawn(), which every candidate calls at FUI; integer ms x 1e6',
    resolution: '1 ms', clock: 'system (ActivityTaskManager)', designRef: 'early-session instrument: system "Fully drawn" logcat line',
  },
  'startup.process_to_fui/early-ios-markers/1': {
    metricId: 'startup.process_to_fui', platform: 'ios', unit: 'ns', unitOfObservation: 'journey',
    procedure: 'process-cold launch with `xcrun simctl launch`; from the BenchKit marker buffer only: '
      + '(t[fui] - t[proc.anchor]) + (ws - ps) x 1000, where proc.anchor carries ws = wall µs at the anchor and '
      + 'ps = sysctl process start (wall µs); t = CLOCK_UPTIME_RAW ns',
    resolution: '1 µs (process start)', clock: 'in-app markers only', designRef: 'early-session instrument: proc.anchor -> fui markers',
  },
  'memory.android.pss_total/early-dumpsys-meminfo-idle/1': {
    metricId: 'memory.android.pss_total', platform: 'android', unit: 'bytes', memoryType: 'pss', unitOfObservation: 'journey',
    procedure: 'process-cold launch, FUI, idle on List for the session idle time with the candidate\'s default stream, '
      + 'then `dumpsys meminfo <pkg>` TOTAL PSS (KB) x 1024; no checkpoint request, so NOT the D1 script',
    resolution: '1 KB', clock: 'n/a', designRef: 'early-session instrument: dumpsys meminfo (own id: the D1 script is not followed)',
  },
  'memory.ios.phys_footprint/early-mem-marker-background/1': {
    metricId: 'memory.ios.phys_footprint', platform: 'ios', unit: 'bytes', memoryType: 'phys-footprint', unitOfObservation: 'journey',
    procedure: 'process-cold launch, FUI, idle on List for the session idle time, background (another app launched), '
      + '`mem` marker fp=<bytes> written by BenchKit at the background checkpoint; NOT the D1 checkpoint',
    resolution: '1 byte', clock: 'n/a', designRef: 'early-session instrument: mem marker (own id: the D1 script is not followed)',
  },
  'size.android.apk_arm64/file-bytes/1': {
    metricId: 'size.android.apk_arm64', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
    procedure: 'byte length of the frozen arm64 release APK that was installed', resolution: '1 byte', clock: 'n/a',
    designRef: 'delivery size: artifact bytes',
  },
  'size.android.aab/file-bytes/1': {
    metricId: 'size.android.aab', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
    procedure: 'byte length of the frozen release AAB', resolution: '1 byte', clock: 'n/a', designRef: 'delivery size: artifact bytes',
  },
  'size.android.benchmark_payload_compressed/zip-central-directory/1': {
    metricId: 'size.android.benchmark_payload_compressed', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
    procedure: 'sum of compressed member sizes classified as benchmark-payload or benchmark-data in the installed APK central directory',
    resolution: '1 byte', clock: 'n/a', designRef: 'payload accounting: compressed ZIP members',
  },
  'size.android.benchmark_payload_uncompressed/zip-central-directory/1': {
    metricId: 'size.android.benchmark_payload_uncompressed', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
    procedure: 'sum of uncompressed member sizes classified as benchmark-payload or benchmark-data in the installed APK central directory',
    resolution: '1 byte', clock: 'n/a', designRef: 'payload accounting: uncompressed ZIP members',
  },
  'size.ios.simulator_app/app-dir-file-bytes/1': {
    metricId: 'size.ios.simulator_app', platform: 'ios', unit: 'bytes', unitOfObservation: 'build',
    procedure: 'sum of regular-file byte lengths below the frozen simulator .app directory (symlinks not followed); descriptive',
    resolution: '1 byte', clock: 'n/a', designRef: 'delivery size: simulator .app bytes (descriptive only)',
  },
};

// Metrics of the early-session subset that early sessions do not collect, with the status the manifest records.
export const NOT_COLLECTED = {
  android: [
    { metricId: 'startup.fui', status: 'not-measured', reason: 'needs-perfetto-trace-processing (the logcat mirror is a control signal, never a timing source)' },
    { metricId: 'size.android.installed', status: 'not-measured', reason: 'needs-android-driver (StorageStatsManager)' },
    { metricId: 'size.android.download_estimate', status: 'not-measured', reason: 'toolchain-missing:bundletool' },
  ],
  ios: [
    { metricId: 'startup.ttff', status: 'not-measured', reason: 'needs-xcuitest-driver (XCTApplicationLaunchMetric)' },
    { metricId: 'startup.fui', status: 'not-measured', reason: 'needs-xcuitest-driver (runner clock before launch())' },
    { metricId: 'startup.ttfd_system', status: 'not-applicable', reason: 'android-only-metric', source: 'Activity.reportFullyDrawn() exists only on Android' },
    { metricId: 'size.ios.download', status: 'unavailable', reason: 'requires-signing' },
    { metricId: 'size.ios.installed', status: 'unavailable', reason: 'requires-signing' },
    { scenarioId: 'early.warm', status: 'not-applicable', reason: 'no activity-warm start on iOS', source: 'iOS distinguishes launch and resume only (scenario A3 is Android-only)' },
  ],
};

// Early scenarios: shortened versions of benchmark scenarios. They never share an id with a benchmark scenario.
export const SCENARIOS = {
  'early.cold': {
    designRef: 'A1', cacheState: 'process-cold',
    differences: 'ends at fui + 2 s: no tap, no TTFI; launched with `am start -W` (Android) / `xcrun simctl launch` (iOS), not the benchmark drivers',
  },
  'early.warm': {
    designRef: 'A3', cacheState: 'activity-warm',
    differences: 'per block and candidate one tool-warmup launch to FUI (retained, not analysed); before each measured launch HOME stops the activity, then `am start -W -f 0x10008000` (NEW_TASK | CLEAR_TASK) in the live process; ends at fui + 2 s; Android only',
  },
  'early.idle-memory': {
    designRef: 'D1', cacheState: 'process-cold',
    differences: 'process-cold launch, FUI, idle on List, memory read without a checkpoint request (Android) / at the background checkpoint (iOS); no CPU window',
  },
  'early.size': {
    designRef: 'E1-E3', cacheState: 'n/a', differences: 'one build-unit observation per frozen artifact; installed and download sizes need the driver or signing',
  },
};

export function methodInfo(methodId) {
  const m = METHODS[methodId];
  if (!m) {
    throw new Error(`unknown method id ${methodId}`);
  }
  return m;
}

export function instrumentId(methodId) {
  const parts = methodId.split('/');
  return parts.length === 3 ? parts[1] : null;
}
