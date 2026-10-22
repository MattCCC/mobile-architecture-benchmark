import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combine, loadSessions, renderSummary, LABELS } from '../lib/combine.mjs';
import { makeObservation } from '../lib/records.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = 'startup.ttff/early-am-start-w/1';

function obs(sessionId, cand, values, { sha = 'aaa', env = 'env-1', buildClass = 'release', platform = 'android', methodId = M, scenarioId = 'early.cold', streamSource = 'replay' } = {}) {
  return values.map((v, i) => {
    const base = { sessionId, runId: 'r', journeyId: `${sessionId}.${cand}.${i}`, journeyIndex: i + 1, candidateId: cand, platform,
      scenarioId, environmentRef: env, environmentClass: platform === 'android' ? 'emulator' : 'simulator', build: { artifactSha256: sha, buildClass },
      streamSource, fixture: { version: '1.0.0', profile: 'representative' } };
    return v === null
      ? makeObservation(base, { methodId, status: 'failed', failure: { class: 'timeout', message: 'x' } })
      : makeObservation(base, { methodId, status: 'measured', value: v, rawRefs: [{ file: 'raw/a', line: 1, text: 't' }] });
  });
}

function session(id, status, observations, platform = 'android') {
  return {
    manifest: { sessionId: id, platform, status, startedAt: '2026-01-01T00:00:00Z', elapsedS: 100, counts: { journeysRun: observations.length },
      design: { sha256: 'f'.repeat(64) }, candidates: [...new Set(observations.map((o) => o.candidateId))].map((c) => ({ id: c, status: 'included' })) },
    observations,
    observationsSha256: 'e'.repeat(64),
  };
}

test('pools only when method, environment and artifact match; sessions are blocks', () => {
  const s1 = session('s-1', 'completed', [...obs('s-1', 'native', [1e6, 2e6, 3e6]), ...obs('s-1', 'flutter', [5e6, null])]);
  const s2 = session('s-2', 'completed', [...obs('s-2', 'native', [4e6, 5e6]), ...obs('s-2', 'native', [9e6], { sha: 'bbb' })]);
  const s3 = session('s-3', 'completed', [...obs('s-3', 'native', [7e6], { env: 'env-2' }), ...obs('s-3', 'native', [8e6], { streamSource: 'server' })]);
  const m = combine([s1, s2, s3]);
  const native = m.rows.filter((r) => r.candidateId === 'native');
  assert.equal(native.length, 4);
  const pooled = native.find((r) => r.artifactSha256 === 'aaa' && r.environmentRef === 'env-1');
  assert.equal(pooled.pooled.n, 5);
  assert.equal(pooled.pooled.median, 3e6);
  assert.deepEqual(pooled.sessions.map((s) => [s.sessionId, s.n, s.median]), [['s-1', 3, 2e6], ['s-2', 2, 4.5e6]]);
  const flutter = m.rows.find((r) => r.candidateId === 'flutter');
  assert.equal(flutter.pooled.n, 1);
  assert.deepEqual(flutter.statuses, [['failed (timeout)', 1], ['measured', 1]]);
});

test('invalid and failed sessions are excluded but listed', () => {
  const s1 = session('s-1', 'completed', obs('s-1', 'native', [1e6]));
  const s2 = session('s-2', 'failed', obs('s-2', 'native', [2e6]));
  const s3 = session('s-3', 'completed', obs('s-3', 'native', [3e6]));
  const m = combine([s1, s2, s3], { invalid: ['s-3'] });
  assert.deepEqual(m.included.map((s) => s.manifest.sessionId), ['s-1']);
  assert.deepEqual(m.excluded.map((e) => e.id), ['s-2', 's-3']);
  assert.equal(m.rows[0].pooled.n, 1);
});

test('summary carries the labels, separates debug builds and is deterministic', () => {
  const s1 = session('s-1', 'completed', [...obs('s-1', 'native', [1e6, 2e6]), ...obs('s-1', 'flutter', [3e6, 4e6])]);
  const s2 = session('s-2', 'completed', [
    ...obs('s-2', 'flutter', [5e6], { platform: 'ios', buildClass: 'debug', methodId: 'startup.process_to_fui/early-ios-markers/1', env: 'env-ios' }),
  ], 'ios');
  const text = renderSummary(combine([s1, s2]));
  for (const l of LABELS) {
    assert.ok(text.includes(l), l);
  }
  assert.ok(text.indexOf('## Debug and unclassified builds') > text.indexOf('## Release builds'));
  assert.ok(text.includes('flutter-semantics-forced-on-simulator'));
  assert.ok(text.includes('| early.cold | `startup.ttff/early-am-start-w/1` | env-1 | replay, 1.0.0/representative | native | aaa | 1 | 2 | 1.5 ms |'));
  assert.ok(text.includes('`startup.ttff/early-am-start-w/1`'));
  assert.equal(text, renderSummary(combine([s1, s2])));
  const ls = text.split('\n');
  const seps = ls.map((l, i) => [l, i]).filter(([l]) => l.startsWith('| ---'));
  assert.ok(seps.length >= 5);
  for (const [, i] of seps) {
    assert.ok(ls[i - 3].startsWith('_EARLY SESSIONS'), `table at line ${i} is not labelled`);
  }
});

test('shared-session view keeps rebuilt artifacts and different environments apart', () => {
  // s-1: native build aaa + flutter fff; s-2: native rebuilt as bbb + flutter fff; s-3: other environment
  const s1 = session('s-1', 'completed', [...obs('s-1', 'native', [1e6, 3e6]), ...obs('s-1', 'flutter', [5e6, 7e6], { sha: 'fff' })]);
  const s2 = session('s-2', 'completed', [...obs('s-2', 'native', [10e6, 12e6], { sha: 'bbb' }), ...obs('s-2', 'flutter', [9e6], { sha: 'fff' })]);
  const s3 = session('s-3', 'completed', [...obs('s-3', 'native', [50e6], { env: 'env-2' }), ...obs('s-3', 'flutter', [60e6], { sha: 'fff', env: 'env-2' })]);
  const m = combine([s1, s2, s3]);
  const g1 = m.shared.find((g) => g.environmentRef === 'env-1');
  assert.deepEqual(g1.candidates, ['flutter', 'native']);
  assert.deepEqual(g1.sharedSessions, ['s-1', 's-2']);
  const line = (cand, sha) => g1.lines.find((l) => l.candidateId === cand && l.artifactSha256 === sha);
  assert.deepEqual([line('native', 'aaa').sessions, line('native', 'aaa').medianOfSessionMedians], [['s-1'], 2e6]);
  assert.deepEqual([line('native', 'bbb').sessions, line('native', 'bbb').medianOfSessionMedians], [['s-2'], 11e6]);
  assert.deepEqual([line('flutter', 'fff').sessions, line('flutter', 'fff').medianOfSessionMedians], [['s-1', 's-2'], 7.5e6]);
  // the other environment is its own group: never mixed into env-1 lines
  const g2 = m.shared.find((g) => g.environmentRef === 'env-2');
  assert.deepEqual(g2.sharedSessions, ['s-3']);
  assert.equal(g2.lines.find((l) => l.candidateId === 'native').medianOfSessionMedians, 50e6);
  const text = renderSummary(m);
  assert.ok(text.includes('| native | bbb | 2 | 2 | 11.0 ms |'));
  assert.ok(text.includes('| native | aaa | 1 | 2 | 2.0 ms |'));
});

test('sizes are build-unit observations with exact values; not-attempted journeys are not-measured', () => {
  const sizeBase = { sessionId: 's-1', runId: 'r', buildId: 'b-native-android-aaa', candidateId: 'native', platform: 'android', scenarioId: 'early.size',
    environmentRef: 'env-1', environmentClass: 'emulator', build: { buildId: 'b-native-android-aaa', artifactSha256: 'aaa', buildClass: 'release' }, streamSource: 'replay' };
  const size = makeObservation(sizeBase, { methodId: 'size.android.apk_arm64/file-bytes/1', status: 'measured', value: 1396588, rawRefs: [{ file: 'raw/s', line: 1, text: 'apk 1396588 bytes' }] });
  const size2 = { ...size, sessionId: 's-2' };
  const jb = { sessionId: 's-1', runId: 'r', journeyId: 'j9', journeyIndex: 9, candidateId: 'native', platform: 'android', scenarioId: 'early.cold',
    environmentRef: 'env-1', environmentClass: 'emulator', build: { artifactSha256: 'aaa', buildClass: 'release' }, streamSource: 'replay', fixture: { version: '1.0.0', profile: 'representative' } };
  const nm = makeObservation(jb, { methodId: M, status: 'not-measured', reason: 'out-of-time:watchdog' });
  const m = combine([
    session('s-1', 'incomplete', [size, nm, ...obs('s-1', 'native', [1e6])]),
    session('s-2', 'completed', [size2]),
  ]);
  assert.equal(m.buildRows.length, 1);
  assert.deepEqual(m.buildRows[0].values, [1396588]);
  assert.deepEqual(m.buildRows[0].sessions, ['s-1', 's-2']);
  const cold = m.rows.find((r) => r.methodId === M);
  assert.equal(cold.pooled.n, 1);
  assert.deepEqual(cold.statuses, [['measured', 1], ['not-measured (out-of-time:watchdog)', 1]]);
  const text = renderSummary(m);
  assert.ok(text.includes('| native | `size.android.apk_arm64/file-bytes/1` | aaa | 1396588 | 1.33 | 1, 2 | measured: 2 |'));
  assert.ok(!text.includes('failed (timeout)'));
});

test('combine.mjs CLI writes byte-identical output for identical input', () => {
  const d = mkdtempSync(join(tmpdir(), 'eb-comb-'));
  try {
    for (const s of [session('s-1', 'completed', obs('s-1', 'native', [1e6, 3e6])), session('s-2', 'completed', obs('s-2', 'native', [2e6]))]) {
      mkdirSync(join(d, 'sessions', s.manifest.sessionId), { recursive: true });
      writeFileSync(join(d, 'sessions', s.manifest.sessionId, 'manifest.json'), JSON.stringify(s.manifest));
      writeFileSync(join(d, 'sessions', s.manifest.sessionId, 'observations.jsonl'), s.observations.map((o) => JSON.stringify(o)).join('\n') + '\n');
    }
    writeFileSync(join(d, 'state.json'), JSON.stringify({ invalidSessions: ['s-2'] }));
    const cli = join(HERE, '..', 'combine.mjs');
    execFileSync(process.execPath, [cli, '--in', join(d, 'sessions'), '--out', join(d, 'a.md'), '--invalid-from', join(d, 'state.json')]);
    execFileSync(process.execPath, [cli, '--in', join(d, 'sessions'), '--out', join(d, 'b.md'), '--invalid-from', join(d, 'state.json')]);
    const a = readFileSync(join(d, 'a.md'));
    assert.ok(a.equals(readFileSync(join(d, 'b.md'))));
    assert.ok(a.toString().includes('- 2: marked invalid by review'));
    assert.equal(loadSessions(join(d, 'sessions')).length, 2);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
