import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobilebench_flutter/domain/format.dart';
import 'package:mobilebench_flutter/domain/store.dart';

import 'support.dart';

/// End-to-end conformance of the Dart port against fixtures/v1/golden.json: the bundled bytes,
/// the seq-0 summary and the state and Insights digests at seq 0, 100, 1000 and 10000.
void main() {
  for (final profile in profiles) {
    group(profile, () {
      final g = goldenProfile(profile);

      test('bundled fixture and stream bytes equal the committed golden SHA-256', () {
        expect(sha256.convert(assetBytes('$profile.json')).toString(), g['sha256']);
        final stream = g['stream'] as Map<String, Object?>;
        expect(sha256.convert(assetBytes('$profile.stream.jsonl')).toString(), stream['sha256']);
        expect(streamLines(profile), hasLength(stream['messages']));
      });

      test('parsed fixture matches the profile and the seq-0 summary', () {
        final f = fixture(profile);
        expect(f.profile, profile);
        expect(f.itemCount, g['items']);
        expect(f.selection, hasLength(g['selections']));
        final store = AppStore.fromFixture(f);
        final s = g['seq0Summary'] as Map<String, Object?>;
        expect(store.summary.value.count, s['selectedCount']);
        expect(store.summary.value.total, s['total']);
        expect(fmt(store.summary.value.total), s['totalText']);
      });

      test('state and Insights digests equal golden.json at every recorded seq', () {
        final store = AppStore.fromFixture(fixture(profile));
        final stateDigests = {
          for (final e in g['stateDigests'] as List<Object?>)
            (e as Map<String, Object?>)['seq'] as int: e['digest'] as String,
        };
        final insightsDigests = {
          for (final e in g['insightsDigests'] as List<Object?>)
            (e as Map<String, Object?>)['seq'] as int: e['digest'] as String,
        };
        void check() {
          final seq = store.lastAppliedSeq;
          if (stateDigests.containsKey(seq)) {
            expect(store.stateDigest(), stateDigests[seq], reason: 'state digest at seq $seq');
            expect(store.insightsDigest(), insightsDigests[seq], reason: 'Insights digest at seq $seq');
          }
        }

        check();
        for (final line in streamLines(profile)) {
          final m = jsonDecode(line) as Map<String, Object?>;
          final v = (m['v'] as List<Object?>).cast<int>();
          expect(m['s'], store.lastAppliedSeq + 1);
          store.applyUpdate(m['s'] as int, m['i'] as int, v[0], v[1], v[2]);
          check();
        }
        expect(store.lastAppliedSeq, 10000);
      });
    });
  }
}
