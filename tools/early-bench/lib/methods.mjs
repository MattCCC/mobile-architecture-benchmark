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
  ...installedAndDownloadMethods(),
  ...scrollMethods(),
  'energy.android.uid_estimated_charge/early-batterystats-power-model/1': {
    metricId: 'energy.android.uid_estimated_charge', platform: 'android', unit: 'mAh', unitOfObservation: 'journey',
    physicalOnly: true,
    procedure: 'PHYSICAL DEVICE ONLY. Process-cold launch to FUI + 2 s, `dumpsys batterystats --reset`, `dumpsys battery '
      + 'unplug`, then the seeded fling plan repeated for --energy-s seconds on List while the stream runs, then '
      + '`dumpsys batterystats --checkin`; value = the app uid\'s "pwi,uid" entry (mAh). A MODEL-BASED ESTIMATE from the '
      + 'device power profile (BatteryUsageStats), not measured current; `dumpsys battery reset` always restores charging state',
    resolution: 'power-profile model (reported with 3 significant digits)', clock: 'n/a',
    designRef: 'early-session instrument: batterystats power-model estimate (not a measured energy method)',
  },
  'thermal.android.skin_temp_end/early-thermalservice-hal/1': {
    metricId: 'thermal.android.skin_temp_end', platform: 'android', unit: 'celsius', unitOfObservation: 'journey',
    physicalOnly: true,
    procedure: 'PHYSICAL DEVICE ONLY. Same journey as the energy estimate; value = SKIN temperature of the '
      + '"Current temperatures from HAL" block of `dumpsys thermalservice` read at the end of the workload',
    resolution: '0.1 °C (HAL)', clock: 'n/a', designRef: 'early-session instrument: thermal HAL skin temperature',
  },
  'thermal.android.skin_temp_rise/early-thermalservice-hal/1': {
    metricId: 'thermal.android.skin_temp_rise', platform: 'android', unit: 'celsius', unitOfObservation: 'journey',
    physicalOnly: true,
    procedure: 'PHYSICAL DEVICE ONLY. Same journey; value = SKIN temperature at the end minus at the start of the workload '
      + '(both from `dumpsys thermalservice` HAL temperatures)',
    resolution: '0.1 °C (HAL)', clock: 'n/a', designRef: 'early-session instrument: thermal HAL skin temperature',
  },
};

function installedAndDownloadMethods() {
  const diskstats = 'after install, the session ART compile and one unmeasured process-cold launch to FUI + 2 s (then '
    + 'force-stop), the DiskStatsLoggingService job is forced (`cmd jobscheduler run -f android <job id>`, waited for '
    + 'by the mtime of /data/system/diskstats_cache.json) and `dumpsys diskstats` is read; the per-package arrays are '
    + 'filled from StorageStatsManager (no root needed)';
  return {
    'size.android.installed_code/early-diskstats-app-size/1': {
      metricId: 'size.android.installed_code', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
      procedure: `${diskstats}; value = "App Sizes" entry of the package (APK, extracted libs, ART dexopt output)`,
      resolution: '1 byte (filesystem allocation)', clock: 'n/a', designRef: '15.2 installed bytes (code)',
    },
    'size.android.installed_data/early-diskstats-data-size/1': {
      metricId: 'size.android.installed_data', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
      procedure: `${diskstats}; value = "App Data Sizes" entry of the package after the first launch (cache bytes are in raw/)`,
      resolution: '1 byte (filesystem allocation)', clock: 'n/a', designRef: '15.2 installed bytes (data after first launch)',
    },
    'size.android.installed/early-diskstats-code-plus-data/1': {
      metricId: 'size.android.installed', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
      procedure: `${diskstats}; value = "App Sizes" + "App Data Sizes" of the package`,
      resolution: '1 byte (filesystem allocation)', clock: 'n/a', designRef: '15.2 installed bytes',
    },
    'size.android.download_estimate/apkanalyzer-download-size/1': {
      metricId: 'size.android.download_estimate', platform: 'android', unit: 'bytes', unitOfObservation: 'build',
      procedure: '`apkanalyzer apk download-size <frozen APK>` (SDK cmdline-tools): estimated over-the-wire size of the '
        + 'measured APK; NOT the Play split-APK download of the AAB',
      resolution: '1 byte (estimate)', clock: 'n/a', designRef: '15.2 download estimate (APK, apkanalyzer model)',
    },
    'size.ios.simulator_installed_app/app-container-file-bytes/1': {
      metricId: 'size.ios.simulator_installed_app', platform: 'ios', unit: 'bytes', unitOfObservation: 'build',
      procedure: 'sum of regular-file byte lengths below `xcrun simctl get_app_container <udid> <bundle> app` after install; descriptive',
      resolution: '1 byte', clock: 'n/a', designRef: '15.2 installed bytes (simulator bundle, descriptive only)',
    },
    'size.ios.simulator_data_container/data-container-file-bytes/1': {
      metricId: 'size.ios.simulator_data_container', platform: 'ios', unit: 'bytes', unitOfObservation: 'build',
      procedure: 'sum of regular-file byte lengths below the data container (`get_app_container ... data`) after one '
        + 'unmeasured process-cold launch to FUI + 2 s and terminate; descriptive',
      resolution: '1 byte', clock: 'n/a', designRef: '15.2 installed bytes (simulator data after first launch, descriptive only)',
    },
    'size.ios.simulator_app_deflate_estimate/zip-9-bytes/1': {
      metricId: 'size.ios.simulator_app_deflate_estimate', platform: 'ios', unit: 'bytes', unitOfObservation: 'build',
      procedure: 'byte length of `zip -r -9 -X -y -q` (deflate) of the frozen simulator .app; a DESCRIPTIVE compressed-size '
        + 'estimate, not the App Store thinned download size (which requires a signed device build)',
      resolution: '1 byte (estimate)', clock: 'n/a', designRef: '15.2 download estimate (descriptive simulator proxy)',
    },
  };
}

// early.scroll frame methods. One id per source; sources are never pooled with each other.
function scrollMethods() {
  const out = {};
  const sources = {
    'early-sf-latency': {
      platform: 'android',
      procedure: 'process-cold launch to FUI + 2 s, then the seeded fling plan (`input swipe` in one device shell script) on '
        + 'List while the stream runs; `dumpsys SurfaceFlinger --latency <layer>` polled every 500 ms on the app layer that '
        + 'presented the most buffers (VRI-* window or the SurfaceView BLAST layer, recorded), merged by present time, frames '
        + 'of the pre-fling baseline poll excluded; frame time = present-to-present interval, intervals > 100 ms are idle '
        + 'breaks between flings (excluded, so longer hitches are not counted: jank is a lower bound); janky = interval > 1.5 x refresh period',
      designRef: 'early-session instrument: SurfaceFlinger per-layer present timestamps (every toolkit)',
    },
    'early-perfetto-frametimeline': {
      platform: 'android',
      procedure: 'same journey; Perfetto data source android.surfaceflinger.frametimeline recorded over the fling plan; actual '
        + 'surface frames of the app pid; frame time = actual surface frame duration; janky = SurfaceFlinger jank type other '
        + 'than none / buffer-stuffing / non-animating. Toolkits that submit buffers without a frame-timeline vsync id '
        + '(Flutter SurfaceView) have no surface frames: unavailable',
      designRef: 'early-session instrument: SurfaceFlinger FrameTimeline (view toolkits)',
    },
  };
  const metrics = [
    ['frame_count', 'count', 'frames in the fling window'],
    ['janky_frames_pct', 'percent', 'janky frames / frames x 100'],
    ['frame_time_p50', 'ns', 'p50 frame time (Hyndman-Fan 7)'],
    ['frame_time_p90', 'ns', 'p90 frame time'],
    ['frame_time_p99', 'ns', 'p99 frame time'],
  ];
  for (const [inst, s] of Object.entries(sources)) {
    for (const [m, unit, what] of metrics) {
      const metricId = `frame.${s.platform}.scroll_${m}`;
      out[`${metricId}/${inst}/1`] = {
        metricId, platform: s.platform, unit, unitOfObservation: 'journey', procedure: `${s.procedure}; value = ${what}`,
        resolution: unit === 'ns' ? '1 ns (device clock)' : 'n/a', clock: 'device CLOCK_MONOTONIC (SurfaceFlinger)', designRef: s.designRef,
      };
    }
  }
  return out;
}

// Added to physical-device sessions (Android --serial).
export const PHYSICAL_LABEL = 'PHYSICAL DEVICE (Android, --serial): early session, descriptive, no independent review; never pooled with emulator sessions';

// Metrics of the early-session subset that early sessions do not collect, with the status the manifest records.
export const NOT_COLLECTED = {
  android: [
    { metricId: 'startup.fui', status: 'not-measured', reason: 'needs-perfetto-trace-processing (the logcat mirror is a control signal, never a timing source)' },
    { metricId: 'size.android.aab_download_estimate', status: 'not-measured', reason: 'toolchain-missing:bundletool (AAB split download estimate not required for early sessions)' },
    { metricId: 'energy.*', status: 'unavailable', reason: 'emulator-has-no-battery-model (no physical device in this session)' },
    { metricId: 'thermal.*', status: 'unavailable', reason: 'emulator-has-no-thermal-model (no physical device in this session)' },
  ],
  ios: [
    { metricId: 'startup.ttff', status: 'not-measured', reason: 'needs-xcuitest-driver (XCTApplicationLaunchMetric)' },
    { metricId: 'startup.fui', status: 'not-measured', reason: 'needs-xcuitest-driver (runner clock before launch())' },
    { metricId: 'startup.ttfd_system', status: 'not-applicable', reason: 'android-only-metric', source: 'Activity.reportFullyDrawn() exists only on Android' },
    { metricId: 'size.ios.download', status: 'unavailable', reason: 'requires-signing' },
    { metricId: 'size.ios.installed', status: 'unavailable', reason: 'requires-signing' },
    { scenarioId: 'early.scroll', metricId: 'frame.ios.scroll_*', status: 'unavailable',
      reason: 'simulator-reports-no-hitch-metrics: XCTOSSignpostMetric.scrollingAndDecelerationMetric on the iOS 27.1 simulator (Xcode 27.1, '
        + 'XCUITest flings over native List) reported only "Duration (Scroll_DraggingAndDeceleration)"; hitch time ratio, frame count and '
        + 'frame rate are not reported, and no harness-free per-frame source exists on the simulator (no SurfaceFlinger equivalent; '
        + 'in-app display-link counters would need candidate changes)' },
    { metricId: 'energy.*', status: 'unavailable', reason: 'simulator-has-no-battery-model' },
    { metricId: 'thermal.*', status: 'unavailable', reason: 'simulator-has-no-thermal-model' },
    { scenarioId: 'early.warm', status: 'not-applicable', reason: 'no activity-warm start on iOS', source: 'iOS distinguishes launch and resume only (scenario A3 is Android-only)' },
  ],
};

NOT_COLLECTED.androidPhysical = NOT_COLLECTED.android.filter((x) => !/^(energy|thermal)\./.test(x.metricId ?? ''));

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
  'early.scroll': {
    designRef: 'B (scroll)', cacheState: 'process-cold',
    differences: 'process-cold launch to FUI + 2 s, then a fixed seeded sequence of fling swipes on List while the stream runs; frames from shell-level SurfaceFlinger sources, not the benchmark frame driver',
  },
  'early.energy': {
    designRef: 'C (energy)', cacheState: 'process-cold',
    differences: 'physical Android device only: process-cold launch to FUI + 2 s, batterystats reset, battery unplugged (software), the seeded fling plan repeated for a fixed duration; power-model estimate and thermal HAL reads, not measured current',
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
