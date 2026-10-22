import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, median, quantile7 } from '../lib/stats.mjs';
import { blockOrders, buildSchedule, fnv1a32, mulberry32, rngFor, selectSubset } from '../lib/order.mjs';

test('type-7 quantiles match the R / NumPy default', () => {
  const s = [1, 1, 2, 3, 4, 5, 6, 9];
  assert.equal(quantile7(s, 0.5), 3.5);
  assert.ok(Math.abs(quantile7(s, 0.95) - 7.95) < 1e-9);
  assert.equal(quantile7(s, 0), 1);
  assert.equal(quantile7(s, 1), 9);
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(quantile7(ten, 0.5), 5.5);
  assert.ok(Math.abs(quantile7(ten, 0.95) - 9.55) < 1e-9);
  assert.equal(quantile7([], 0.5), null);
  assert.equal(median([7]), 7);
  assert.throws(() => quantile7(s, 1.5), RangeError);
});

test('describe flags tail-dominated p95 below 20 values and sorts its input', () => {
  const d = describe([5, 1, 3]);
  assert.deepEqual([d.n, d.median, d.min, d.max], [3, 3, 1, 5]);
  assert.deepEqual(d.flags, ['tail-dominated-by-max']);
  assert.deepEqual(describe(Array.from({ length: 20 }, (_, i) => i)).flags, []);
  assert.equal(describe([]).median, null);
});

test('fnv1a32 and mulberry32 are the standard algorithms and deterministic', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  const a = mulberry32(42);
  const b = mulberry32(42);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, mulberry32(43)));
});

test('Latin-square orders balance positions when blocks are a multiple of k', () => {
  const cands = ['a', 'b'];
  const { method, orders } = blockOrders(cands, 10, rngFor(7, 'android|early.cold'));
  assert.equal(method, 'randomized-latin-square');
  assert.equal(orders.length, 10);
  for (const o of orders) {
    assert.deepEqual([...o].sort(), cands);
  }
  for (const pos of [0, 1]) {
    for (const c of cands) {
      assert.equal(orders.filter((o) => o[pos] === c).length, 5);
    }
  }
  const three = blockOrders(['x', 'y', 'z'], 9, rngFor(1, 'k'));
  for (const pos of [0, 1, 2]) {
    for (const c of ['x', 'y', 'z']) {
      assert.equal(three.orders.filter((o) => o[pos] === c).length, 3);
    }
  }
});

test('Fisher-Yates per block otherwise; schedule is reproducible from the seed', () => {
  const { method, orders } = blockOrders(['x', 'y', 'z'], 10, rngFor(1, 'k'));
  assert.equal(method, 'fisher-yates-per-block');
  for (const o of orders) {
    assert.deepEqual([...o].sort(), ['x', 'y', 'z']);
  }
  const args = { seed: 123, platform: 'android', groups: [{ id: 'early.cold', blocks: 4 }, { id: 'early.warm', blocks: 4 }], candidates: ['a', 'b'] };
  assert.deepEqual(buildSchedule(args), buildSchedule(args));
  assert.notDeepEqual(buildSchedule(args).groups[0].blocks, buildSchedule({ ...args, seed: 124 }).groups[0].blocks);
  assert.equal(buildSchedule(args).groups[1].blocks[3].block, 4);
});

test('subset keeps the anchor and prefers candidates with the fewest pooled journeys', () => {
  const r = selectSubset({ candidates: ['flutter', 'native', 'expo', 'nativescript'], anchor: 'native', pooledN: { flutter: 20, expo: 0, nativescript: 10 }, maxCandidates: 2, seed: 9 });
  assert.deepEqual(r.selected, ['native', 'expo']);
  assert.deepEqual(r.excluded, ['flutter', 'nativescript']);
  const all = selectSubset({ candidates: ['a', 'b'], anchor: 'native', maxCandidates: 5, seed: 1 });
  assert.deepEqual(all, { selected: ['a', 'b'], excluded: [] });
  const noAnchor = selectSubset({ candidates: ['a', 'b', 'c'], anchor: 'native', pooledN: {}, maxCandidates: 1, seed: 3 });
  assert.equal(noAnchor.selected.length, 1);
  assert.deepEqual(noAnchor, selectSubset({ candidates: ['a', 'b', 'c'], anchor: 'native', pooledN: {}, maxCandidates: 1, seed: 3 }));
});
