import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import 'digest.dart';
import 'fixture.dart';
import 'format.dart';

/// Immutable view of one row: three option values and the selected option (-1 = none).
@immutable
class RowState {
  const RowState(this.a, this.b, this.c, this.selected);

  final int a;
  final int b;
  final int c;
  final int selected;

  int value(int option) => option == 0 ? a : (option == 1 ? b : c);
}

/// Selection count and integer total (fixed point) of the selected option values.
@immutable
class SelectionSummary {
  const SelectionSummary(this.count, this.total);

  final int count;
  final int total;
}

/// Application state. Fine-grained notification: an update or a toggle notifies only the target
/// row's notifier and, when a selected value changes, the summary. Row notifiers are created
/// lazily when a row is first built; off-screen items are updated in [values] only.
class AppStore {
  AppStore._({
    required this.profile,
    required this.groups,
    required this.values,
    required this.selected,
    required this.lastAppliedSeq,
  }) : summary = ValueNotifier(_summarize(values, selected));

  /// Initial state at seq 0 from the fixture.
  factory AppStore.fromFixture(Fixture fixture) {
    final selected = Int8List(fixture.itemCount)..fillRange(0, fixture.itemCount, -1);
    for (final e in fixture.selection) {
      selected[e.item] = e.option;
    }
    return AppStore._(
      profile: fixture.profile,
      groups: fixture.groups,
      values: Int32List.fromList(fixture.values),
      selected: selected,
      lastAppliedSeq: 0,
    );
  }

  /// Exact state at [lastSeq] taken from a restoration record.
  factory AppStore.restored(Fixture fixture, Int32List values, List<SelectionEntry> selection, int lastSeq) {
    final selected = Int8List(fixture.itemCount)..fillRange(0, fixture.itemCount, -1);
    for (final e in selection) {
      selected[e.item] = e.option;
    }
    return AppStore._(
      profile: fixture.profile,
      groups: fixture.groups,
      values: Int32List.fromList(values),
      selected: selected,
      lastAppliedSeq: lastSeq,
    );
  }

  final String profile;
  final Uint8List groups;
  final Int32List values;
  final Int8List selected;
  int lastAppliedSeq;

  /// Increments on every selection change (probe token `rev:<n>`).
  int selectionRevision = 0;

  /// Row builds since launch (implementation-quality counter `ctr.rows`).
  int rowBuilds = 0;

  final ValueNotifier<SelectionSummary> summary;

  /// Increments on every applied update; only the Insights screen listens to it.
  final ValueNotifier<int> valuesVersion = ValueNotifier(0);

  final Map<int, ValueNotifier<RowState>> _rows = {};

  int get itemCount => groups.length;

  ValueListenable<RowState> row(int item) => _rows.putIfAbsent(item, () => ValueNotifier(_rowState(item)));

  RowState _rowState(int i) {
    final k = i * optionsPerItem;
    return RowState(values[k], values[k + 1], values[k + 2], selected[i]);
  }

  int value(int item, int option) => values[item * optionsPerItem + option];

  /// Applies one update message: replaces all three values of [item].
  void applyUpdate(int seq, int item, int a, int b, int c) {
    final k = item * optionsPerItem;
    final o = selected[item];
    final before = o >= 0 ? values[k + o] : 0;
    values[k] = a;
    values[k + 1] = b;
    values[k + 2] = c;
    lastAppliedSeq = seq;
    if (o >= 0) {
      final s = summary.value;
      summary.value = SelectionSummary(s.count, s.total + values[k + o] - before);
    }
    _rows[item]?.value = RowState(a, b, c, o);
    valuesVersion.value++;
  }

  /// Toggles option [option] of [item]: deselect if selected, otherwise select it (replacing any
  /// other option of the item). Returns the new selection revision.
  int toggle(int item, int option) {
    final k = item * optionsPerItem;
    final current = selected[item];
    final s = summary.value;
    var count = s.count;
    var total = s.total;
    if (current == option) {
      selected[item] = -1;
      count--;
      total -= values[k + option];
    } else {
      if (current >= 0) {
        total -= values[k + current];
      } else {
        count++;
      }
      selected[item] = option;
      total += values[k + option];
    }
    selectionRevision++;
    summary.value = SelectionSummary(count, total);
    _rows[item]?.value = _rowState(item);
    return selectionRevision;
  }

  /// Selected items in index order.
  List<int> selectedItems() => [
    for (var i = 0; i < selected.length; i++)
      if (selected[i] >= 0) i,
  ];

  List<SelectionEntry> selectionEntries() => [
    for (var i = 0; i < selected.length; i++)
      if (selected[i] >= 0) SelectionEntry(i, selected[i]),
  ];

  String stateDigest() => sha256Hex(stateText(profile, lastAppliedSeq, values, selected));

  String insightsDigest() => sha256Hex(insightsText(lastAppliedSeq, Insights.compute(values)));

  static SelectionSummary _summarize(Int32List values, Int8List selected) {
    var count = 0;
    var total = 0;
    for (var i = 0; i < selected.length; i++) {
      final o = selected[i];
      if (o >= 0) {
        count++;
        total += values[i * optionsPerItem + o];
      }
    }
    return SelectionSummary(count, total);
  }
}
