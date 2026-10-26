import 'dart:async';
import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';
import 'package:flutter/services.dart';

import 'backend.dart';

/// Interim platform backends: direct `dart:ffi` calls into public platform C APIs. They follow the
/// BenchKit semantics of the instrumentation contract and are replaced by the core BenchKit C ABI at integration
/// (same Dart facade, see README "Instrumentation").

final class _Timespec extends Struct {
  @Long()
  external int tvSec;

  @Long()
  external int tvNsec;
}

/// Pre-allocated, NUL-terminated ASCII buffer, so emitting a marker allocates no native memory.
class _NativeText {
  _NativeText(this._capacity) : _ptr = calloc<Uint8>(_capacity);

  final int _capacity;
  final Pointer<Uint8> _ptr;

  Pointer<Utf8> set(String s) {
    final bytes = _ptr.asTypedList(_capacity);
    final len = s.length < _capacity - 1 ? s.length : _capacity - 1;
    for (var k = 0; k < len; k++) {
      final c = s.codeUnitAt(k);
      bytes[k] = c < 0x80 ? c : 0x3F; // markers are ASCII; anything else becomes '?'
    }
    bytes[len] = 0;
    return _ptr.cast<Utf8>();
  }
}

typedef _ClockGettimeC = Int32 Function(Int32, Pointer<_Timespec>);
typedef _ClockGettimeDart = int Function(int, Pointer<_Timespec>);
typedef _TraceBeginC = Void Function(Pointer<Utf8>);
typedef _TraceBeginDart = void Function(Pointer<Utf8>);
typedef _TraceEndC = Void Function();
typedef _TraceEndDart = void Function();
typedef _LogWriteC = Int32 Function(Int32, Pointer<Utf8>, Pointer<Utf8>);
typedef _LogWriteDart = int Function(int, Pointer<Utf8>, Pointer<Utf8>);

/// Android: zero-length atrace slice `mb|<event>|<n>|<payload>` (NDK `ATrace_beginSection` /
/// `ATrace_endSection`, the timing source of record in a Perfetto trace) plus, for the
/// driver-visible set, one logcat line `MB <journeyId> <event> <n> <payload> t=<ns>` with tag
/// `MobileBench` (`__android_log_write`). Clock: `clock_gettime(CLOCK_BOOTTIME)`, the clock of
/// `SystemClock.elapsedRealtimeNanos()`.
class AndroidMarkerBackend implements MarkerBackend {
  AndroidMarkerBackend() {
    final libc = DynamicLibrary.open('libc.so');
    _clockGettime = libc.lookupFunction<_ClockGettimeC, _ClockGettimeDart>('clock_gettime');
    final libandroid = DynamicLibrary.open('libandroid.so');
    _traceBegin = libandroid.lookupFunction<_TraceBeginC, _TraceBeginDart>('ATrace_beginSection');
    _traceEnd = libandroid.lookupFunction<_TraceEndC, _TraceEndDart>('ATrace_endSection');
    final liblog = DynamicLibrary.open('liblog.so');
    _logWrite = liblog.lookupFunction<_LogWriteC, _LogWriteDart>('__android_log_write');
  }

  static const int _clockBoottime = 7;
  static const int _logInfo = 4;
  static const MethodChannel _channel = MethodChannel('org.example.mobilebench/benchkit');

  late final _ClockGettimeDart _clockGettime;
  late final _TraceBeginDart _traceBegin;
  late final _TraceEndDart _traceEnd;
  late final _LogWriteDart _logWrite;
  final Pointer<_Timespec> _ts = calloc<_Timespec>();
  final _NativeText _section = _NativeText(160);
  final _NativeText _line = _NativeText(256);
  final Pointer<Utf8> _tag = 'MobileBench'.toNativeUtf8();

  @override
  int nowNs() {
    _clockGettime(_clockBoottime, _ts);
    return _ts.ref.tvSec * 1000000000 + _ts.ref.tvNsec;
  }

  @override
  void emit(MarkerRecord r, {required bool mirror, required String journeyId}) {
    _traceBegin(_section.set('mb|${r.event}|${r.n}|${r.payload}'));
    _traceEnd();
    if (mirror) {
      final p = r.payload.isEmpty ? '-' : r.payload;
      _logWrite(_logInfo, _tag, _line.set('MB $journeyId ${r.event} ${r.n} $p t=${r.tNs}'));
    }
  }

  @override
  int get buffered => 0;

  @override
  int get capacity => 4096;

  @override
  void flush(String journeyId) {}

  @override
  void fullyDrawn() {
    // Posted to the platform thread; Activity.reportFullyDrawn() runs there.
    unawaited(_channel.invokeMethod<void>('fullyDrawn').catchError((Object _) {}));
  }

  @override
  String? nativePayload(String event) => null;
}

typedef _NsecNpC = Uint64 Function(Int32);
typedef _NsecNpDart = int Function(int);
typedef _SyslogC = Void Function(Int32, Pointer<Utf8>, VarArgs<(Pointer<Utf8>,)>);
typedef _SyslogDart = void Function(int, Pointer<Utf8>, Pointer<Utf8>);
typedef _NotifyPostC = Uint32 Function(Pointer<Utf8>);
typedef _NotifyPostDart = int Function(Pointer<Utf8>);
typedef _PayloadC = Int32 Function(Pointer<Utf8>, Pointer<Utf8>, Int32);
typedef _PayloadDart = int Function(Pointer<Utf8>, Pointer<Utf8>, int);

/// iOS: markers go to a pre-allocated in-memory ring buffer (4096 entries) on
/// `clock_gettime_nsec_np(CLOCK_UPTIME_RAW)`, flushed to
/// `Library/Caches/mobilebench/markers-<journeyId>.jsonl` at checkpoints and on background. The
/// driver-visible set also gets one `syslog` line (the unified log, like Flutter's own `print`
/// path) and a Darwin notification `org.example.mobilebench.<event>` (`notify_post`).
class IosMarkerBackend implements MarkerBackend {
  IosMarkerBackend({required String cachesDir}) : _dir = Directory('$cachesDir/mobilebench') {
    final p = DynamicLibrary.process();
    _clock = p.lookupFunction<_NsecNpC, _NsecNpDart>('clock_gettime_nsec_np');
    _syslog = p.lookupFunction<_SyslogC, _SyslogDart>('syslog');
    _notifyPost = p.lookupFunction<_NotifyPostC, _NotifyPostDart>('notify_post');
    _markerPayload = p.providesSymbol('mb_marker_payload')
        ? p.lookupFunction<_PayloadC, _PayloadDart>('mb_marker_payload')
        : null;
  }

  late final _PayloadDart? _markerPayload;
  final Pointer<Uint8> _payload = calloc<Uint8>(128);

  static const int _clockUptimeRaw = 8;
  static const int _logNotice = 5;
  static const int _ringSize = 4096;

  final Directory _dir;
  late final _NsecNpDart _clock;
  late final _SyslogDart _syslog;
  late final _NotifyPostDart _notifyPost;
  final List<MarkerRecord?> _ring = List<MarkerRecord?>.filled(_ringSize, null);
  int _count = 0;
  final _NativeText _line = _NativeText(256);
  final _NativeText _name = _NativeText(96);
  final Pointer<Utf8> _format = '%s'.toNativeUtf8();

  @override
  int nowNs() => _clock(_clockUptimeRaw);

  @override
  void emit(MarkerRecord r, {required bool mirror, required String journeyId}) {
    if (_count < _ringSize) {
      _ring[_count++] = r;
    }
    if (mirror) {
      final p = r.payload.isEmpty ? '-' : r.payload;
      _syslog(_logNotice, _format, _line.set('MB $journeyId ${r.event} ${r.n} $p t=${r.tNs}'));
      _notifyPost(_name.set('org.example.mobilebench.${r.event}'));
    }
  }

  @override
  int get buffered => _count;

  @override
  int get capacity => _ringSize;

  @override
  void flush(String journeyId) {
    if (_count == 0) {
      return;
    }
    final b = StringBuffer();
    for (var k = 0; k < _count; k++) {
      b
        ..write(_ring[k]!.toJsonLine())
        ..write('\n');
      _ring[k] = null;
    }
    _count = 0;
    _dir.createSync(recursive: true);
    File('${_dir.path}/markers-$journeyId.jsonl').writeAsStringSync(b.toString(), mode: FileMode.append, flush: true);
  }

  @override
  void fullyDrawn() {}

  /// `mb_marker_payload` (ios/Runner/MarkerPayload.swift): writes the payload into [_payload], 0 when unavailable.
  @override
  String? nativePayload(String event) {
    final n = _markerPayload?.call(_name.set(event), _payload.cast(), 128) ?? 0;
    return n > 0 ? _payload.cast<Utf8>().toDartString(length: n) : null;
  }
}

typedef _ArgcC = Pointer<Int32> Function();
typedef _ArgvC = Pointer<Pointer<Pointer<Utf8>>> Function();

/// iOS launch arguments (`-mb.<key> <value>`) from `_NSGetArgc` / `_NSGetArgv`, without native
/// code in the Runner. Skips argv[0].
List<String> iosProcessArguments() {
  final p = DynamicLibrary.process();
  final argc = p.lookupFunction<_ArgcC, _ArgcC>('_NSGetArgc')().value;
  final argv = p.lookupFunction<_ArgvC, _ArgvC>('_NSGetArgv')().value;
  return [for (var k = 1; k < argc; k++) argv[k].toDartString()];
}

typedef _GetenvC = Pointer<Utf8> Function(Pointer<Utf8>);

/// `getenv(3)` through `dart:ffi`. Needed on iOS, where Dart's `Platform.environment` is empty; the
/// Flutter engine itself reads `getenv("HOME")` there for its caches.
String? posixGetenv(String name) {
  final getenv = DynamicLibrary.process().lookupFunction<_GetenvC, _GetenvC>('getenv');
  final key = name.toNativeUtf8();
  try {
    final value = getenv(key);
    return value == nullptr ? null : value.toDartString();
  } finally {
    calloc.free(key);
  }
}

/// The app container on iOS (`HOME`), with the temp dir's parent (`<container>/tmp`) as fallback.
String iosHomeDirectory() => posixGetenv('HOME') ?? Directory.systemTemp.parent.path;

/// Picks the backend for the current platform; the host (tests) gets the memory backend.
MarkerBackend createPlatformBackend({required bool noop}) {
  if (noop) {
    return const NoopMarkerBackend();
  }
  if (Platform.isAndroid) {
    return AndroidMarkerBackend();
  }
  if (Platform.isIOS) {
    return IosMarkerBackend(cachesDir: '${iosHomeDirectory()}/Library/Caches');
  }
  return MemoryMarkerBackend();
}

/// Private persistent directory: Android `Context.getFilesDir()` (passed by MainActivity), iOS
/// `Library/Application Support` in the app container, host: the system temp dir.
String platformAppDataDir({String? androidFilesDir}) {
  if (Platform.isAndroid && androidFilesDir != null) {
    return androidFilesDir;
  }
  if (Platform.isIOS) {
    return '${iosHomeDirectory()}/Library/Application Support';
  }
  return Directory.systemTemp.path;
}
