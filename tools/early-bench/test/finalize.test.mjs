// Post-hoc finalization of a killed session from its raw files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeAndroidSession, parseSourceManifest } from '../lib/finalize.mjs';
import { buildSchedule } from '../lib/order.mjs';
import { sha256 } from '../lib/hash.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PKG = 'org.example.mobilebench.nativeapp';
const SHA = 'a'.repeat(64);

function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fakeSession() {
  const d = mkdtempSync(join(tmpdir(), 'eb-fin-'));
  const repo = join(d, 'repo');
  const s = join(d, 's-x-android-ab12');
  const cj = JSON.stringify({ id: 'native', family: 'native', platforms: { android: { applicationId: PKG, launchActivity: `${PKG}/.MainActivity`,
    streamClient: 'in-app replay', streamSource: 'replay', instrumentationId: 'test-benchkit/1', artifacts: { apk: 'out/app.apk' } } } });
  const fx = JSON.stringify({ fixtureVersion: '1.0.0', profile: 'representative', selection: Array.from({ length: 50 }, (_, i) => i) });
  put(repo, 'candidates/native/candidate.json', cj);
  put(repo, 'fixtures/v1/representative.json', fx);
  put(s, 'source-manifest.txt', `${sha256(cj)}  candidates/native/candidate.json\n${sha256(fx)}  fixtures/v1/representative.json\n${'c'.repeat(64)}  candidates/native/gradle.lockfile\n`);
  const schedule = buildSchedule({ seed: 1, platform: 'android', groups: [{ id: 'early.cold', blocks: 1 }, { id: 'early.idle-memory', blocks: 3 }], candidates: ['native'] });
  put(s, 'schedule.json', JSON.stringify(schedule));
  put(s, 'manifest.json', JSON.stringify({ sessionId: 's-x-android-ab12', runId: 'r1', platform: 'android', status: 'running', startedAt: '2026-01-01T00:00:00.000Z',
    plan: { candidates: ['native'], profile: 'representative' }, source: { candidateTreeSha256: { native: 't'.repeat(64) } }, candidates: [] }));
  put(s, 'harness.log.jsonl', [
    JSON.stringify({ event: 'artifact.frozen', details: { candidate: 'native', artifacts: [{ kind: 'apk', sha256: SHA, bytes: 10, copyVerified: true }] } }),
    JSON.stringify({ event: 'device.ready', details: { deviceKey: 'd-12345678', bootedBySession: true, gpuMode: 'host' } }),
  ].join('\n'));
  const dex = (st) => `Dexopt state:\n  [${PKG}]\n    path: /data/app/x/base.apk\n      arm64: [status=${st}] [reason=cmdline] [primary-abi]\n`;
  put(s, 'raw/setup/native/badging.txt', `package: name='${PKG}' versionCode='1'\n`);
  put(s, 'raw/setup/native/install-verify.txt', `installed base.apk sha256 ${SHA}\nfrozen artifact sha256 ${SHA}\nmatch true\n`);
  put(s, 'raw/setup/native/artifact-sizes.txt', `apk 10 bytes sha256 ${SHA}\n`);
  put(s, 'raw/setup/native/art-dexopt.txt', dex('speed-profile'));
  for (const f of ['dexopt-b00-native.txt', 'dexopt-b01-a1-native.txt']) {
    put(s, `raw/groups/early.cold/${f}`, dex('speed-profile'));
    put(s, `raw/groups/early.idle-memory/${f}`, dex('speed-profile'));
  }
  const journey = (jid, memory = false) => {
    copyFileSync(join(FIX, 'am-start-cold.txt'), (put(s, `raw/journeys/${jid}/x`, ''), join(s, 'raw/journeys', jid, 'am-start.txt')));
    copyFileSync(join(FIX, 'logcat-cold.txt'), join(s, 'raw/journeys', jid, 'logcat.txt'));
    rmSync(join(s, 'raw/journeys', jid, 'x'));
    if (memory) {
      copyFileSync(join(FIX, 'meminfo.txt'), join(s, 'raw/journeys', jid, 'meminfo.txt'));
      writeFileSync(join(s, 'raw/journeys', jid, 'proc-status.txt'), 'Name:\tx\nPid:\t5678\n');
    }
  };
  journey('ab12.cold.prime.native');
  journey('ab12.cold.01.native');
  journey('ab12.idle-memory.prime.native');
  journey('ab12.idle-memory.01.native', true);
  copyFileSync(join(FIX, 'am-start-cold.txt'), (put(s, 'raw/journeys/ab12.idle-memory.02.native/x', ''), join(s, 'raw/journeys/ab12.idle-memory.02.native/am-start.txt')));
  rmSync(join(s, 'raw/journeys/ab12.idle-memory.02.native/x'));
  put(s, 'raw/logcat-mobilebench-stream.txt', '');
  return { d, repo, s };
}

test('a killed session is rebuilt from raw files: measured values, interrupted and never-started journeys', () => {
  const { d, repo, s } = fakeSession();
  try {
    const r = finalizeAndroidSession({ sdir: s, repo, abortReason: 'terminated:SIGHUP', endedAt: '2026-01-01T00:20:00.000Z', hostIdentity: { cpu: 'x' }, now: 'T' });
    assert.equal(r.manifest.status, 'incomplete');
    assert.equal(r.manifest.failureReason, 'aborted:terminated:SIGHUP');
    assert.equal(r.manifest.elapsedS, 1200);
    assert.deepEqual([r.manifest.counts.journeysPlanned, r.manifest.counts.journeysRun, r.manifest.counts.journeysInterrupted, r.manifest.counts.journeysNotAttempted], [4, 2, 1, 1]);
    const by = (jid, m) => r.observations.find((o) => o.journeyId === jid && o.methodId.startsWith(m));
    assert.equal(by('ab12.cold.01.native', 'startup.ttff').value, 1143e6);
    assert.deepEqual(by('ab12.cold.01.native', 'startup.ttff').rawRefs, [{ file: 'raw/journeys/ab12.cold.01.native/am-start.txt', line: 5, text: 'TotalTime: 1143' }]);
    assert.equal(by('ab12.cold.01.native', 'startup.ttfd_system').value, 1146e6);
    assert.equal(by('ab12.idle-memory.01.native', 'memory').value, 22386 * 1024);
    assert.ok(by('ab12.idle-memory.01.native', 'memory').limitations.includes('process-liveness-not-recorded'));
    assert.deepEqual([by('ab12.idle-memory.02.native', 'memory').status, by('ab12.idle-memory.02.native', 'memory').reason], ['not-measured', 'session-aborted:terminated:SIGHUP']);
    assert.deepEqual([by('ab12.idle-memory.03.native', 'memory').status, by('ab12.idle-memory.03.native', 'memory').value], ['not-measured', null]);
    const js = Object.fromEntries(r.journeys.map((j) => [j.journeyId, j.status]));
    assert.equal(js['ab12.idle-memory.02.native'], 'interrupted');
    assert.equal(js['ab12.idle-memory.03.native'], 'not-attempted');
    assert.equal(js['ab12.cold.01.native'], 'completed');
    assert.equal(r.observations.filter((o) => o.status === 'failed').length, 0);
    const size = r.observations.find((o) => o.methodId === 'size.android.apk_arm64/file-bytes/1');
    assert.deepEqual([size.buildId, size.value, size.journeyId], [`b-native-android-${SHA.slice(0, 12)}`, 10, null]);
    const cand = r.manifest.candidates.find((c) => c.id === 'native');
    assert.deepEqual(cand.provenance.lockfiles, [{ path: 'candidates/native/gradle.lockfile', sha256: 'c'.repeat(64) }]);
    assert.equal(r.manifest.postHocFinalization.verifiedUnchanged.every((v) => v.same), true);
    // a finished block takes its after-state from its own dexopt file
    assert.equal(r.journeys.find((j) => j.journeyId === 'ab12.idle-memory.01.native').artState.after, 'arm64=speed-profile');
    // identical input -> identical records
    assert.deepEqual(finalizeAndroidSession({ sdir: s, repo, abortReason: 'terminated:SIGHUP', endedAt: '2026-01-01T00:20:00.000Z', hostIdentity: { cpu: 'x' }, now: 'T' }).observations, r.observations);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('finalization refuses finished sessions and changed candidate manifests', () => {
  const { d, repo, s } = fakeSession();
  try {
    writeFileSync(join(repo, 'candidates/native/candidate.json'), '{"changed":true}');
    assert.throws(() => finalizeAndroidSession({ sdir: s, repo, abortReason: 'x' }), /changed since the session start/);
    const m = JSON.parse(readFileSync(join(s, 'manifest.json'), 'utf8'));
    writeFileSync(join(s, 'manifest.json'), JSON.stringify({ ...m, status: 'completed' }));
    assert.throws(() => finalizeAndroidSession({ sdir: s, repo, abortReason: 'x' }), /only a killed/);
    assert.equal(parseSourceManifest(`${'a'.repeat(64)}  x/y\nbad\n`).get('x/y'), 'a'.repeat(64));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
