import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_island_flutter/main.dart';

void main() {
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
