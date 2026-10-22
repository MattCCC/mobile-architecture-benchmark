import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../benchkit/benchkit.dart';
import '../benchkit/probe.dart';
import '../domain/format.dart';
import '../domain/store.dart';
import 'style.dart';

/// Detail screen (route `detail/<i>`): label, group, three live values and the animated info panel
/// (animated interaction): show = translateY +240 dp -> 0 and opacity 0 -> 1 over 300 ms with
/// cubic-bezier(0.42, 0, 0.58, 1) (`Curves.easeInOut`); hide = the reverse over 300 ms.
class DetailScreen extends StatefulWidget {
  const DetailScreen({super.key, required this.item});

  final int item;

  @override
  State<DetailScreen> createState() => _DetailScreenState();
}

class _DetailScreenState extends State<DetailScreen> with SingleTickerProviderStateMixin {
  static const double panelHeight = 120;

  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
    reverseDuration: const Duration(milliseconds: 300),
  )..addStatusListener(_onStatus);
  late final Animation<double> _curve = CurvedAnimation(parent: _controller, curve: Curves.easeInOut);
  // SlideTransition offsets are fractions of the child's size: 240 dp / 120 dp = 2.0.
  late final Animation<Offset> _slide = Tween<Offset>(
    begin: const Offset(0, 240 / panelHeight),
    end: Offset.zero,
  ).animate(_curve);

  bool _shown = false;

  void _onStatus(AnimationStatus status) {
    final bench = AppScope.of(context).bench;
    if (status == AnimationStatus.completed) {
      bench.mark('anim.end', 'dir=show');
    } else if (status == AnimationStatus.dismissed) {
      bench.mark('anim.end', 'dir=hide');
      setState(() {});
    }
  }

  void _toggle() {
    final bench = AppScope.of(context).bench;
    setState(() => _shown = !_shown);
    if (_shown) {
      bench.mark('anim.start', 'dir=show');
      _controller.forward();
    } else {
      bench.mark('anim.start', 'dir=hide');
      _controller.reverse();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    final store = c.store;
    final item = widget.item;
    final route = Routes.detail(item);
    final panelPresent = _shown || _controller.status != AnimationStatus.dismissed;
    return Scaffold(
      appBar: benchAppBar(itemLabel(item, store.itemCount)),
      body: Id(
        'mb.screen.detail',
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  DrawProbe(
                    bench: c.bench,
                    kinds: const [ProbeKind.screen, ProbeKind.resume, ProbeKind.restore],
                    route: route,
                    color: Style.background,
                  ),
                  const SizedBox(width: 3),
                  Text('Group ${store.groups[item]}', style: const TextStyle(fontSize: 14, color: Style.secondaryText)),
                ],
              ),
              const SizedBox(height: 12),
              ValueListenableBuilder<RowState>(
                valueListenable: store.row(item),
                builder: (context, s, _) => Row(
                  children: [
                    for (var o = 0; o < optionsPerItem; o++) ...[
                      if (o > 0) const SizedBox(width: 16),
                      Id(
                        'mb.detail.values.${optionKeys[o].toLowerCase()}',
                        child: Text(optionText(o, s.value(o)), style: const TextStyle(fontSize: 16, color: Style.text)),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Id(
                'mb.detail.panel.toggle',
                button: true,
                child: PlainButton(label: _shown ? 'Hide details' : 'Show details', onTap: _toggle),
              ),
              const SizedBox(height: 16),
              if (panelPresent)
                SlideTransition(
                  position: _slide,
                  child: FadeTransition(
                    opacity: _curve,
                    child: Id(
                      'mb.detail.panel',
                      child: Container(
                        height: panelHeight,
                        width: double.infinity,
                        color: Style.neutral,
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          '${itemLabel(item, store.itemCount)} belongs to Group ${store.groups[item]} '
                          'and has $optionsPerItem options.',
                          style: const TextStyle(fontSize: 14, color: Style.text),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
