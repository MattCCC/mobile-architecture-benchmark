import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_island_flutter/main.dart';

void main() {
  Map<String, dynamic> listMessage() => {
    't': 'init',
    'sid': 5,
    'k': 'list',
    'n': 40,
    's': 0,
    'tk': 'nav:0',
    'xr': 0,
    'rows': List.generate(40, (i) => [i % 3, 100, 200, 300, i == 1 ? 0 : -1]),
    'summary': [1, 100, 0],
    'anchor': 0,
  };

  test('List applies host row updates and selection revisions without owning mutations', () {
    final m = IslandState(listMessage());
    var untouched = 0;
    m.rows[1].addListener(() => untouched++);
    m.apply({
      't': 'row',
      'sid': 5,
      's': 1,
      'i': 0,
      'row': [0, 110, 210, 310, -1],
      'summary': [1, 100, 0],
    });
    m.apply({
      't': 'row',
      'sid': 5,
      's': 1,
      'i': 0,
      'row': [0, 110, 210, 310, 1],
      'summary': [2, 310, 1],
    });
    expect(m.rows[0].value, [0, 110, 210, 310, 1]);
    expect(m.summary.value, [2, 310, 1]);
    m.apply({
      't': 'row',
      'sid': 5,
      's': 0,
      'i': 0,
      'row': [0, 1, 2, 3, -1],
      'summary': [0, 0, 0],
    });
    expect(m.summary.value, [2, 310, 1]);
    expect(untouched, 0);
  });

  testWidgets(
    'List emits FUI probes from painted island content and sends taps to the host',
    (tester) async {
      const channel = MethodChannel('org.example.mobilebench/islands');
      final messages = <Map<String, dynamic>>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(channel, (
        call,
      ) async {
        messages.add(
          jsonDecode(call.arguments as String) as Map<String, dynamic>,
        );
        return null;
      });
      final m = IslandState(listMessage());
      await tester.pumpWidget(
        MaterialApp(
          home: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 420,
              height: 480,
              child: Material(child: ListIsland(model: m)),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Selected 1'), findsOneWidget);
      expect(
        messages.any((e) => e['kind'] == 'summary' && e['tk'] == '0:1'),
        isTrue,
      );
      expect(messages.any((e) => e['kind'] == 'list' && e['i'] == 432), isTrue);
      for (var i = 0; i < 6; i++) {
        expect(messages.any((e) => e['kind'] == 'row' && e['i'] == i), isTrue);
      }
      await tester.tap(find.text('A 1.00').first);
      await tester.pump();
      expect(
        messages.any((e) => e['t'] == 'toggle' && e['i'] == 0 && e['o'] == 0),
        isTrue,
      );
      expect(m.summary.value, [
        1,
        100,
        0,
      ], reason: 'tap is only an intent; the host owns selection');
      await tester.pumpWidget(const SizedBox());
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        null,
      );
    },
  );

  test('formatting matches the benchmark contract', () {
    expect(fmt(101), '1.01');
    expect(fmt(9999), '99.99');
    expect(itemLabel(7, 300), 'Item 007');
    expect(itemLabel(7, 3000), 'Item 0007');
  });

  test('detail and insights messages update only with newer sequences', () {
    final detail = IslandState({
      't': 'init',
      'sid': 1,
      'k': 'detail',
      'n': 300,
      's': 4,
      'tk': 'nav:1',
      'xr': 0,
      'i': 7,
      'g': 2,
      'v': [100, 200, 300],
    });
    detail.apply({
      't': 'v',
      'sid': 1,
      's': 3,
      'v': [1, 2, 3],
    });
    expect(detail.values, [100, 200, 300]);
    detail.apply({
      't': 'v',
      'sid': 1,
      's': 5,
      'v': [101, 202, 303],
    });
    expect(detail.values, [101, 202, 303]);

    final insights = IslandState({
      't': 'init',
      'sid': 2,
      'k': 'insights',
      'n': 300,
      's': 4,
      'tk': 'nav:2',
      'xr': 0,
      'top': [
        [7, 999],
      ],
      'b': [1, 2, 3, 4, 5],
      'src': 'embedded',
      'ver': '1',
      'open': 1,
      'idg': '-',
    });
    insights.apply({
      't': 'ins',
      'sid': 2,
      's': 5,
      'top': [
        [8, 1000],
      ],
      'b': [5, 4, 3, 2, 1],
    });
    expect(insights.top, [
      [8, 1000],
    ]);
    expect(insights.buckets, [5, 4, 3, 2, 1]);
  });
}
