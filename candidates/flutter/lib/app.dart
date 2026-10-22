import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'ui/detail_screen.dart';
import 'ui/error_screen.dart';
import 'ui/insights_screen.dart';
import 'ui/list_screen.dart';
import 'ui/selection_screen.dart';
import 'ui/style.dart';

/// Root widget: Material app with stack navigation (default platform transitions), the lifecycle
/// hooks of the restoration contract and the `mb.state.digest` checkpoint element on every screen.
class BenchApp extends StatefulWidget {
  const BenchApp({super.key, required this.controller});

  final AppController controller;

  @override
  State<BenchApp> createState() => _BenchAppState();
}

class _BenchAppState extends State<BenchApp> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    final c = widget.controller;
    // Interim: Flutter's lifecycle (paused = background, leaving paused = foreground); the core
    // BenchKit takes these from the platform lifecycle instead (README "Instrumentation").
    _lifecycle = AppLifecycleListener(onPause: c.handleBackground, onRestart: c.handleForeground);
    WidgetsBinding.instance.addPostFrameCallback((_) => c.navigator.start());
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  Route<void> _route(RouteSettings settings) {
    final name = settings.name ?? Routes.list;
    final Widget page;
    if (name == Routes.selection) {
      page = const SelectionScreen();
    } else if (name == Routes.insights) {
      page = const InsightsScreen();
    } else if (name.startsWith('detail/')) {
      page = DetailScreen(item: int.parse(name.substring(7)));
    } else {
      page = const ListScreen();
    }
    return MaterialPageRoute<void>(
      settings: RouteSettings(name: name),
      builder: (_) => page,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    return AppScope(
      controller: c,
      child: MaterialApp(
        title: 'MB Flutter',
        debugShowCheckedModeBanner: false,
        theme: Style.theme(),
        themeMode: ThemeMode.light,
        navigatorObservers: [c.navigator],
        onGenerateInitialRoutes: (_) => [for (final r in c.initialRoutes) _route(RouteSettings(name: r))],
        onGenerateRoute: _route,
        builder: (context, child) => _DigestOverlay(controller: c, child: child!),
      ),
    );
  }
}

/// `mb.state.digest`: tiny low-contrast text, updated only at checkpoints, visible on every screen.
class _DigestOverlay extends StatelessWidget {
  const _DigestOverlay({required this.controller, required this.child});

  final AppController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top + Style.headerHeight + 8;
    return Stack(
      children: [
        child,
        Positioned(
          top: top,
          right: 8,
          child: ValueListenableBuilder<String>(
            valueListenable: controller.bench.stateDigestText,
            builder: (context, text, _) => Id(
              'mb.state.digest',
              child: Text(
                text,
                textDirection: TextDirection.ltr,
                style: const TextStyle(fontSize: 10, color: Style.lowContrast),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Fatal startup error (invalid fixture): only the error screen.
class ErrorApp extends StatelessWidget {
  const ErrorApp({super.key, required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MB Flutter',
      debugShowCheckedModeBanner: false,
      theme: Style.theme(),
      home: ErrorScreen(code: code),
    );
  }
}
