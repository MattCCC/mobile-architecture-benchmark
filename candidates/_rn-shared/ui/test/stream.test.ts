// Stream tests: replay schedule and catch-up, end/checkpoint frames, duplicates and gaps, stale and reconnect,
// WebSocket frame parsing and URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplaySource } from '../src/stream/replay.ts';
import type { StreamAsset } from '../src/stream/replay.ts';
import { StreamClient } from '../src/stream/client.ts';
import type { StreamClientHost } from '../src/stream/client.ts';
import type { FrameSource, FrameSourceHandlers } from '../src/stream/source.ts';
import { parseFrame, streamUrl, WebSocketSource } from '../src/stream/websocket.ts';
import type { SocketLike } from '../src/stream/websocket.ts';
import type { StreamFrame, StreamStatus } from '../src/domain/types.ts';
import { FakeClock } from './helpers.ts';

function asset(messages: number, rate: number): StreamAsset {
  const data: number[] = [];
  for (let s = 1; s <= messages; s += 1) {
    data.push(s % 7, 100 + s, 200 + s, 300 + s);
  }
  return { schema: 'mobilebench.rn-stream/1', profile: 'small', rate, messages, sha256: '-', data };
}

class Host implements StreamClientHost {
  last = 0;
  applied: number[] = [];
  statuses: StreamStatus[] = [];
  checkpoints: number[] = [];
  marks: string[] = [];
  lastApplied(): number {
    return this.last;
  }
  apply(seq: number): void {
    this.last = seq;
    this.applied.push(seq);
  }
  status(s: StreamStatus): void {
    this.statuses.push(s);
  }
  checkpoint(k: number): void {
    this.checkpoints.push(k);
  }
  mark(event: string, payload: string): void {
    this.marks.push(`${event} ${payload}`);
  }
}

test('replay follows the absolute schedule and ends with a checkpoint 500 ms after the end frame', () => {
  const clock = new FakeClock();
  const host = new Host();
  const client = new StreamClient(new ReplaySource(asset(100, 20), clock, 10), clock, host);
  client.start();
  assert.equal(client.status, 'Connecting');
  clock.advance(0);
  assert.equal(client.status, 'Live');
  assert.deepEqual(host.applied, [1]); // message 1 is due at t0
  clock.advance(49);
  assert.deepEqual(host.applied, [1]);
  clock.advance(1);
  assert.deepEqual(host.applied, [1, 2]);
  clock.advance(450);
  assert.deepEqual(host.applied, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(client.status, 'Ended');
  assert.deepEqual(host.checkpoints, []);
  clock.advance(500);
  assert.deepEqual(host.checkpoints, [0]);
  assert.deepEqual(client.counters, { received: 10, applied: 10, dup: 0, gap: 0, first: 1, last: 10 });
  assert.ok(host.marks.includes('stream.live s=1'));
});

test('replay catch-up after stop/start delivers all due messages at once, then real time', () => {
  const clock = new FakeClock();
  const host = new Host();
  const client = new StreamClient(new ReplaySource(asset(1000, 20), clock, null), clock, host);
  client.start();
  clock.advance(0);
  clock.advance(100); // seq 1..3
  assert.equal(host.last, 3);
  client.stop('background');
  assert.equal(client.status, 'Disconnected');
  clock.advance(5000); // background: the schedule continues
  assert.equal(host.last, 3);
  client.start();
  clock.advance(0);
  // Due by now: t = 5100 ms after t0 -> seq 1 + 5100 / 50 = 103.
  assert.equal(host.last, 103);
  clock.advance(50);
  assert.equal(host.last, 104);
  assert.equal(client.counters.gap, 0);
  assert.equal(client.counters.dup, 0);
});

test('count 0: hello then end; status Live then Ended; checkpoint k=0 at seq 0', () => {
  const clock = new FakeClock();
  const host = new Host();
  const client = new StreamClient(new ReplaySource(asset(10, 20), clock, 0), clock, host);
  client.start();
  clock.advance(0);
  assert.deepEqual(host.statuses, ['Connecting', 'Live', 'Ended']);
  clock.advance(500);
  assert.deepEqual(host.checkpoints, [0]);
  assert.equal(host.last, 0);
});

class ScriptedSource implements FrameSource {
  readonly kind = 'websocket' as const;
  handlers: FrameSourceHandlers | null = null;
  opens: number[] = [];
  closes = 0;
  open(from: number, handlers: FrameSourceHandlers): void {
    this.opens.push(from);
    this.handlers = handlers;
  }
  close(): void {
    this.closes += 1;
    this.handlers = null;
  }
  send(f: StreamFrame): void {
    this.handlers?.onFrame(f);
  }
}

test('duplicates are counted and ignored; a gap closes and reconnects from lastApplied + 1', () => {
  const clock = new FakeClock();
  const host = new Host();
  const src = new ScriptedSource();
  const client = new StreamClient(src, clock, host);
  client.start();
  src.handlers?.onOpen();
  src.send({ t: 'h', from: 1 });
  src.send({ t: 'u', s: 1, i: 0, v: [100, 100, 100] });
  src.send({ t: 'u', s: 1, i: 0, v: [100, 100, 100] });
  src.send({ t: 'u', s: 3, i: 0, v: [100, 100, 100] });
  assert.equal(client.counters.dup, 1);
  assert.equal(client.counters.gap, 1);
  assert.equal(client.status, 'Disconnected');
  assert.ok(host.marks.includes('err code=stream-gap'));
  clock.advance(249);
  assert.deepEqual(src.opens, [1]);
  clock.advance(1);
  assert.deepEqual(src.opens, [1, 2]);
});

test('checkpoint frame pauses timers; resume frame returns to Live; stale after 2 s, reconnect after 3 s', () => {
  const clock = new FakeClock();
  const host = new Host();
  const src = new ScriptedSource();
  const client = new StreamClient(src, clock, host);
  client.start();
  src.handlers?.onOpen();
  src.send({ t: 'h', from: 1 });
  src.send({ t: 'u', s: 1, i: 0, v: [100, 100, 100] });
  src.send({ t: 'c', k: 3, last: 1 });
  assert.equal(client.status, 'Paused');
  clock.advance(10000);
  assert.equal(client.status, 'Paused'); // no stale while paused
  assert.deepEqual(host.checkpoints, [3]);
  src.send({ t: 'r', from: 2 });
  assert.equal(client.status, 'Live');
  clock.advance(2000);
  assert.equal(client.status, 'Stale');
  clock.advance(999);
  assert.deepEqual(src.opens, [1]);
  clock.advance(1);
  assert.equal(client.status, 'Disconnected');
  clock.advance(250);
  assert.deepEqual(src.opens, [1, 2]);
});

test('websocket frames, URL and close handling', () => {
  assert.deepEqual(parseFrame('{"t":"u","s":17,"i":42,"v":[1234,567,8910]}'), { t: 'u', s: 17, i: 42, v: [1234, 567, 8910] });
  assert.deepEqual(parseFrame('{"t":"c","k":3,"last":417}'), { t: 'c', k: 3, last: 417 });
  assert.equal(parseFrame('{"t":"u","s":1}'), null);
  assert.equal(parseFrame('nope'), null);
  const o = { wsBase: 'ws://10.0.2.2:8787', profile: 'representative', session: 's-1', token: null, factory: () => fake };
  assert.equal(streamUrl(o, 5), 'ws://10.0.2.2:8787/v1/stream?profile=representative&from=5&session=s-1');
  assert.equal(
    streamUrl({ ...o, token: '0123456789abcdef0123456789abcdef' }, 1),
    'ws://10.0.2.2:8787/v1/stream?profile=representative&from=1&session=s-1&token=0123456789abcdef0123456789abcdef',
  );
  const fake: SocketLike = { onopen: null, onmessage: null, onerror: null, onclose: null, close: () => {} };
  const clock = new FakeClock();
  const host = new Host();
  const client = new StreamClient(new WebSocketSource(o), clock, host);
  client.start();
  fake.onopen?.({});
  fake.onmessage?.({ data: '{"t":"h","from":1}' });
  fake.onmessage?.({ data: '{"t":"u","s":1,"i":2,"v":[100,200,300]}' });
  assert.equal(host.last, 1);
  fake.onmessage?.({ data: 'garbage' });
  assert.ok(host.marks.includes('err code=stream-protocol'));
  assert.equal(client.status, 'Disconnected');
});
