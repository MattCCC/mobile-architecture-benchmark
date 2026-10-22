import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'format.dart';

/// Canonical state text `mb-state-v1` (every line LF-terminated). [selected] holds the selected
/// option index per item, or -1.
String stateText(String profile, int seq, Int32List values, Int8List selected) {
  final b = StringBuffer()
    ..write('mb-state-v1\nprofile=')
    ..write(profile)
    ..write('\nseq=')
    ..write(seq)
    ..write('\nvalues=');
  for (var k = 0; k < values.length; k++) {
    if (k > 0) {
      b.write(',');
    }
    b.write(values[k]);
  }
  b.write('\nselection=');
  var first = true;
  for (var i = 0; i < selected.length; i++) {
    final o = selected[i];
    if (o < 0) {
      continue;
    }
    if (!first) {
      b.write(',');
    }
    first = false;
    b
      ..write(i)
      ..write(':')
      ..write(optionKeys[o]);
  }
  b.write('\n');
  return b.toString();
}

/// Insights derived from the current values: the top 5 items by option A (descending, ties by lower
/// index first) and the counts of option B values in 5 equal buckets over [100, 9999].
class Insights {
  const Insights(this.topItems, this.topValues, this.buckets);

  final List<int> topItems;
  final List<int> topValues;
  final List<int> buckets;

  static Insights compute(Int32List values) {
    final n = values.length ~/ optionsPerItem;
    final topItems = <int>[];
    final topValues = <int>[];
    final buckets = List<int>.filled(5, 0);
    for (var i = 0; i < n; i++) {
      final a = values[i * optionsPerItem];
      // Ascending index order: an equal value never displaces an earlier item.
      var p = topValues.length;
      while (p > 0 && topValues[p - 1] < a) {
        p--;
      }
      if (p < 5) {
        topItems.insert(p, i);
        topValues.insert(p, a);
        if (topItems.length > 5) {
          topItems.removeLast();
          topValues.removeLast();
        }
      }
      final vb = values[i * optionsPerItem + 1];
      final bucket = ((vb - valueMin) * 5) ~/ (valueMax - valueMin + 1);
      buckets[bucket > 4 ? 4 : bucket]++;
    }
    return Insights(topItems, topValues, buckets);
  }
}

/// Canonical Insights text `mb-insights-v1` (every line LF-terminated).
String insightsText(int seq, Insights insights) {
  final top = [for (var k = 0; k < insights.topItems.length; k++) '${insights.topItems[k]}:${insights.topValues[k]}'];
  return 'mb-insights-v1\nseq=$seq\ntop=${top.join(',')}\nbuckets=${insights.buckets.join(',')}\n';
}

/// Lowercase hex SHA-256 of the UTF-8 bytes of [text].
String sha256Hex(String text) => sha256.convert(utf8.encode(text)).toString();
