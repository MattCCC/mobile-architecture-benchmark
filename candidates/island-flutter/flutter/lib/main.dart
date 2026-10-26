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
      digest = message['idg'] as String? ?? '-';

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
        seq = incoming;
        token = message['tk'] as String;
        xr = message['xr'] == 1;
        if (kind == 'detail') {
          values = List<int>.from(message['v'] as List);
        } else {
          top = _pairs(message['top']);
          buckets = List<int>.from(message['b'] as List);
          digest = message['idg'] as String;
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
        if (mounted) setState(() => state!.apply(message));
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
    if (model != null) _reportDraw(model);
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
            : model.kind == 'detail'
            ? DetailIsland(model: model)
            : InsightsIsland(model: model),
      ),
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
