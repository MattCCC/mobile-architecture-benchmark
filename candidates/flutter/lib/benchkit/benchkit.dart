import 'package:flutter/foundation.dart';

import 'backend.dart';

/// Draw-probe kinds.
enum ProbeKind { row, summary, screen, resume, restore, insights }

/// Stream counters published at checkpoints (`ctr` marker).
class StreamCounters {
  int received = 0;
  int applied = 0;
  int duplicates = 0;
  int gaps = 0;
}

/// Dart facade of BenchKit: marker emission, the first-usable-UI gate and the probe
/// token rules. Probes call [probeDrawn] from their paint callback; tokens come from this object's
/// state, never from framework callbacks. The backend decides where markers go (platform trace
/// and log, or memory on the host).
class BenchKit {
  BenchKit({required this.backend, required this.journeyId, this.mirrorAll = false, this.enabled = true});

  static const int rowHeight = 72;

  /// Markers mirrored to the platform log by default (driver-visible set).
  static const Set<String> controlSet = {
    'fui',
    'resume',
    'restore',
    'remote.ready',
    'remote.error',
    'state',
    'ctr',
    'err',
    'a11y',
    'launch',
  };

  static final RegExp _eventPattern = RegExp(r'^[a-z0-9.]{1,24}$');

  final MarkerBackend backend;
  final String journeyId;
  final bool mirrorAll;

  /// False in the `MB_BENCHKIT=noop` overhead build: no markers, probes skip their calls.
  final bool enabled;

  final Map<String, int> _ordinals = {};

  // Probe token state.
  final ValueNotifier<int> selectionRevision = ValueNotifier(0);
  final ValueNotifier<int> navSeq = ValueNotifier(0);
  final ValueNotifier<int> fgSeq = ValueNotifier(0);
  final ValueNotifier<String?> restoreToken = ValueNotifier(null);
  final ValueNotifier<int> insightsRequest = ValueNotifier(0);

  /// Text of the `mb.state.digest` element: `k=<k>;seq=<n>;d=<12 hex>`.
  final ValueNotifier<String> stateDigestText = ValueNotifier('-');

  String topRoute = 'list';
  int _selectionCount = 0;
  int _lastResp = 0;
  int _lastScreenNav = -1;
  int _lastResumeFg = 0;
  bool _restoreEmitted = false;
  int _lastInsightsReady = 0;

  // First-usable-UI gate.
  bool gateArmed = true;
  int? _h;
  int? _kReq;
  int _itemCount = 1 << 30;
  final Set<int> _rowsDrawn = {};
  bool _summaryDrawn = false;
  bool _fuiDone = false;

  /// Supplies the `fui` payload fields `sel` and `seq`.
  int Function() selectionCount = () => 0;
  int Function() lastAppliedSeq = () => 0;

  VoidCallback? onFui;
  VoidCallback? onResume;
  VoidCallback? onRestore;

  bool get fuiDone => _fuiDone;
  int? get kReq => _kReq;

  int nowNs() => backend.nowNs();

  /// Records [event] with the next per-event ordinal and returns the ordinal (0 when disabled).
  int mark(String event, [String payload = '']) {
    if (!enabled) {
      return 0;
    }
    assert(_eventPattern.hasMatch(event), 'invalid marker event "$event"');
    final p = sanitizePayload(payload);
    final n = (_ordinals[event] ?? 0) + 1;
    _ordinals[event] = n;
    final t = backend.nowNs();
    backend.emit(MarkerRecord(event, n, t, p), mirror: mirrorAll || controlSet.contains(event), journeyId: journeyId);
    if (backend.buffered >= (backend.capacity * 3) ~/ 4) {
      backend.flush(journeyId);
      final fn = (_ordinals['flush'] ?? 0) + 1;
      _ordinals['flush'] = fn;
      backend.emit(MarkerRecord('flush', fn, backend.nowNs(), ''), mirror: mirrorAll, journeyId: journeyId);
    }
    return n;
  }

  /// Payload rule: at most 64 printable ASCII characters, no `|` and no spaces.
  static String sanitizePayload(String payload) {
    final out = StringBuffer();
    for (final c in payload.codeUnits) {
      if (out.length == 64) {
        break;
      }
      if (c > 0x20 && c < 0x7F && c != 0x7C && c != 0x22 && c != 0x5C) {
        out.writeCharCode(c);
      }
    }
    return out.toString();
  }

  /// Number of items in the dataset (caps `kReq` for very small profiles).
  set itemCount(int n) => _itemCount = n;

  /// The list container's height in dp at its first layout; arms the FUI gate. A layout without
  /// height (Flutter's warm-up frame runs before the platform reports the window size) is not a
  /// first layout and is ignored, and probe draws before arming do not count.
  void listLayout(double h) {
    if (_kReq != null || h < 1) {
      return;
    }
    final hInt = h.floor();
    var k = hInt ~/ rowHeight;
    if (k < 1) {
      k = 1;
    }
    if (k > _itemCount) {
      k = _itemCount;
    }
    _h = hInt;
    _kReq = k;
    _rowsDrawn.clear();
    _summaryDrawn = false;
  }

  /// Current token of a probe of [kind] (probes repaint when it changes).
  String tokenFor(ProbeKind kind) => switch (kind) {
    ProbeKind.row => 'fui0',
    ProbeKind.summary => _fuiDone ? 'rev:${selectionRevision.value}' : 'fui0',
    ProbeKind.screen => 'nav:${navSeq.value}',
    ProbeKind.resume => 'fg:${fgSeq.value}',
    ProbeKind.restore => restoreToken.value ?? '',
    ProbeKind.insights => 'ins:${insightsRequest.value}',
  };

  /// Called by draw probes from their paint callback.
  void probeDrawn(ProbeKind kind, int index, String token, {String route = ''}) {
    if (!enabled) {
      return;
    }
    switch (kind) {
      case ProbeKind.row:
        final k = _kReq;
        if (_fuiDone || !gateArmed || k == null || token != 'fui0' || index >= k) {
          return;
        }
        _rowsDrawn.add(index);
        _checkGate();
      case ProbeKind.summary:
        if (!_fuiDone) {
          if (gateArmed && _kReq != null && token == 'fui0') {
            _summaryDrawn = true;
            _checkGate();
          }
          return;
        }
        if (!token.startsWith('rev:')) {
          return;
        }
        final rev = int.parse(token.substring(4));
        if (rev > _lastResp) {
          _lastResp = rev;
          mark('resp', 'rev=$rev;sel=$_selectionCount');
        }
      case ProbeKind.screen:
        if (route != topRoute || !token.startsWith('nav:')) {
          return;
        }
        final nav = int.parse(token.substring(4));
        if (nav != _lastScreenNav) {
          _lastScreenNav = nav;
          mark('screen', 'r=$route;nav=$nav');
        }
      case ProbeKind.resume:
        if (route != topRoute || !token.startsWith('fg:')) {
          return;
        }
        final fg = int.parse(token.substring(3));
        if (fg > _lastResumeFg) {
          _lastResumeFg = fg;
          mark('resume', 'r=$route;fg=$fg');
          onResume?.call();
        }
      case ProbeKind.restore:
        final expected = restoreToken.value;
        if (_restoreEmitted || expected == null || token != expected || route != topRoute) {
          return;
        }
        _restoreEmitted = true;
        final anchor = expected.substring(expected.lastIndexOf(':') + 1);
        mark('restore', 'r=$route;a=$anchor');
        onRestore?.call();
      case ProbeKind.insights:
        if (!token.startsWith('ins:')) {
          return;
        }
        final req = int.parse(token.substring(4));
        if (req > _lastInsightsReady) {
          _lastInsightsReady = req;
          mark('remote.ready', 'v=1');
        }
    }
  }

  void _checkGate() {
    final k = _kReq;
    if (k == null || !_summaryDrawn || _rowsDrawn.length < k) {
      return;
    }
    _fuiDone = true;
    _rowsDrawn.clear();
    mark('fui', 'rows=$k;h=$_h;sel=${selectionCount()};seq=${lastAppliedSeq()}');
    fullyDrawn();
    onFui?.call();
  }

  /// The selection changed; the summary probe's next draw emits `resp`.
  void selectionChanged(int revision, int count) {
    _selectionCount = count;
    selectionRevision.value = revision;
  }

  /// A route transition started (push or pop); [route] is the new top route.
  void routeTransitionStarted(String route) {
    topRoute = route;
    navSeq.value++;
  }

  /// Background: `bg` marker (interim: from Flutter's lifecycle, see README).
  void background() => mark('bg', 'fg=${fgSeq.value}');

  /// Foreground: increments `fgSeq` and emits `fg`; the top screen's next draw emits `resume`.
  void foreground() {
    fgSeq.value++;
    mark('fg', 'fg=${fgSeq.value}');
  }

  /// The restoration record has been applied; the restored screen's next draw emits `restore`.
  void restoreApplied(String route, int anchor) {
    topRoute = route;
    restoreToken.value = 'restore:$route:$anchor';
  }

  /// Insights was opened (embedded feature; remote loading is not applicable to this candidate).
  void insightsRequested() {
    mark('remote.request');
    mark('remote.source', 'src=embedded');
    insightsRequest.value++;
  }

  /// Checkpoint publication.
  void publishState({
    required int k,
    required int seq,
    required String digest,
    required StreamCounters counters,
    required int rowBuilds,
  }) {
    mark('state', 's=$seq;d=${digest.substring(0, 16)}');
    mark(
      'ctr',
      'r=${counters.received};a=${counters.applied};dup=${counters.duplicates};gap=${counters.gaps};rows=$rowBuilds',
    );
    final mem = enabled ? backend.nativePayload('mem') : null;
    if (mem != null) {
      mark('mem', mem);
    }
    stateDigestText.value = 'k=$k;seq=$seq;d=${digest.substring(0, 12)}';
    flush();
  }

  void flush() {
    if (enabled) {
      backend.flush(journeyId);
    }
  }

  void fullyDrawn() {
    if (enabled) {
      backend.fullyDrawn();
    }
  }
}
