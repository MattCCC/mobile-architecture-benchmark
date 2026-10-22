import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../benchkit/benchkit.dart';
import '../benchkit/probe.dart';
import '../domain/format.dart';
import '../domain/store.dart';
import 'style.dart';

/// Selection screen (route `selection`): every selected option with its live value, and the total.
class SelectionScreen extends StatelessWidget {
  const SelectionScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    final store = c.store;
    // Membership cannot change on this screen; values update per entry.
    final items = store.selectedItems();
    return Scaffold(
      appBar: benchAppBar('Selection'),
      body: Id(
        'mb.screen.selection',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              child: Row(
                children: [
                  DrawProbe(
                    bench: c.bench,
                    kinds: const [ProbeKind.screen, ProbeKind.resume, ProbeKind.restore],
                    route: Routes.selection,
                    color: Style.background,
                  ),
                  const SizedBox(width: 3),
                  ValueListenableBuilder<SelectionSummary>(
                    valueListenable: store.summary,
                    builder: (context, s, _) =>
                        Text('Total ${fmt(s.total)}', style: const TextStyle(fontSize: 16, color: Style.text)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                itemExtent: 48,
                itemCount: items.length,
                itemBuilder: (context, k) => _Entry(item: items[k]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Entry extends StatelessWidget {
  const _Entry({required this.item});

  final int item;

  @override
  Widget build(BuildContext context) {
    final store = AppScope.of(context).store;
    return ValueListenableBuilder<RowState>(
      valueListenable: store.row(item),
      builder: (context, s, _) {
        final o = s.selected;
        final text = o < 0
            ? itemLabel(item, store.itemCount)
            : '${itemLabel(item, store.itemCount)} \u00B7 Option ${optionKeys[o]} \u2014 ${fmt(s.value(o))}';
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(text, style: const TextStyle(fontSize: 16, color: Style.text)),
          ),
        );
      },
    );
  }
}
