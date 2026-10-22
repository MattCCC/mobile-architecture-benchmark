import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../benchkit/benchkit.dart';
import '../domain/format.dart';
import 'frame_source.dart';

/// The six status words of `mb.stream.status`.
enum StreamStatus {
  connecting('Connecting'),
  live('Live'),
  paused('Paused'),
  stale('Stale'),
  disconnected('Disconnected'),
  ended('Ended');

  const StreamStatus(this.word);

  final String word;
}

/// Client rules of the update stream, independent of the transport: apply in seq
/// order, count duplicates, reconnect on gaps, stale detection, deterministic back-off, checkpoint
/// after `c` / `e` plus 500 ms without updates.
class StreamClient {
  StreamClient({
    required this.source,
    required this.bench,
    required this.itemCount,
    required this.lastApplied,
    required this.apply,
    required this.onCheckpoint,
  });

  static const Duration staleAfter = Duration(seconds: 2);
  static const Duration reconnectAfter = Duration(seconds: 3);
  static const Duration checkpointQuiet = Duration(milliseconds: 500);
  static const List<int> backoffMs = [250, 500, 1000, 2000];

  final FrameSource source;
  final BenchKit bench;
  final int itemCount;
  final int Function() lastApplied;
  final void Function(int seq, int item, int a, int b, int c) apply;
  final void Function(int k) onCheckpoint;

  final ValueNotifier<StreamStatus> status = ValueNotifier(StreamStatus.connecting);
  final StreamCounters counters = StreamCounters();

  int _attempt = 0;
  int _backoff = 0;
  bool _wanted = false;
  bool _appliedSinceOpen = false;
  bool _timersSuspended = false;
  int? _pendingCheckpoint;
  Timer? _stale;
  Timer? _staleReconnect;
  Timer? _reconnect;
  Timer? _checkpoint;

  /// Opens the stream from `lastApplied + 1`.
  void connect() {
    _wanted = true;
    _reconnect?.cancel();
    _cancelStale();
    _attempt++;
    status.value = StreamStatus.connecting;
    bench.mark('stream.connect', 'a=$_attempt');
    final from = lastApplied() + 1;
    source.open(
      from: from,
      onOpen: () {
        _appliedSinceOpen = false;
        bench.mark('stream.open', 'from=$from');
      },
      onFrame: _onFrame,
      onClosed: _onClosed,
    );
  }

  /// Closes the stream on purpose (background); no reconnect until [connect].
  void disconnect(String why) {
    _wanted = false;
    _reconnect?.cancel();
    _checkpoint?.cancel();
    _pendingCheckpoint = null;
    _cancelStale();
    source.close();
    status.value = StreamStatus.disconnected;
    bench.mark('stream.closed', 'why=$why');
  }

  void _onFrame(String text) {
    final Object? frame;
    try {
      frame = jsonDecode(text);
    } on FormatException {
      bench.mark('err', 'code=stream-protocol');
      return;
    }
    if (frame is! Map<String, Object?>) {
      bench.mark('err', 'code=stream-protocol');
      return;
    }
    switch (frame['t']) {
      case 'u':
        _onUpdate(frame);
      case 'h':
        _backoff = 0;
        _timersSuspended = false;
        status.value = StreamStatus.live;
        _armStale();
      case 'c':
        final k = frame['k'];
        _timersSuspended = true;
        _cancelStale();
        status.value = StreamStatus.paused;
        _pendingCheckpoint = k is int ? k : 0;
        _armCheckpoint();
      case 'r':
        _timersSuspended = false;
        status.value = StreamStatus.live;
        _armStale();
      case 'e':
        _timersSuspended = true;
        _cancelStale();
        status.value = StreamStatus.ended;
        _pendingCheckpoint = 0;
        _armCheckpoint();
      default:
        bench.mark('err', 'code=stream-protocol');
    }
  }

  void _onUpdate(Map<String, Object?> m) {
    final s = m['s'];
    final i = m['i'];
    final v = m['v'];
    if (s is! int || i is! int || i < 0 || i >= itemCount || v is! List<Object?> || v.length != optionsPerItem) {
      bench.mark('err', 'code=stream-protocol');
      return;
    }
    final a = v[0];
    final b = v[1];
    final c = v[2];
    if (a is! int || b is! int || c is! int || !_inRange(a) || !_inRange(b) || !_inRange(c)) {
      bench.mark('err', 'code=stream-protocol');
      return;
    }
    counters.received++;
    final last = lastApplied();
    if (s <= last) {
      counters.duplicates++;
      return;
    }
    if (s > last + 1) {
      counters.gaps++;
      bench.mark('err', 'code=stream-gap');
      _closeAndReconnect('gap');
      return;
    }
    apply(s, i, a, b, c);
    counters.applied++;
    if (!_appliedSinceOpen) {
      _appliedSinceOpen = true;
      bench.mark('stream.live', 's=$s');
    }
    if (status.value == StreamStatus.stale) {
      status.value = StreamStatus.live;
    }
    _armStale();
    if (_pendingCheckpoint != null) {
      _armCheckpoint();
    }
  }

  static bool _inRange(int x) => x >= valueMin && x <= valueMax;

  void _onClosed(String why) {
    _cancelStale();
    status.value = StreamStatus.disconnected;
    bench.mark('stream.closed', 'why=$why');
    if (_wanted) {
      _scheduleReconnect();
    }
  }

  void _closeAndReconnect(String why) {
    source.close();
    _onClosed(why);
  }

  void _scheduleReconnect() {
    final ms = backoffMs[_backoff < backoffMs.length ? _backoff : backoffMs.length - 1];
    _backoff++;
    _reconnect?.cancel();
    _reconnect = Timer(Duration(milliseconds: ms), connect);
  }

  void _armStale() {
    _cancelStale();
    if (_timersSuspended) {
      return;
    }
    _stale = Timer(staleAfter, () {
      status.value = StreamStatus.stale;
      bench.mark('stream.stale');
    });
    _staleReconnect = Timer(reconnectAfter, () => _closeAndReconnect('stale'));
  }

  void _cancelStale() {
    _stale?.cancel();
    _staleReconnect?.cancel();
    _stale = null;
    _staleReconnect = null;
  }

  void _armCheckpoint() {
    _checkpoint?.cancel();
    _checkpoint = Timer(checkpointQuiet, () {
      final k = _pendingCheckpoint;
      _pendingCheckpoint = null;
      if (k != null) {
        onCheckpoint(k);
      }
    });
  }
}
