import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeInsights, insightsDigest, stateDigest } from '../app/core/digest';
import { FixtureError, parseFixture } from '../app/core/fixture';
import { fmt } from '../app/core/format';
import { Store } from '../app/core/store';
import { parseFrame } from '../app/core/wire';
import { candidateRoot, fixturesDir, golden, loadFixture, PROFILES, streamText } from './helpers';

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

test('bundled fixture copies are byte-identical to fixtures/v1', () => {
  const g = golden();
  PROFILES.forEach((p) => {
    const copy = readFileSync(join(candidateRoot, 'app', 'generated', 'fixtures', `${p}.json`));
    const source = readFileSync(join(fixturesDir, `${p}.json`));
    assert.ok(copy.equals(source), p);
    assert.equal(sha256(copy), g.profiles[p].sha256, p);
  });
});

test('bundled replay streams match golden.json in both asset locations', () => {
  const g = golden();
  PROFILES.forEach((p) => {
    const text = streamText(p);
    assert.equal(sha256(text), g.profiles[p].stream.sha256, p);
    const android = readFileSync(
      join(candidateRoot, 'App_Resources', 'Android', 'src', 'main', 'assets', 'mobilebench', `${p}.stream.jsonl`),
      'utf8',
    );
    assert.equal(android, text, p);
  });
});

test('seq-0 state, Insights digest and summary equal golden.json for every profile', () => {
  const g = golden();
  PROFILES.forEach((p) => {
    const store = new Store(loadFixture(p));
    const expected = g.profiles[p];
    assert.equal(stateDigest(store), expected.stateDigests[0].digest, `${p} state`);
    assert.equal(insightsDigest(0, computeInsights(store)), expected.insightsDigests[0].digest, `${p} insights`);
    assert.equal(store.selectionCount, expected.seq0Summary.selectedCount, `${p} count`);
    assert.equal(store.selectionTotal, expected.seq0Summary.total, `${p} total`);
    assert.equal(fmt(store.selectionTotal), expected.seq0Summary.totalText, `${p} total text`);
  });
});

test('applying the bundled stream reproduces the golden digests at seq 100, 1000 and 10000', () => {
  const g = golden();
  PROFILES.forEach((p) => {
    const store = new Store(loadFixture(p));
    const expected = g.profiles[p];
    const states = new Map(expected.stateDigests.map((d) => [d.seq, d.digest]));
    const insights = new Map(expected.insightsDigests.map((d) => [d.seq, d.digest]));
    const lines = streamText(p).split('\n');
    let checked = 0;
    lines.forEach((line) => {
      if (line === '') {
        return;
      }
      const frame = parseFrame(line, store.itemCount);
      assert.ok(frame !== null && frame.t === 'u', `frame ${line}`);
      if (frame.t !== 'u') {
        return;
      }
      assert.equal(store.applyUpdate(frame.s, frame.i, frame.a, frame.b, frame.c), 'applied');
      if (states.has(frame.s)) {
        assert.equal(stateDigest(store), states.get(frame.s), `${p} state @${frame.s}`);
        assert.equal(insightsDigest(frame.s, computeInsights(store)), insights.get(frame.s), `${p} insights @${frame.s}`);
        checked += 1;
      }
    });
    assert.equal(checked, 3, `${p}: digests checked at 100, 1000, 10000`);
    // The running selection total stays equal to a full recomputation.
    const total = store.selectionTotal;
    store.recomputeSummary();
    assert.equal(store.selectionTotal, total, `${p} incremental total`);
  });
});

test('parseFixture rejects malformed documents', () => {
  const good = JSON.parse(readFileSync(join(fixturesDir, 'small.json'), 'utf8'));
  const broken = [
    null,
    { ...good, schema: 'other/1' },
    { ...good, items: [] },
    { ...good, items: [{ ...good.items[0], i: 5 }, ...good.items.slice(1)] },
    { ...good, items: [{ ...good.items[0], v: [99, 100, 100] }, ...good.items.slice(1)] },
    { ...good, items: [{ ...good.items[0], g: 8 }, ...good.items.slice(1)] },
    { ...good, selection: [good.selection[1], good.selection[0]] },
    { ...good, selection: [{ i: 0, o: 3 }] },
  ];
  broken.forEach((doc, k) => assert.throws(() => parseFixture(doc), FixtureError, `case ${k}`));
});
