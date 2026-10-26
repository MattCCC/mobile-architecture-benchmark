// Post-hoc finalization of an Android session whose runner process was killed before it wrote its records
// (manifest status still `running`). Every value is re-parsed from the session's raw files with the same parsers
// and classification rules as the live runner; nothing is estimated. What the raw files cannot show is recorded as
// not recorded: journeys that never started are `not-measured` / `not-attempted`, the journey in progress is
// `not-measured` / `interrupted`, unrecoverable environment fields are null with a reason.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { avdConfig } from './android.mjs';
import { resolveCandidate } from './candidates.mjs';
import { environmentKey, hashedId, hostKey } from './env.mjs';
import { isLockfile, sha256 } from './hash.mjs';
import { LABELS, NOT_COLLECTED, SCENARIOS } from './methods.mjs';
import { JOURNEY_SCHEMA, makeObservation, notAttemptedReason, rawRef } from './records.mjs';
import {
  checkFuiPayload, crashClass, findCrash, parseAmStart, parseBadging, parseDexopt, parseDisplayed, parseFullyDrawn,
  parseMbLogcat, parseMeminfo,
} from './parse.mjs';

const A_START = ['startup.ttff/early-am-start-w/1', 'startup.ttfd_system/early-logcat-fully-drawn/1'];
const A_MEM = ['memory.android.pss_total/early-dumpsys-meminfo-idle/1'];

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function mtimeIso(path) {
  return existsSync(path) ? statSync(path).mtime.toISOString() : null;
}

function readJsonl(path) {
  const t = readText(path);
  return t ? t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
}

// "<sha256>  <path>" lines of the session's source manifest (written at session start).
export function parseSourceManifest(text) {
  const out = new Map();
  for (const l of String(text ?? '').split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(l);
    if (m) {
      out.set(m[2], m[1]);
    }
  }
  return out;
}

// Same journey list as the live runner (release blocks only on Android).
function planned(schedule, sid4) {
  const list = [];
  for (const g of schedule.groups) {
    for (const b of g.blocks) {
      b.order.forEach((cand, i) => {
        list.push({
          journeyId: `${sid4}.${g.id.replace('early.', '')}.${String(b.block).padStart(2, '0')}.${cand}`,
          scenarioId: g.id, blockSet: 'release', block: b.block, position: i + 1, journeyIndex: b.block, candidateId: cand, role: 'measured',
        });
      });
    }
  }
  return list;
}

function procPid(text) {
  const m = /^Pid:\s+(\d+)/m.exec(String(text ?? ''));
  return m ? m[1] : null;
}

// Reads one journey directory. Returns null when the directory does not exist.
function readJourney(rawDir, j, { memory, pkg, fixtureSel, streamText }) {
  const rel = `journeys/${j.journeyId}`;
  const dir = join(rawDir, rel);
  if (!existsSync(dir)) {
    return null;
  }
  const am = readText(join(dir, 'am-start.txt'));
  const lc = readText(join(dir, 'logcat.txt'));
  const mi = memory ? readText(join(dir, 'meminfo.txt')) : '';
  const complete = am !== null && lc !== null && (!memory || mi !== null);
  j.rawFiles = readdirSync(dir).sort().map((f) => `raw/${rel}/${f}`);
  if (!complete) {
    return { interrupted: true };
  }
  const amP = parseAmStart(am);
  j.am = { ...amP, file: `raw/${rel}/am-start.txt`, code: amP.status === null ? null : 0 };
  j.logcatFile = `raw/${rel}/logcat.txt`;
  const mb = parseMbLogcat(lc, null);
  j.fui = mb.find((m) => m.event === 'fui' && m.n >= 1) ?? null;
  j.fuiCheck = j.fui ? checkFuiPayload(j.fui.payload, fixtureSel, { hRef: null }) : null;
  j.fullyDrawn = parseFullyDrawn(lc, pkg)[0] ?? null;
  j.crash = findCrash(lc, pkg);
  j.diagnostics = { displayedMs: parseDisplayed(lc, pkg)[0]?.ms ?? null };
  j.fuiSeenByStream = streamText.includes(` MB ${j.journeyId} fui `);
  if (memory) {
    j.meminfoFile = `raw/${rel}/meminfo.txt`;
    j.meminfo = parseMeminfo(mi);
    j.pid = procPid(readText(join(dir, 'proc-status.txt')));
  }
  j.startedAtUpperBound = mtimeIso(join(dir, 'am-start.txt'));
  j.endedAt = mtimeIso(join(dir, 'logcat.txt'));
  return { interrupted: false };
}

export function finalizeAndroidSession({ sdir, repo, avd = 'mobilebench_api37', abortReason, endedAt = null, hostIdentity = null, tools = {}, now = new Date().toISOString() }) {
  const manifest = JSON.parse(readFileSync(join(sdir, 'manifest.json'), 'utf8'));
  if (manifest.status !== 'running') {
    throw new Error(`session ${manifest.sessionId} has status ${manifest.status}; only a killed (running) session is finalized`);
  }
  if (manifest.platform !== 'android') {
    throw new Error('post-hoc finalization supports Android sessions only');
  }
  const rawDir = join(sdir, 'raw');
  const sessionId = manifest.sessionId;
  const sid4 = sessionId.slice(-4);
  const schedule = JSON.parse(readFileSync(join(sdir, 'schedule.json'), 'utf8'));
  const srcMan = parseSourceManifest(readText(join(sdir, 'source-manifest.txt')));
  const log = readJsonl(join(sdir, 'harness.log.jsonl'));
  const ready = log.find((e) => e.event === 'device.ready')?.details ?? null;
  const frozen = Object.fromEntries(log.filter((e) => e.event === 'artifact.frozen').map((e) => [e.details.candidate, e.details.artifacts]));
  const journal = readJsonl(join(sdir, 'journal.jsonl'));
  const journalBy = new Map(journal.filter((x) => x.journeyId).map((x) => [x.journeyId, x]));
  if (readdirSync(join(rawDir, 'journeys')).some((d) => d.endsWith('.a2'))) {
    throw new Error('block re-runs (.a2) are not reconstructed post hoc');
  }
  const verify = (path) => {
    const rec = srcMan.get(path);
    const cur = existsSync(join(repo, path)) ? sha256(readFileSync(join(repo, path))) : null;
    return { path, sha256AtStart: rec ?? null, sha256Now: cur, same: Boolean(rec) && rec === cur };
  };

  // ---- fixture (verified unchanged since the session start) ----
  const profile = manifest.plan?.profile ?? 'representative';
  const fxPath = `fixtures/v1/${profile}.json`;
  const fxV = verify(fxPath);
  if (!fxV.same) {
    throw new Error(`${fxPath} changed since the session start; cannot reuse it`);
  }
  const fx = JSON.parse(readFileSync(join(repo, fxPath), 'utf8'));
  const fixture = { version: fx.fixtureVersion ?? null, profile: fx.profile ?? profile, sha256: fxV.sha256AtStart, profileSource: 'launch config mb.profile' };
  const fixtureSel = Array.isArray(fx.selection) ? fx.selection.length : null;

  // ---- environment: what the raw files and the start manifest show; the rest is not recorded ----
  const avdCfg = avdConfig(avd);
  const emuVersionLine = (readText(join(rawDir, 'emulator.log')) ?? '').split('\n').find((l) => /Android emulator version/.test(l)) ?? null;
  const emulatorVersion = emuVersionLine ? emuVersionLine.replace(/^\S+\s+\|\s*/, '').trim() : null;
  const comparability = {
    environmentClass: 'emulator', platform: 'android', avd, avdHardware: avdCfg, gpuMode: ready?.gpuMode ?? null,
    emulatorCores: Number(avdCfg?.['hw.cpu.ncore'] ?? NaN) || null, emulatorMemoryMb: Number(avdCfg?.['hw.ramSize'] ?? NaN) || null,
    emulatorVersion, host: hostIdentity, reconstruction: 'post-hoc: device identity and settings not recorded',
  };
  const envLimitations = ['environment-reconstructed-post-hoc', 'process-liveness-not-recorded'];
  const env = {
    key: environmentKey(comparability), class: 'emulator', platform: 'android', deviceKey: ready?.deviceKey ?? hashedId('d', 'unknown', sessionId),
    limitations: envLimitations, comparabilityKey: comparability, deviceSettings: null,
    host: { key: hostIdentity ? hostKey(hostIdentity) : null, identity: hostIdentity, identitySource: 'captured at finalization (hardware and OS constants)', start: null, end: null,
      stateNotRecorded: 'host load, power and thermal state at session start and end were held in memory by the killed runner' },
    device: { identity: null, identityNotRecorded: 'build fingerprint, display size and device settings were held in memory by the killed runner',
      bootedBySession: ready?.bootedBySession ?? null, gpuMode: ready?.gpuMode ?? null, gpuModeSource: 'harness.log device.ready', avdHardware: avdCfg,
      avdHardwareSource: 'AVD config.ini read at finalization', emulatorVersion, emulatorVersionSource: 'raw/emulator.log',
      layoutReference: null, layoutReferenceReason: 'calibration app not built yet (no h_ref)', shutdownBySession: false,
      shutdownNote: 'the lock wrapper stopped the emulator this session had booted (pid file)' },
    otherDevices: { start: null, end: null, note: 'not recorded' },
  };

  // ---- candidates from raw/setup ----
  const ids = manifest.plan.candidates;
  const streamText = readText(join(rawDir, 'logcat-mobilebench-stream.txt')) ?? '';
  const C = {};
  const candidateRecords = [];
  const allObs = [];
  for (const id of ids) {
    const sdirC = join(rawDir, 'setup', id);
    const cjPath = `candidates/${id}/candidate.json`;
    const cjV = verify(cjPath);
    if (!cjV.same) {
      throw new Error(`${cjPath} changed since the session start; cannot reuse it`);
    }
    const cj = JSON.parse(readFileSync(join(repo, cjPath), 'utf8'));
    const rc = resolveCandidate({ repo, id, platform: 'android' });
    const pkg = cj.platforms?.android?.applicationId;
    const component = cj.platforms?.android?.launchActivity ?? cj.platforms?.android?.activity ?? null;
    const badging = readText(join(sdirC, 'badging.txt'));
    const bad = badging ? parseBadging(badging) : { debuggable: null, packageName: null };
    const buildClass = bad.debuggable === null ? 'unknown' : (bad.debuggable ? 'debug' : 'release');
    const iv = readText(join(sdirC, 'install-verify.txt')) ?? '';
    const installVerified = /^match true$/m.test(iv);
    const sizeText = readText(join(sdirC, 'artifact-sizes.txt')) ?? '';
    const sizes = sizeText.split('\n').map((l, i) => ({ l, i, m: /^(apk|aab) (\d+) bytes sha256 ([0-9a-f]{64})$/.exec(l) })).filter((x) => x.m);
    const apk = sizes.find((x) => x.m[1] === 'apk');
    if (!installVerified || !apk || pkg !== bad.packageName) {
      candidateRecords.push({ id, status: 'not-measured', reason: !installVerified ? 'installed-artifact-mismatch' : 'setup-records-incomplete' });
      continue;
    }
    const artDex = parseDexopt(readText(join(sdirC, 'art-dexopt.txt')) ?? '');
    const buildId = `b-${id}-android-${apk.m[3].slice(0, 12)}`;
    C[id] = { id, pkg, component, buildClass, buildId, apkSha: apk.m[3], artUnreadable: artDex.summary === null, rc };
    const lockfiles = [...srcMan.entries()].filter(([p]) => p.startsWith(`candidates/${id}/`) && isLockfile(p)).sort().map(([p, s]) => ({ path: p, sha256: s }));
    candidateRecords.push({
      id, status: 'included', packageName: pkg, component, buildClass, buildClassSource: 'aapt2 application-debuggable (raw/setup badging.txt)',
      family: rc.family, architectureClass: rc.architectureClass, buildId,
      artifacts: (frozen[id] ?? []).map((a) => ({ kind: a.kind, sha256: a.sha256, bytes: a.bytes, copyVerified: a.copyVerified })),
      provenance: { source: 'session source-manifest.txt (session start)', candidateTreeSha256: manifest.source?.candidateTreeSha256?.[id] ?? null,
        buildInputSha256: manifest.source?.buildInputSha256?.[id] ?? null, lockfiles, candidateJson: { path: cjPath, sha256: cjV.sha256AtStart } },
      buildInputs: rc.buildInputs, versions: rc.versions, art: { after: { summary: artDex.summary, file: `raw/setup/${id}/art-dexopt.txt` } },
      artStateReadable: artDex.summary !== null, streamSource: rc.streamSource, streamSourceBasis: rc.streamSourceBasis,
      instrumentationId: rc.instrumentationId,
      installVerified, limitations: rc.limitations,
    });
    const sizeBase = {
      sessionId, runId: manifest.runId, buildId, candidateId: id, platform: 'android', scenarioId: 'early.size',
      environmentRef: env.key, environmentClass: 'emulator', deviceKey: env.deviceKey, streamSource: rc.streamSource, fixture,
      instrumentationId: rc.instrumentationId,
      limitations: [...rc.limitations, ...envLimitations, ...(rc.streamSource === 'replay' ? ['bundles-replay-stream'] : [])],
    };
    for (const s of sizes) {
      const methodId = s.m[1] === 'aab' ? 'size.android.aab/file-bytes/1' : 'size.android.apk_arm64/file-bytes/1';
      allObs.push(makeObservation({ ...sizeBase, build: { buildId, artifactSha256: s.m[3], buildClass } }, {
        methodId, status: 'measured', value: Number(s.m[2]), rawRefs: [{ file: `raw/setup/${id}/artifact-sizes.txt`, line: s.i + 1, text: s.l }],
      }));
    }
    if (!sizes.some((x) => x.m[1] === 'aab')) {
      allObs.push(makeObservation({ ...sizeBase, build: { buildId, artifactSha256: apk.m[3], buildClass } }, { methodId: 'size.android.aab/file-bytes/1', status: 'not-measured', reason: 'artifact-not-provided' }));
    }
    const payloadText = readText(join(sdirC, 'payload-sizes.txt')) ?? '';
    const payload = /benchmark payload (\d+) entries compressed (\d+) bytes uncompressed (\d+) bytes/.exec(payloadText);
    for (const [methodId, index] of [
      ['size.android.benchmark_payload_compressed/zip-central-directory/1', 2],
      ['size.android.benchmark_payload_uncompressed/zip-central-directory/1', 3],
    ]) {
      const fields = rc.benchmarkPayloadAccounting.status === 'unavailable'
        ? { methodId, status: 'unavailable', reason: rc.benchmarkPayloadAccounting.reason }
        : payload && Number(payload[1]) > 0
          ? { methodId, status: 'measured', value: Number(payload[index]),
            rawRefs: [{ file: `raw/setup/${id}/payload-sizes.txt`, line: 1, text: payload[0] }] }
          : { methodId, status: 'unavailable', reason: 'benchmark-payload-accounting-not-recorded-before-interruption' };
      allObs.push(makeObservation({ ...sizeBase, build: { buildId, artifactSha256: apk.m[3], buildClass } }, fields));
    }
  }

  // ---- journeys ----
  const plan = planned(schedule, sid4).filter((p) => C[p.candidateId]);
  const results = [];
  const dexSummary = (g, file) => parseDexopt(readText(join(rawDir, 'groups', g, file)) ?? '').summary;
  for (const g of schedule.groups) {
    const memory = g.id === 'early.idle-memory';
    for (const id of Object.keys(C)) {
      const pj = { journeyId: `${sid4}.${g.id.replace('early.', '')}.prime.${id}`, scenarioId: g.id, candidateId: id, role: 'priming' };
      const r = readJourney(rawDir, pj, { memory: false, pkg: C[id].pkg, fixtureSel, streamText });
      if (r) {
        pj.interrupted = r.interrupted;
        results.push(pj);
      }
    }
    let before = Object.fromEntries(Object.keys(C).map((id) => [id, dexSummary(g.id, `dexopt-b00-${id}.txt`)]));
    for (const b of g.blocks) {
      const tag = `b${String(b.block).padStart(2, '0')}`;
      const after = Object.fromEntries(Object.keys(C).map((id) => [id, existsSync(join(rawDir, 'groups', g.id, `dexopt-${tag}-a1-${id}.txt`)) ? dexSummary(g.id, `dexopt-${tag}-a1-${id}.txt`) : null]));
      const blockFinished = Object.keys(C).every((id) => existsSync(join(rawDir, 'groups', g.id, `dexopt-${tag}-a1-${id}.txt`)));
      for (const p of plan.filter((x) => x.scenarioId === g.id && x.block === b.block)) {
        const j = { ...p, attempt: 1, resetProcedures: ['R-PROC@block', ...(g.id === 'early.warm' ? [] : ['R-PROC'])] };
        if (g.id === 'early.warm') {
          const tw = { journeyId: `${j.journeyId}.tw`, scenarioId: g.id, candidateId: j.candidateId, role: 'tool-warmup', forJourneyId: j.journeyId, block: j.block, blockSet: 'release', attempt: 1, resetProcedures: ['R-PROC'] };
          const r = readJourney(rawDir, tw, { memory: false, pkg: C[j.candidateId].pkg, fixtureSel, streamText });
          if (r) {
            tw.interrupted = r.interrupted;
            results.push(tw);
          }
        }
        const r = readJourney(rawDir, j, { memory, pkg: C[j.candidateId].pkg, fixtureSel, streamText });
        if (!r) {
          j.notRun = true;
          j.journeyStatus = 'not-attempted';
          j.notRunReason = notAttemptedReason(abortReason);
        } else if (r.interrupted) {
          j.notRun = true;
          j.journeyStatus = 'interrupted';
          j.notRunReason = notAttemptedReason(abortReason);
        } else {
          j.art = { before: before[j.candidateId], after: after[j.candidateId] };
          if (!blockFinished) {
            j.art.afterReason = 'block-not-finished';
          }
          if (j.art.before === null || j.art.after === null) {
            j.art.unreadable = true;
          } else if (j.art.before !== j.art.after) {
            j.failure = { class: 'environment-violation', message: 'art-state-changed' };
          }
        }
        results.push(j);
      }
      before = after;
    }
  }
  // execution order from the am-start file times (previousCandidateId)
  const ran = results.filter((r) => !r.notRun && !r.interrupted && r.startedAtUpperBound).sort((a, b) => (a.startedAtUpperBound < b.startedAtUpperBound ? -1 : 1));
  ran.forEach((r, i) => {
    r.previousCandidateId = i > 0 ? ran[i - 1].candidateId : null;
  });

  const kindOf = (j) => (j.scenarioId === 'early.warm' && j.role === 'measured' ? 'warm' : 'cold');
  const seenFui = {};
  const seenFd = {};
  for (const j of ran) {
    const k = `${j.candidateId}|${kindOf(j)}`;
    seenFui[k] = Boolean(seenFui[k] || j.fui);
    seenFd[k] = Boolean(seenFd[k] || j.fullyDrawn);
  }
  const journeysOut = [];
  let notAttempted = 0;
  let interrupted = 0;
  for (const j of results) {
    const x = C[j.candidateId];
    const jr = journal.length > 0 ? journalBy.get(j.journeyId) ?? null : null;
    const alive = jr?.alive ?? null;
    const build = { buildId: x.buildId, artifactSha256: x.apkSha, buildClass: x.buildClass };
    const memory = j.scenarioId === 'early.idle-memory';
    const methods = memory ? A_MEM : A_START;
    const artUnknown = x.artUnreadable || Boolean(j.art?.unreadable);
    const base = {
      sessionId, runId: manifest.runId, journeyId: j.journeyId, journeyIndex: j.journeyIndex ?? null, block: j.block ?? null, position: j.position ?? null,
      attempt: 1, candidateId: x.id, platform: 'android', scenarioId: j.scenarioId, environmentRef: env.key, environmentClass: 'emulator',
      deviceKey: env.deviceKey, build, streamSource: x.rc.streamSource, instrumentationId: x.rc.instrumentationId, fixture,
      limitations: [...x.rc.limitations, ...envLimitations, ...(x.rc.streamSource === 'replay' && memory ? ['bundles-replay-stream'] : []), ...(artUnknown ? ['art-state-unknown'] : [])],
    };
    let failure = j.failure ?? null;
    if (j.role === 'measured' && !j.notRun && !failure) {
      const cc = crashClass(j.crash);
      const expected = kindOf(j) === 'warm' ? 'WARM' : 'COLD';
      j.expectedLaunchState = expected;
      if (j.am.status !== 'ok' || j.am.errors.length > 0) {
        failure = cc ? { class: cc, message: j.crash[0].text.trim() } : { class: 'harness-error', message: `am start failed (status ${j.am.status})` };
      } else if (cc || alive === false) {
        failure = { class: cc ?? 'candidate-crash', message: j.crash[0]?.text.trim() ?? 'process not running at journey end' };
      } else if (j.am.launchState !== expected) {
        failure = { class: 'harness-error', message: `launch-state-mismatch: ${j.am.launchState}, expected ${expected}` };
      } else if (j.fui && !j.fuiCheck.pass) {
        failure = { class: 'functional-mismatch', message: `fui payload: ${j.fuiCheck.problems.join(', ')}` };
      } else if (!j.fui && seenFui[`${j.candidateId}|${kindOf(j)}`]) {
        failure = { class: 'timeout', message: 'fui marker not observed within 20 s' };
      }
    }
    journeysOut.push({
      schema: JOURNEY_SCHEMA, journeyId: j.journeyId, sessionId, runId: manifest.runId, candidateId: x.id, platform: 'android', deviceKey: env.deviceKey,
      scenarioId: j.scenarioId, designScenarioRef: SCENARIOS[j.scenarioId]?.designRef ?? null, bootSession: 1, blockSet: j.blockSet ?? null,
      block: j.block ?? null, position: j.position ?? null, journeyIndex: j.journeyIndex ?? null, previousCandidateId: j.previousCandidateId ?? null,
      attempt: 1, role: j.role, forJourneyId: j.forJourneyId ?? null, resetProcedures: j.resetProcedures ?? ['R-PROC'], buildClass: x.buildClass,
      environmentClass: 'emulator', environmentRef: env.key, streamSource: x.rc.streamSource,
      instrumentationId: x.rc.instrumentationId, fixture, uiGeneration: null, deviceSettings: null,
      startedAt: null, startedAtUpperBound: j.startedAtUpperBound ?? null, endedAt: j.endedAt ?? null, timeSource: 'raw file modification times (post-hoc)',
      status: j.notRun ? j.journeyStatus : (j.interrupted ? 'interrupted' : (failure ? 'failed' : 'completed')),
      failure: j.notRun ? null : failure, notAttemptedReason: j.notRun ? j.notRunReason : null,
      cacheState: SCENARIOS[j.scenarioId]?.cacheState ?? null, artState: j.art ?? null, environmentFlags: [],
      launchConfig: { 'mb.journey': j.journeyId, 'mb.journeyMode': '1', 'mb.profile': profile },
      checks: j.am && !j.notRun ? {
        launchState: j.expectedLaunchState ? (j.am.launchState === j.expectedLaunchState ? 'pass' : `fail:${j.am.launchState}`) : `recorded:${j.am.launchState}`,
        fuiMarker: j.fui ? 'present' : 'absent',
        fuiJourneyId: j.fui ? (j.fui.journeyId === j.journeyId ? 'match' : `other:${j.fui.journeyId}`) : 'n/a',
        fuiPayload: j.fuiCheck ? (j.fuiCheck.pass ? 'pass' : `fail:${j.fuiCheck.problems.join(',')}`) : 'n/a',
        fuiPayloadNotChecked: [...(j.fuiCheck?.notChecked ?? []), 'stream-order:stream.connect-not-mirrored-on-android (needs the trace)'],
        fuiWait: j.fuiSeenByStream ? 'stream' : 'not-seen-in-stream-file',
        process: alive === null ? 'not-recorded (post-hoc finalization)' : (alive ? 'alive' : 'not-running'),
      } : {},
      rawRefs: j.rawFiles ?? [], diagnostics: j.diagnostics ?? {},
    });
    if (j.role !== 'measured') {
      continue;
    }
    if (j.notRun) {
      notAttempted += j.journeyStatus === 'not-attempted' ? 1 : 0;
      interrupted += j.journeyStatus === 'interrupted' ? 1 : 0;
      allObs.push(...methods.map((methodId) => makeObservation(base, { methodId, status: 'not-measured', reason: j.notRunReason })));
      continue;
    }
    if (failure) {
      const diag = j.am?.totalTimeMs ? { [A_START[0]]: j.am.totalTimeMs * 1e6 } : {};
      allObs.push(...methods.map((m) => makeObservation(base, { methodId: m, status: 'failed', failure, diagnosticValue: diag[m] ?? null })));
      continue;
    }
    const lim = j.fui ? [] : ['fui-marker-missing'];
    if (!memory) {
      allObs.push(j.am.totalTimeMs !== null
        ? makeObservation(base, { methodId: A_START[0], status: 'measured', value: j.am.totalTimeMs * 1e6, limitations: lim, rawRefs: [rawRef(j.am.file, j.am.refs.totalTime)] })
        : makeObservation(base, { methodId: A_START[0], status: 'failed', failure: { class: 'instrument-error', message: 'TotalTime missing' } }));
      if (j.fullyDrawn) {
        allObs.push(makeObservation(base, { methodId: A_START[1], status: 'measured', value: j.fullyDrawn.ms * 1e6, limitations: lim, rawRefs: [rawRef(j.logcatFile, j.fullyDrawn)] }));
      } else if (seenFd[`${j.candidateId}|${kindOf(j)}`]) {
        allObs.push(makeObservation(base, { methodId: A_START[1], status: 'failed', failure: { class: 'instrument-error', message: 'Fully drawn line missing' } }));
      } else {
        allObs.push(makeObservation(base, { methodId: A_START[1], status: 'unavailable', reason: 'marker-missing:fully-drawn' }));
      }
    } else {
      const mi = j.meminfo;
      const pidOk = mi && mi.pid !== null && String(mi.pid) === String(j.pid);
      allObs.push(pidOk && mi.totalPssKb !== null
        ? makeObservation(base, { methodId: A_MEM[0], status: 'measured', value: mi.totalPssKb * 1024, limitations: lim, rawRefs: [rawRef(j.meminfoFile, mi.refs.totalPssKb)] })
        : makeObservation(base, { methodId: A_MEM[0], status: 'failed', failure: { class: 'instrument-error', message: pidOk ? 'TOTAL PSS not found' : 'meminfo pid mismatch or missing' } }));
    }
  }
  const byStatus = {};
  for (const o of allObs) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  }
  const ranMeasured = results.filter((r) => r.role === 'measured' && !r.notRun).length;
  Object.assign(manifest, {
    status: 'incomplete',
    failureReason: `aborted:${abortReason}`,
    endedAt,
    elapsedS: endedAt && manifest.startedAt ? Math.round((Date.parse(endedAt) - Date.parse(manifest.startedAt)) / 1000) : null,
    labels: LABELS,
    candidates: [...candidateRecords, ...(manifest.candidates ?? [])],
    environment: env,
    device: { deviceKey: env.deviceKey },
    resets: {
      'R-BOOT': { applied: ready?.bootedBySession ?? null, source: 'harness.log device.ready' },
      'R-INSTALL': { applied: true, verify: 'raw/setup/<id>/install-verify.txt' },
      'R-ART': { applied: true, procedure: 'early.art.partial-use-if-available.shell', source: 'raw/setup/<id>/art-*.txt' },
      ...Object.fromEntries(schedule.groups.map((g) => [`R-DATA@${g.id}`, { applied: existsSync(join(rawDir, 'groups', g.id)), source: `raw/groups/${g.id}/R-DATA-*.txt` }])),
    },
    tools: { ...tools, note: 'tool versions captured at finalization; emulator version from raw/emulator.log' },
    counts: {
      journeysPlanned: plan.length, journeysRun: ranMeasured, journeysNotAttempted: notAttempted, journeysInterrupted: interrupted,
      observationsByStatus: Object.fromEntries(Object.entries(byStatus).sort()),
    },
    notCollected: manifest.notCollected ?? NOT_COLLECTED.android,
    postHocFinalization: {
      at: now, tool: 'tools/early-bench/finalize.mjs', reason: `runner process ended by ${abortReason} before it wrote its records`,
      method: 'every value re-parsed from raw/ with the live parsers and classification rules; nothing estimated',
      notRecorded: [
        'process liveness at journey end (the live runner checked pidof; crash evidence from the logcat crash buffer is still applied)',
        'device identity, display size and device settings snapshot (environment key reconstructed without them, so this session never pools with sessions that recorded them)',
        'host load, power and thermal state at session start and end',
        'journey start times (only upper bounds from am-start.txt modification times)',
        'ART state after the last, unfinished block (art-state-unknown on its journeys)',
      ],
      journalUsed: journal.length > 0,
      verifiedUnchanged: [fxV, ...ids.map((id) => verify(`candidates/${id}/candidate.json`))],
    },
    files: readdirSync(sdir).concat(['journeys.jsonl', 'observations.jsonl']).filter((v, i, a) => a.indexOf(v) === i).sort(),
  });
  return { manifest, journeys: journeysOut, observations: allObs };
}
