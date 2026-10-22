import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReplayTransport, TextFrameReader } from '../app/core/replay';
import { Store } from '../app/core/store';
import { StreamClient, Transport, TransportClient } from '../app/core/stream-client';
import { FakeClock, loadFixture, Recorder, streamText } from './helpers';

function replaySession(limit: number | null, frames = 400) {
  const clock = new FakeClock();
  const store = new Store(loadFixture('representative'));
  const text = `${streamText('representative').split('\n').slice(0, frames).join('\n')}\n`;
  const transport = new ReplayTransport({
    reader: new TextFrameReader(text),
    profile: 'representative',
    seed: 42,
    rate: 20,
    limit,
    nowNs: clock.nowNs,
    timers: clock,
  });
  const events = new Recorder(clock);
  const client = new StreamClient(store, transport, clock, events);
  return { clock, store, transport, events, client };
}

/** Transport driven by the test: frames are pushed by hand. */
class ManualTransport implements Transport {
  readonly kind = 'websocket' as const;
  client: TransportClient | null = null;
  opens: number[] = [];
  open(from: number, client: TransportClient): void {
    this.opens.push(from);
    this.client = client;
    client.onOpen();
  }
  close(): void {
    this.client = null;
  }
  dispose(): void {
    this.client = null;
  }
  send(frame: string): void {
    this.client?.onFrame(frame);
  }
}

function manualSession() {
  const clock = new FakeClock();
  const store = new Store(loadFixture('small'));
  const transport = new ManualTransport();
  const events = new Recorder(clock);
  const client = new StreamClient(store, transport, clock, events);
  return { clock, store, transport, events, client };
}

test('replay delivers message k at t0 + (k - from) / rate', () => {
  const s = replaySession(null);
  s.client.connect();
  assert.equal(s.events.lastStatus, 'Live');
  assert.equal(s.store.lastSeq, 1, 'message 1 is due at t0');
  s.clock.advanceMs(49);
  assert.equal(s.store.lastSeq, 1);
  s.clock.advanceMs(1);
  assert.equal(s.store.lastSeq, 2);
  s.clock.advanceMs(950);
  assert.equal(s.store.lastSeq, 21);
  assert.deepEqual(s.events.markers.slice(0, 4), ['stream.connect a=1', 'stream.open from=1', 'stream.live s=1', 'update.applied s=1']);
  assert.deepEqual(s.store.counters, { received: 21, applied: 21, dup: 0, gap: 0, rows: 0 });
});

test('reconnect after background catches up with every message already due, then continues in real time', () => {
  const s = replaySession(null);
  s.client.connect();
  s.clock.advanceMs(1000);
  assert.equal(s.store.lastSeq, 21);
  s.client.disconnect('background');
  assert.equal(s.events.lastStatus, 'Disconnected');
  assert.ok(s.events.markers.includes('stream.closed why=background'));
  s.clock.advanceMs(5000);
  assert.equal(s.store.lastSeq, 21, 'nothing applied while closed');
  assert.equal(s.clock.pending, 0, 'no timers while closed');
  s.client.connect();
  assert.equal(s.store.lastSeq, 121, 'catch-up up to the message due at 6000 ms');
  assert.ok(s.events.markers.includes('stream.open from=22'));
  assert.ok(s.events.markers.includes('stream.live s=22'));
  s.clock.advanceMs(50);
  assert.equal(s.store.lastSeq, 122);
  assert.equal(s.store.counters.dup + s.store.counters.gap, 0);
});

test('end frame after the session count: status Ended, checkpoint k=0 after 500 ms idle', () => {
  const s = replaySession(30);
  s.client.connect();
  s.clock.advanceMs(1450);
  assert.equal(s.store.lastSeq, 30);
  assert.equal(s.events.lastStatus, 'Ended');
  s.clock.advanceMs(499);
  assert.equal(s.events.checkpoints.length, 0);
  s.clock.advanceMs(1);
  assert.deepEqual(s.events.checkpoints, [{ k: 0, atMs: 1950 }]);
  s.clock.advanceMs(10000);
  assert.ok(!s.events.statuses.includes('Stale'), 'no stale timer after the end frame');
});

test('a session count of 0 ends right after the hello frame (checkpoint at seq 0)', () => {
  const s = replaySession(0);
  s.client.connect();
  assert.deepEqual(s.events.statuses, ['Connecting', 'Live', 'Ended']);
  s.clock.advanceMs(500);
  assert.deepEqual(s.events.checkpoints.map((c) => c.k), [0]);
  assert.equal(s.store.lastSeq, 0);
});

test('a gap closes the connection and reconnects from lastApplied + 1 after 250 ms', () => {
  const s = manualSession();
  s.client.connect();
  s.transport.send('{"t":"h","session":"x","profile":"small","seed":42,"rate":5,"from":1}');
  s.transport.send('{"t":"u","s":1,"i":0,"v":[200,300,400]}');
  s.transport.send('{"t":"u","s":3,"i":0,"v":[201,301,401]}');
  assert.deepEqual(s.events.errors, ['stream-gap']);
  assert.equal(s.events.lastStatus, 'Disconnected');
  assert.equal(s.store.counters.gap, 1);
  s.clock.advanceMs(249);
  assert.deepEqual(s.transport.opens, [1]);
  s.clock.advanceMs(1);
  assert.deepEqual(s.transport.opens, [1, 2]);
});

test('duplicates are counted and ignored', () => {
  const s = manualSession();
  s.client.connect();
  s.transport.send('{"t":"h","session":"x","profile":"small","seed":42,"rate":5,"from":1}');
  s.transport.send('{"t":"u","s":1,"i":0,"v":[200,300,400]}');
  s.transport.send('{"t":"u","s":1,"i":0,"v":[200,300,400]}');
  assert.equal(s.store.counters.dup, 1);
  assert.equal(s.store.counters.received, 2);
  assert.equal(s.store.counters.applied, 1);
});

test('no message for 2 s: Stale; 3 s: reconnect with deterministic back-off', () => {
  const s = manualSession();
  s.client.connect();
  s.transport.send('{"t":"h","session":"x","profile":"small","seed":42,"rate":5,"from":1}');
  s.clock.advanceMs(1999);
  assert.equal(s.events.lastStatus, 'Live');
  s.clock.advanceMs(1);
  assert.equal(s.events.lastStatus, 'Stale');
  assert.ok(s.events.markers.includes('stream.stale'));
  s.clock.advanceMs(1000);
  assert.equal(s.events.lastStatus, 'Disconnected');
  assert.ok(s.events.markers.includes('stream.closed why=stale'));
  s.clock.advanceMs(250);
  assert.deepEqual(s.transport.opens, [1, 1]);
  assert.equal(s.events.lastStatus, 'Connecting');
  // The second reconnect waits 500 ms.
  s.clock.advanceMs(3000);
  assert.equal(s.events.lastStatus, 'Disconnected');
  s.clock.advanceMs(499);
  assert.equal(s.transport.opens.length, 2);
  s.clock.advanceMs(1);
  assert.equal(s.transport.opens.length, 3);
});

test('checkpoint frame pauses the timers, checkpoints after 500 ms idle; resume frame returns to Live', () => {
  const s = manualSession();
  s.client.connect();
  s.transport.send('{"t":"h","session":"x","profile":"small","seed":42,"rate":5,"from":1}');
  s.transport.send('{"t":"u","s":1,"i":0,"v":[200,300,400]}');
  s.transport.send('{"t":"c","k":3,"last":1}');
  assert.equal(s.events.lastStatus, 'Paused');
  s.clock.advanceMs(500);
  assert.deepEqual(s.events.checkpoints, [{ k: 3, atMs: 500 }]);
  s.clock.advanceMs(10000);
  assert.ok(!s.events.statuses.includes('Stale'), 'timers suspended while paused');
  s.transport.send('{"t":"r","from":2}');
  assert.equal(s.events.lastStatus, 'Live');
  s.clock.advanceMs(2000);
  assert.equal(s.events.lastStatus, 'Stale', 'timers active again after resume');
});

test('an update inside the checkpoint idle window restarts the 500 ms wait', () => {
  const s = manualSession();
  s.client.connect();
  s.transport.send('{"t":"h","session":"x","profile":"small","seed":42,"rate":5,"from":1}');
  s.transport.send('{"t":"c","k":1,"last":1}');
  s.clock.advanceMs(300);
  s.transport.send('{"t":"u","s":1,"i":0,"v":[200,300,400]}');
  s.clock.advanceMs(300);
  assert.equal(s.events.checkpoints.length, 0);
  s.clock.advanceMs(200);
  assert.deepEqual(s.events.checkpoints.map((c) => c.k), [1]);
});

test('protocol violations are reported, not applied', () => {
  const s = manualSession();
  s.client.connect();
  ['nope', '{"t":"u","s":0,"i":0,"v":[200,300,400]}', '{"t":"u","s":1,"i":99,"v":[200,300,400]}', '{"t":"u","s":1,"i":0,"v":[99,300,400]}', '{"t":"x"}'].forEach(
    (frame) => s.transport.send(frame),
  );
  assert.equal(s.events.errors.length, 5);
  assert.ok(s.events.errors.every((e) => e === 'stream-protocol'));
  assert.equal(s.store.lastSeq, 0);
});
