// The session runner's planning path (no device): candidate resolution, artifact checks, budget subset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimate, markNotRun, notRunObservations, plannedJourneys, processToFui, sessionSchedule } from '../session.mjs';
import { sha256 } from '../lib/hash.mjs';
import { matchesExpected, parseExpectedHash, resolveCandidate } from '../lib/candidates.mjs';
import { startLogcatStream } from '../lib/android.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'session.mjs');

function fakeRepo() {
  const d = mkdtempSync(join(tmpdir(), 'eb-repo-'));
  const design = 'test design\n';
  writeFileSync(join(d, 'design.md'), design);
  mkdirSync(join(d, 'config'), { recursive: true });
  writeFileSync(join(d, 'config', 'build-policy.json'), JSON.stringify({
    schema: 'mobilebench.build-policy/1.0.0',
    android: { minSdk: 24, targetSdk: 36, abi: 'arm64-v8a', eligibleBuildClass: 'release' },
    ios: { deploymentTarget: '16.4', arch: 'arm64', eligibleBuildClass: 'release', descriptiveBuildClasses: ['debug'] },
  }));
  for (const [id, pkg] of [['native', 'org.example.mobilebench.nativeapp'], ['flutter', 'org.example.mobilebench.flutter'], ['expo', 'org.example.mobilebench.expo']]) {
    mkdirSync(join(d, 'candidates', id, 'out'), { recursive: true });
    writeFileSync(join(d, 'candidates', id, 'out', 'app.apk'), `apk-${id}`);
    writeFileSync(join(d, 'candidates', id, 'candidate.json'), JSON.stringify({
      id, family: id, platforms: { android: { applicationId: pkg, launchActivity: `${pkg}/.MainActivity`,
        streamSource: 'replay', benchmarkBuild: { minSdk: 24, targetSdk: 36, abi: 'arm64-v8a', buildClass: 'release' },
        instrumentationId: 'test-benchkit/1',
        artifacts: { apk: 'out/app.apk' } } },
    }));
    const receiptDir = join(d, 'receipts', id);
    mkdirSync(receiptDir, { recursive: true });
    const evidence = `accepted ${id}\n`;
    writeFileSync(join(receiptDir, 'evidence.txt'), evidence);
    writeFileSync(join(receiptDir, 'receipt.json'), JSON.stringify({
      schema: 'mobilebench.acceptance-receipt/1.0.0', suiteId: 'mobilebench.acceptance/1', status: 'passed',
      candidateId: id, platform: 'android', artifactSha256: sha256(`apk-${id}`), designSha256: sha256(design),
      checks: ['initial-state', 'build-policy', 'instrumentation-overhead', 'list-geometry', 'selection-semantics', 'navigation', 'live-update',
        'background-foreground', 'restore', 'insights', 'error-behavior'].map((check) => ({ id: check, status: 'passed' })),
      evidence: [{ path: 'evidence.txt', sha256: sha256(evidence) }],
    }));
  }
  mkdirSync(join(d, 'candidates', 'nomanifest'), { recursive: true });
  return d;
}

function plan(repo, extra) {
  const receipts = ['native', 'flutter', 'expo'].flatMap((id) => [
    '--acceptance-receipt', `${id}:android=${join(repo, 'receipts', id, 'receipt.json')}`,
  ]);
  const out = execFileSync(process.execPath, [CLI, '--platform', 'android', '--repo', repo, '--out', join(repo, 'o'), '--artifacts', join(repo, 'f'),
    '--run-id', 'r1', '--seed', '7', '--plan-only', '--scroll-journeys', '0', ...receipts, ...extra], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('estimates give two Android candidates per 30-minute session at 10 journeys', () => {
  const e = estimate('android', { journeys: 10, memoryJourneys: 10, idleS: 30 });
  assert.equal(Math.floor((1800 - e.overheadS) / e.perCandidateS), 2);
  const i = estimate('ios', { journeys: 10, memoryJourneys: 10, idleS: 30 });
  assert.ok(i.perCandidateS > 0);
});

test('plan-only: verified hash mismatch and missing manifest become not-measured; subset keeps the anchor', () => {
  const repo = fakeRepo();
  try {
    const p = plan(repo, ['--candidates', 'flutter,native,expo,nomanifest', '--expect-artifact', `expo:android=${'0'.repeat(64)}`]);
    assert.deepEqual(p.plan.notMeasured.map((x) => [x.id, x.reason]).sort(), [['expo', 'artifact-not-verified'], ['nomanifest', 'candidate-manifest-missing']]);
    assert.deepEqual([...p.plan.candidates].sort(), ['flutter', 'native']);
    assert.equal(p.artifacts.find((a) => a.id === 'native').acceptance.suiteId, 'mobilebench.acceptance/1');
    assert.equal(p.artifacts.find((a) => a.id === 'native').sha256, sha256('apk-native'));
    assert.equal(p.schedule.groups.length, 3);
    assert.equal(p.schedule.groups[0].method, 'randomized-latin-square');
    const p2 = plan(repo, ['--candidates', 'flutter,native,expo']);
    assert.deepEqual(p2.plan.candidates.length, 2);
    assert.ok(p2.plan.candidates.includes('native'));
    assert.deepEqual(p2.plan.incompleteBlockDesign.excluded.length, 1);
    assert.deepEqual(plan(repo, ['--candidates', 'flutter,native,expo']), p2);
    const p3 = plan(repo, ['--candidates', 'flutter,native', '--scroll-journeys', '2', '--scroll-swipes', '3', '--budget-min', '120']);
    assert.deepEqual(p3.schedule.groups.map((g) => g.id), ['early.cold', 'early.warm', 'early.idle-memory', 'early.scroll']);
    assert.equal(p3.plan.swipePlan.length, 3);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('iOS startup.process_to_fui comes from proc.anchor and fui markers only', () => {
  const anchor = { t: '1000000000', payload: 'ws=5000000;ps=4800000' };
  assert.deepEqual(processToFui({ anchor, fui: { t: '1300000000' } }), { value: 500000000, error: null });
  assert.equal(processToFui({ anchor: null, fui: { t: '1' } }).value, null);
  assert.match(processToFui({ anchor, fui: { t: '900000000' } }).error, /non-positive/);
  assert.match(processToFui({ anchor: { t: '1', payload: 'ws=x' }, fui: { t: '2' } }).error, /unparsable/);
});

test('CLI rejects bad input', () => {
  const r = spawnSync(process.execPath, [CLI, '--platform', 'web'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  const repo = fakeRepo();
  try {
    assert.equal(resolveCandidate({ repo, id: 'Bad_Id', platform: 'android' }).reason, 'invalid-candidate-id');
    assert.equal(resolveCandidate({ repo, id: 'native', platform: 'ios' }).reason, 'bundle-id-missing');
    const ov = resolveCandidate({ repo, id: 'nomanifest', platform: 'android', overrides: { nomanifest: { android: {
      applicationId: 'org.example.x', streamSource: 'replay', instrumentationId: 'test-benchkit/1', artifacts: { apk: 'nope.apk' } } } } });
    assert.equal(ov.reason, 'artifact-missing');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('iOS: flutter release is unavailable on the simulator, flutter@debug is the debug variant; undeclared build class is not measured', () => {
  const repo = mkdtempSync(join(tmpdir(), 'eb-ios-'));
  try {
    mkdirSync(join(repo, 'candidates', 'flutter', 'build', 'Runner.app'), { recursive: true });
    writeFileSync(join(repo, 'candidates', 'flutter', 'build', 'Runner.app', 'Info.plist'), 'x');
    writeFileSync(join(repo, 'candidates', 'flutter', 'candidate.json'), JSON.stringify({ id: 'flutter', family: 'flutter', platforms: { ios: {
      bundleId: 'org.example.mobilebench.flutter', streamSource: 'replay', instrumentationId: 'test-benchkit/1',
      buildClass: { simulator: 'debug' }, artifacts: { simulatorApp: 'build/Runner.app' } } } }));
    mkdirSync(join(repo, 'candidates', 'native'), { recursive: true });
    writeFileSync(join(repo, 'candidates', 'native', 'candidate.json'), JSON.stringify({ id: 'native', platforms: { ios: {
      bundleId: 'org.example.mobilebench.nativeapp', streamSource: 'replay', instrumentationId: 'test-benchkit/1', artifacts: { app: 'x.app' } } } }));
    const rel = resolveCandidate({ repo, id: 'flutter', platform: 'ios' });
    assert.deepEqual([rel.ok, rel.status, rel.reason], [false, 'unavailable', 'framework-no-release-on-simulator']);
    const dbg = resolveCandidate({ repo, id: 'flutter@debug', platform: 'ios' });
    assert.deepEqual([dbg.ok, dbg.variant, dbg.declaredBuildClass, dbg.token, dbg.dir], [true, 'debug', 'debug', 'flutter-debug', 'candidates/flutter']);
    assert.equal(resolveCandidate({ repo, id: 'native', platform: 'ios' }).reason, 'build-class-undeclared');
    assert.equal(resolveCandidate({ repo, id: 'flutter@debug', platform: 'android' }).reason, 'variant-not-supported-on-platform');
    const ov = resolveCandidate({ repo, id: 'native', platform: 'ios', overrides: { native: { ios: { buildClass: 'release' } } } });
    assert.equal(ov.reason, 'artifact-missing');
    // undeclared build class: taken from the Xcode products directory in the artifact path
    mkdirSync(join(repo, 'candidates', 'native', 'b', 'Release-iphonesimulator', 'N.app'), { recursive: true });
    writeFileSync(join(repo, 'candidates', 'native', 'candidate.json'), JSON.stringify({ id: 'native', platforms: { ios: {
      bundleId: 'org.example.mobilebench.nativeapp', streamSource: 'replay', instrumentationId: 'test-benchkit/1',
      artifacts: { app: 'b/Release-iphonesimulator/N.app' } } } }));
    const inferred = resolveCandidate({ repo, id: 'native', platform: 'ios' });
    assert.deepEqual([inferred.ok, inferred.declaredBuildClass], [true, 'release']);
    assert.match(inferred.buildClassSource, /artifact path/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('expected artifact hashes: full or prefix…suffix form', () => {
  const sha = 'dc4bb018ea1605ce328e06ba121e02f40562d7cb33ce9ca97d678f4cf41787c5';
  assert.ok(matchesExpected(parseExpectedHash(sha), sha));
  assert.ok(matchesExpected(parseExpectedHash('dc4bb018…87c5'), sha));
  assert.ok(matchesExpected(parseExpectedHash('dc4bb018ea16...41787c5'), sha));
  assert.ok(!matchesExpected(parseExpectedHash('dc4bb018…87c6'), sha));
  assert.equal(parseExpectedHash('dc4b…87c5'), null);
  const repo = fakeRepo();
  try {
    const p = plan(repo, ['--candidates', 'native,flutter', '--expect-artifact', `native:android=${sha256('apk-native').slice(0, 10)}…${sha256('apk-native').slice(-6)}`]);
    assert.deepEqual(p.artifacts.find((a) => a.id === 'native').verified, { text: `${sha256('apk-native').slice(0, 10)}…${sha256('apk-native').slice(-6)}`, form: 'abbreviated', matched: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('debug variants get their own blocks after the release blocks; journey ids use the safe token', () => {
  const groups = [{ id: 'early.cold', blocks: 2 }, { id: 'early.idle-memory', blocks: 2 }];
  const s = sessionSchedule({ seed: 3, platform: 'ios', groups, release: ['native', 'expo'], debug: ['flutter@debug'] });
  assert.deepEqual(s.groups[0].blocks.map((b) => [...b.order].sort()), [['expo', 'native'], ['expo', 'native']]);
  assert.deepEqual(s.groups[0].debugBlocks.map((b) => b.order), [['flutter@debug'], ['flutter@debug']]);
  const list = plannedJourneys(s, 'ab12', (id) => id.replace('@', '-'));
  const cold = list.filter((j) => j.scenarioId === 'early.cold');
  assert.deepEqual(cold.map((j) => j.blockSet), ['release', 'release', 'release', 'release', 'debug', 'debug']);
  assert.ok(cold.every((j) => /^[a-z0-9.-]+$/.test(j.journeyId)));
  assert.equal(cold[4].journeyId, 'ab12.cold.d01.flutter-debug');
  assert.deepEqual(sessionSchedule({ seed: 3, platform: 'ios', groups, release: ['native', 'expo'], debug: ['flutter@debug'] }), s);
});

test('a journey that never ran becomes not-measured with the abort reason', () => {
  const j = markNotRun({ journeyId: 'j1' }, 'watchdog');
  assert.deepEqual([j.notRun, j.notRunReason], [true, 'out-of-time:watchdog']);
  const base = { sessionId: 's', runId: 'r', journeyId: 'j1', candidateId: 'native', platform: 'android', scenarioId: 'early.idle-memory',
    environmentRef: 'e', environmentClass: 'emulator', build: { artifactSha256: 'a', buildClass: 'release' } };
  const [o] = notRunObservations(base, ['memory.android.pss_total/early-dumpsys-meminfo-idle/1'], j.notRunReason);
  assert.deepEqual([o.status, o.reason, o.value, o.failure], ['not-measured', 'out-of-time:watchdog', null, null]);
});

test('logcat stream: waits without polling, skips lines seen before a restart, restarts after the reader exits', async () => {
  const d = mkdtempSync(join(tmpdir(), 'eb-adb-'));
  try {
    // fake adb: 1st call prints two lines and exits; 2nd call (with -T) re-prints the last line, then a fui line
    const fake = join(d, 'adb');
    writeFileSync(fake, [
      '#!/bin/sh',
      `n=$(cat "${d}/n" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${d}/n"; echo "$@" >> "${d}/args"`,
      'if [ "$n" = 1 ]; then',
      '  echo "1700000000.100  10  10 I MobileBench: MB j0 launch 1 x"',
      '  echo "1700000000.200  10  10 I MobileBench: MB j0 fui 1 rows=10;h=730;sel=50;seq=0"',
      '  exit 0',
      'fi',
      'echo "1700000000.200  10  10 I MobileBench: MB j0 fui 1 rows=10;h=730;sel=50;seq=0"',
      'sleep 0.3',
      'echo "1700000001.000  11  11 I MobileBench: MB j1 fui 1 rows=10;h=730;sel=50;seq=0"',
      'sleep 5',
    ].join('\n'), { mode: 0o755 });
    const s = startLogcatStream({ adbPath: fake, serial: 'emulator-5554', rawFile: join(d, 'raw.txt') });
    const first = await s.waitFor((e) => e.event === 'fui', { since: 0, timeoutMs: 3000 });
    assert.equal(first.journeyId, 'j0');
    const since = first.index + 1;
    const next = await s.waitFor((e) => e.event === 'fui', { since, timeoutMs: 5000 });
    assert.equal(next.journeyId, 'j1');
    assert.equal(s.entries.filter((e) => e.journeyId === 'j0' && e.event === 'fui').length, 1);
    assert.equal(s.restarts(), 1);
    assert.match(readFileSync(join(d, 'args'), 'utf8').split('\n')[1], /-T 1700000000\.200/);
    assert.equal(await s.waitFor((e) => e.event === 'nope', { since: 0, timeoutMs: 100 }), null);
    await s.stop();
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
