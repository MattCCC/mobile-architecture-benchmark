// Session tests: startup, tokens from core state, checkpoints, background record v2, restoration (F3: the
// restored state equals the reference state at lastSeq, so later digests match the reference).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/app/session.ts';
import type { Persistence } from '../src/app/session.ts';
import { parseLaunchConfig } from '../src/domain/launchConfig.ts';
import { sha256Hex } from '../src/domain/sha256.ts';
import { Store } from '../src/domain/store.ts';
import { ReplaySource } from '../src/stream/replay.ts';
import type { StreamAsset } from '../src/stream/replay.ts';
import { FakeClock, loadFixture, RecordingBench } from './helpers.ts';

class MemoryPersistence implements Persistence {
  text: string | null = null;
  async load(): Promise<string | null> {
    return this.text;
  }
  async save(text: string): Promise<void> {
    this.text = text;
  }
}

function smallAsset(): StreamAsset {
  // Deterministic synthetic stream over the small profile (30 items); values stay in range.
  const data: number[] = [];
  for (let s = 1; s <= 500; s += 1) {
    data.push(s % 30, 100 + (s % 9000), 200 + (s % 9000), 300 + (s % 9000));
  }
  return { schema: 'mobilebench.rn-stream/1', profile: 'small', rate: 5, messages: 500, sha256: '-', data };
}

function makeSession(raw: Record<string, string>, persistence: MemoryPersistence, clock: FakeClock, bench: RecordingBench) {
  const { config } = parseLaunchConfig(raw);
  const asset = smallAsset();
  return new Session(config, loadFixture('small'), {
    bench,
    persistence,
    clock,
    createSource: (c) => new ReplaySource(asset, clock, c.count),
  });
}

test('startup, selection tokens, navigation tokens, end checkpoint', async () => {
  const clock = new FakeClock();
  const bench = new RecordingBench();
  const persistence = new MemoryPersistence();
  const s = makeSession({ 'mb.profile': 'small', 'mb.count': '20' }, persistence, clock, bench);
  const plan = await s.prepare();
  assert.deepEqual(plan, { routes: ['list'], anchor: 0, restored: false });
  assert.equal(s.streamGateMarker, 'fui');
  assert.equal(s.summaryToken.get(), 'fui0');
  s.toggle(1, 0);
  assert.equal(s.summaryToken.get(), 'rev:1');
  s.routeChanged('list');
  assert.equal(s.topToken.get().token, 'nav:0');
  s.routeChanged('detail/3');
  assert.deepEqual(s.topToken.get(), { route: 'detail/3', token: 'nav:1' });
  s.routeChanged('list');
  assert.deepEqual(s.topToken.get(), { route: 'list', token: 'nav:2' });
  s.startStream();
  clock.advance(0);
  assert.equal(s.status.get(), 'Live');
  clock.advance(4000); // 20 messages at 5 msg/s
  assert.equal(s.store.lastSeq, 20);
  assert.equal(s.status.get(), 'Ended');
  clock.advance(500);
  assert.equal(bench.states.length, 1);
  const st = bench.states[0];
  assert.equal(st.k, 0);
  assert.equal(st.seq, 20);
  assert.equal(st.digest, sha256Hex(s.store.stateText()));
  assert.equal(st.counters, `r=20;a=20;dup=0;gap=0;rows=${s.store.rowRenders}`);
  assert.equal(s.digestText.get(), `k=0;seq=20;d=${st.digest.slice(0, 12)}`);
});

test('background writes record v2 then checkpoint k=0; restore reproduces the exact state and resumes at lastSeq + 1', async () => {
  const clock = new FakeClock();
  const bench = new RecordingBench();
  const persistence = new MemoryPersistence();
  const s = makeSession({ 'mb.profile': 'small' }, persistence, clock, bench);
  await s.prepare();
  s.toggle(1, 0);
  s.toggle(1, 1);
  s.toggle(2, 2);
  s.startStream();
  clock.advance(0);
  clock.advance(19 * 200); // seq 1..20
  assert.equal(s.store.lastSeq, 20);
  s.setAnchor(20);
  s.routeChanged('detail/21');
  const reference = s.store.stateText();
  await s.onBackground(['list', 'detail/21']);
  assert.equal(bench.states.at(-1)?.k, 0);
  assert.equal(bench.states.at(-1)?.seq, 20);
  assert.ok(persistence.text?.startsWith('{"v":2,"route":["list","detail/21"],"anchor":20,'));
  clock.advance(10000);
  assert.equal(s.store.lastSeq, 20); // stream closed in background

  // New process: launch with mb.restore=1.
  const bench2 = new RecordingBench();
  const clock2 = new FakeClock();
  const r = makeSession({ 'mb.profile': 'small', 'mb.restore': '1' }, persistence, clock2, bench2);
  const plan = await r.prepare();
  assert.deepEqual(plan, { routes: ['list', 'detail/21'], anchor: 20, restored: true });
  assert.equal(r.streamGateMarker, 'restore');
  assert.equal(r.store.stateText(), reference);
  assert.deepEqual(r.topToken.get(), { route: 'detail/21', token: 'restore:detail/21:20' });
  r.routeChanged('list'); // the restored stack is rebuilt bottom first
  r.routeChanged('detail/21');
  assert.deepEqual(r.topToken.get(), { route: 'detail/21', token: 'restore:detail/21:20' });
  r.restoreDone();
  r.startStream();
  clock2.advance(0);
  assert.equal(r.store.lastSeq, 21); // first message after restore has seq lastSeq + 1
  // Reference: the same state with message 21 applied on top.
  const ref = new Store('small', loadFixture('small'));
  const parsed = JSON.parse(persistence.text as string) as { values: number[][]; selection: number[][]; lastSeq: number };
  ref.restoreState(parsed.values, parsed.selection, parsed.lastSeq);
  const a = smallAsset().data;
  ref.applyUpdate(21, a[80], [a[81], a[82], a[83]]);
  assert.equal(r.store.stateText(), ref.stateText());
  r.routeChanged('list');
  assert.deepEqual(r.topToken.get(), { route: 'list', token: 'nav:1' });
});

test('missing or invalid record: normal launch with err code=persist-read', async () => {
  const bench = new RecordingBench();
  const persistence = new MemoryPersistence();
  persistence.text = '{"v":1}';
  const s = makeSession({ 'mb.profile': 'small', 'mb.restore': '1' }, persistence, new FakeClock(), bench);
  const plan = await s.prepare();
  assert.equal(plan.restored, false);
  assert.deepEqual(bench.events('err'), [{ event: 'err', payload: 'code=persist-read' }]);
});

test('foreground sets the fg token; activity-warm reset returns to seq 0 and list', async () => {
  const clock = new FakeClock();
  const bench = new RecordingBench();
  const s = makeSession({ 'mb.profile': 'small' }, new MemoryPersistence(), clock, bench);
  await s.prepare();
  s.startStream();
  clock.advance(0);
  clock.advance(1000);
  assert.ok(s.store.lastSeq > 0);
  bench.fg = 1;
  s.onForeground();
  assert.deepEqual(s.topToken.get(), { route: 'list', token: 'fg:1' });
  s.resetForNewActivity();
  assert.equal(s.store.lastSeq, 0);
  assert.equal(s.summaryToken.get(), 'fui0');
  assert.deepEqual(s.topToken.get(), { route: 'list', token: 'nav:0' });
  assert.equal(s.status.get(), 'Disconnected');
});
