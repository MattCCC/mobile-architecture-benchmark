import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../benchkit/benchkit.dart';
import '../benchkit/probe.dart';
import '../domain/format.dart';
import '../domain/store.dart';
import '../stream/stream_client.dart';
import 'style.dart';

/// List screen (route `list`) in the normative layout bands: header 56, status chip row
/// 32, summary bar 48, list container down to the bottom inset; nothing under the system bars.
class ListScreen extends StatelessWidget {
  const ListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    return Scaffold(
      body: SafeArea(
        child: Id(
          'mb.screen.list',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                height: Style.headerHeight,
                child: _Header(controller: c),
              ),
              SizedBox(
                height: Style.statusRowHeight,
                child: _StatusRow(controller: c),
              ),
              SizedBox(
                height: Style.summaryHeight,
                child: _SummaryBar(controller: c),
              ),
              Expanded(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    c.bench.listLayout(constraints.maxHeight);
                    return _ItemList(controller: c);
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          DrawProbe(
            bench: controller.bench,
            kinds: const [ProbeKind.screen, ProbeKind.resume, ProbeKind.restore],
            route: Routes.list,
            color: Style.background,
          ),
          const SizedBox(width: 3),
          const Text('Items', style: TextStyle(fontSize: 20, color: Style.text)),
          const Spacer(),
          ValueListenableBuilder<SelectionSummary>(
            valueListenable: controller.store.summary,
            builder: (context, s, _) => Id(
              'mb.nav.selection',
              button: true,
              child: PlainButton(label: 'Selection (${s.count})', onTap: () => controller.openSelection(context)),
            ),
          ),
          const SizedBox(width: 8),
          Id(
            'mb.nav.insights',
            button: true,
            child: PlainButton(label: 'Insights', onTap: () => controller.openInsights(context)),
          ),
        ],
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Align(
        alignment: Alignment.centerLeft,
        child: ValueListenableBuilder<StreamStatus>(
          valueListenable: controller.stream.status,
          builder: (context, status, _) => Id(
            'mb.stream.status',
            child: Container(
              color: Style.neutral,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              child: Text(status.word, style: const TextStyle(fontSize: 13, color: Style.text)),
            ),
          ),
        ),
      ),
    );
  }
}

class _SummaryBar extends StatelessWidget {
  const _SummaryBar({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Id(
      'mb.summary',
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        child: ValueListenableBuilder<SelectionSummary>(
          valueListenable: controller.store.summary,
          builder: (context, s, _) => Row(
            children: [
              DrawProbe(bench: controller.bench, kinds: const [ProbeKind.summary], color: Style.background),
              const SizedBox(width: 3),
              Id('mb.summary.count', child: Text('Selected ${s.count}', style: _summaryStyle)),
              const Text(' \u00B7 ', style: _summaryStyle),
              Id('mb.summary.total', child: Text('Total ${fmt(s.total)}', style: _summaryStyle)),
            ],
          ),
        ),
      ),
    );
  }

  static const TextStyle _summaryStyle = TextStyle(fontSize: 16, color: Style.text);
}

class _ItemList extends StatelessWidget {
  const _ItemList({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return NotificationListener<ScrollEndNotification>(
      onNotification: (_) {
        controller.bench.mark('scroll.idle');
        return false;
      },
      child: Id(
        'mb.list',
        child: ListView.builder(
          controller: controller.listScroll,
          itemExtent: Style.rowHeight,
          itemCount: controller.store.itemCount,
          itemBuilder: (context, index) => ItemRow(index: index),
        ),
      ),
    );
  }
}

/// One row: label, group, three option buttons. Rebuilds only when its own row state changes.
class ItemRow extends StatelessWidget {
  const ItemRow({super.key, required this.index});

  final int index;

  @override
  Widget build(BuildContext context) {
    final c = AppScope.of(context);
    final store = c.store;
    return ValueListenableBuilder<RowState>(
      valueListenable: store.row(index),
      builder: (context, s, _) {
        store.rowBuilds++;
        return Id(
          'mb.row.$index',
          child: Stack(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Id(
                            'mb.row.$index.label',
                            child: GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () => c.openDetail(context, index),
                              child: Text(
                                itemLabel(index, store.itemCount),
                                maxLines: 1,
                                softWrap: false,
                                style: const TextStyle(fontSize: 16, color: Style.text),
                              ),
                            ),
                          ),
                          Text(
                            'Group ${store.groups[index]}',
                            maxLines: 1,
                            softWrap: false,
                            style: const TextStyle(fontSize: 14, color: Style.secondaryText),
                          ),
                        ],
                      ),
                    ),
                    for (var o = 0; o < optionsPerItem; o++) ...[
                      const SizedBox(width: 6),
                      Id(
                        'mb.row.$index.opt.${optionKeys[o].toLowerCase()}',
                        button: true,
                        selected: s.selected == o,
                        child: PlainButton(
                          label: optionText(o, s.value(o)),
                          selected: s.selected == o,
                          onTap: () => c.toggle(index, o),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Positioned(
                left: 0,
                top: 0,
                child: DrawProbe(bench: c.bench, kinds: const [ProbeKind.row], index: index, color: Style.background),
              ),
            ],
          ),
        );
      },
    );
  }
}
