// Domain model tests: SHA-256, formatting, store digests against fixtures/v1/golden.json, selection rules,
// Insights, restoration record v2, launch configuration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { sha256Hex } from '../src/domain/sha256.ts';
import { fmt, itemLabel, labelWidth, optionText } from '../src/domain/format.ts';
import { insightsText, Store } from '../src/domain/store.ts';
import { parseRecord, serializeRecord } from '../src/domain/restoration.ts';
import { parseLaunchConfig } from '../src/domain/launchConfig.ts';
import { loadFixture, loadGolden, repoRoot } from './helpers.ts';
import type { ProfileName } from '../src/domain/types.ts';

interface GeneratorLib {
  loadProfiles(): [string, unknown][];
  updateStream(profile: unknown, dataset: unknown): Iterator<{ s: number; i: number; v: number[] }>;
}

async function generator(): Promise<GeneratorLib> {
  return (await import(pathToFileURL(join(repoRoot, 'fixtures', 'generator', 'lib.mjs')).href)) as GeneratorLib;
}

test('sha256 matches node:crypto', () => {
  const inputs = ['', 'abc', 'mb-state-v1\n', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'q'.repeat(100000), 'Item 042 · Option B'];
  for (const s of inputs) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `input length ${s.length}`);
  }
});

test('fmt and labels follow the locale-free rules', () => {
  assert.equal(fmt(100), '1.00');
  assert.equal(fmt(1234), '12.34');
  assert.equal(fmt(9999), '99.99');
  assert.equal(fmt(191327), '1913.27');
  assert.equal(fmt(105), '1.05');
  assert.equal(labelWidth(30), 3);
  assert.equal(labelWidth(300), 3);
  assert.equal(labelWidth(3000), 4);
  assert.equal(itemLabel(42, 3), 'Item 042');
  assert.equal(itemLabel(7, 4), 'Item 0007');
  assert.equal(optionText(1, 1234), 'B 12.34');
});

for (const profile of ['small', 'representative', 'stress'] as ProfileName[]) {
  test(`store digests equal golden.json (${profile})`, async () => {
    const fixture = loadFixture(profile);
    const golden = loadGolden(profile);
    const store = new Store(profile, fixture);
    const sel = store.getSelection();
    assert.equal(sel.count, golden.seq0Summary.selectedCount);
    assert.equal(sel.total, golden.seq0Summary.total);
    assert.equal(fmt(sel.total), golden.seq0Summary.totalText);
    const lib = await generator();
    const profiles = new Map(lib.loadProfiles());
    const stream = lib.updateStream(profiles.get(profile), { items: fixture.items, selection: fixture.selection });
    const targets = new Map(golden.stateDigests.map((d) => [d.seq, d.digest]));
    const insightTargets = new Map(golden.insightsDigests.map((d) => [d.seq, d.digest]));
    assert.equal(sha256Hex(store.stateText()), targets.get(0));
    assert.equal(sha256Hex(insightsText(store.insights())), insightTargets.get(0));
    for (let s = 1; s <= 10000; s += 1) {
      const msg = stream.next().value as { s: number; i: number; v: number[] };
      store.applyUpdate(msg.s, msg.i, msg.v);
      if (targets.has(s)) {
        assert.equal(sha256Hex(store.stateText()), targets.get(s), `state digest at seq ${s}`);
        assert.equal(sha256Hex(insightsText(store.insights())), insightTargets.get(s), `insights digest at seq ${s}`);
      }
    }
    assert.equal(store.lastSeq, 10000);
    // Incrementally maintained total equals a full recomputation.
    const recomputed = store.selectionPairs().reduce((sum, [i, o]) => sum + store.value(i, o), 0);
    assert.equal(store.getSelection().total, recomputed);
  });
}

test('selection rules: select, replace, deselect; revision increments per change', () => {
  const store = new Store('representative', loadFixture('representative'));
  const before = store.getSelection();
  const item = store.selectedItems().length > 0 ? 1 : 1;
  const initial = store.selectedOption(item);
  const a = store.toggle(item, 0);
  assert.equal(a.rev, before.rev + 1);
  assert.equal(store.selectedOption(item), 0);
  const b = store.toggle(item, 1);
  assert.equal(store.selectedOption(item), 1);
  assert.equal(b.count, a.count);
  const c = store.toggle(item, 1);
  assert.equal(store.selectedOption(item), -1);
  assert.equal(c.count, b.count - 1);
  assert.equal(c.rev, before.rev + 3);
  assert.equal(c.total, store.selectionPairs().reduce((s, [i, o]) => s + store.value(i, o), 0));
  assert.ok(initial >= -1);
});

test('item snapshots are stable until the item changes', () => {
  const store = new Store('small', loadFixture('small'));
  const s0 = store.getItem(3);
  assert.equal(store.getItem(3), s0);
  let calls = 0;
  const unsubscribe = store.subscribeItem(3, () => {
    calls += 1;
  });
  store.applyUpdate(1, 4, [101, 102, 103]);
  assert.equal(calls, 0);
  assert.equal(store.getItem(3), s0);
  store.applyUpdate(2, 3, [111, 112, 113]);
  assert.equal(calls, 1);
  assert.notEqual(store.getItem(3), s0);
  assert.deepEqual(store.getItem(3).v, [111, 112, 113]);
  unsubscribe();
});

test('restoration record v2 round trip and rejection rules', () => {
  const store = new Store('small', loadFixture('small'));
  store.applyUpdate(1, 2, [500, 600, 700]);
  store.toggle(0, 2);
  const record = {
    v: 2 as const,
    route: ['list', 'detail/21'],
    anchor: 20,
    selection: store.selectionPairs(),
    lastSeq: store.lastSeq,
    values: store.valueTriples(),
  };
  const text = serializeRecord(record);
  assert.equal(text, JSON.stringify(record));
  const parsed = parseRecord(text, 30);
  assert.ok(parsed.ok);
  if (parsed.ok) {
    const restored = new Store('small', loadFixture('small'));
    restored.restoreState(parsed.record.values, parsed.record.selection, parsed.record.lastSeq);
    assert.equal(restored.stateText(), store.stateText());
  }
  assert.equal(parseRecord(null, 30).ok, false);
  assert.equal(parseRecord('{', 30).ok, false);
  assert.equal(parseRecord(JSON.stringify({ ...record, v: 1 }), 30).ok, false);
  assert.equal(parseRecord(JSON.stringify({ ...record, values: record.values.slice(1) }), 30).ok, false);
  assert.equal(parseRecord(JSON.stringify({ ...record, route: ['detail/3'] }), 30).ok, false);
  assert.equal(parseRecord(JSON.stringify({ ...record, route: ['list', 'detail/99'] }), 30).ok, false);
});

test('launch configuration: defaults, invalid values, unknown keys, server rules', () => {
  const d = parseLaunchConfig({});
  assert.equal(d.config.profile, 'representative');
  assert.equal(d.config.source, 'replay');
  assert.deepEqual(d.invalid, []);
  const r = parseLaunchConfig({
    'mb.journey': 'j-001',
    'mb.profile': 'small',
    'mb.restore': '1',
    'mb.count': '200',
    'mb.markerMirror': 'all',
    'mb.other': 'x',
    'android.intent.extra': 'ignored',
  });
  assert.equal(r.config.journey, 'j-001');
  assert.equal(r.config.profile, 'small');
  assert.equal(r.config.restore, true);
  assert.equal(r.config.count, 200);
  assert.equal(r.config.markerMirror, 'all');
  assert.deepEqual(r.unknown, ['mb.other']);
  assert.deepEqual(parseLaunchConfig({ 'mb.profile': 'huge' }).invalid, ['mb.profile']);
  assert.deepEqual(parseLaunchConfig({ 'mb.restore': 'yes' }).invalid, ['mb.restore']);
  assert.deepEqual(parseLaunchConfig({ 'mb.semantics': 'auto' }).invalid, []);
  assert.deepEqual(parseLaunchConfig({ 'mb.semantics': 'on' }).invalid, []);
  assert.deepEqual(parseLaunchConfig({ 'mb.semantics': 'off' }).invalid, ['mb.semantics']);
  const ws = parseLaunchConfig({ 'mb.source': 'websocket', 'mb.server': 'ws://10.0.2.2:8787' });
  assert.deepEqual(ws.invalid, []);
  assert.equal(ws.config.server?.httpBase, 'http://10.0.2.2:8787');
  assert.deepEqual(parseLaunchConfig({ 'mb.source': 'websocket' }).invalid, ['mb.server']);
  assert.deepEqual(parseLaunchConfig({ 'mb.server': 'ws://example.org:8787' }).invalid, ['mb.server']);
  assert.deepEqual(parseLaunchConfig({ 'mb.server': 'ws://localhost:80' }).invalid, ['mb.server']);
  assert.deepEqual(parseLaunchConfig({ 'mb.server': 'ws://host.local:8787' }).invalid, ['mb.server']);
  const lan = parseLaunchConfig({ 'mb.server': 'ws://host.local:8787', 'mb.token': '0123456789abcdef0123456789abcdef' });
  assert.deepEqual(lan.invalid, []);
  const loopbackToken = parseLaunchConfig({ 'mb.server': 'ws://127.0.0.1:8787', 'mb.token': '0123456789abcdef0123456789abcdef' });
  assert.deepEqual(loopbackToken.invalid, ['mb.token']);
});
