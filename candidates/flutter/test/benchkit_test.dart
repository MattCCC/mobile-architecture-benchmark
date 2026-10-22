import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_flutter/benchkit/backend.dart';
import 'package:mobilebench_flutter/benchkit/backend_ffi.dart';
import 'package:mobilebench_flutter/benchkit/benchkit.dart';
import 'package:mobilebench_flutter/benchkit/launch_config.dart';

void main() {
  late MemoryMarkerBackend backend;
  late BenchKit bench;
  var clock = 0;

  setUp(() {
    clock = 1000;
    backend = MemoryMarkerBackend(clock: () => clock += 10);
    bench = BenchKit(backend: backend, journeyId: 'j1')
      ..selectionCount = (() => 50)
      ..lastAppliedSeq = (() => 0);
  });

  void drawFuiSet({int rows = 9}) {
    for (var i = 0; i < rows; i++) {
      bench.probeDrawn(ProbeKind.row, i, 'fui0');
    }
    bench.probeDrawn(ProbeKind.summary, 0, 'fui0');
  }

  group('first usable UI gate', () {
    test('fires once when rows 0..kReq-1 and the summary are drawn', () {
      var fired = 0;
      bench.onFui = () => fired++;
      bench.listLayout(700.6);
      expect(bench.kReq, 9);
      for (var i = 0; i < 8; i++) {
        bench.probeDrawn(ProbeKind.row, i, 'fui0');
      }
      bench.probeDrawn(ProbeKind.row, 12, 'fui0');
      bench.probeDrawn(ProbeKind.summary, 0, 'fui0');
      expect(backend.of('fui'), isEmpty, reason: 'row 8 not drawn yet');
      bench.probeDrawn(ProbeKind.row, 8, 'fui0');
      bench.probeDrawn(ProbeKind.row, 8, 'fui0');
      drawFuiSet();
      final fui = backend.of('fui');
      expect(fui, hasLength(1));
      expect(fui.single.payload, 'rows=9;h=700;sel=50;seq=0');
      expect(fui.single.n, 1);
      expect(fired, 1);
      expect(backend.fullyDrawnCalls, 1);
      expect(backend.mirrored.single, 'MB j1 fui 1 rows=9;h=700;sel=50;seq=0');
    });

    test('ignores a layout without height and probe draws before arming', () {
      bench.listLayout(0);
      expect(bench.kReq, isNull);
      drawFuiSet();
      expect(backend.of('fui'), isEmpty);
      bench.listLayout(720);
      expect(bench.kReq, 10);
      bench.probeDrawn(ProbeKind.summary, 0, 'fui0');
      for (var i = 0; i < 9; i++) {
        bench.probeDrawn(ProbeKind.row, i, 'fui0');
      }
      expect(backend.of('fui'), isEmpty, reason: 'row 9 not drawn after arming');
      bench.probeDrawn(ProbeKind.row, 9, 'fui0');
      expect(backend.of('fui').single.payload, 'rows=10;h=720;sel=50;seq=0');
    });

    test('is not armed on restore launches', () {
      bench
        ..gateArmed = false
        ..listLayout(700);
      drawFuiSet();
      expect(backend.of('fui'), isEmpty);
    });

    test('kReq is capped by the item count', () {
      bench
        ..itemCount = 4
        ..listLayout(2000);
      expect(bench.kReq, 4);
    });
  });

  group('probe tokens', () {
    setUp(() {
      bench.listLayout(700);
      drawFuiSet();
    });

    test('resp on the first draw of each new selection revision', () {
      bench.probeDrawn(ProbeKind.summary, 0, bench.tokenFor(ProbeKind.summary));
      expect(backend.of('resp'), isEmpty);
      bench.selectionChanged(1, 51);
      bench.probeDrawn(ProbeKind.summary, 0, bench.tokenFor(ProbeKind.summary));
      bench.probeDrawn(ProbeKind.summary, 0, bench.tokenFor(ProbeKind.summary));
      expect(backend.of('resp').map((r) => r.payload), ['rev=1;sel=51']);
      expect(backend.mirrored.where((l) => l.contains(' resp ')), isEmpty, reason: 'resp is not in the control set');
    });

    test('screen for the top route only, once per navigation sequence', () {
      bench.probeDrawn(ProbeKind.screen, 0, bench.tokenFor(ProbeKind.screen), route: 'list');
      bench.routeTransitionStarted('selection');
      bench.probeDrawn(ProbeKind.screen, 0, bench.tokenFor(ProbeKind.screen), route: 'list');
      bench.probeDrawn(ProbeKind.screen, 0, bench.tokenFor(ProbeKind.screen), route: 'selection');
      bench.probeDrawn(ProbeKind.screen, 0, bench.tokenFor(ProbeKind.screen), route: 'selection');
      bench.routeTransitionStarted('list');
      bench.probeDrawn(ProbeKind.screen, 0, bench.tokenFor(ProbeKind.screen), route: 'list');
      expect(backend.of('screen').map((r) => r.payload), ['r=list;nav=0', 'r=selection;nav=1', 'r=list;nav=2']);
    });

    test('resume after foreground, then the resume callback', () {
      var resumed = 0;
      bench.onResume = () => resumed++;
      bench.probeDrawn(ProbeKind.resume, 0, bench.tokenFor(ProbeKind.resume), route: 'list');
      bench.background();
      bench.foreground();
      bench.probeDrawn(ProbeKind.resume, 0, bench.tokenFor(ProbeKind.resume), route: 'list');
      bench.probeDrawn(ProbeKind.resume, 0, bench.tokenFor(ProbeKind.resume), route: 'list');
      expect(backend.of('bg').single.payload, 'fg=0');
      expect(backend.of('fg').single.payload, 'fg=1');
      expect(backend.of('resume').single.payload, 'r=list;fg=1');
      expect(resumed, 1);
    });

    test('restore once, on the restored screen', () {
      var restored = 0;
      bench.onRestore = () => restored++;
      bench.restoreApplied('detail/21', 20);
      bench.probeDrawn(ProbeKind.restore, 0, bench.tokenFor(ProbeKind.restore), route: 'list');
      bench.probeDrawn(ProbeKind.restore, 0, bench.tokenFor(ProbeKind.restore), route: 'detail/21');
      bench.probeDrawn(ProbeKind.restore, 0, bench.tokenFor(ProbeKind.restore), route: 'detail/21');
      expect(backend.of('restore').single.payload, 'r=detail/21;a=20');
      expect(restored, 1);
    });
  });

  group('markers', () {
    test('ordinals per event, monotonic timestamps, payload rules', () {
      bench.mark('scroll.idle');
      bench.mark('scroll.idle');
      bench.mark('err', 'code=x y|z');
      expect(backend.of('scroll.idle').map((r) => r.n), [1, 2]);
      expect(backend.records[1].tNs, greaterThan(backend.records[0].tNs));
      expect(backend.of('err').single.payload, 'code=xyz');
      expect(BenchKit.sanitizePayload('a' * 80), hasLength(64));
    });

    test('mirror: control set by default, everything with mb.markerMirror=all', () {
      bench.mark('scroll.idle');
      bench.mark('state', 's=1;d=00');
      expect(backend.mirrored, ['MB j1 state 1 s=1;d=00']);
      final all = BenchKit(backend: backend, journeyId: 'j2', mirrorAll: true)..mark('scroll.idle');
      expect(all.journeyId, 'j2');
      expect(backend.mirrored.last, 'MB j2 scroll.idle 1 -');
    });

    test('checkpoint publishes state, ctr and the digest element text', () {
      final counters = StreamCounters()
        ..received = 12
        ..applied = 11
        ..duplicates = 1;
      bench.publishState(k: 3, seq: 11, digest: '0123456789abcdef0123456789', counters: counters, rowBuilds: 40);
      expect(backend.of('state').single.payload, 's=11;d=0123456789abcdef');
      expect(backend.of('ctr').single.payload, 'r=12;a=11;dup=1;gap=0;rows=40');
      expect(bench.stateDigestText.value, 'k=3;seq=11;d=0123456789ab');
      expect(backend.flushes, 1);
    });

    test('disabled (noop build) emits nothing', () {
      final off = BenchKit(backend: backend, journeyId: 'j', enabled: false)..listLayout(700);
      for (var i = 0; i < 9; i++) {
        off.probeDrawn(ProbeKind.row, i, 'fui0');
      }
      off.probeDrawn(ProbeKind.summary, 0, 'fui0');
      off.mark('fui');
      expect(backend.records, isEmpty);
    });
  });

  group('getenv through dart:ffi (used for the iOS app container)', () {
    test('matches Platform.environment on the host and returns null for unset names', () {
      expect(posixGetenv('HOME'), Platform.environment['HOME']);
      expect(posixGetenv('MB_SURELY_UNSET_VARIABLE_42'), isNull);
    });
  });

  group('launch configuration', () {
    test('parses known keys, reports invalid and unknown ones, reads internal arguments', () {
      final c = LaunchConfig.parse([
        '-mb.profile',
        'small',
        '-mb.restore',
        '1',
        '-mb.markerMirror',
        'all',
        '-mb.semantics',
        'on',
        '-mb.journey',
        'J-7',
        '-mb.token',
        'XYZ',
        '-mb.colour',
        'red',
        '--mb-internal-files-dir=/data/files',
        '--mb-internal-saved-state=1',
        '-NSSomething',
        'YES',
      ]);
      expect(c.profile, 'small');
      expect(c.restore, isTrue);
      expect(c.mirrorAll, isTrue);
      expect(c.semanticsOn, isTrue);
      expect(c.journeyId, 'J-7');
      expect(c.invalidKeys, ['mb.token']);
      expect(c.unknownKeys, ['mb.colour']);
      expect(c.androidFilesDir, '/data/files');
      expect(c.savedState, 1);
    });

    test('defaults', () {
      final c = LaunchConfig.parse(const []);
      expect(c.profile, 'representative');
      expect(c.restore, isFalse);
      expect(c.mirrorAll, isFalse);
      expect(c.semanticsOn, isFalse);
      expect(c.journeyId, '-');
      expect(c.savedState, isNull);
    });
  });
}
