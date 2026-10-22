import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'fixture.dart';
import 'format.dart';

/// Restoration record v2: route stack, list anchor, selection, last applied seq and
/// the values of every item at that seq, so a restore reproduces the exact reference state.
class RestoreRecord {
  RestoreRecord({
    required this.route,
    required this.anchor,
    required this.selection,
    required this.lastSeq,
    required this.values,
  });

  static final RegExp _routePattern = RegExp(r'^(list|selection|insights|detail/(0|[1-9][0-9]*))$');

  final List<String> route;
  final int anchor;
  final List<SelectionEntry> selection;
  final int lastSeq;
  final Int32List values;

  /// Compact canonical JSON: fixed key order, integers only, no whitespace, trailing LF.
  String serialize() {
    final b = StringBuffer('{"v":2,"route":[')
      ..write(route.map((r) => '"$r"').join(','))
      ..write('],"anchor":')
      ..write(anchor)
      ..write(',"selection":[')
      ..write(selection.map((e) => '[${e.item},${e.option}]').join(','))
      ..write('],"lastSeq":')
      ..write(lastSeq)
      ..write(',"values":[');
    final n = values.length ~/ optionsPerItem;
    for (var i = 0; i < n; i++) {
      if (i > 0) {
        b.write(',');
      }
      final k = i * optionsPerItem;
      b.write('[${values[k]},${values[k + 1]},${values[k + 2]}]');
    }
    b.write(']}\n');
    return b.toString();
  }

  /// Parses and validates a record for a dataset of [itemCount] items. Throws [FormatException]
  /// for anything that is not a valid v2 record (including v1 records).
  static RestoreRecord parse(String text, {required int itemCount}) {
    final Object? doc = jsonDecode(text);
    if (doc is! Map<String, Object?>) {
      throw const FormatException('restore: not a JSON object');
    }
    _expect(doc['v'] == 2, 'version');
    final route = doc['route'];
    _expect(route is List<Object?> && route.isNotEmpty && route.first == 'list', 'route');
    final routes = <String>[];
    for (final r in route as List<Object?>) {
      _expect(r is String && _routePattern.hasMatch(r), 'route entry');
      final name = r as String;
      if (name.startsWith('detail/')) {
        _expect(int.parse(name.substring(7)) < itemCount, 'detail index');
      }
      routes.add(name);
    }
    final anchor = doc['anchor'];
    _expect(anchor is int && anchor >= 0 && anchor < itemCount, 'anchor');
    final lastSeq = doc['lastSeq'];
    _expect(lastSeq is int && lastSeq >= 0, 'lastSeq');
    final sel = doc['selection'];
    _expect(sel is List<Object?>, 'selection');
    final selection = <SelectionEntry>[];
    var previous = -1;
    for (final e in sel as List<Object?>) {
      _expect(e is List<Object?> && e.length == 2, 'selection entry');
      final pair = e as List<Object?>;
      final i = pair[0];
      final o = pair[1];
      _expect(i is int && i > previous && i < itemCount, 'selection item');
      _expect(o is int && o >= 0 && o < optionsPerItem, 'selection option');
      selection.add(SelectionEntry(i as int, o as int));
      previous = i;
    }
    final vals = doc['values'];
    _expect(vals is List<Object?> && vals.length == itemCount, 'values length');
    final values = Int32List(itemCount * optionsPerItem);
    for (var i = 0; i < itemCount; i++) {
      final row = (vals as List<Object?>)[i];
      _expect(row is List<Object?> && row.length == optionsPerItem, 'values[$i]');
      for (var o = 0; o < optionsPerItem; o++) {
        final x = (row as List<Object?>)[o];
        _expect(x is int && x >= valueMin && x <= valueMax, 'values[$i][$o]');
        values[i * optionsPerItem + o] = x as int;
      }
    }
    return RestoreRecord(
      route: routes,
      anchor: anchor as int,
      selection: selection,
      lastSeq: lastSeq as int,
      values: values,
    );
  }

  static void _expect(bool ok, String what) {
    if (!ok) {
      throw FormatException('restore: invalid $what');
    }
  }
}

/// App-private storage of the restoration record (written with temp file + atomic rename).
class RestoreStore {
  RestoreStore(String appDataDir) : _dir = Directory('$appDataDir/mobilebench');

  final Directory _dir;

  File get _file => File('${_dir.path}/restore-v2.json');

  void write(RestoreRecord record) {
    _dir.createSync(recursive: true);
    final tmp = File('${_file.path}.tmp');
    tmp.writeAsStringSync(record.serialize(), flush: true);
    tmp.renameSync(_file.path);
  }

  /// Returns null when no record exists; throws [FormatException] when it is invalid.
  RestoreRecord? read({required int itemCount}) {
    final file = _file;
    if (!file.existsSync()) {
      return null;
    }
    return RestoreRecord.parse(file.readAsStringSync(), itemCount: itemCount);
  }
}
