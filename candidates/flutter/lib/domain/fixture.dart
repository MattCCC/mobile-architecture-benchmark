import 'dart:convert';
import 'dart:typed_data';

import 'format.dart';

/// One selected option: item index and option index (0 = A, 1 = B, 2 = C).
class SelectionEntry {
  const SelectionEntry(this.item, this.option);

  final int item;
  final int option;

  @override
  bool operator ==(Object other) => other is SelectionEntry && other.item == item && other.option == option;

  @override
  int get hashCode => Object.hash(item, option);

  @override
  String toString() => '$item:${optionKeys[option]}';
}

/// The committed workload fixture (`mobilebench.fixture/1.0.0`), parsed at run time from the bundled
/// bytes and validated. Labels are derived from the index, never stored.
class Fixture {
  Fixture._(this.profile, this.seed, this.groups, this.values, this.selection);

  static const String schema = 'mobilebench.fixture/1.0.0';
  static const String fixtureVersion = '1.0.0';
  static const int groupCount = 8;

  final String profile;
  final int seed;

  /// Group 0-7 per item.
  final Uint8List groups;

  /// Option values A/B/C per item, flattened: `values[3 * i + o]`.
  final Int32List values;

  /// Initial selection, sorted by item index, at most one option per item.
  final List<SelectionEntry> selection;

  int get itemCount => groups.length;

  /// Parses and validates fixture text. Throws [FormatException] on any deviation from the format.
  static Fixture parse(String text) {
    final Object? doc = jsonDecode(text);
    if (doc is! Map<String, Object?>) {
      throw const FormatException('fixture: not a JSON object');
    }
    _expect(doc['schema'] == schema, 'schema');
    _expect(doc['fixtureVersion'] == fixtureVersion, 'fixtureVersion');
    _expect(doc['valueScale'] == valueScale, 'valueScale');
    final range = doc['valueRange'];
    _expect(range is List<Object?> && range.length == 2 && range[0] == valueMin && range[1] == valueMax, 'valueRange');
    final profile = doc['profile'];
    _expect(profile is String && RegExp(r'^[a-z][a-z0-9-]*$').hasMatch(profile), 'profile');
    final seed = doc['seed'];
    _expect(seed is int && seed >= 0, 'seed');

    final items = doc['items'];
    _expect(items is List<Object?> && items.isNotEmpty, 'items');
    final itemList = items as List<Object?>;
    final n = itemList.length;
    final groups = Uint8List(n);
    final values = Int32List(n * optionsPerItem);
    for (var i = 0; i < n; i++) {
      final item = itemList[i];
      _expect(item is Map<String, Object?>, 'items[$i]');
      final m = item as Map<String, Object?>;
      _expect(m['i'] == i, 'items[$i].i');
      final g = m['g'];
      _expect(g is int && g >= 0 && g < groupCount, 'items[$i].g');
      groups[i] = g as int;
      final v = m['v'];
      _expect(v is List<Object?> && v.length == optionsPerItem, 'items[$i].v');
      for (var o = 0; o < optionsPerItem; o++) {
        final x = (v as List<Object?>)[o];
        _expect(x is int && x >= valueMin && x <= valueMax, 'items[$i].v[$o]');
        values[i * optionsPerItem + o] = x as int;
      }
    }

    final sel = doc['selection'];
    _expect(sel is List<Object?>, 'selection');
    final selection = <SelectionEntry>[];
    var previous = -1;
    for (final entry in sel as List<Object?>) {
      _expect(entry is Map<String, Object?>, 'selection entry');
      final m = entry as Map<String, Object?>;
      final i = m['i'];
      final o = m['o'];
      _expect(i is int && i > previous && i < n, 'selection item order/range');
      _expect(o is int && o >= 0 && o < optionsPerItem, 'selection option');
      selection.add(SelectionEntry(i as int, o as int));
      previous = i;
    }
    return Fixture._(profile as String, seed as int, groups, values, List.unmodifiable(selection));
  }

  static void _expect(bool ok, String what) {
    if (!ok) {
      throw FormatException('fixture: invalid $what');
    }
  }
}
