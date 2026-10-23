// Island protocol and view-model tests (node --test, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHostMessage } from '../src/protocol.ts';
import { IslandRegistry } from '../src/model.ts';

class Marks {
  readonly marks: string[] = [];

  mark(event: string, payload: string): void {
    this.marks.push(`${event} ${payload}`);
  }
}

const detailInit = {
  t: 'init',
  sid: 3,
  k: 'detail',
  n: 300,
  s: 10,
  tk: 'nav:1',
  xr: 1,
  i: 42,
  g: 5,
  v: [1234, 567, 8910],
};

const insightsInit = {
  t: 'init',
  sid: 4,
  k: 'insights',
  n: 300,
  s: 10,
  tk: 'nav:2',
  xr: 0,
  top: [
    [7, 9999],
    [1, 9000],
  ],
  b: [1, 2, 3, 4, 5],
  src: 'embedded',
  ver: '1',
  open: 1,
  idg: '-',
};

test('host messages are validated', () => {
  assert.notEqual(parseHostMessage(detailInit), null);
  assert.notEqual(parseHostMessage(JSON.stringify(insightsInit)), null);
  assert.equal(parseHostMessage({ ...detailInit, v: [1, 2] }), null);
  assert.equal(parseHostMessage({ ...detailInit, i: 300 }), null);
  assert.equal(parseHostMessage({ ...insightsInit, src: 'elsewhere' }), null);
  assert.equal(parseHostMessage({ t: 'v', sid: 3, s: 11, v: [1, 2, 3] })?.t, 'v');
  assert.equal(parseHostMessage({ t: 'v', s: 11, v: [1, 2, 3] }), null);
  assert.equal(parseHostMessage('{'), null);
  assert.equal(parseHostMessage({ t: 'zz', sid: 1 }), null);
});

test('detail island: init, buffered and live updates, stale updates ignored, xr.js marks', () => {
  const marks = new Marks();
  const registry = new IslandRegistry(marks);
  // Arrives before the root mounted: buffered, applied after init.
  registry.dispatch({ t: 'v', sid: 3, s: 12, v: [1, 2, 3] });
  const model = registry.adopt(JSON.stringify(detailInit));
  assert.ok(model);
  assert.equal(model.kind, 'detail');
  assert.deepEqual(model.values.get(), [1, 2, 3]);
  assert.equal(model.lastSeq, 12);
  registry.dispatch({ t: 'v', sid: 3, s: 11, v: [9, 9, 9] });
  assert.deepEqual(model.values.get(), [1, 2, 3]);
  registry.dispatch({ t: 'v', sid: 3, s: 20, v: [4, 5, 6] });
  assert.deepEqual(model.values.get(), [4, 5, 6]);
  registry.dispatch({ t: 'tk', sid: 3, k: 'fg:1' });
  assert.equal(model.token.get(), 'fg:1');
  assert.deepEqual(marks.marks, ['xr.js s=12', 'xr.js s=11', 'xr.js s=20']);
  // A snapshot older than the applied state is ignored; a newer one replaces it.
  registry.dispatch({ ...detailInit, t: 'snap', s: 15, v: [7, 7, 7] });
  assert.deepEqual(model.values.get(), [4, 5, 6]);
  registry.dispatch({ ...detailInit, t: 'snap', s: 25, v: [8, 8, 8], tk: 'nav:1' });
  assert.deepEqual(model.values.get(), [8, 8, 8]);
  // Adopting the same sid again returns the live model.
  assert.equal(registry.adopt(detailInit), model);
  registry.remove(3);
  assert.equal(registry.size, 0);
});

test('insights island: snapshot updates notify subscribers, digest text', () => {
  const registry = new IslandRegistry(new Marks());
  const model = registry.adopt(insightsInit);
  assert.ok(model);
  assert.equal(model.source, 'embedded');
  assert.equal(model.openSeq, 1);
  let calls = 0;
  const unsubscribe = model.subscribeValues(() => {
    calls += 1;
  });
  registry.dispatch({ t: 'ins', sid: 4, s: 11, top: [[3, 5000]], b: [5, 4, 3, 2, 1] });
  assert.equal(calls, 1);
  assert.deepEqual(model.insightsSnapshot().top, [[3, 5000]]);
  assert.deepEqual(model.insightsSnapshot().buckets, [5, 4, 3, 2, 1]);
  registry.dispatch({ t: 'ins', sid: 4, s: 11, top: [[1, 1]], b: [0, 0, 0, 0, 0] });
  assert.equal(calls, 1);
  registry.dispatch({ t: 'idg', sid: 4, x: '0123456789ab' });
  assert.equal(model.insightsDigest.get(), '0123456789ab');
  unsubscribe();
  // Messages for an unknown island instance are buffered, not applied to another one.
  registry.dispatch({ t: 'ins', sid: 9, s: 30, top: [], b: [0, 0, 0, 0, 0] });
  assert.equal(model.insightsSnapshot().seq, 11);
});
