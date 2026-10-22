import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_flutter/domain/fixture.dart';
import 'package:mobilebench_flutter/domain/format.dart';
import 'package:mobilebench_flutter/domain/restore_record.dart';
import 'package:mobilebench_flutter/domain/store.dart';

import 'support.dart';

void main() {
  group('display formatting (no locale APIs)', () {
    test('fixed point with two decimals', () {
      expect(fmt(100), '1.00');
      expect(fmt(105), '1.05');
      expect(fmt(1234), '12.34');
      expect(fmt(9999), '99.99');
      expect(fmt(0), '0.00');
      expect(fmt(191327), '1913.27');
      expect(optionText(1, 567), 'B 5.67');
    });

    test('item labels are zero-padded to max(3, digits(N - 1))', () {
      expect(itemLabel(5, 30), 'Item 005');
      expect(itemLabel(42, 300), 'Item 042');
      expect(itemLabel(299, 300), 'Item 299');
      expect(itemLabel(42, 3000), 'Item 0042');
    });
  });

  group('fixture parsing', () {
    test('rejects documents that deviate from the format', () {
      final valid = File('$assetDir/small.json').readAsStringSync();
      expect(() => Fixture.parse(valid.replaceFirst('"valueScale": 100', '"valueScale": 10')), throwsFormatException);
      expect(() => Fixture.parse(valid.replaceFirst('"i": 0,', '"i": 7,')), throwsFormatException);
      expect(() => Fixture.parse('[]'), throwsFormatException);
    });
  });

  group('selection rules', () {
    late AppStore store;
    setUp(() => store = AppStore.fromFixture(fixture('representative')));

    int bruteTotal() {
      var t = 0;
      for (var i = 0; i < store.itemCount; i++) {
        if (store.selected[i] >= 0) {
          t += store.value(i, store.selected[i]);
        }
      }
      return t;
    }

    test('select, replace and deselect keep at most one option per item', () {
      final item = List.generate(store.itemCount, (i) => i).firstWhere((i) => store.selected[i] < 0);
      final count = store.summary.value.count;
      expect(store.toggle(item, 0), 1);
      expect(store.selected[item], 0);
      expect(store.summary.value.count, count + 1);
      expect(store.toggle(item, 1), 2);
      expect(store.selected[item], 1);
      expect(store.summary.value.count, count + 1);
      expect(store.toggle(item, 1), 3);
      expect(store.selected[item], -1);
      expect(store.summary.value.count, count);
      expect(store.summary.value.total, bruteTotal());
    });

    test('updates of a selected item change the total; others only their row', () {
      final selectedItem = store.selectedItems().first;
      final otherItem = List.generate(store.itemCount, (i) => i).firstWhere((i) => store.selected[i] < 0);
      var selectedRowNotified = 0;
      var otherRowNotified = 0;
      var summaryNotified = 0;
      store.row(selectedItem).addListener(() => selectedRowNotified++);
      store.row(otherItem).addListener(() => otherRowNotified++);
      store.summary.addListener(() => summaryNotified++);
      store.applyUpdate(1, otherItem, 111, 222, 333);
      expect(summaryNotified, 0);
      expect(otherRowNotified, 1);
      store.applyUpdate(2, selectedItem, 444, 555, 666);
      expect(summaryNotified, 1);
      expect(selectedRowNotified, 1);
      expect(store.summary.value.total, bruteTotal());
      expect(store.lastAppliedSeq, 2);
    });
  });

  group('restoration record v2', () {
    test('canonical serialization', () {
      final r = RestoreRecord(
        route: const ['list', 'detail/1'],
        anchor: 1,
        selection: const [SelectionEntry(0, 2)],
        lastSeq: 7,
        values: Int32List.fromList([100, 200, 300, 400, 500, 600]),
      );
      expect(
        r.serialize(),
        '{"v":2,"route":["list","detail/1"],"anchor":1,"selection":[[0,2]],"lastSeq":7,'
        '"values":[[100,200,300],[400,500,600]]}\n',
      );
      final back = RestoreRecord.parse(r.serialize(), itemCount: 2);
      expect(back.route, r.route);
      expect(back.anchor, 1);
      expect(back.selection, r.selection);
      expect(back.lastSeq, 7);
      expect(back.values, r.values);
    });

    test('rejects v1 records and records for another dataset', () {
      const v1 = '{"v":1,"route":["list"],"anchor":0,"selection":[],"lastSeq":0}';
      expect(() => RestoreRecord.parse(v1, itemCount: 2), throwsFormatException);
      const ok = '{"v":2,"route":["list"],"anchor":0,"selection":[],"lastSeq":0,"values":[[100,100,100]]}';
      expect(() => RestoreRecord.parse(ok, itemCount: 2), throwsFormatException);
      expect(RestoreRecord.parse(ok, itemCount: 1).values, [100, 100, 100]);
      const badRoute = '{"v":2,"route":["detail/0"],"anchor":0,"selection":[],"lastSeq":0,"values":[[100,100,100]]}';
      expect(() => RestoreRecord.parse(badRoute, itemCount: 1), throwsFormatException);
    });

    test('restore reproduces the exact state digest at lastSeq', () {
      final f = fixture('small');
      final live = AppStore.fromFixture(f);
      for (final line in streamLines('small').take(100)) {
        final parts = RegExp(r'"s":(\d+),"i":(\d+),"v":\[(\d+),(\d+),(\d+)\]').firstMatch(line)!;
        live.applyUpdate(
          int.parse(parts[1]!),
          int.parse(parts[2]!),
          int.parse(parts[3]!),
          int.parse(parts[4]!),
          int.parse(parts[5]!),
        );
      }
      live.toggle(1, 0);
      final dir = Directory.systemTemp.createTempSync('mb-restore-');
      addTearDown(() => dir.deleteSync(recursive: true));
      final storage = RestoreStore(dir.path);
      expect(storage.read(itemCount: f.itemCount), isNull);
      storage.write(
        RestoreRecord(
          route: const ['list', 'detail/3'],
          anchor: 2,
          selection: live.selectionEntries(),
          lastSeq: live.lastAppliedSeq,
          values: live.values,
        ),
      );
      final record = storage.read(itemCount: f.itemCount)!;
      final restored = AppStore.restored(f, record.values, record.selection, record.lastSeq);
      expect(restored.lastAppliedSeq, 100);
      expect(restored.stateDigest(), live.stateDigest());
      expect(File('${dir.path}/mobilebench/restore-v2.json.tmp').existsSync(), isFalse);
    });
  });
}
