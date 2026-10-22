import 'dart:io';
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_flutter/app.dart';
import 'package:mobilebench_flutter/app_controller.dart';
import 'package:mobilebench_flutter/benchkit/backend.dart';
import 'package:mobilebench_flutter/benchkit/benchkit.dart';
import 'package:mobilebench_flutter/domain/format.dart';
import 'package:mobilebench_flutter/domain/restore_record.dart';
import 'package:mobilebench_flutter/domain/store.dart';
import 'package:mobilebench_flutter/stream/replay_source.dart';
import 'package:mobilebench_flutter/stream/stream_client.dart';

import 'support.dart';

/// Widget-level checks of the reference application on the host (no device): first usable UI,
/// accessibility ids, selection, navigation, the animated panel, Insights, background and restore.
void main() {
  late MemoryMarkerBackend backend;
  late Directory dataDir;

  setUp(() {
    backend = MemoryMarkerBackend();
    dataDir = Directory.systemTemp.createTempSync('mb-app-');
  });

  tearDown(() => dataDir.deleteSync(recursive: true));

  AppController controllerFor(WidgetTester tester, {String profile = 'small', RestoreRecord? record}) {
    final f = fixture(profile);
    final bench = BenchKit(backend: backend, journeyId: 't');
    final store = record == null
        ? AppStore.fromFixture(f)
        : AppStore.restored(f, record.values, record.selection, record.lastSeq);
    return AppController(
      bench: bench,
      store: store,
      source: ReplayFrameSource(
        profile: profile,
        seed: f.seed,
        rate: 5,
        load: () => Future.value(assetBytes('$profile.stream.jsonl')),
        clockUs: () => tester.binding.clock.now().microsecondsSinceEpoch,
      ),
      restoreStore: RestoreStore(dataDir.path),
      initialRoutes: record?.route ?? const [Routes.list],
      initialAnchor: record?.anchor ?? 0,
      restored: record != null,
    );
  }

  // 1080 x 2400 px phone height at 420 dpi (2.625). The width is doubled because the test font
  // draws every glyph 1 em wide, about twice as wide as a system font; heights are unaffected.
  void phone(WidgetTester tester) {
    tester.view
      ..physicalSize = const Size(2160, 2400)
      ..devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);
  }

  List<String> payloads(String event) => backend.of(event).map((r) => r.payload).toList();

  String textOf(WidgetTester tester, String id) {
    final finder = find.descendant(of: find.bySemanticsIdentifier(id), matching: find.byType(Text));
    return tester.widget<Text>(finder.first).data!;
  }

  Future<void> settle(WidgetTester tester, [int ms = 600]) async {
    for (var t = 0; t < ms; t += 100) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('first usable UI, ids, live updates, selection and navigation', (tester) async {
    final semantics = tester.ensureSemantics();
    phone(tester);
    final c = controllerFor(tester);
    await tester.pumpWidget(BenchApp(controller: c));

    // 2400 px / 2.625 = 914.3 dp; minus 56 + 32 + 48 = 778 dp -> 10 full rows of 72 dp.
    expect(payloads('fui'), ['rows=10;h=778;sel=5;seq=0']);
    expect(payloads('screen'), ['r=list;nav=0']);
    expect(backend.fullyDrawnCalls, 1);
    for (final id in [
      'mb.screen.list',
      'mb.list',
      'mb.row.0',
      'mb.row.0.label',
      'mb.row.0.opt.a',
      'mb.row.0.opt.b',
      'mb.row.0.opt.c',
      'mb.summary',
      'mb.summary.count',
      'mb.summary.total',
      'mb.nav.selection',
      'mb.nav.insights',
      'mb.stream.status',
      'mb.state.digest',
    ]) {
      expect(find.bySemanticsIdentifier(id), findsOneWidget, reason: id);
    }
    expect(textOf(tester, 'mb.row.0.label'), 'Item 000');
    expect(textOf(tester, 'mb.summary.count'), 'Selected 5');
    // The first frame shows the fixture at seq 0 (the stream connects only after it).
    final seq0 = goldenProfile('small')['seq0Summary'] as Map<String, Object?>;
    expect(textOf(tester, 'mb.summary.total'), 'Total ${seq0['totalText']}');
    expect(textOf(tester, 'mb.stream.status'), 'Connecting');

    // The stream connects after the first usable UI; seq 1 is due at once, then every 200 ms.
    await tester.pump();
    expect(textOf(tester, 'mb.stream.status'), 'Live');
    expect(payloads('stream.open'), ['from=1']);
    expect(payloads('stream.live'), ['s=1']);
    await tester.pump(const Duration(milliseconds: 400));
    expect(c.store.lastAppliedSeq, 3);

    // Selection: option A of row 1.
    final before = c.store.selected[1];
    await tester.tap(find.bySemanticsIdentifier('mb.row.1.opt.a'));
    await tester.pump();
    expect(payloads('resp'), ['rev=1;sel=${c.store.summary.value.count}']);
    expect(c.store.selected[1], before == 0 ? -1 : 0);
    final optA = tester.getSemantics(find.bySemanticsIdentifier('mb.row.1.opt.a'));
    expect(optA.flagsCollection.isSelected, before == 0 ? Tristate.isFalse : Tristate.isTrue);

    // Selection screen and back.
    await tester.tap(find.bySemanticsIdentifier('mb.nav.selection'));
    await settle(tester);
    expect(find.bySemanticsIdentifier('mb.screen.selection'), findsOneWidget);
    expect(find.textContaining(' \u00B7 Option '), findsNWidgets(c.store.summary.value.count));
    await tester.tap(find.bySemanticsIdentifier('mb.nav.back'));
    await settle(tester);
    expect(payloads('screen'), ['r=list;nav=0', 'r=selection;nav=1', 'r=list;nav=2']);

    // Detail screen with the animated panel.
    await tester.tap(find.bySemanticsIdentifier('mb.row.3.label'));
    await settle(tester);
    expect(find.bySemanticsIdentifier('mb.screen.detail'), findsOneWidget);
    expect(find.bySemanticsIdentifier('mb.detail.panel'), findsNothing);
    await tester.tap(find.bySemanticsIdentifier('mb.detail.panel.toggle'));
    await settle(tester, 1000);
    expect(find.bySemanticsIdentifier('mb.detail.panel'), findsOneWidget);
    expect(textOf(tester, 'mb.detail.panel.toggle'), 'Hide details');
    expect(textOf(tester, 'mb.detail.values.a'), optionText(0, c.store.value(3, 0)));
    await tester.tap(find.bySemanticsIdentifier('mb.detail.panel.toggle'));
    await settle(tester, 1000);
    expect(find.bySemanticsIdentifier('mb.detail.panel'), findsNothing);
    expect(payloads('anim.start'), ['dir=show', 'dir=hide']);
    expect(payloads('anim.end'), ['dir=show', 'dir=hide']);
    await tester.tap(find.bySemanticsIdentifier('mb.nav.back'));
    await settle(tester);

    // Insights (embedded).
    await tester.tap(find.bySemanticsIdentifier('mb.nav.insights'));
    await settle(tester);
    expect(payloads('remote.request'), ['']);
    expect(payloads('remote.source'), ['src=embedded']);
    expect(payloads('remote.ready'), ['v=1']);
    expect(textOf(tester, 'mb.insights.source'), 'Source: embedded');
    expect(find.bySemanticsIdentifier('mb.insights.top'), findsOneWidget);
    expect(find.bySemanticsIdentifier('mb.insights.buckets'), findsOneWidget);
    expect(find.bySemanticsIdentifier('mb.insights.digest'), findsOneWidget);

    // Background: restoration record, stream closed, checkpoint k=0.
    for (final s in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]) {
      tester.binding.handleAppLifecycleStateChanged(s);
    }
    final seq = c.store.lastAppliedSeq;
    expect(payloads('bg'), ['fg=0']);
    expect(payloads('stream.closed'), ['why=bg']);
    expect(payloads('state').single, startsWith('s=$seq;d='));
    expect(c.bench.stateDigestText.value, 'k=0;seq=$seq;d=${c.store.stateDigest().substring(0, 12)}');
    expect(c.insightsDigestText.value, c.store.insightsDigest().substring(0, 12));
    final record = RestoreStore(dataDir.path).read(itemCount: c.store.itemCount)!;
    expect(record.route, ['list', 'insights']);
    expect(record.lastSeq, seq);

    // Foreground: `fg`, then `resume` on the next draw, then the stream reconnects.
    for (final s in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
      tester.binding.handleAppLifecycleStateChanged(s);
    }
    await tester.pump();
    expect(payloads('fg'), ['fg=1']);
    expect(payloads('resume'), ['r=insights;fg=1']);
    await tester.pump();
    expect(payloads('stream.open'), ['from=1', 'from=${seq + 1}']);
    expect(c.stream.status.value, StreamStatus.live);

    c.stream.disconnect('test');
    semantics.dispose();
  });

  testWidgets('a frame without window size (warm-up frame) does not count as first usable UI', (tester) async {
    tester.view
      ..physicalSize = Size.zero
      ..devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);
    final c = controllerFor(tester);
    final errors = <FlutterErrorDetails>[];
    final original = FlutterError.onError;
    FlutterError.onError = errors.add;
    await tester.pumpWidget(BenchApp(controller: c));
    FlutterError.onError = original;
    expect(errors.every((e) => e.exceptionAsString().contains('overflowed')), isTrue);
    expect(payloads('fui'), isEmpty);
    expect(payloads('screen'), isEmpty);
    tester.view.physicalSize = const Size(2160, 2400);
    await tester.pump();
    expect(payloads('fui'), ['rows=10;h=778;sel=5;seq=0']);
    expect(payloads('screen'), ['r=list;nav=0']);
    c.stream.disconnect('test');
  });

  testWidgets('restoration launch shows the restored screen with the exact state', (tester) async {
    final semantics = tester.ensureSemantics();
    phone(tester);
    final source = AppStore.fromFixture(fixture('small'))
      ..applyUpdate(1, 4, 111, 222, 333)
      ..toggle(4, 2);
    final record = RestoreRecord(
      route: const ['list', 'detail/4'],
      anchor: 2,
      selection: source.selectionEntries(),
      lastSeq: 1,
      values: source.values,
    );
    final c = controllerFor(tester, record: record);
    // The restored state is exactly the reference state at lastSeq (before the stream resumes).
    expect(c.store.lastAppliedSeq, 1);
    expect(c.store.stateDigest(), source.stateDigest());
    await tester.pumpWidget(BenchApp(controller: c));
    expect(payloads('restore'), ['r=detail/4;a=2']);
    expect(payloads('fui'), isEmpty);
    expect(payloads('screen'), ['r=detail/4;nav=0']);
    expect(textOf(tester, 'mb.detail.values.c'), 'C 3.33');
    await tester.pump();
    expect(payloads('stream.open'), ['from=2']);
    await tester.tap(find.bySemanticsIdentifier('mb.nav.back'));
    await settle(tester);
    expect(find.bySemanticsIdentifier('mb.row.2'), findsOneWidget);
    expect(c.listScroll.offset, 2 * 72.0);
    c.stream.disconnect('test');
    semantics.dispose();
  });
}
