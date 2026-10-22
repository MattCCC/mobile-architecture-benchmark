import 'dart:async';

import 'package:flutter/widgets.dart';

import 'benchkit/benchkit.dart';
import 'domain/restore_record.dart';
import 'domain/store.dart';
import 'stream/frame_source.dart';
import 'stream/stream_client.dart';

/// Route names of the reference application.
abstract final class Routes {
  static const String list = 'list';
  static const String selection = 'selection';
  static const String insights = 'insights';
  static String detail(int item) => 'detail/$item';
}

/// Wires the store, BenchKit, the update stream and the restoration record together and
/// implements the startup / lifecycle / checkpoint rules of the functional specification.
class AppController {
  AppController({
    required this.bench,
    required this.store,
    required FrameSource source,
    required this.restoreStore,
    required this.initialRoutes,
    this.initialAnchor = 0,
    this.restored = false,
  }) : listScroll = ScrollController(initialScrollOffset: initialAnchor * BenchKit.rowHeight.toDouble()) {
    stream = StreamClient(
      source: source,
      bench: bench,
      itemCount: store.itemCount,
      lastApplied: () => store.lastAppliedSeq,
      apply: store.applyUpdate,
      onCheckpoint: checkpoint,
    );
    bench
      ..itemCount = store.itemCount
      ..selectionCount = (() => store.summary.value.count)
      ..lastAppliedSeq = (() => store.lastAppliedSeq)
      ..gateArmed = !restored
      ..onFui = _connectAfterFrame
      ..onRestore = _connectAfterFrame
      ..onResume = _connectAfterFrame;
    navigator = BenchNavigatorObserver(bench, initialRoutes);
    if (restored) {
      // Values and selection are already restored in the store and the route stack and anchor are
      // the initial routes / scroll offset, so the first draw of the restored top screen emits
      // `restore`; the stream connects after it.
      bench.restoreApplied(initialRoutes.last, initialAnchor);
    }
  }

  final BenchKit bench;
  final AppStore store;
  final RestoreStore? restoreStore;
  final List<String> initialRoutes;
  final int initialAnchor;
  final bool restored;
  final ScrollController listScroll;
  late final StreamClient stream;
  late final BenchNavigatorObserver navigator;

  /// Text of `mb.insights.digest` (updated at checkpoints while Insights is shown).
  final ValueNotifier<String> insightsDigestText = ValueNotifier('-');
  bool insightsVisible = false;

  /// `fui`, `restore` and `resume` fire from a paint callback; the stream connects right after
  /// that frame, never inside it.
  void _connectAfterFrame() => scheduleMicrotask(stream.connect);

  void toggle(int item, int option) {
    final revision = store.toggle(item, option);
    bench.selectionChanged(revision, store.summary.value.count);
  }

  void openDetail(BuildContext context, int item) {
    unawaited(Navigator.of(context).pushNamed(Routes.detail(item)));
  }

  void openSelection(BuildContext context) {
    unawaited(Navigator.of(context).pushNamed(Routes.selection));
  }

  void openInsights(BuildContext context) {
    bench.insightsRequested();
    unawaited(Navigator.of(context).pushNamed(Routes.insights));
  }

  /// Checkpoint: digest, counters and `state` / `ctr` publication.
  void checkpoint(int k) {
    final digest = store.stateDigest();
    bench.publishState(
      k: k,
      seq: store.lastAppliedSeq,
      digest: digest,
      counters: stream.counters,
      rowBuilds: store.rowBuilds,
    );
    if (insightsVisible) {
      insightsDigestText.value = store.insightsDigest().substring(0, 12);
    }
  }

  /// Background: `bg`, restoration record v2, close the stream, checkpoint k = 0.
  void handleBackground() {
    bench.background();
    final record = RestoreRecord(
      route: List.of(navigator.stack),
      anchor: _anchor(),
      selection: store.selectionEntries(),
      lastSeq: store.lastAppliedSeq,
      values: store.values,
    );
    try {
      restoreStore?.write(record);
    } on Exception {
      bench.mark('err', 'code=persist-write');
    }
    stream.disconnect('bg');
    checkpoint(0);
  }

  /// Foreground: `fg`; the top screen's next draw emits `resume`, which reconnects the stream.
  void handleForeground() => bench.foreground();

  int _anchor() {
    if (!listScroll.hasClients) {
      return initialAnchor;
    }
    final a = listScroll.offset ~/ BenchKit.rowHeight;
    return a.clamp(0, store.itemCount - 1);
  }
}

/// Tracks the route stack and reports transition starts (push and pop) to BenchKit. Routes created
/// before the first frame (initial routes) do not count as transitions.
class BenchNavigatorObserver extends NavigatorObserver {
  BenchNavigatorObserver(this.bench, List<String> initial) {
    bench.topRoute = initial.last;
  }

  final BenchKit bench;
  final List<String> stack = [];
  bool _started = false;

  /// Called after the first frame; later pushes and pops are transitions.
  void start() => _started = true;

  void _report() {
    if (stack.isEmpty) {
      return;
    }
    if (_started) {
      bench.routeTransitionStarted(stack.last);
    } else {
      bench.topRoute = stack.last;
    }
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.add(route.settings.name ?? '?');
    _report();
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    if (stack.isNotEmpty) {
      stack.removeLast();
    }
    _report();
  }

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) {
    stack.remove(route.settings.name);
    _report();
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final at = stack.lastIndexOf(oldRoute?.settings.name ?? '');
    if (at >= 0 && newRoute != null) {
      stack[at] = newRoute.settings.name ?? '?';
    }
    _report();
  }
}

/// Gives widgets access to the controller.
class AppScope extends InheritedWidget {
  const AppScope({super.key, required this.controller, required super.child});

  final AppController controller;

  static AppController of(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.controller;

  @override
  bool updateShouldNotify(AppScope oldWidget) => oldWidget.controller != controller;
}
