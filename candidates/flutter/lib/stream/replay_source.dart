import 'dart:async';
import 'dart:typed_data';

import 'frame_source.dart';

/// In-app replay of the bundled update stream (`assets/fixtures/<profile>.stream.jsonl`: update
/// frames seq 1..N in wire form, LF-terminated, byte-identical to the stream golden.json hashes).
///
/// It behaves like the local server for one session: a hello frame on every connection, message
/// k due at `t0 + (k - from0) / rate` on a monotonic clock (absolute schedule, no drift), catch-up
/// of already-due messages on reconnect, and an end frame after the last bundled message. Frames
/// are handed over as text; the client parses each one on receipt, as it would from a socket.
class ReplayFrameSource implements FrameSource {
  ReplayFrameSource({
    required this.profile,
    required this.seed,
    required this.rate,
    required this.load,
    int Function()? clockUs,
    this.session = 'replay',
  }) : _clockUs = clockUs ?? _monotonicUs();

  final String profile;
  final int seed;
  final int rate;
  final String session;

  /// Loads the bundled stream bytes (asset `<profile>.stream.jsonl`).
  final Future<Uint8List> Function() load;
  final int Function() _clockUs;

  Uint8List? _bytes;
  List<int>? _lineStarts;
  Future<void>? _loading;
  int? _t0Us;
  int _from0 = 1;
  int _next = 1;
  int _connection = 0;
  bool _open = false;
  bool _endSent = false;
  Timer? _timer;

  static int Function() _monotonicUs() {
    final sw = Stopwatch()..start();
    return () => sw.elapsedMicroseconds;
  }

  /// Number of bundled update messages (known after the first load).
  int? get messageCount => _lineStarts == null ? null : _lineStarts!.length - 1;

  @override
  void open({
    required int from,
    required void Function() onOpen,
    required void Function(String frame) onFrame,
    required void Function(String why) onClosed,
  }) {
    close();
    final connection = ++_connection;
    _open = true;
    _loading ??= load().then(_index);
    _loading!.then(
      (_) {
        if (!_open || connection != _connection) {
          return;
        }
        if (_t0Us == null) {
          _t0Us = _clockUs();
          _from0 = from;
        }
        _next = from;
        _endSent = false;
        onOpen();
        onFrame('{"t":"h","session":"$session","profile":"$profile","seed":$seed,"rate":$rate,"from":$from}');
        _pump(connection, onFrame);
      },
      onError: (Object _) {
        if (_open && connection == _connection) {
          _open = false;
          _loading = null;
          onClosed('load-failed');
        }
      },
    );
  }

  @override
  void close() {
    _open = false;
    _timer?.cancel();
    _timer = null;
  }

  void _index(Uint8List bytes) {
    final starts = <int>[0];
    for (var k = 0; k < bytes.length; k++) {
      if (bytes[k] == 0x0A) {
        starts.add(k + 1);
      }
    }
    _bytes = bytes;
    _lineStarts = starts;
  }

  int _dueUs(int seq) => _t0Us! + ((seq - _from0) * 1000000) ~/ rate;

  void _pump(int connection, void Function(String frame) onFrame) {
    _timer = null;
    if (!_open || connection != _connection) {
      return;
    }
    final starts = _lineStarts!;
    final total = starts.length - 1;
    final now = _clockUs();
    while (_next <= total && _dueUs(_next) <= now) {
      final seq = _next++;
      onFrame(String.fromCharCodes(_bytes!, starts[seq - 1], starts[seq] - 1));
      if (!_open || connection != _connection) {
        return;
      }
    }
    if (_next > total) {
      if (!_endSent) {
        _endSent = true;
        onFrame('{"t":"e","last":$total}');
      }
      return;
    }
    // Dart timers have millisecond granularity: round up, so a timer never fires before the next
    // message is due (no spinning); delivery is at most 1 ms late and the schedule never drifts.
    final waitMs = (_dueUs(_next) - now + 999) ~/ 1000;
    _timer = Timer(Duration(milliseconds: waitMs), () => _pump(connection, onFrame));
  }
}
