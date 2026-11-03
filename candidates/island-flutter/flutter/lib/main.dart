import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const _channel = MethodChannel('org.example.mobilebench/islands');

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const IslandApp());
}

class IslandState {
  IslandState(Map<String, dynamic> message)
    : sid = message['sid'] as int,
      kind = message['k'] as String,
      itemCount = message['n'] as int,
      seq = message['s'] as int,
      token = message['tk'] as String,
      xr = message['xr'] == 1,
      index = message['i'] as int? ?? -1,
      group = message['g'] as int? ?? -1,
      values = List<int>.from(message['v'] as List? ?? const []),
      top = _pairs(message['top']),
      buckets = List<int>.from(message['b'] as List? ?? const []),
      source = message['src'] as String? ?? 'embedded',
      version = message['ver'] as String? ?? '1',
      open = message['open'] as int? ?? 0,
      digest = message['idg'] as String? ?? '-' {
    if (kind == 'list') loadList(message);
  }

  final rows = <ValueNotifier<List<int>>>[];
  final summary = ValueNotifier<List<int>>([0, 0, 0]);
  int anchor = 0;
  final drawnRows = <int>{};
  int _pendingRenders = 0;

  void rowRendered() {
    if (++_pendingRenders != 1) return;
    Future.microtask(() {
      final count = _pendingRenders;
      _pendingRenders = 0;
      send({'t': 'rendered', 'sid': sid, 'n': count});
    });
  }

  void loadList(Map<String, dynamic> message) {
    rows.addAll(
      _pairs(message['rows']).map((r) => ValueNotifier<List<int>>(r)),
    );
    if (rows.length != itemCount) throw const FormatException('list row count');
    summary.value = List<int>.from(message['summary'] as List);
    anchor = message['anchor'] as int;
  }

  final int sid;
  final String kind;
  final int itemCount;
  int seq;
  String token;
  bool xr;
  final int index;
  final int group;
  List<int> values;
  List<List<int>> top;
  List<int> buckets;
  final String source;
  final String version;
  final int open;
  String digest;

  static List<List<int>> _pairs(dynamic value) => (value as List? ?? const [])
      .map((e) => List<int>.from(e as List))
      .toList();

  void apply(Map<String, dynamic> message) {
    switch (message['t']) {
      case 'snap':
        final incoming = message['s'] as int;
        if (incoming < seq) return;
        if (kind == 'list' &&
            (message['summary'] as List)[2] < summary.value[2]) {
          return;
        }
        seq = incoming;
        token = message['tk'] as String;
        xr = message['xr'] == 1;
        if (kind == 'detail') {
          values = List<int>.from(message['v'] as List);
        } else if (kind == 'insights') {
          top = _pairs(message['top']);
          buckets = List<int>.from(message['b'] as List);
          digest = message['idg'] as String;
        } else {
          final next = _pairs(message['rows']);
          for (var i = 0; i < rows.length; i++) {
            rows[i].value = next[i];
          }
          summary.value = List<int>.from(message['summary'] as List);
        }
        return;
      case 'row':
        final incoming = message['s'] as int;
        final next = List<int>.from(message['summary'] as List);
        final i = message['i'] as int;
        if (kind != 'list' ||
            incoming < seq ||
            next[2] < summary.value[2] ||
            i < 0 ||
            i >= itemCount) {
          return;
        }
        if (xr) mark('xr.js', 's=$incoming');
        seq = incoming;
        rows[i].value = List<int>.from(message['row'] as List);
        if (List.generate(
          3,
          (i) => next[i] != summary.value[i],
        ).any((v) => v)) {
          summary.value = next;
        }
        return;
      case 'v':
        final incoming = message['s'] as int;
        if (xr) mark('xr.js', 's=$incoming');
        if (kind == 'detail' && incoming > seq) {
          seq = incoming;
          values = List<int>.from(message['v'] as List);
        }
        return;
      case 'ins':
        final incoming = message['s'] as int;
        if (xr) mark('xr.js', 's=$incoming');
        if (kind == 'insights' && incoming > seq) {
          seq = incoming;
          top = _pairs(message['top']);
          buckets = List<int>.from(message['b'] as List);
        }
        return;
      case 'tk':
        token = message['k'] as String;
        return;
      case 'idg':
        digest = message['x'] as String;
        return;
    }
  }
}

Future<void> send(Map<String, Object?> message) =>
    _channel.invokeMethod('islandMessage', jsonEncode(message));

void mark(String event, String payload) {
  final state = IslandAppState.instance?.state;
  if (state != null) {
    send({'t': 'mark', 'sid': state.sid, 'e': event, 'p': payload});
  }
}

class IslandApp extends StatefulWidget {
  const IslandApp({super.key});

  @override
  State<IslandApp> createState() => IslandAppState();
}

class IslandAppState extends State<IslandApp> {
  static IslandAppState? instance;
  IslandState? state;
  String? _lastScreenToken;
  String? _lastInsightsToken;

  @override
  void initState() {
    super.initState();
    instance = this;
    _channel.setMethodCallHandler((call) async {
      if (call.method != 'message' || call.arguments is! String) return;
      final message =
          jsonDecode(call.arguments as String) as Map<String, dynamic>;
      if (message['t'] == 'init') {
        state = IslandState(message);
        _lastScreenToken = null;
        _lastInsightsToken = null;
        if (mounted) setState(() {});
        await send({'t': 'ready', 'sid': state!.sid});
      } else if (state != null && message['sid'] == state!.sid) {
        if (mounted) {
          if (message['t'] == 'row') {
            state!.apply(message);
          } else {
            setState(() => state!.apply(message));
          }
        }
      }
    });
    send({'t': 'runtimeReady', 'sid': 0});
  }

  @override
  void dispose() {
    if (identical(instance, this)) instance = null;
    super.dispose();
  }

  void _reportDraw(IslandState model) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || state?.sid != model.sid) return;
      if (_lastScreenToken != model.token) {
        _lastScreenToken = model.token;
        send({
          't': 'probe',
          'sid': model.sid,
          'kind': 'screen',
          'i': model.kind == 'detail' ? 2 : 3,
          'tk': model.token,
        });
      }
      if (model.kind == 'insights') {
        final ready = 'ready:${model.version}:${model.open}';
        if (_lastInsightsToken != ready) {
          _lastInsightsToken = ready;
          send({
            't': 'probe',
            'sid': model.sid,
            'kind': 'insights',
            'i': 0,
            'tk': ready,
          });
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final model = state;
    if (model != null && model.kind != 'list') _reportDraw(model);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: Colors.blue,
        scaffoldBackgroundColor: Colors.white,
      ),
      // Material supplies the text theme; without it Text falls back to the debug "missing Material" style.
      home: Material(
        color: Colors.white,
        child: model == null
            ? const SizedBox.expand()
            : model.kind == 'list'
            ? ListIsland(key: ValueKey(model.sid), model: model)
            : model.kind == 'detail'
            ? DetailIsland(model: model)
            : InsightsIsland(model: model),
      ),
    );
  }
}

/// Probe messages originate in paint, then cross the channel after the frame. A runtime-ready or layout callback
/// alone cannot complete the host's FUI gate.
class IslandProbe extends StatelessWidget {
  const IslandProbe({
    super.key,
    required this.model,
    required this.kind,
    required this.index,
    required this.token,
  });
  final IslandState model;
  final String kind;
  final int index;
  final String token;

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: const Size(1, 1),
    painter: _IslandPainter(
      model,
      kind,
      index,
      token,
      !View.of(context).physicalSize.isEmpty,
    ),
  );
}

class _IslandPainter extends CustomPainter {
  _IslandPainter(this.model, this.kind, this.index, this.token, this.visible);
  final IslandState model;
  final String kind;
  final int index;
  final String token;
  final bool visible;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    if (!visible || (kind == 'row' && !model.drawnRows.add(index))) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      send({
        't': 'probe',
        'sid': model.sid,
        'kind': kind,
        'i': index,
        'tk': token,
      });
    });
  }

  @override
  bool shouldRepaint(_IslandPainter old) =>
      old.model.sid != model.sid ||
      old.index != index ||
      old.token != token ||
      old.visible != visible;
}

class ListIsland extends StatefulWidget {
  const ListIsland({super.key, required this.model});
  final IslandState model;
  @override
  State<ListIsland> createState() => _ListIslandState();
}

class _ListIslandState extends State<ListIsland> {
  late final controller = ScrollController(
    initialScrollOffset: widget.model.anchor * 72.0,
  );
  int lastAnchor = -1;
  int lastHeight = -1;

  @override
  void initState() {
    super.initState();
    controller.addListener(() {
      final i = (controller.offset / 72).floor().clamp(
        0,
        widget.model.itemCount - 1,
      );
      if (i == lastAnchor) return;
      lastAnchor = i;
      send({'t': 'anchor', 'sid': widget.model.sid, 'i': i});
    });
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.model;
    return Stack(
      children: [
        Column(
          children: [
            ValueListenableBuilder<List<int>>(
              valueListenable: m.summary,
              builder: (context, summary, _) => Semantics(
                identifier: 'mb.summary',
                container: true,
                child: SizedBox(
                  height: 48,
                  child: Stack(
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Row(
                          children: [
                            Semantics(
                              identifier: 'mb.summary.count',
                              child: Text(
                                'Selected ${summary[0]}',
                                style: const TextStyle(fontSize: 14),
                              ),
                            ),
                            const Text(' · '),
                            Semantics(
                              identifier: 'mb.summary.total',
                              child: Text(
                                'Total ${fmt(summary[1])}',
                                style: const TextStyle(fontSize: 14),
                              ),
                            ),
                          ],
                        ),
                      ),
                      IslandProbe(
                        model: m,
                        kind: 'summary',
                        index: summary[2],
                        token: '${summary[2]}:${summary[0]}',
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final h = constraints.maxHeight.floor();
                  if (h > 0 && h != lastHeight) {
                    lastHeight = h;
                    WidgetsBinding.instance.addPostFrameCallback(
                      (_) => send({
                        't': 'probe',
                        'sid': m.sid,
                        'kind': 'list',
                        'i': h,
                        'tk': '',
                      }),
                    );
                  }
                  return Semantics(
                    identifier: 'mb.list',
                    container: true,
                    child: NotificationListener<ScrollEndNotification>(
                      onNotification: (_) {
                        mark('scroll.idle', '');
                        return false;
                      },
                      child: ListView.builder(
                        controller: controller,
                        padding: EdgeInsets.zero,
                        itemExtent: 72,
                        itemCount: m.itemCount,
                        itemBuilder: (context, i) => ValueListenableBuilder<List<int>>(
                          valueListenable: m.rows[i],
                          builder: (context, row, _) {
                            m.rowRendered();
                            return Semantics(
                              identifier: 'mb.row.$i',
                              container: true,
                              child: Stack(
                                children: [
                                  Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                    ),
                                    child: Row(
                                      children: [
                                        Expanded(
                                          child: Column(
                                            mainAxisAlignment:
                                                MainAxisAlignment.center,
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Semantics(
                                                identifier: 'mb.row.$i.label',
                                                child: GestureDetector(
                                                  behavior:
                                                      HitTestBehavior.opaque,
                                                  onTap: () => send({
                                                    't': 'detail',
                                                    'sid': m.sid,
                                                    'i': i,
                                                  }),
                                                  child: Text(
                                                    itemLabel(i, m.itemCount),
                                                    maxLines: 1,
                                                    style: const TextStyle(
                                                      fontSize: 16,
                                                    ),
                                                  ),
                                                ),
                                              ),
                                              Text(
                                                'Group ${row[0]}',
                                                style: const TextStyle(
                                                  fontSize: 14,
                                                  color: Color(0xff5f6368),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        for (var o = 0; o < 3; o++)
                                          Padding(
                                            padding: const EdgeInsets.only(
                                              left: 6,
                                            ),
                                            child: Semantics(
                                              identifier:
                                                  'mb.row.$i.opt.${String.fromCharCode(97 + o)}',
                                              button: true,
                                              selected: row[4] == o,
                                              child: GestureDetector(
                                                onTap: () => send({
                                                  't': 'toggle',
                                                  'sid': m.sid,
                                                  'i': i,
                                                  'o': o,
                                                }),
                                                child: Container(
                                                  height: 36,
                                                  constraints:
                                                      const BoxConstraints(
                                                        minWidth: 48,
                                                      ),
                                                  alignment: Alignment.center,
                                                  padding:
                                                      const EdgeInsets.symmetric(
                                                        horizontal: 8,
                                                      ),
                                                  decoration: BoxDecoration(
                                                    color: row[4] == o
                                                        ? const Color(
                                                            0xff2f6feb,
                                                          )
                                                        : const Color(
                                                            0xffe8eaed,
                                                          ),
                                                    borderRadius:
                                                        BorderRadius.circular(
                                                          4,
                                                        ),
                                                  ),
                                                  child: Text(
                                                    '${String.fromCharCode(65 + o)} ${fmt(row[o + 1])}',
                                                    style: TextStyle(
                                                      fontSize: 14,
                                                      color: row[4] == o
                                                          ? Colors.white
                                                          : const Color(
                                                              0xff1a1a1a,
                                                            ),
                                                    ),
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  IslandProbe(
                                    model: m,
                                    kind: 'row',
                                    index: i,
                                    token: 'fui0',
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
        IslandProbe(model: m, kind: 'screen', index: 0, token: m.token),
      ],
    );
  }
}

class DetailIsland extends StatefulWidget {
  const DetailIsland({super.key, required this.model});
  final IslandState model;

  @override
  State<DetailIsland> createState() => _DetailIslandState();
}

class _DetailIslandState extends State<DetailIsland>
    with SingleTickerProviderStateMixin {
  late final AnimationController controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 300),
    reverseDuration: const Duration(milliseconds: 300),
  );
  bool shown = false;

  void toggle() {
    setState(() => shown = !shown);
    final direction = shown ? 'show' : 'hide';
    mark('anim.start', 'dir=$direction');
    final future = shown ? controller.forward() : controller.reverse();
    future.whenComplete(() => mark('anim.end', 'dir=$direction'));
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final model = widget.model;
    return Semantics(
      identifier: 'mb.screen.detail',
      container: true,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              itemLabel(model.index, model.itemCount),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            Text(
              'Group ${model.group}',
              style: const TextStyle(fontSize: 14, color: Color(0xff5f6368)),
            ),
            const SizedBox(height: 12),
            for (var option = 0; option < 3; option++)
              Semantics(
                identifier:
                    'mb.detail.values.${String.fromCharCode(97 + option)}',
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(
                    '${String.fromCharCode(65 + option)} ${fmt(model.values[option])}',
                    style: const TextStyle(fontSize: 16),
                  ),
                ),
              ),
            const SizedBox(height: 16),
            Semantics(
              identifier: 'mb.detail.panel.toggle',
              button: true,
              child: FilledButton.tonal(
                onPressed: toggle,
                child: Text(shown ? 'Hide details' : 'Show details'),
              ),
            ),
            const SizedBox(height: 16),
            SizeTransition(
              sizeFactor: controller,
              child: SlideTransition(
                position: Tween(begin: const Offset(0, 2), end: Offset.zero)
                    .animate(
                      CurvedAnimation(
                        parent: controller,
                        curve: Curves.easeInOut,
                      ),
                    ),
                child: FadeTransition(
                  opacity: CurvedAnimation(
                    parent: controller,
                    curve: Curves.easeInOut,
                  ),
                  child: Semantics(
                    identifier: 'mb.detail.panel',
                    child: Container(
                      height: 120,
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      color: const Color(0xfff1f3f4),
                      child: Text(
                        '${itemLabel(model.index, model.itemCount)} belongs to Group ${model.group} and has 3 options.',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class InsightsIsland extends StatelessWidget {
  const InsightsIsland({super.key, required this.model});
  final IslandState model;

  @override
  Widget build(BuildContext context) => Semantics(
    identifier: 'mb.screen.insights',
    container: true,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Top 5 by Option A',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          Semantics(
            identifier: 'mb.insights.top',
            container: true,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final pair in model.top)
                  Text(
                    '${itemLabel(pair[0], model.itemCount)} — ${fmt(pair[1])}',
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Option B distribution',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          Semantics(
            identifier: 'mb.insights.buckets',
            child: Text(model.buckets.join(' · ')),
          ),
          const SizedBox(height: 16),
          Semantics(
            identifier: 'mb.insights.source',
            child: Text('Source: ${model.source}'),
          ),
          Semantics(
            identifier: 'mb.insights.digest',
            child: Text(
              model.digest,
              style: const TextStyle(fontSize: 8, color: Color(0xffe4e4e4)),
            ),
          ),
        ],
      ),
    ),
  );
}

String fmt(int value) =>
    '${value ~/ 100}.${(value % 100).toString().padLeft(2, '0')}';

String itemLabel(int index, int count) {
  final width = (count - 1).toString().length.clamp(3, 99);
  return 'Item ${index.toString().padLeft(width, '0')}';
}
