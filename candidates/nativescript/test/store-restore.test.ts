import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stateDigest, stateText } from '../app/core/digest';
import { OPTIONS } from '../app/core/fixture';
import { isValidRoute, parseRecord, recordFromStore, serializeRecord } from '../app/core/restore';
import { Store, StoreListener } from '../app/core/store';
import { parseFrame } from '../app/core/wire';
import { generatorLib, loadFixture, streamText } from './helpers';

/** Independent implementation of the selection rule (design §8.5). */
function expectedSelection(initial: ReadonlyArray<readonly [number, number]>, taps: Array<[number, number]>): Map<number, number> {
  const sel = new Map<number, number>(initial.map(([i, o]) => [i, o]));
  taps.forEach(([i, o]) => {
    if (sel.get(i) === o) {
      sel.delete(i);
    } else {
      sel.set(i, o);
    }
  });
  return sel;
}

function valuesOf(store: Store): number[][] {
  return Array.from({ length: store.itemCount }, (_, i) => [0, 1, 2].map((o) => store.values[i * OPTIONS + o]));
}

function applyFrames(store: Store, profile: string, upTo: number): void {
  streamText(profile)
    .split('\n')
    .slice(0, upTo)
    .forEach((line) => {
      const f = parseFrame(line, store.itemCount);
      if (f !== null && f.t === 'u') {
        store.applyUpdate(f.s, f.i, f.a, f.b, f.c);
      }
    });
}

test('selection script (FA-03 taps) follows the rule and matches the reference state text', async () => {
  const lib = await generatorLib();
  const store = new Store(loadFixture('representative'));
  const taps: Array<[number, number]> = [
    [1, 0],
    [1, 1],
    [2, 2],
    [2, 2],
  ];
  taps.forEach(([i, o]) => store.toggle(i, o));
  assert.equal(store.revision, 4);
  const sel = expectedSelection(store.fixture.selection, taps);
  assert.equal(store.selected[1], 1, 'row 1: B replaced A');
  assert.equal(store.selected[2], sel.has(2) ? sel.get(2) : -1, 'row 2 per rule');
  assert.equal(store.selectionCount, sel.size);
  const refSelection = [...sel.entries()].sort((a, b) => a[0] - b[0]).map(([i, o]) => ({ i, o }));
  const reference = lib.stateText('representative', 0, valuesOf(store), refSelection);
  assert.equal(stateText(store), reference);
  assert.equal(stateDigest(store), lib.sha256Hex(reference));
  const total = refSelection.reduce((sum, { i, o }) => sum + store.value(i, o), 0);
  assert.equal(store.selectionTotal, total);
});

test('store notifies item, selection and summary changes', () => {
  const store = new Store(loadFixture('small'));
  const calls: string[] = [];
  const listener: StoreListener = {
    itemValues: (i) => calls.push(`v${i}`),
    itemSelection: (i) => calls.push(`s${i}`),
    summary: () => calls.push('sum'),
  };
  store.listener = listener;
  const [selectedItem] = store.fixture.selection[0];
  const unselected = Array.from({ length: store.itemCount }, (_, i) => i).find((i) => store.selected[i] < 0) as number;
  store.applyUpdate(1, unselected, 200, 300, 400);
  store.applyUpdate(2, selectedItem, 500, 600, 700);
  store.toggle(unselected, 0);
  assert.deepEqual(calls, [`v${unselected}`, `v${selectedItem}`, 'sum', `s${unselected}`, 'sum']);
});

test('applyUpdate counts duplicates and gaps without applying them', () => {
  const store = new Store(loadFixture('small'));
  assert.equal(store.applyUpdate(1, 0, 200, 300, 400), 'applied');
  assert.equal(store.applyUpdate(1, 0, 201, 301, 401), 'dup');
  assert.equal(store.applyUpdate(3, 0, 202, 302, 402), 'gap');
  assert.equal(store.lastSeq, 1);
  assert.deepEqual([store.value(0, 0), store.value(0, 1), store.value(0, 2)], [200, 300, 400]);
  assert.deepEqual(store.counters, { received: 0, applied: 1, dup: 1, gap: 1, rows: 0 });
});

test('restoration record v2 round-trips the exact state at lastSeq (FA-09 shape)', () => {
  const store = new Store(loadFixture('representative'));
  applyFrames(store, 'representative', 100);
  [
    [1, 0],
    [1, 1],
    [2, 2],
    [2, 2],
  ].forEach(([i, o]) => store.toggle(i, o));
  const record = recordFromStore(store, ['list', 'detail/21'], 20);
  const text = serializeRecord(record);
  assert.ok(text.startsWith('{"v":2,"route":["list","detail/21"],"anchor":20,"selection":[['));
  assert.ok(text.endsWith(']]}\n'));
  assert.ok(!/\s/.test(text.trimEnd()), 'canonical form has no whitespace');
  const parsed = parseRecord(text, store.itemCount);
  assert.ok(parsed !== null);
  assert.equal(parsed.lastSeq, 100);
  const restored = new Store(loadFixture('representative'));
  restored.restore(parsed.values, parsed.selection, parsed.lastSeq);
  assert.equal(stateDigest(restored), stateDigest(store));
  assert.equal(restored.selectionTotal, store.selectionTotal);
  assert.equal(serializeRecord(recordFromStore(restored, parsed.route, parsed.anchor)), text);
});

test('parseRecord treats missing, v1 and inconsistent records as unusable', () => {
  const store = new Store(loadFixture('small'));
  const good = serializeRecord(recordFromStore(store, ['list'], 0));
  const doc = JSON.parse(good);
  const bad = [
    null,
    '',
    'not json',
    JSON.stringify({ ...doc, v: 1 }),
    JSON.stringify({ ...doc, route: ['detail/3'] }),
    JSON.stringify({ ...doc, route: ['list', 'detail/30'] }),
    JSON.stringify({ ...doc, anchor: 30 }),
    JSON.stringify({ ...doc, values: doc.values.slice(1) }),
    JSON.stringify({ ...doc, values: [[1, 2, 3], ...doc.values.slice(1)] }),
    JSON.stringify({ ...doc, selection: [...doc.selection].reverse() }),
    JSON.stringify({ ...doc, selection: [[0, 3]] }),
    JSON.stringify({ ...doc, lastSeq: -1 }),
  ];
  bad.forEach((text, k) => assert.equal(parseRecord(text, store.itemCount), null, `case ${k}`));
  assert.ok(parseRecord(good, store.itemCount) !== null);
});

test('route validation', () => {
  assert.ok(isValidRoute('list', 300));
  assert.ok(isValidRoute('selection', 300));
  assert.ok(isValidRoute('insights', 300));
  assert.ok(isValidRoute('detail/0', 300));
  assert.ok(isValidRoute('detail/299', 300));
  assert.ok(!isValidRoute('detail/300', 300));
  assert.ok(!isValidRoute('detail/01', 300));
  assert.ok(!isValidRoute('error', 300));
});
