import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../benchkit/benchkit.dart';
import '../benchkit/probe.dart';
import '../domain/digest.dart';
import '../domain/format.dart';
import 'style.dart';

/// Insights screen (route `insights`), embedded in the app (remote loading is not applicable to
/// Flutter): top 5 items by option A and the option B distribution, live.
class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key});

  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  late final AppController _controller = AppScope.of(context);

  @override
  void initState() {
    super.initState();
    _controller.insightsVisible = true;
  }

  @override
  void dispose() {
    _controller.insightsVisible = false;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    final store = c.store;
    const style = TextStyle(fontSize: 16, color: Style.text);
    return Scaffold(
      appBar: benchAppBar('Insights'),
      body: Id(
        'mb.screen.insights',
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: ValueListenableBuilder<int>(
            valueListenable: store.valuesVersion,
            builder: (context, _, _) {
              final insights = Insights.compute(store.values);
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      DrawProbe(
                        bench: c.bench,
                        kinds: const [ProbeKind.screen, ProbeKind.resume, ProbeKind.restore, ProbeKind.insights],
                        route: Routes.insights,
                        color: Style.background,
                      ),
                      const SizedBox(width: 3),
                      const Text('Top 5 by option A', style: TextStyle(fontSize: 14, color: Style.secondaryText)),
                    ],
                  ),
                  Id(
                    'mb.insights.top',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (var k = 0; k < insights.topItems.length; k++)
                          Text(
                            '${itemLabel(insights.topItems[k], store.itemCount)} \u00B7 ${optionText(0, insights.topValues[k])}',
                            style: style,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text('Option B distribution', style: TextStyle(fontSize: 14, color: Style.secondaryText)),
                  Id('mb.insights.buckets', child: Text(insights.buckets.join(' \u00B7 '), style: style)),
                  const SizedBox(height: 16),
                  const Id('mb.insights.source', child: Text('Source: embedded', style: style)),
                  const SizedBox(height: 8),
                  ValueListenableBuilder<String>(
                    valueListenable: c.insightsDigestText,
                    builder: (context, d, _) => Id(
                      'mb.insights.digest',
                      child: Text(d, style: const TextStyle(fontSize: 10, color: Style.lowContrast)),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
