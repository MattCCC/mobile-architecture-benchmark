import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { journeyStatus, makeObservation, notAttemptedObservations, notAttemptedReason, validateObservation } from '../lib/records.mjs';
import {
  isLockfile, manifestText, sha256, sha256Entries, sha256Tree, sourceIdentity, subsetHash, treeManifest, TREE_MANIFEST_ALGORITHM,
} from '../lib/hash.mjs';
import { LABELS, METHODS, SCENARIOS } from '../lib/methods.mjs';
import { makeRedactor } from '../lib/exec.mjs';
import { buildInputs, iosSimulatorBuildClass } from '../lib/candidates.mjs';

test('iosSimulatorBuildClass: buildClass string/object, benchmarkBuild, artifact path', () => {
  assert.equal(iosSimulatorBuildClass({ buildClass: 'debug' }).declared, 'debug');
  assert.equal(iosSimulatorBuildClass({ buildClass: { simulator: 'debug' } }).declared, 'debug');
  assert.equal(iosSimulatorBuildClass({ benchmarkBuild: { buildClass: 'debug' } }).declared, 'debug');
  assert.equal(iosSimulatorBuildClass({ artifacts: { simulatorApp: 'b/Build/Products/Debug-iphonesimulator/A.app' } }).declared, 'debug');
  assert.equal(iosSimulatorBuildClass({}).declared, null);
});

const base = {
  sessionId: 's-1', runId: 'r', journeyId: 'j', journeyIndex: 1, candidateId: 'native', platform: 'android',
  scenarioId: 'early.cold', environmentRef: 'env-x', environmentClass: 'emulator', build: { artifactSha256: 'a', buildClass: 'release' },
};
const M = 'startup.ttff/early-am-start-w/1';

test('measured observations need a value and a raw reference', () => {
  const o = makeObservation(base, { methodId: M, status: 'measured', value: 1e9, rawRefs: [{ file: 'raw/x', line: 5, text: 'TotalTime: 1000' }] });
  assert.equal(o.metricId, 'startup.ttff');
  assert.equal(o.designScenarioRef, 'A1');
  assert.equal(o.instrument.id, 'early-am-start-w');
  assert.equal(o.streamSource, 'unknown');
  assert.throws(() => makeObservation({ ...base, streamSource: 'socket' }, { methodId: M, status: 'unavailable', reason: 'r' }), /streamSource/);
  assert.throws(() => makeObservation(base, { methodId: M, status: 'measured', value: 1 }), /rawRefs/);
  assert.throws(() => makeObservation(base, { methodId: M, status: 'measured', value: null, rawRefs: [{}] }), /finite/);
});

test('status taxonomy: never zero-filled, reasons and failure classes required', () => {
  assert.equal(makeObservation(base, { methodId: M, status: 'failed', failure: { class: 'timeout', message: 'x' }, value: 5 }).value, null);
  assert.throws(() => makeObservation(base, { methodId: M, status: 'failed', failure: { class: 'oops' } }), /failure.class/);
  assert.throws(() => makeObservation(base, { methodId: M, status: 'unavailable' }), /reason/);
  assert.throws(() => makeObservation(base, { methodId: M, status: 'not-applicable', reason: 'r' }), /source/);
  assert.throws(() => makeObservation(base, { methodId: 'nope/x/1', status: 'unavailable', reason: 'r' }), /unknown methodId/);
  assert.throws(() => makeObservation({ ...base, scenarioId: 'A1' }, { methodId: M, status: 'unavailable', reason: 'r' }), /scenarioId/);
  const bad = { ...makeObservation(base, { methodId: M, status: 'unavailable', reason: 'r' }), diagnosticValue: 3 };
  assert.ok(validateObservation(bad).some((p) => p.includes('diagnosticValue')));
});

test('registry: every method id is <design metric id>/<instrument>/<version>, early scenarios never reuse design ids', () => {
  for (const [id, m] of Object.entries(METHODS)) {
    assert.match(id, /^[a-z0-9_.]+\/[a-z0-9-]+\/\d+$/);
    assert.ok(id.startsWith(`${m.metricId}/`), id);
    assert.ok(['ns', 'bytes'].includes(m.unit), id);
    assert.ok(m.procedure && m.designRef, id);
  }
  for (const id of Object.keys(SCENARIOS)) {
    assert.ok(id.startsWith('early.'));
  }
});

test('content hashes are order-independent, content-sensitive and cover symlinks', () => {
  const d = mkdtempSync(join(tmpdir(), 'eb-hash-'));
  try {
    mkdirSync(join(d, 'a'));
    writeFileSync(join(d, 'a', 'x.txt'), 'one');
    writeFileSync(join(d, 'b.txt'), 'two');
    symlinkSync('b.txt', join(d, 'link'));
    const h1 = sha256Entries(d, ['b.txt', 'a/x.txt', 'link']);
    const h2 = sha256Entries(d, ['link', 'a/x.txt', 'b.txt']);
    assert.equal(h1.sha256, h2.sha256);
    assert.equal(h1.bytes, 6);
    assert.equal(sha256Tree(d).sha256, h1.sha256);
    writeFileSync(join(d, 'b.txt'), 'TWO');
    assert.notEqual(sha256Entries(d, ['b.txt', 'a/x.txt', 'link']).sha256, h1.sha256);
    assert.notEqual(sha256Entries(d, ['b.txt', 'a/x.txt', 'link', 'missing']).sha256, sha256Entries(d, ['b.txt', 'a/x.txt', 'link']).sha256);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  assert.ok(isLockfile('candidates/x/package-lock.json'));
  assert.ok(isLockfile('candidates/native/android/buildscript-gradle.lockfile'));
  assert.ok(!isLockfile('candidates/x/package.json'));
});

test('observations carry the labels; sizes are build-unit observations; journey methods need a journey', () => {
  const o = makeObservation(base, { methodId: M, status: 'unavailable', reason: 'r' });
  assert.deepEqual(o.labels, LABELS);
  const b = { ...base, journeyId: undefined, buildId: 'b-native-android-aaa', scenarioId: 'early.size' };
  const s = makeObservation(b, { methodId: 'size.android.apk_arm64/file-bytes/1', status: 'measured', value: 10, rawRefs: [{ file: 'raw/s', line: 1, text: 'apk 10' }] });
  assert.equal(s.journeyId, null);
  assert.equal(s.buildId, 'b-native-android-aaa');
  assert.throws(() => makeObservation(base, { methodId: 'size.android.apk_arm64/file-bytes/1', status: 'measured', value: 10, rawRefs: [{}] }), /build-unit/);
  assert.throws(() => makeObservation(b, { methodId: M, status: 'unavailable', reason: 'r' }), /journey-unit/);
  assert.throws(() => makeObservation({ ...base, buildId: 'x' }, { methodId: M, status: 'unavailable', reason: 'r' }), /exactly one/);
});

test('journeys a session never started are not-measured / not-attempted, never failures', () => {
  assert.equal(notAttemptedReason('watchdog'), 'out-of-time:watchdog');
  assert.equal(notAttemptedReason('host-sleep'), 'session-aborted:host-sleep');
  assert.equal(notAttemptedReason('terminated:SIGTERM'), 'session-aborted:terminated:SIGTERM');
  const obs = notAttemptedObservations(base, [M, 'startup.ttfd_system/early-logcat-fully-drawn/1'], 'watchdog');
  assert.deepEqual(obs.map((x) => [x.status, x.reason, x.value, x.failure]), [
    ['not-measured', 'out-of-time:watchdog', null, null], ['not-measured', 'out-of-time:watchdog', null, null]]);
  assert.equal(journeyStatus({ notRun: true }), 'not-attempted');
  assert.equal(journeyStatus({ failure: { class: 'timeout' } }), 'failed');
  assert.equal(journeyStatus({}), 'completed');
});

test('tree manifest: shasum format, byte-sorted, subset hashes, executables and the algorithm id', () => {
  const d = mkdtempSync(join(tmpdir(), 'eb-tm-'));
  try {
    mkdirSync(join(d, 'candidates', 'x'), { recursive: true });
    mkdirSync(join(d, 'fixtures'));
    writeFileSync(join(d, 'candidates', 'x', 'a.txt'), 'A');
    writeFileSync(join(d, 'candidates', 'x', 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(d, 'fixtures', 'f.json'), '{}');
    writeFileSync(join(d, 'README.md'), 'r');
    const tm = treeManifest(d, ['README.md', 'fixtures/f.json', 'candidates/x/run.sh', 'candidates/x/a.txt']);
    assert.equal(tm.algorithm, TREE_MANIFEST_ALGORITHM);
    assert.deepEqual(tm.lines.map((l) => l.path), ['README.md', 'candidates/x/a.txt', 'candidates/x/run.sh', 'fixtures/f.json']);
    assert.equal(manifestText(tm.lines).split('\n')[1], `${sha256('A')}  candidates/x/a.txt`);
    assert.deepEqual(tm.executables, ['candidates/x/run.sh']);
    const cand = subsetHash(tm.lines, ['candidates/x/']);
    assert.equal(cand.files, 2);
    assert.equal(cand.sha256, sha256(manifestText(tm.lines.filter((l) => l.path.startsWith('candidates/x/')))));
    // whole-repo identity through git ls-files (read-only); no HEAD -> uncommitted-tree
    execFileSync('git', ['init', '-q', d]);
    const id = sourceIdentity(d, [{ id: 'x', dir: 'candidates/x', buildInputs: ['candidates/x/', 'fixtures/'] }]);
    assert.equal(id.source.algorithm, TREE_MANIFEST_ALGORITHM);
    assert.equal(id.source.gitCommit, null);
    assert.equal(id.source.gitCommitReason, 'uncommitted-tree');
    assert.equal(id.source.repoFiles, 4);
    assert.equal(id.source.scopeFiles, 3);
    assert.equal(id.source.candidateTreeSha256.x, cand.sha256);
    assert.equal(id.source.buildInputSha256.x, subsetHash(tm.lines, ['candidates/x/', 'fixtures/']).sha256);
    assert.equal(id.source.repoTreeSha256, sha256(id.manifestText));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('build inputs: declared sharedBuildInputs, else adapters[].path, plus the core directories', () => {
  const a = buildInputs({ adapters: [{ path: '../_rn-shared/rn-benchkit' }, { path: '../_rn-shared/ui' }] }, 'candidates/expo');
  assert.deepEqual(a.shared, ['candidates/_rn-shared/rn-benchkit/', 'candidates/_rn-shared/ui/']);
  assert.ok(a.dirs.includes('candidates/expo/') && a.dirs.includes('instrumentation/') && a.dirs.includes('fixtures/'));
  assert.match(a.basis, /adapters/);
  const b = buildInputs({ sharedBuildInputs: ['candidates/_rn-shared/'] }, 'candidates/repack');
  assert.deepEqual(b.shared, ['candidates/_rn-shared/']);
  assert.equal(buildInputs({}, 'candidates/native').basis, 'none declared');
});

test('redactor replaces plain and slash-escaped forms, longest first', () => {
  const r = makeRedactor();
  r.add('/home/someone', '<home>');
  r.add('/home/someone/repo', '<repo>');
  r.add('ABCD-1234', '<udid>');
  assert.equal(r.scrub('x /home/someone/repo/a y /home/someone/b'), 'x <repo>/a y <home>/b');
  assert.equal(r.scrub('{"processImagePath":"\\/home\\/someone\\/Library\\/ABCD-1234\\/App"}'), '{"processImagePath":"<home>\\/Library\\/<udid>\\/App"}');
  assert.equal(r.scrub(r.scrub('/home/someone/repo')), '<repo>');
});
