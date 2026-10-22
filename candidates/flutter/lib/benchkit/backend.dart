/// One recorded marker: event name, per-event ordinal (from 1), monotonic timestamp in ns, payload.
class MarkerRecord {
  const MarkerRecord(this.event, this.n, this.tNs, this.payload);

  final String event;
  final int n;
  final int tNs;
  final String payload;

  /// Line of `markers-<journeyId>.jsonl`. Event and payload are validated ASCII
  /// without quotes or backslashes, so no escaping is needed.
  String toJsonLine() => '{"e":"$event","n":$n,"t":$tNs,"p":"$payload"}';
}

/// Where markers go. The platform backends (backend_ffi.dart) write the platform trace/log; the
/// memory backend is used on the host (unit and widget tests).
abstract interface class MarkerBackend {
  /// Monotonic clock in integer nanoseconds (Android CLOCK_BOOTTIME, iOS CLOCK_UPTIME_RAW).
  int nowNs();

  /// Records [record]; [mirror] asks for the driver-visible log line.
  void emit(MarkerRecord record, {required bool mirror, required String journeyId});

  /// Number of markers buffered in memory and not yet written by [flush] (iOS ring buffer).
  int get buffered;

  /// Capacity of the in-memory buffer; BenchKit flushes at 75 %.
  int get capacity;

  /// Writes buffered markers to the marker file (iOS); no-op where markers are not buffered.
  void flush(String journeyId);

  /// Platform "fully drawn" signal (Android `Activity.reportFullyDrawn()`); no-op elsewhere.
  void fullyDrawn();
}

/// Host backend: keeps every marker in memory. The clock is injectable for tests.
class MemoryMarkerBackend implements MarkerBackend {
  MemoryMarkerBackend({int Function()? clock}) : _clock = clock ?? _stopwatchClock();

  final int Function() _clock;
  final List<MarkerRecord> records = [];
  final List<String> mirrored = [];
  int flushes = 0;
  int fullyDrawnCalls = 0;

  static int Function() _stopwatchClock() {
    final sw = Stopwatch()..start();
    return () => sw.elapsedMicroseconds * 1000;
  }

  @override
  int nowNs() => _clock();

  @override
  void emit(MarkerRecord record, {required bool mirror, required String journeyId}) {
    records.add(record);
    if (mirror) {
      mirrored.add('MB $journeyId ${record.event} ${record.n} ${record.payload.isEmpty ? '-' : record.payload}');
    }
  }

  @override
  int get buffered => 0;

  @override
  int get capacity => 4096;

  @override
  void flush(String journeyId) => flushes++;

  @override
  void fullyDrawn() => fullyDrawnCalls++;

  /// Records of one event, in emission order.
  List<MarkerRecord> of(String event) => records.where((r) => r.event == event).toList();
}

/// No-op backend of the `--dart-define=MB_BENCHKIT=noop` overhead build.
class NoopMarkerBackend implements MarkerBackend {
  const NoopMarkerBackend();

  @override
  int nowNs() => 0;

  @override
  void emit(MarkerRecord record, {required bool mirror, required String journeyId}) {}

  @override
  int get buffered => 0;

  @override
  int get capacity => 4096;

  @override
  void flush(String journeyId) {}

  @override
  void fullyDrawn() {}
}
