import 'dart:convert';
import 'dart:typed_data';

import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_flutter/benchkit/backend.dart';
import 'package:mobilebench_flutter/benchkit/benchkit.dart';
import 'package:mobilebench_flutter/stream/frame_source.dart';
import 'package:mobilebench_flutter/stream/replay_source.dart';
import 'package:mobilebench_flutter/stream/stream_client.dart';

/// Scripted transport for the client rules.
class FakeSource implements FrameSource {
  final List<int> opens = [];
  int closes = 0;
  void Function(String)? frame;
  void Function(String)? closed;

  @override
  void open({
    required int from,
    required void Function() onOpen,
    required void Function(String frame) onFrame,
    required void Function(String why) onClosed,
  }) {
    opens.add(from);
    frame = onFrame;
    closed = onClosed;
    onOpen();
  }

  @override
  void close() => closes++;

  void send(String f) => frame!(f);
  void update(int s, int i) => send('{"t":"u","s":$s,"i":$i,"v":[100,200,300]}');
}

void main() {
  late MemoryMarkerBackend backend;
  late BenchKit bench;
  late FakeSource source;
  late StreamClient client;
  late int last;
  late List<int> checkpoints;

  setUp(() {
    backend = MemoryMarkerBackend();
    bench = BenchKit(backend: backend, journeyId: 'j');
    source = FakeSource();
    last = 0;
    checkpoints = [];
    client = StreamClient(
      source: source,
      bench: bench,
      itemCount: 10,
      lastApplied: () => last,
      apply: (s, i, a, b, c) => last = s,
      onCheckpoint: checkpoints.add,
    );
  });

  List<String> payloads(String event) => backend.of(event).map((r) => r.payload).toList();

  test('hello, in-order updates, duplicates and the first-applied marker', () {
    fakeAsync((fa) {
      client.connect();
      expect(client.status.value, StreamStatus.connecting);
      source.send('{"t":"h","session":"s","profile":"small","seed":42,"rate":5,"from":1}');
      expect(client.status.value, StreamStatus.live);
      source
        ..update(1, 3)
        ..update(2, 4)
        ..update(2, 4);
      expect(last, 2);
      expect(client.counters.received, 3);
      expect(client.counters.applied, 2);
      expect(client.counters.duplicates, 1);
      expect(payloads('stream.connect'), ['a=1']);
      expect(payloads('stream.open'), ['from=1']);
      expect(payloads('stream.live'), ['s=1']);
      client.disconnect('bg');
    });
  });

  test('a gap closes the connection and reconnects from lastApplied + 1 with back-off', () {
    fakeAsync((fa) {
      client.connect();
      source
        ..send('{"t":"h","from":1}')
        ..update(1, 0)
        ..update(3, 0);
      expect(client.counters.gaps, 1);
      expect(payloads('err'), ['code=stream-gap']);
      expect(client.status.value, StreamStatus.disconnected);
      fa.elapse(const Duration(milliseconds: 249));
      expect(source.opens, [1]);
      fa.elapse(const Duration(milliseconds: 1));
      expect(source.opens, [1, 2]);
      client.disconnect('bg');
    });
  });

  test('stale after 2 s without messages, reconnect after 3 s; back-off grows', () {
    fakeAsync((fa) {
      client.connect();
      source.send('{"t":"h","from":1}');
      fa.elapse(const Duration(seconds: 2));
      expect(client.status.value, StreamStatus.stale);
      expect(backend.of('stream.stale'), hasLength(1));
      fa.elapse(const Duration(seconds: 1));
      expect(payloads('stream.closed'), ['why=stale']);
      fa.elapse(const Duration(milliseconds: 250));
      expect(source.opens, [1, 1]);
      source.closed!('peer');
      fa.elapse(const Duration(milliseconds: 499));
      expect(source.opens, hasLength(2));
      fa.elapse(const Duration(milliseconds: 1));
      expect(source.opens, hasLength(3));
      client.disconnect('bg');
    });
  });

  test('checkpoint and end frames suspend timers and trigger checkpoints after 500 ms', () {
    fakeAsync((fa) {
      client.connect();
      source
        ..send('{"t":"h","from":1}')
        ..update(1, 0)
        ..send('{"t":"c","k":3,"last":1}');
      expect(client.status.value, StreamStatus.paused);
      fa.elapse(const Duration(milliseconds: 499));
      expect(checkpoints, isEmpty);
      fa.elapse(const Duration(milliseconds: 1));
      expect(checkpoints, [3]);
      fa.elapse(const Duration(seconds: 10));
      expect(client.status.value, StreamStatus.paused, reason: 'no stale while paused');
      source.send('{"t":"r","from":2}');
      expect(client.status.value, StreamStatus.live);
      source
        ..update(2, 1)
        ..send('{"t":"e","last":2}');
      expect(client.status.value, StreamStatus.ended);
      fa.elapse(const Duration(seconds: 5));
      expect(checkpoints, [3, 0]);
      expect(client.status.value, StreamStatus.ended);
    });
  });

  test('protocol errors are reported and ignored', () {
    fakeAsync((fa) {
      client.connect();
      source
        ..send('not json')
        ..send('{"t":"u","s":1,"i":99,"v":[100,200,300]}')
        ..send('{"t":"u","s":1,"i":1,"v":[1,2,3]}')
        ..send('{"t":"x"}');
      expect(payloads('err'), List.filled(4, 'code=stream-protocol'));
      expect(last, 0);
      client.disconnect('bg');
    });
  });

  group('replay source', () {
    Uint8List streamBytes(int count) => Uint8List.fromList(
      utf8.encode([for (var s = 1; s <= count; s++) '{"t":"u","s":$s,"i":0,"v":[100,200,300]}\n'].join()),
    );

    test('hello, absolute schedule at the profile rate, end frame', () {
      fakeAsync((fa) {
        final frames = <String>[];
        final replay = ReplayFrameSource(
          profile: 'small',
          seed: 42,
          rate: 20,
          load: () async => streamBytes(5),
          clockUs: () => fa.elapsed.inMicroseconds,
        );
        replay.open(from: 1, onOpen: () {}, onFrame: frames.add, onClosed: (_) {});
        fa.flushMicrotasks();
        expect(frames.first, startsWith('{"t":"h",'));
        expect(frames.first, contains('"rate":20,"from":1}'));
        expect(frames, hasLength(2), reason: 'seq 1 is due at t0');
        fa.elapse(const Duration(milliseconds: 49));
        expect(frames, hasLength(2));
        fa.elapse(const Duration(milliseconds: 1));
        expect(frames.last, '{"t":"u","s":2,"i":0,"v":[100,200,300]}');
        fa.elapse(const Duration(milliseconds: 149));
        expect(frames, hasLength(5));
        fa.elapse(const Duration(milliseconds: 1));
        // seq 5 is due at 200 ms; the end frame follows the last bundled message directly.
        expect(frames.sublist(5), ['{"t":"u","s":5,"i":0,"v":[100,200,300]}', '{"t":"e","last":5}']);
        fa.elapse(const Duration(seconds: 1));
        expect(frames, hasLength(7));
        expect(replay.messageCount, 5);
      });
    });

    test('reconnect delivers already-due messages immediately, then real time', () {
      fakeAsync((fa) {
        final frames = <String>[];
        final replay = ReplayFrameSource(
          profile: 'small',
          seed: 42,
          rate: 10,
          load: () async => streamBytes(100),
          clockUs: () => fa.elapsed.inMicroseconds,
        );
        replay.open(from: 1, onOpen: () {}, onFrame: frames.add, onClosed: (_) {});
        fa.flushMicrotasks();
        fa.elapse(const Duration(milliseconds: 200));
        expect(frames.where((f) => f.contains('"t":"u"')), hasLength(3));
        replay.close();
        fa.elapse(const Duration(seconds: 2));
        frames.clear();
        replay.open(from: 4, onOpen: () {}, onFrame: frames.add, onClosed: (_) {});
        fa.flushMicrotasks();
        // t = 2.2 s: seq 1..23 are due; 4..23 arrive as catch-up right after the hello frame.
        expect(frames.first, contains('"from":4}'));
        final seqs = [for (final f in frames.skip(1)) int.parse(RegExp(r'"s":(\d+)').firstMatch(f)![1]!)];
        expect(seqs, List.generate(20, (k) => k + 4));
        fa.elapse(const Duration(milliseconds: 100));
        expect(frames.last, contains('"s":24,'));
        replay.close();
      });
    });
  });
}
