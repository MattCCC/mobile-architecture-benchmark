import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FuiGate, ROW_HEIGHT, TokenProbe } from '../app/core/fui-gate';
import { entriesFromArguments, parseLaunchConfig } from '../app/core/launch-config';
import { isValidEvent, isValidPayload, jsonlRecord, mirrorLine, Ordinals, traceSectionName } from '../app/core/markers';

function gate() {
  const emitted: string[] = [];
  const g = new FuiGate({ selectionCount: () => 50, lastSeq: () => 0 }, (e, p) => emitted.push(`${e} ${p}`));
  return { g, emitted };
}

test('FUI gate: kReq = floor(h / 72); fui only after rows 0..kReq-1 and the summary probe drew', () => {
  const { g, emitted } = gate();
  g.arm();
  g.listLayout(700.19);
  assert.equal(g.requiredRows, Math.floor(700 / ROW_HEIGHT));
  g.summaryProbeDrawn();
  for (let i = 8; i >= 1; i -= 1) {
    g.rowDrawn(i);
  }
  g.rowDrawn(12);
  assert.deepEqual(emitted, []);
  g.rowDrawn(0);
  assert.deepEqual(emitted, ['list.rendered rows=9;h=700', 'fui rows=9;h=700;sel=50;seq=0']);
  assert.ok(g.done);
  g.rowDrawn(0);
  g.summaryProbeDrawn();
  assert.equal(emitted.length, 2, 'inert after FUI');
});

test('FUI gate: rows complete first, fui waits for the summary probe; first layout wins', () => {
  const { g, emitted } = gate();
  g.arm();
  for (let i = 0; i < 3; i += 1) {
    g.rowDrawn(i);
  }
  g.listLayout(216);
  g.listLayout(999);
  assert.deepEqual(emitted, ['list.rendered rows=3;h=216']);
  g.summaryProbeDrawn();
  assert.equal(emitted[1], 'fui rows=3;h=216;sel=50;seq=0');
});

test('FUI gate: disarmed (restore launch) emits nothing; re-arm starts a new gate', () => {
  const { g, emitted } = gate();
  g.disarm();
  g.listLayout(144);
  g.rowDrawn(0);
  g.rowDrawn(1);
  g.summaryProbeDrawn();
  assert.deepEqual(emitted, []);
  g.arm();
  g.listLayout(144);
  g.rowDrawn(0);
  g.rowDrawn(1);
  g.summaryProbeDrawn();
  assert.equal(emitted.length, 2);
  g.arm();
  assert.ok(!g.done);
});

test('token probe: a marker is due once per new token; settle suppresses it', () => {
  const p = new TokenProbe<string>();
  assert.equal(p.drawn(), null);
  assert.ok(p.set('nav:1', 'screen 1'));
  assert.ok(!p.set('nav:1', 'screen 1 again'));
  assert.equal(p.drawn(), 'screen 1');
  assert.equal(p.drawn(), null);
  p.settle('rev:0');
  assert.equal(p.drawn(), null);
  assert.ok(p.set('rev:1', 'resp 1'));
  assert.ok(p.set('rev:2', 'resp 2'));
  assert.equal(p.drawn(), 'resp 2', 'only the latest token is emitted');
  assert.equal(p.current, 'rev:2');
});

test('launch configuration: defaults, valid keys, invalid values and unknown keys', () => {
  const d = parseLaunchConfig({});
  assert.equal(d.profile, 'representative');
  assert.equal(d.restore, false);
  assert.equal(d.markerMirror, 'control');
  assert.equal(d.replayCount, null);
  assert.deepEqual([d.unknownKeys, d.invalidKeys], [[], []]);

  const c = parseLaunchConfig({
    'mb.journey': 'j-000123',
    'mb.profile': 'small',
    'mb.restore': '1',
    'mb.journeyMode': '1',
    'mb.markerMirror': 'all',
    'mb.replayCount': '200',
    'mb.semantics': 'on',
    'mb.zzz': 'x',
    'other.key': 'ignored',
  });
  assert.deepEqual(
    [c.journey, c.profile, c.restore, c.journeyMode, c.markerMirror, c.replayCount],
    ['j-000123', 'small', true, true, 'all', 200],
  );
  assert.deepEqual(c.unknownKeys, ['mb.zzz']);
  assert.deepEqual(c.invalidKeys, []);

  const bad = parseLaunchConfig({
    'mb.profile': 'huge',
    'mb.restore': 'yes',
    'mb.token': 'short',
    'mb.dataset': 'network',
    'mb.server': 'ws://10.0.2.2:8080',
  });
  assert.equal(bad.profile, 'representative');
  assert.equal(bad.restore, false);
  assert.equal(bad.token, null);
  assert.deepEqual([...bad.invalidKeys].sort(), ['mb.dataset', 'mb.profile', 'mb.restore', 'mb.server', 'mb.token']);
});

test('iOS launch arguments -mb.<key> <value>', () => {
  assert.deepEqual(entriesFromArguments(['/path/App', '-mb.profile', 'small', '-NSDoubleLocalizedStrings', 'YES', '-mb.restore', '1']), {
    'mb.profile': 'small',
    'mb.restore': '1',
  });
  assert.deepEqual(entriesFromArguments(['/path/App', '-mb.profile']), {});
});

test('marker encoding follows the instrumentation contract', () => {
  assert.ok(isValidEvent('fui'));
  assert.ok(isValidEvent('stream.live'));
  assert.ok(!isValidEvent('Fui'));
  assert.ok(!isValidEvent('a'.repeat(25)));
  assert.ok(isValidPayload('rows=9;h=700;sel=50;seq=0'));
  assert.ok(isValidPayload(''));
  assert.ok(!isValidPayload('a b'));
  assert.ok(!isValidPayload('a|b'));
  assert.ok(!isValidPayload('x'.repeat(65)));
  assert.equal(traceSectionName('fui', 1, 'rows=9'), 'mb|fui|1|rows=9');
  assert.ok(traceSectionName('remote.request', 99, 'x'.repeat(64)).length <= 127);
  assert.equal(mirrorLine('j-1', 'state', 2, 'k=0;s=5', 123.4), 'MB j-1 state 2 k=0;s=5 t=123');
  assert.equal(mirrorLine('j-1', 'bg', 1, '', 7), 'MB j-1 bg 1 - t=7');
  assert.equal(jsonlRecord('fui', 1, 123456789012, 'rows=9'), '{"e":"fui","n":1,"t":123456789012,"p":"rows=9"}');
  const o = new Ordinals();
  assert.deepEqual([o.next('fui'), o.next('resp'), o.next('fui')], [1, 1, 2]);
});
