import 'dart:ui' show FlutterView;

import 'package:flutter/widgets.dart';

import 'benchkit.dart';

/// A 1 x 1 dp opaque probe painted in its parent's background colour (visually invisible, rendered
/// normally). Its [CustomPainter.paint] reports the current token to BenchKit, and it repaints
/// whenever one of its tokens changes (`CustomPainter(repaint:)`), because Flutter would otherwise
/// reuse the previous drawing. Paints while the view has no size (Flutter's warm-up frame before
/// the platform reports the window metrics) draw nothing on screen and are not reported.
class DrawProbe extends StatelessWidget {
  const DrawProbe({
    super.key,
    required this.bench,
    required this.kinds,
    this.index = 0,
    this.route = '',
    required this.color,
  });

  final BenchKit bench;
  final List<ProbeKind> kinds;
  final int index;
  final String route;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final repaint = Listenable.merge([
      for (final kind in kinds)
        switch (kind) {
          ProbeKind.row => null,
          ProbeKind.summary => bench.selectionRevision,
          ProbeKind.screen => bench.navSeq,
          ProbeKind.resume => bench.fgSeq,
          ProbeKind.restore => bench.restoreToken,
          ProbeKind.insights => bench.insightsRequest,
        },
    ]);
    return CustomPaint(
      size: const Size(1, 1),
      painter: _ProbePainter(bench, kinds, index, route, color, View.maybeOf(context), repaint),
    );
  }
}

class _ProbePainter extends CustomPainter {
  _ProbePainter(this.bench, this.kinds, this.index, this.route, this.color, this.view, Listenable repaint)
    : super(repaint: repaint);

  final BenchKit bench;
  final List<ProbeKind> kinds;
  final int index;
  final String route;
  final Color color;
  final FlutterView? view;

  @override
  void paint(Canvas canvas, Size size) {
    final v = view;
    if (bench.enabled && (v == null || !v.physicalSize.isEmpty)) {
      for (final kind in kinds) {
        bench.probeDrawn(kind, index, bench.tokenFor(kind), route: route);
      }
    }
    canvas.drawRect(Offset.zero & size, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_ProbePainter oldDelegate) =>
      oldDelegate.index != index || oldDelegate.route != route || oldDelegate.color != color;
}
