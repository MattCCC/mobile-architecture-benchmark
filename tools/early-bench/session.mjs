#!/usr/bin/env node
// early-bench session runner: ONE device session on ONE platform (Android emulator or iOS simulator).
// Node built-ins only. See README.md for scope, labels and the method registry.
//
// The caller is responsible for the cross-workflow device lock; this runner never builds anything and only
// installs frozen copies of artifacts that were built and verified elsewhere.
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isoNow, makeLogger, makeRedactor, run, sleep } from './lib/exec.mjs';
import { environmentKey, hashedId, hostKey, hostSnapshot, startSleepDetector } from './lib/env.mjs';
import { buildSchedule, selectSubset } from './lib/order.mjs';
import {
  candidateProvenance, freezeArtifact, hashArtifact, matchesExpected, parseExpectedHash, resolveCandidate,
} from './lib/candidates.mjs';
import { scopeTreeSha256, sha256, sha256Entries, sha256Tree, publishablePaths, sourceIdentity } from './lib/hash.mjs';
import { LABELS, NOT_COLLECTED, PHYSICAL_LABEL, SCENARIOS } from './lib/methods.mjs';
import { describe } from './lib/stats.mjs';
import { JOURNEY_SCHEMA, journeyStatus, makeObservation, notAttemptedReason, rawRef } from './lib/records.mjs';
import {
  checkFuiPayload, crashClass, findCrash, parseAmStart, parseBadging, parseBroadcastResult, parseDexopt, parseDisplayed,
  parseFullyDrawn, parseMarkersJsonl, parseMbLogcat, parseMeminfo, parsePayload, parseProcStatus,
  parseResolveActivity, parseSimctlLaunch, streamConnectBeforeFui, parseApkanalyzerBytes, parseDiskstatsPackage,
  parseBatterystatsUidMah, parsePackageUid, parseThermalservice,
} from './lib/parse.mjs';
import {
  frameTimelineMetrics, frameTimelineText, mergeSfPolls, sfSummaryLine, parseSfLatency, planDurationMs, plausibleFrameCount, sfLatencyMetrics, sfLayersFor,
  swipePlan, swipeScript,
} from './lib/scroll.mjs';
import * as android from './lib/android.mjs';
import * as ios from './lib/ios.mjs';
import { verifyAcceptanceReceipt } from '../acceptance/lib.mjs';
import { androidArtifactBuildProblems, declaredBuildProblems, loadBuildPolicy } from './lib/build-policy.mjs';
import { benchmarkPayloadTotals, classifyZip } from './lib/zip-size.mjs';

export const TOOL_VERSION = '0.2.0';
const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: node session.mjs --platform android|ios --repo <repo> --out <sessions dir> --artifacts <frozen dir>
  --candidates a,b --run-id <id> [--design <path>] [options]
options:
  --journeys <n>           journeys per candidate for each startup scenario (default 10)
  --memory-journeys <n>    journeys per candidate for idle memory (default: --journeys)
  --idle-s <s>             idle time on List before the memory read (default 30)
  --scroll-journeys <n>    journeys per candidate for early.scroll (default 5; 0 skips the scenario)
  --scroll-swipes <n>      flings per early.scroll journey (default 8)
  --profile <name>         fixture profile passed as mb.profile (default representative)
  --stream-source <name>   required candidate stream source: replay or server (default replay)
  --seed <uint32>          schedule seed (default: random, recorded)
  --budget-min <m>         planned device time (default 30); a seeded candidate subset is used if needed
  --watchdog-min <m>       stop starting journeys and finalize after this many minutes (default 35); the caller
                           enforces the hard stop (SIGTERM, then SIGKILL)
  --anchor <id>            candidate always kept in a subset (default native)
  --pooled-n <file>        JSON {candidate: pooled journeys so far} used to choose a subset
  --overrides <file>       JSON {candidate: {android|ios: {...candidate.json platform fields}}}
  --expect-artifact id:platform=<sha256 | prefix…suffix>   verified build hash (repeatable); mismatch -> not-measured
  --acceptance-receipt id:platform=<path>  passing artifact-bound acceptance receipt (repeatable; required)
  --verification-note <t>  where the verified-candidate list came from
  --design <path>          normative design file (default: <repo>/design.md); its bytes are hashed by the runner
  --design-ref <t>         label of the design revision
  --other-devices abort|wait|record   foreign emulators/simulators at session start (default abort)
  --other-devices-wait-s <s>          how long "wait" waits before aborting (default 120)
  --avd <name>             (default mobilebench_api37)
  --serial <s>             Android: use this already-connected PHYSICAL device instead of the AVD (no boot, no wipe);
                           every other attached device must be disconnected or shut down
  --energy-journeys <n>    physical Android only: early.energy journeys per candidate (default 3; 0 skips)
  --energy-s <s>           workload duration of one early.energy journey (default 60)
  --sim-name <n> --sim-runtime <id> --sim-type <id>   (default mobilebench-iphone, iOS 27.0, iPhone 17)
  --plan-only              resolve candidates, hash artifacts, print the plan and schedule; no device use
candidate ids: <id> or <id>@debug (the debug-build variant, e.g. flutter@debug on the iOS simulator)`;

function cli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      platform: { type: 'string' }, repo: { type: 'string' }, out: { type: 'string' }, artifacts: { type: 'string' },
      candidates: { type: 'string' }, 'run-id': { type: 'string' }, design: { type: 'string' },
      'design-ref': { type: 'string', default: '' }, 'verification-note': { type: 'string', default: '' },
      journeys: { type: 'string', default: '10' }, 'memory-journeys': { type: 'string' }, 'idle-s': { type: 'string', default: '30' },
      'scroll-journeys': { type: 'string', default: '5' }, 'scroll-swipes': { type: 'string', default: '8' },
      profile: { type: 'string', default: 'representative' },
      'stream-source': { type: 'string', default: 'replay' },
      seed: { type: 'string' }, 'budget-min': { type: 'string', default: '30' }, 'watchdog-min': { type: 'string', default: '35' },
      anchor: { type: 'string', default: 'native' }, 'pooled-n': { type: 'string' }, overrides: { type: 'string' },
      'expect-artifact': { type: 'string', multiple: true, default: [] }, 'other-devices': { type: 'string', default: 'abort' },
      'acceptance-receipt': { type: 'string', multiple: true, default: [] },
      'other-devices-wait-s': { type: 'string', default: '120' },
      avd: { type: 'string', default: 'mobilebench_api37' }, 'sim-name': { type: 'string', default: 'mobilebench-iphone' },
      'sim-runtime': { type: 'string', default: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0' },
      'sim-type': { type: 'string', default: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' },
      serial: { type: 'string' }, 'energy-journeys': { type: 'string', default: '3' }, 'energy-s': { type: 'string', default: '60' },
      'lock-acquired-at': { type: 'string' }, 'plan-only': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  const need = ['platform', 'repo', 'out', 'artifacts', 'candidates', 'run-id'];
  const missing = need.filter((k) => !values[k]);
  const int = (k, lo, hi) => {
    const n = Number(values[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) {
      throw new Error(`--${k} must be an integer in [${lo}, ${hi}]`);
    }
    return n;
  };
  if (missing.length > 0 || !['android', 'ios'].includes(values.platform) || !['abort', 'wait', 'record'].includes(values['other-devices'])) {
    process.stderr.write(`${USAGE}\n`);
    process.exit(2);
  }
  const expect = {};
  for (const e of values['expect-artifact']) {
    const m = /^([a-z][a-z0-9-]*(?:@debug)?):(android|ios)=(\S+)$/.exec(e);
    const parsed = m ? parseExpectedHash(m[3]) : null;
    if (!parsed) {
      throw new Error(`bad --expect-artifact ${e}`);
    }
    expect[`${m[1]}:${m[2]}`] = { ...parsed, text: m[3] };
  }
  const acceptance = {};
  for (const entry of values['acceptance-receipt']) {
    const m = /^([a-z][a-z0-9-]*(?:@debug)?):(android|ios)=(.+)$/.exec(entry);
    if (!m) {
      throw new Error(`bad --acceptance-receipt ${entry}`);
    }
    acceptance[`${m[1]}:${m[2]}`] = resolve(m[3]);
  }
  const repo = resolve(values.repo);
  const designPath = resolve(repo, values.design ?? 'design.md');
  if (!existsSync(designPath)) {
    throw new Error(`design file not found: ${designPath}`);
  }
  if (!/^[a-z]+$/.test(values.profile)) {
    throw new Error('--profile must match [a-z]+');
  }
  if (!['replay', 'server'].includes(values['stream-source'])) {
    throw new Error('--stream-source must be replay or server');
  }
  const journeys = int('journeys', 1, 100);
  values['memory-journeys'] ??= String(journeys);
  return {
    platform: values.platform,
    repo,
    out: resolve(values.out),
    artifacts: resolve(values.artifacts),
    candidates: values.candidates.split(',').map((x) => x.trim()).filter(Boolean),
    runId: values['run-id'],
    designSha256: sha256(readFileSync(designPath)),
    designRef: values['design-ref'] || (values.design ?? 'design.md'),
    verificationNote: values['verification-note'],
    journeys,
    memoryJourneys: int('memory-journeys', 0, 100),
    idleS: int('idle-s', 1, 600),
    scrollJourneys: int('scroll-journeys', 0, 100),
    scrollSwipes: int('scroll-swipes', 1, 50),
    profile: values.profile,
    streamSource: values['stream-source'],
    seed: values.seed === undefined ? randomBytes(4).readUInt32BE(0) : int('seed', 0, 4294967295),
    budgetMin: int('budget-min', 1, 240),
    watchdogMin: int('watchdog-min', 1, 300),
    anchor: values.anchor,
    pooledN: values['pooled-n'] ? JSON.parse(readFileSync(values['pooled-n'], 'utf8')) : {},
    overrides: values.overrides ? JSON.parse(readFileSync(values.overrides, 'utf8')) : {},
    expect,
    acceptance,
    otherDevices: values['other-devices'],
    otherDevicesWaitS: int('other-devices-wait-s', 0, 1800),
    avd: values.avd,
    simName: values['sim-name'],
    simRuntime: values['sim-runtime'],
    simType: values['sim-type'],
    lockAcquiredAt: values['lock-acquired-at'] ?? null,
    serial: values.serial ?? null,
    energyJourneys: values.serial && values.platform === 'android' ? int('energy-journeys', 0, 100) : 0,
    energyS: int('energy-s', 10, 600),
    planOnly: values['plan-only'],
  };
}

// ---------- time estimates (seconds) used only for the budget plan ----------
// Android per candidate: setup (install, ART) 40; priming 10 per group; cold journey 8; warm journey 13 (its
// tool-warmup launch included); memory journey idle + 12; 1.5 per block for R-PROC and the dexopt read.
// Scroll journey: launch + fling plan + 3 s settle + trace pull and parsing.
export function estimate(platform, { journeys, memoryJourneys, idleS, scrollJourneys = 0, scrollSwipes = 8, energyJourneys = 0, energyS = 60 }) {
  const scrollS = (swipes) => swipes * 1.33 + 3;
  if (platform === 'android') {
    const groups = 2 + (memoryJourneys > 0 ? 1 : 0) + (scrollJourneys > 0 ? 1 : 0);
    const blocks = 2 * journeys + memoryJourneys + scrollJourneys;
    const perCandidate = 40 + 15 + groups * 10 + journeys * 8 + journeys * 13 + memoryJourneys * (idleS + 12)
      + scrollJourneys * (14 + scrollS(scrollSwipes)) + (energyJourneys > 0 ? 10 : 0) + energyJourneys * (energyS + 25)
      + (blocks + energyJourneys) * 1.5;
    return { overheadS: 150 + 60 + 20, perCandidateS: perCandidate };
  }
  const groups = 1 + (memoryJourneys > 0 ? 1 : 0) + (scrollJourneys > 0 ? 1 : 0);
  const blocks = journeys + memoryJourneys + scrollJourneys;
  const perCandidate = 25 + 15 + groups * 20 + journeys * 16 + memoryJourneys * (idleS + 18)
    + scrollJourneys * (20 + scrollS(scrollSwipes)) + blocks * 1;
  return { overheadS: 90 + 40, perCandidateS: perCandidate };
}

function groupsFor(platform, o) {
  const g = [{ id: 'early.cold', blocks: o.journeys }];
  if (platform === 'android') {
    g.push({ id: 'early.warm', blocks: o.journeys });
  }
  if (o.memoryJourneys > 0) {
    g.push({ id: 'early.idle-memory', blocks: o.memoryJourneys });
  }
  if (o.scrollJourneys > 0 && platform === 'android') {
    g.push({ id: 'early.scroll', blocks: o.scrollJourneys });
  }
  if (o.energyJourneys > 0 && platform === 'android' && o.serial) {
    g.push({ id: 'early.energy', blocks: o.energyJourneys });
  }
  return g;
}

// Release candidates share the blocked order; debug variants get their own blocks after the release blocks of
// each group, so they never take a position in a release block.
export function sessionSchedule({ seed, platform, groups, release, debug }) {
  const rel = buildSchedule({ seed, platform, groups, candidates: release });
  const dbg = debug.length > 0 ? buildSchedule({ seed, platform: `${platform}|debug`, groups, candidates: debug }) : null;
  return {
    ...rel,
    debugCandidates: [...debug],
    groups: rel.groups.map((g, i) => ({ ...g, debugMethod: dbg ? dbg.groups[i].method : null, debugBlocks: dbg ? dbg.groups[i].blocks : [] })),
  };
}

export function plannedJourneys(schedule, sid4, tokenOf) {
  const list = [];
  for (const g of schedule.groups) {
    const sets = [['release', g.blocks, ''], ['debug', g.debugBlocks ?? [], 'd']];
    for (const [blockSet, blocks, prefix] of sets) {
      for (const b of blocks) {
        b.order.forEach((cand, i) => {
          list.push({
            journeyId: `${sid4}.${g.id.replace('early.', '')}.${prefix}${String(b.block).padStart(2, '0')}.${tokenOf(cand)}`,
            scenarioId: g.id, blockSet, block: b.block, position: i + 1, journeyIndex: b.block, candidateId: cand, role: 'measured',
          });
        });
      }
    }
  }
  return list;
}

function utcStamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

// Every JSON file of a session passes through the session's redactor (set in main()).
let SCRUB = (s) => s;

function writeJson(path, obj) {
  writeFileSync(path, SCRUB(`${JSON.stringify(obj, null, 2)}\n`));
}

function toolSource() {
  const repoRoot = resolve(HERE, '..', '..');
  try {
    const paths = publishablePaths(repoRoot, 'tools/early-bench');
    return { dir: 'tools/early-bench', ...sha256Entries(repoRoot, paths) };
  } catch {
    const t = sha256Tree(HERE);
    return { dir: 'tools/early-bench', ...t, note: 'git unavailable: hashed every file below the directory' };
  }
}

async function firstLine(cmd, args, n = 1) {
  const r = await run(cmd, args, { timeoutMs: 20000 });
  return r.code === 0 ? `${r.stdout}${r.stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, n).join(' / ') : null;
}

const NULL_LOG = { info() {}, warn() {}, error() {}, redact() {}, scrub: (s) => s };

// ======================================================================================================
async function main() {
  const o = cli(process.argv.slice(2));
  const buildPolicy = loadBuildPolicy(o.repo);
  const sessionId = `s-${utcStamp()}-${o.platform}-${randomBytes(2).toString('hex')}`;
  const sid4 = sessionId.slice(-4);
  const sdir = join(o.out, sessionId);
  const rawDir = join(sdir, 'raw');
  if (!o.planOnly) {
    mkdirSync(rawDir, { recursive: true });
  }
  const redactor = makeRedactor();
  redactor.add(o.repo, '<repo>');
  redactor.add(o.out, '<sessions>');
  redactor.add(o.artifacts, '<artifacts>');
  redactor.add(homedir(), '<home>');
  redactor.add(hostname(), '<host>');
  SCRUB = (s) => redactor.scrub(s);
  const log = o.planOnly ? NULL_LOG : makeLogger(join(sdir, 'harness.log.jsonl'), redactor);
  const startedAt = isoNow();
  const t0 = Date.now();
  const ctx = { abort: null, sessionFailed: null, o, sessionId, sdir, rawDir, log, redactor, fixture: fixtureInfo(o.repo, o.profile), buildPolicy };

  // ---- candidates, artifacts, provenance (no device) ----
  const resolved = o.candidates.map((id) => resolveCandidate({ repo: o.repo, id, platform: o.platform, overrides: o.overrides }));
  const usable = [];
  const candidateRecords = [];
  for (const c of resolved) {
    if (!c.ok) {
      candidateRecords.push({ id: c.id, status: c.status ?? 'not-measured', reason: c.reason, ...(c.hint ? { hint: c.hint } : {}) });
      continue;
    }
    if (c.streamSource !== o.streamSource) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'stream-source-mismatch',
        detail: `candidate declares ${c.streamSource}; session requires ${o.streamSource}` });
      continue;
    }
    const buildProblems = declaredBuildProblems(c, o.platform, buildPolicy.value);
    if (buildProblems.length > 0) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'build-policy-mismatch', detail: buildProblems.join('; ') });
      continue;
    }
    const src = join(o.repo, c.dir, c.artifacts[0].rel);
    const h = hashArtifact(src);
    const receiptPath = o.acceptance[`${c.id}:${o.platform}`] ?? null;
    if (!receiptPath) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'acceptance-receipt-missing' });
      continue;
    }
    const acceptance = verifyAcceptanceReceipt(receiptPath, {
      candidateId: c.baseId, platform: o.platform, artifactSha256: h.sha256, designSha256: o.designSha256,
    });
    if (!acceptance.ok) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'acceptance-receipt-invalid', detail: acceptance.problems.join('; ') });
      continue;
    }
    const expected = o.expect[`${c.id}:${o.platform}`] ?? null;
    if (expected && !matchesExpected(expected, h.sha256)) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'artifact-not-verified', detail: `artifact ${h.sha256} != verified ${expected.text}` });
      continue;
    }
    usable.push({ ...c, primarySha256: h.sha256,
      acceptance: { sha256: acceptance.sha256, suiteId: acceptance.receipt.suiteId, waived: acceptance.waived },
      verified: expected ? { text: expected.text, form: expected.form, matched: true } : null });
  }
  const est = estimate(o.platform, o);
  const budgetS = o.budgetMin * 60;
  const maxK = Math.max(1, Math.floor((budgetS - est.overheadS) / est.perCandidateS));
  const subset = selectSubset({ candidates: usable.map((c) => c.id), anchor: o.anchor, pooledN: o.pooledN, maxCandidates: maxK, seed: o.seed });
  const selected = usable.filter((c) => subset.selected.includes(c.id));
  for (const c of usable.filter((x) => subset.excluded.includes(x.id))) {
    candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'out-of-budget-subset' });
  }
  const incompleteBlockDesign = subset.excluded.length > 0 ? {
    allCandidates: usable.map((c) => c.id), selected: subset.selected, excluded: subset.excluded,
    reason: `estimated ${est.overheadS + usable.length * est.perCandidateS} s for all > budget ${budgetS} s`,
    rule: 'anchor first, then fewest pooled journeys, ties by seeded shuffle',
  } : null;
  const groups = groupsFor(o.platform, o);
  const tokenOf = (id) => selected.find((c) => c.id === id)?.token ?? id;
  const schedule = sessionSchedule({
    seed: o.seed, platform: o.platform, groups,
    release: selected.filter((c) => !c.variant).map((c) => c.id), debug: selected.filter((c) => c.variant).map((c) => c.id),
  });
  const plan = {
    platform: o.platform, candidates: selected.map((c) => c.id), groups, journeysPerCandidate: o.journeys,
    memoryJourneysPerCandidate: o.memoryJourneys, idleS: o.idleS, scrollJourneysPerCandidate: o.scrollJourneys,
    scrollSwipes: o.scrollSwipes, swipePlan: swipePlan(o.seed, o.scrollSwipes), profile: o.profile, streamSource: o.streamSource, seed: o.seed,
    estimateS: est.overheadS + selected.length * est.perCandidateS, estimateModel: est, budgetS, watchdogS: o.watchdogMin * 60,
    incompleteBlockDesign,
    notMeasured: candidateRecords,
  };
  if (o.planOnly) {
    process.stdout.write(`${JSON.stringify({ plan, schedule, artifacts: usable.map((c) => ({ id: c.id, sha256: c.primarySha256,
      verified: c.verified, acceptance: c.acceptance })) }, null, 2)}\n`);
    return 0;
  }
  writeJson(join(sdir, 'schedule.json'), schedule);
  const ident = sourceIdentity(o.repo, selected.map((c) => ({ id: c.id, dir: c.dir, buildInputs: c.buildInputs })));
  writeFileSync(join(sdir, 'source-manifest.txt'), ident.manifestText);
  const manifest = {
    schema: 'early-bench.session-manifest/2',
    label: LABELS[0],
    labels: LABELS,
    sessionId, runId: o.runId, platform: o.platform,
    environmentClass: o.platform === 'android' ? (o.serial ? 'physical-device' : 'emulator') : 'simulator',
    ...(o.serial ? { physicalDevice: { label: PHYSICAL_LABEL } } : {}),
    status: 'running', failureReason: null, startedAt, endedAt: null, lockAcquiredAt: o.lockAcquiredAt,
    design: { sha256: o.designSha256, ref: o.designRef },
    buildPolicy: { path: buildPolicy.path, sha256: buildPolicy.sha256 },
    verification: { note: o.verificationNote, candidatesRequested: o.candidates,
      expectedArtifacts: Object.fromEntries(Object.entries(o.expect).map(([k, v]) => [k, v.text])),
      acceptanceReceipts: Object.fromEntries(selected.map((c) => [c.id, c.acceptance])) },
    tool: { name: 'early-bench', version: TOOL_VERSION, source: toolSource() },
    source: ident.source,
    schedule: { file: 'schedule.json', sha256: sha256(readFileSync(join(sdir, 'schedule.json'))) },
    launchConfigBase: { 'mb.journeyMode': '1', 'mb.profile': o.profile },
    watchdog: { softMin: o.watchdogMin, hardStop: 'caller (lock wrapper): SIGTERM, then SIGKILL after a grace period' },
    plan, fixture: ctx.fixture, notCollected: o.serial ? NOT_COLLECTED.androidPhysical : NOT_COLLECTED[o.platform],
    candidates: candidateRecords, environment: null, device: null, resets: {}, counts: null, tools: null,
  };
  const manifestPath = join(sdir, 'manifest.json');
  writeJson(manifestPath, manifest);
  log.info('session.start', { sessionId, plan });

  // ---- watchdog, host-sleep detector, signals ----
  const watchdog = setTimeout(() => {
    ctx.abort ??= 'watchdog';
    log.error('watchdog', { minutes: o.watchdogMin });
  }, o.watchdogMin * 60000);
  const sleepDet = startSleepDetector({
    onSleep: (gapMs) => {
      ctx.abort ??= 'host-sleep';
      ctx.sessionFailed = 'host-sleep';
      log.error('host-sleep', { gapMs });
    },
  });
  const onSignal = (sig) => {
    ctx.abort ??= `terminated:${sig}`;
    log.error('signal', { sig });
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  // A detached session must survive the end of the terminal that started it (Node resets inherited signal
  // dispositions, so `nohup` alone does not protect it). The caller's SIGTERM / SIGKILL stays the hard stop.
  process.on('SIGHUP', () => log.warn('signal.ignored', { sig: 'SIGHUP' }));
  ctx.checkpoint = (patch) => {
    Object.assign(manifest, patch);
    writeJson(manifestPath, manifest);
  };
  // Journal: one line per finished launch with the in-memory facts the raw files do not show (liveness, pid,
  // fui wait), so a killed session can be finalized post hoc by finalize.mjs.
  ctx.journal = (j) => appendFileSync(join(sdir, 'journal.jsonl'), SCRUB(`${JSON.stringify({
    journeyId: j.journeyId, role: j.role, candidateId: j.candidateId, alive: j.alive ?? null, pid: j.pid ?? null,
    fuiSeenByStream: j.fuiSeenByStream ?? j.fuiControl ?? null, startedAt: j.startedAt ?? null, endedAt: j.endedAt ?? null,
    previousCandidateId: j.previousCandidateId ?? null,
  })}\n`));
  const progress = (extra) => writeJson(join(sdir, 'progress.json'), { sessionId, at: isoNow(), elapsedS: Math.round((Date.now() - t0) / 1000), abort: ctx.abort, ...extra });

  const hostStart = await hostSnapshot();
  const builds = {};
  for (const c of selected) {
    const frozen = c.artifacts.map((a) => freezeArtifact({ repo: o.repo, candidate: c, platform: o.platform, artifact: a, frozenRoot: o.artifacts }));
    const prov = candidateProvenance(o.repo, c);
    builds[c.id] = { frozen, prov, buildId: `b-${c.token}-${o.platform}-${frozen[0].sha256.slice(0, 12)}` };
    log.info('artifact.frozen', { candidate: c.id, artifacts: frozen.map((f) => ({ kind: f.kind, sha256: f.sha256, bytes: f.bytes, copyVerified: f.copyVerified })) });
  }

  let result;
  try {
    result = o.platform === 'android'
      ? await runAndroid(ctx, { selected, builds, schedule, sid4, hostStart, progress, tokenOf })
      : await runIos(ctx, { selected, builds, schedule, sid4, hostStart, progress, tokenOf });
  } catch (err) {
    log.error('session.exception', { message: String(err?.stack ?? err) });
    result = { fatal: String(err?.message ?? err) };
  }
  clearTimeout(watchdog);
  sleepDet.stop();
  const hostEnd = await hostSnapshot();
  const env = result.environment ?? null;
  if (env) {
    env.host.end = hostEnd.state;
  }
  let scopeAtEnd = null;
  try {
    scopeAtEnd = scopeTreeSha256(o.repo);
  } catch (err) {
    log.warn('source.end-hash-failed', { message: String(err?.message ?? err) });
  }
  manifest.source.scopeTreeSha256AtEnd = scopeAtEnd;
  manifest.source.scopeChangedDuringSession = scopeAtEnd === null ? null : scopeAtEnd !== manifest.source.scopeTreeSha256;
  const counts = {
    journeysPlanned: result.planned ?? 0, journeysRun: result.ran ?? 0, journeysNotAttempted: result.notAttempted ?? 0,
    observationsByStatus: result.byStatus ?? {},
  };
  let status = 'completed';
  if (ctx.sessionFailed) {
    status = 'failed';
  } else if (result.fatal || result.notStarted) {
    status = result.notStarted ? 'not-started' : 'failed';
  } else if (ctx.abort) {
    status = 'incomplete';
  }
  Object.assign(manifest, {
    status,
    failureReason: ctx.sessionFailed ?? result.notStarted ?? result.fatal ?? (ctx.abort ? `aborted:${ctx.abort}` : null),
    endedAt: isoNow(),
    elapsedS: Math.round((Date.now() - t0) / 1000),
    hostSleep: { detected: ctx.sessionFailed === 'host-sleep', maxWallMinusMonoGapMs: Math.round(sleepDet.maxGapMs()) },
    bootReset: result.resets?.['R-BOOT']?.applied ?? null,
    candidates: [...(result.candidateRecords ?? []), ...candidateRecords],
    environment: env,
    device: result.device ?? null,
    resets: result.resets ?? {},
    tools: { node: process.version, ...(result.tools ?? {}) },
    counts,
    rawRedaction: { applied: true, replaced: ['repo path', 'sessions path', 'artifacts path', 'home path', 'host name', 'device serials / UDIDs', 'app container paths'], forms: 'plain and slash-escaped (JSON)' },
    files: existsSync(sdir) ? readdirSync(sdir).sort() : [],
  });
  writeJson(manifestPath, manifest);
  progress({ done: true, status });
  log.info('session.end', { status, counts });
  process.stdout.write(`${JSON.stringify({ sessionId, status, failureReason: manifest.failureReason, elapsedS: manifest.elapsedS, counts, headline: result.headline ?? null })}\n`);
  return status === 'completed' || status === 'incomplete' ? 0 : 1;
}

// ---------- shared helpers ----------
function journeyBase(ctx, env, c, build, j) {
  const replayLimited = c.streamSource === 'replay' && ['early.idle-memory', 'early.size'].includes(j.scenarioId);
  return {
    sessionId: ctx.sessionId, runId: ctx.o.runId, journeyId: j.journeyId ?? null, buildId: j.buildId ?? null,
    journeyIndex: j.journeyIndex ?? null, block: j.block ?? null,
    position: j.position ?? null, attempt: j.attempt ?? 1, candidateId: c.id, platform: ctx.o.platform, scenarioId: j.scenarioId,
    environmentRef: env.key, environmentClass: env.class, deviceKey: env.deviceKey, build,
    streamSource: c.streamSource, fixture: ctx.fixture,
    instrumentationId: c.instrumentationId,
    limitations: [...c.limitations, ...(env.limitations ?? []), ...(replayLimited ? ['bundles-replay-stream'] : []), ...(j.limitations ?? [])],
  };
}

function buildRef(c, builds, buildClass) {
  const b = builds[c.id];
  return { buildId: b.buildId, artifactSha256: b.frozen[0].sha256, buildClass };
}

function journeyRecord(ctx, env, c, buildClass, j) {
  return {
    schema: JOURNEY_SCHEMA, journeyId: j.journeyId, sessionId: ctx.sessionId, runId: ctx.o.runId, candidateId: c.id,
    platform: ctx.o.platform, deviceKey: env.deviceKey, scenarioId: j.scenarioId, designScenarioRef: SCENARIOS[j.scenarioId]?.designRef ?? null,
    bootSession: 1, blockSet: j.blockSet ?? null, block: j.block ?? null, position: j.position ?? null, journeyIndex: j.journeyIndex ?? null,
    previousCandidateId: j.previousCandidateId ?? null, attempt: j.attempt ?? 1, role: j.role, forJourneyId: j.forJourneyId ?? null,
    resetProcedures: j.resetProcedures ?? [],
    buildClass, environmentClass: env.class, environmentRef: env.key, streamSource: c.streamSource,
    instrumentationId: c.instrumentationId, fixture: ctx.fixture,
    uiGeneration: null, deviceSettings: env.deviceSettings ?? null,
    startedAt: j.startedAt ?? null, endedAt: j.endedAt ?? null,
    status: journeyStatus(j), failure: j.notRun ? null : (j.failure ?? null), notAttemptedReason: j.notRun ? j.notRunReason : null,
    cacheState: SCENARIOS[j.scenarioId]?.cacheState ?? null, artState: j.art ?? null, environmentFlags: j.environmentFlags ?? [],
    launchConfig: j.launchConfig ?? null, checks: j.checks ?? {}, rawRefs: j.rawFiles ?? [], diagnostics: j.diagnostics ?? {},
  };
}

function countStatuses(obs) {
  const out = {};
  for (const x of obs) {
    out[x.status] = (out[x.status] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort());
}

export function markNotRun(j, abort) {
  j.notRun = true;
  j.notRunReason = notAttemptedReason(abort);
  return j;
}

// Observations of a journey that was never started: not-measured with the recorded reason (never failures).
export function notRunObservations(base, methods, reason) {
  return methods.map((methodId) => makeObservation(base, { methodId, status: 'not-measured', reason }));
}

function failAll(base, methods, failure, diag = {}) {
  return methods.map((m) => makeObservation(base, { methodId: m, status: 'failed', failure, diagnosticValue: diag[m] ?? null }));
}

function rawWriter(ctx) {
  return (rel, text) => {
    const clean = ctx.redactor.scrub(String(text ?? '').replace(/\r/g, ''));
    const p = join(ctx.rawDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, clean);
    return { file: `raw/${rel}`, text: clean };
  };
}

function envLimitationsFromHost(hostStart, otherStart) {
  const out = [];
  if (hostStart.state.powerSource && hostStart.state.powerSource !== 'AC Power') {
    out.push('host-not-on-ac-power');
  }
  if (hostStart.state.loadavg && hostStart.identity.cpuCount && hostStart.state.loadavg[0] > hostStart.identity.cpuCount) {
    out.push('host-load-above-cpu-count');
  }
  if (otherStart.adb > 0 || otherStart.simulatorsBooted > 0) {
    out.push('other-devices-running');
  }
  return out;
}

// Foreign emulators / simulators: abort (default), wait up to N s for them to go away, or record and continue.
async function checkOtherDevices(o, probe, log) {
  const deadline = Date.now() + o.otherDevicesWaitS * 1000;
  let state = await probe();
  while (state.count > 0 && o.otherDevices === 'wait' && Date.now() < deadline) {
    log.warn('other-devices.waiting', state.summary);
    await sleep(10000);
    state = await probe();
  }
  return { ...state, proceed: state.count === 0 || o.otherDevices === 'record' };
}

// ======================================================================================================
// Android
// ======================================================================================================
const A_START = ['startup.ttff/early-am-start-w/1', 'startup.ttfd_system/early-logcat-fully-drawn/1'];
const A_MEM = ['memory.android.pss_total/early-dumpsys-meminfo-idle/1'];
const SCROLL_METRICS = ['frame_count', 'janky_frames_pct', 'frame_time_p50', 'frame_time_p90', 'frame_time_p99'];
const A_SCROLL_SF = SCROLL_METRICS.map((m) => `frame.android.scroll_${m}/early-sf-latency/1`);
const A_SCROLL_FT = SCROLL_METRICS.map((m) => `frame.android.scroll_${m}/early-perfetto-frametimeline/1`);
const A_SCROLL = [...A_SCROLL_SF, ...A_SCROLL_FT];
const A_ENERGY = ['energy.android.uid_estimated_charge/early-batterystats-power-model/1',
  'thermal.android.skin_temp_end/early-thermalservice-hal/1', 'thermal.android.skin_temp_rise/early-thermalservice-hal/1'];

// Energy-journey observations: power-model estimate of the app uid and the HAL skin temperature (end, rise).
export function energyObservations(base, en, limitations = []) {
  const out = [];
  const lim = [...limitations, 'power-model-estimate-not-measured-current', 'usb-connected-software-unplug'];
  if (en.swipesExit !== 0) {
    return failAll(base, A_ENERGY, { class: 'harness-error', message: `workload script exit ${en.swipesExit}` });
  }
  if (!en.est) {
    out.push(makeObservation(base, { methodId: A_ENERGY[0], status: 'failed', failure: { class: 'instrument-error', message: en.uid === null ? 'app uid not resolved' : 'no pwi,uid entry for the app uid' } }));
  } else {
    out.push(makeObservation(base, { methodId: A_ENERGY[0], status: 'measured', value: en.est.mah, limitations: lim, rawRefs: [rawRef(en.checkinFile, en.est.ref)] }));
  }
  const s0 = en.t0?.hal?.SKIN;
  const s1 = en.t1?.hal?.SKIN;
  if (s1 && Number.isFinite(s1.value)) {
    out.push(makeObservation(base, { methodId: A_ENERGY[1], status: 'measured', value: s1.value, limitations, rawRefs: [rawRef(en.t1.file, s1.ref)] }));
  } else {
    out.push(makeObservation(base, { methodId: A_ENERGY[1], status: 'unavailable', reason: 'thermal-hal-has-no-SKIN-sensor' }));
  }
  if (s0 && s1 && Number.isFinite(s0.value) && Number.isFinite(s1.value)) {
    out.push(makeObservation(base, { methodId: A_ENERGY[2], status: 'measured', value: Math.round((s1.value - s0.value) * 10) / 10, limitations,
      rawRefs: [rawRef(en.t0.file, s0.ref), rawRef(en.t1.file, s1.ref)] }));
  } else {
    out.push(makeObservation(base, { methodId: A_ENERGY[2], status: 'unavailable', reason: 'thermal-hal-has-no-SKIN-sensor' }));
  }
  return out;
}

// Five scroll observations of one source from its metrics; a source that fails plausibility is failed.
export function scrollObservations(base, ids, m, ref, { windowNs, refreshNs, limitations = [] }) {
  const check = plausibleFrameCount(m.frames, windowNs, refreshNs);
  if (!check.pass) {
    return ids.map((methodId) => makeObservation(base, { methodId, status: 'failed', failure: { class: 'instrument-error', message: `implausible frame count: ${check.reason}` } }));
  }
  const vals = [m.frames, m.jankyPct, m.p50, m.p90, m.p99];
  return ids.map((methodId, i) => (vals[i] === null || vals[i] === undefined
    ? makeObservation(base, { methodId, status: 'failed', failure: { class: 'instrument-error', message: 'too few frames for the statistic' } })
    : makeObservation(base, { methodId, status: 'measured', value: vals[i], limitations, rawRefs: [ref] })));
}

function findAapt2() {
  const root = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'build-tools') : null;
  if (!root || !existsSync(root)) {
    return null;
  }
  const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, 'aapt2')))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return dirs.length > 0 ? join(root, dirs[dirs.length - 1], 'aapt2') : null;
}

function tool(name) {
  const home = process.env.ANDROID_HOME;
  const p = home ? join(home, name === 'adb' ? 'platform-tools' : 'emulator', name) : name;
  return existsSync(p) ? p : name;
}

function intOrNull(v) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

async function runAndroid(ctx, { selected, builds, schedule, sid4, hostStart, progress, tokenOf }) {
  const { o, log, rawDir, redactor } = ctx;
  const adbPath = tool('adb');
  const emulatorPath = tool('emulator');
  const aapt2 = findAapt2();
  const apkanalyzer = findApkanalyzer();
  const resets = {};
  const write = rawWriter(ctx);
  const tools = {
    adb: await firstLine(adbPath, ['version'], 2),
    emulator: await firstLine(emulatorPath, ['-version'], 1),
    aapt2: aapt2 ? await firstLine(aapt2, ['version'], 1) : null,
    apkanalyzer: apkanalyzer ? cmdlineToolsRevision(apkanalyzer) : null,
  };

  // ---- device: reuse a running mobilebench AVD, else cold-boot it ----
  const before = await android.listEmulators(adbPath);
  for (const d of before.devices) {
    redactor.add(d.serial, hashedId('serial', d.serial, ctx.sessionId));
  }
  write('setup/adb-devices-start.txt', before.raw);
  const physical = Boolean(o.serial);
  let serial = physical ? (before.devices.find((d) => d.serial === o.serial && d.state === 'device')?.serial ?? null)
    : (before.devices.find((d) => d.avd === o.avd && d.state === 'device')?.serial ?? null);
  if (physical && !serial) {
    return { notStarted: 'physical-device-not-connected (--serial not in `adb devices` with state device)', planned: 0, ran: 0, tools };
  }
  const probe = async () => {
    const list = await android.listEmulators(adbPath);
    const foreign = list.devices.filter((d) => d.serial !== serial);
    const sims = (await ios.listDevices().catch(() => [])).filter((d) => d.state === 'Booted');
    return { count: foreign.length + sims.length, adb: foreign.length, simulatorsBooted: sims.length, summary: { adb: foreign.length, simulatorsBooted: sims.length } };
  };
  const other = await checkOtherDevices(o, probe, log);
  const otherDevicesStart = { adb: other.adb, simulatorsBooted: other.simulatorsBooted, policy: o.otherDevices };
  if (physical && other.adb > 0) {
    return { notStarted: `other-devices-attached (${other.adb} other adb device(s); a physical-device session needs the selected device alone: shut the emulator down / disconnect)`, planned: 0, ran: 0, tools };
  }
  if (!other.proceed) {
    return { notStarted: `other-devices-running (adb ${other.adb}, simulators ${other.simulatorsBooted})`, planned: 0, ran: 0, tools };
  }
  let bootedBySession = false;
  let bootFlags = null;
  const avdCfg = android.avdConfig(o.avd);
  if (!serial) {
    if (!avdCfg) {
      return { notStarted: `avd-missing:${o.avd}`, planned: 0, ran: 0, tools };
    }
    bootFlags = ['-no-snapshot-load', '-no-snapshot-save', '-no-boot-anim', '-no-audio', '-no-window', '-gpu', 'host',
      '-cores', String(intOrNull(avdCfg['hw.cpu.ncore']) ?? 4), '-memory', String(intOrNull(avdCfg['hw.ramSize']) ?? 4096)];
    const b0 = Date.now();
    const pid = android.bootEmulator({ emulatorPath, avd: o.avd, flags: bootFlags, logFile: join(rawDir, 'emulator.log'), scrub: (s) => redactor.scrub(s) });
    if (process.env.EB_EMU_PID_FILE) {
      writeFileSync(process.env.EB_EMU_PID_FILE, `${pid}\n`);
    }
    bootedBySession = true;
    serial = await android.waitForAvd(adbPath, o.avd, 180000);
    if (!serial) {
      return { fatal: 'emulator-did-not-appear', planned: 0, ran: 0, tools };
    }
    redactor.add(serial, hashedId('serial', serial, ctx.sessionId));
    const dev0 = android.makeAdb(adbPath, serial);
    if (!(await android.waitForBootCompleted(dev0, 240000))) {
      await android.killEmulator(adbPath, serial);
      return { fatal: 'boot-not-completed', planned: 0, ran: 0, tools };
    }
    await sleep(10000);
    resets['R-BOOT'] = { applied: true, bootS: Math.round((Date.now() - b0) / 1000), flags: bootFlags };
  } else {
    resets['R-BOOT'] = { applied: false, reason: 'reused running emulator' };
  }
  const dev = android.makeAdb(adbPath, serial);
  const deviceKey = hashedId('d', serial, ctx.sessionId);
  const cmdline = bootedBySession || physical ? null : await android.emulatorCmdlineFlags(o.avd);
  const gpuMode = physical ? 'device-gpu' : (bootedBySession ? 'host' : (cmdline?.gpu ?? 'unknown'));
  const effective = physical ? { cores: null, memoryMb: null, source: 'physical device (see identity.cpuCount, state.memTotalKb)' } : bootedBySession
    ? { cores: intOrNull(bootFlags[bootFlags.indexOf('-cores') + 1]), memoryMb: intOrNull(bootFlags[bootFlags.indexOf('-memory') + 1]), source: 'boot flags of this session' }
    : { cores: intOrNull(cmdline?.cores) ?? intOrNull(avdCfg?.['hw.cpu.ncore']), memoryMb: intOrNull(cmdline?.memory) ?? intOrNull(avdCfg?.['hw.ramSize']),
      source: cmdline?.cores || cmdline?.memory ? 'emulator command line (missing flags from config.ini)' : 'AVD config.ini (no -cores / -memory on the command line)' };

  // device preparation (recorded and restored): screen on and awake for the whole session
  const stayOnBefore = (await dev.sh('settings get global stay_on_while_plugged_in', { timeoutMs: 15000 })).stdout.trim();
  const prep = [];
  for (const cmd of [physical ? 'svc power stayon usb' : 'svc power stayon true', 'input keyevent KEYCODE_WAKEUP', 'wm dismiss-keyguard']) {
    const r = await dev.sh(cmd, { timeoutMs: 15000 });
    prep.push({ cmd, code: r.code });
  }
  const devStart = await android.deviceSnapshot(dev);
  const comparability = physical ? {
    environmentClass: 'physical-device', platform: 'android',
    model: devStart.identity.props['ro.product.model'], manufacturer: devStart.identity.props['ro.product.manufacturer'],
    sdk: devStart.identity.props['ro.build.version.sdk'], fingerprint: devStart.identity.props['ro.build.fingerprint'],
    abi: devStart.identity.props['ro.product.cpu.abi'], serialHash: `p-${sha256(`mobilebench-serial|${serial}`).slice(0, 12)}`,
    deviceCpuCount: devStart.identity.cpuCount, wmSize: devStart.identity.wmSize, wmDensity: devStart.identity.wmDensity,
    deviceSettings: devStart.state.keySettings, host: hostStart.identity,
  } : {
    environmentClass: 'emulator', platform: 'android', avd: o.avd, avdHardware: avdCfg, gpuMode,
    emulatorCores: effective.cores, emulatorMemoryMb: effective.memoryMb, deviceCpuCount: devStart.identity.cpuCount,
    emulatorVersion: tools.emulator, fingerprint: devStart.identity.props['ro.build.fingerprint'],
    wmSize: devStart.identity.wmSize, wmDensity: devStart.identity.wmDensity, deviceSettings: devStart.state.keySettings,
    host: hostStart.identity,
  };
  const env = {
    key: environmentKey(comparability), class: physical ? 'physical-device' : 'emulator', platform: 'android', deviceKey,
    ...(physical ? { physicalDevice: { label: PHYSICAL_LABEL, model: comparability.model, manufacturer: comparability.manufacturer, sdk: comparability.sdk } } : {}),
    limitations: envLimitationsFromHost(hostStart, otherDevicesStart),
    comparabilityKey: comparability, deviceSettings: devStart.state.keySettings,
    host: { key: hostKey(hostStart.identity), identity: hostStart.identity, start: hostStart.state, end: null },
    device: { identity: devStart.identity, start: devStart.state, end: null, avdHardware: physical ? null : avdCfg,
      emulatorVersion: physical ? null : tools.emulator, physical,
      gpuMode, gpuModeSource: bootedBySession ? 'boot flag' : 'emulator command line', effectiveCoresMemory: effective,
      bootedBySession, bootFlags, emulatorCmdline: cmdline, prep, stayOnBefore, layoutReference: null,
      layoutReferenceReason: 'calibration app not built yet (no h_ref)' },
    otherDevices: { start: otherDevicesStart, end: null },
  };
  log.info('device.ready', { deviceKey, bootedBySession, gpuMode });
  ctx.checkpoint?.({ environment: env });
  const mbStream = android.startLogcatStream({ adbPath, serial, rawFile: join(rawDir, 'logcat-mobilebench-stream.txt'), scrub: (s) => redactor.scrub(s) });

  // ---- per-candidate setup: R-INSTALL, build class, R-ART, size ----
  const fixtureSel = readFixtureSelection(o.repo, o.profile);
  const C = {};
  const candidateRecords = [];
  const allObs = [];
  const journeysOut = [];
  const readDexopt = async (pkg, rel) => {
    const r = await dev.sh(`dumpsys package ${pkg}`, { timeoutMs: 30000 });
    const w = write(rel, r.stdout);
    const d = parseDexopt(w.text);
    return { summary: d.summary, file: w.file, entries: d.entries.map((e) => ({ isa: e.isa, status: e.status, reason: e.reason, line: e.line })) };
  };
  for (const c of selected) {
    const f = builds[c.id].frozen.find((x) => x.kind === 'apk');
    const base = `setup/${c.token}`;
    const badging = aapt2 ? await run(aapt2, ['dump', 'badging', f.absFrozen], { timeoutMs: 60000 }) : null;
    const bad = badging ? parseBadging(badging.stdout) : { debuggable: null, packageName: null, minSdk: null, targetSdk: null, nativeCode: [] };
    if (badging) {
      write(`${base}/badging.txt`, badging.stdout);
    }
    const buildClass = bad.debuggable === null ? (c.declaredBuildClass ?? 'unknown') : (bad.debuggable ? 'debug' : 'release');
    const artifactBuildProblems = badging ? androidArtifactBuildProblems(bad, ctx.buildPolicy.value) : ['aapt2 unavailable'];
    if (artifactBuildProblems.length > 0) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'artifact-build-policy-mismatch',
        detail: artifactBuildProblems.join('; ') });
      continue;
    }
    await dev.adb(['uninstall', c.packageName], { timeoutMs: 60000 });
    const inst = await dev.adb(['install', f.absFrozen], { timeoutMs: 180000 });
    write(`${base}/install.txt`, `${inst.stdout}${inst.stderr}`);
    const pmPath = (await dev.sh(`pm path ${c.packageName}`)).stdout.replace(/\r/g, '');
    const apkOnDevice = (/package:(\S+base\.apk)/.exec(pmPath) ?? [])[1] ?? null;
    const shaOnDevice = apkOnDevice ? ((await dev.sh(`sha256sum ${apkOnDevice}`)).stdout.trim().split(/\s+/)[0] ?? null) : null;
    const installVerified = shaOnDevice === f.sha256;
    write(`${base}/install-verify.txt`, `installed base.apk sha256 ${shaOnDevice}\nfrozen artifact sha256 ${f.sha256}\nmatch ${installVerified}\n`);
    if (inst.code !== 0 || !installVerified) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: inst.code !== 0 ? 'install-failed' : 'installed-artifact-mismatch' });
      continue;
    }
    let component = c.launchActivity;
    if (!component) {
      const ra = await dev.sh(`cmd package resolve-activity --brief ${c.packageName}`);
      component = parseResolveActivity(ra.stdout.replace(/\r/g, ''));
    }
    if (!component) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: 'launch-activity-unresolved' });
      continue;
    }
    const art = await applyArt(dev, c.packageName, (rel, t) => write(`${base}/${rel}`, t), readDexopt, `${base}/art-dexopt.txt`);
    C[c.id] = { c, component, buildClass, art, artCurrent: art.after.summary, artUnreadable: art.after.summary === null };
    const build = buildRef(c, builds, buildClass);
    candidateRecords.push({
      id: c.id, status: 'included', packageName: c.packageName, component, buildClass,
      buildClassSource: bad.debuggable === null ? 'candidate.json' : 'aapt2 application-debuggable',
      declaredBuildClass: c.declaredBuildClass, family: c.family, architectureClass: c.architectureClass, buildId: builds[c.id].buildId,
      artifacts: builds[c.id].frozen.map(({ absFrozen, ...rest }) => rest), provenance: builds[c.id].prov,
      buildInputs: c.buildInputs,
      versions: c.versions, candidateJson: c.candidateJson, overridesApplied: c.overridesApplied, art,
      artStateReadable: art.after.summary !== null,
      streamSource: c.streamSource, streamSourceBasis: c.streamSourceBasis, instrumentationId: c.instrumentationId, verified: c.verified,
      installVerified, limitations: c.limitations,
    });
    // sizes: build-unit observations, one per frozen artifact
    const sizeBase = journeyBase(ctx, env, c, build, { buildId: builds[c.id].buildId, scenarioId: 'early.size' });
    const sizeLines = builds[c.id].frozen.map((x) => `${x.kind} ${x.bytes} bytes sha256 ${x.sha256}`);
    const sizeFile = write(`${base}/artifact-sizes.txt`, `${sizeLines.join('\n')}\n`).file;
    builds[c.id].frozen.forEach((x, i) => {
      const methodId = x.kind === 'aab' ? 'size.android.aab/file-bytes/1' : 'size.android.apk_arm64/file-bytes/1';
      allObs.push(makeObservation({ ...sizeBase, build: { buildId: builds[c.id].buildId, artifactSha256: x.sha256, buildClass } }, {
        methodId, status: 'measured', value: x.bytes, rawRefs: [{ file: sizeFile, line: i + 1, text: sizeLines[i] }],
      }));
    });
    const payloadMethods = [
      ['size.android.benchmark_payload_compressed/zip-central-directory/1', 'compressedBytes'],
      ['size.android.benchmark_payload_uncompressed/zip-central-directory/1', 'uncompressedBytes'],
    ];
    if (c.benchmarkPayloadAccounting.status === 'unavailable') {
      for (const [methodId] of payloadMethods) {
        allObs.push(makeObservation(sizeBase, { methodId, status: 'unavailable', reason: c.benchmarkPayloadAccounting.reason }));
      }
    } else {
      const payload = benchmarkPayloadTotals(classifyZip(f.absFrozen, c.sizeClassification));
      const payloadLine = `benchmark payload ${payload.entries} entries compressed ${payload.compressedBytes} bytes uncompressed ${payload.uncompressedBytes} bytes`;
      const payloadFile = write(`${base}/payload-sizes.txt`, `${payloadLine}\n`).file;
      for (const [methodId, field] of payloadMethods) {
        allObs.push(makeObservation(sizeBase, payload.entries === 0
          ? { methodId, status: 'unavailable', reason: 'benchmark-payload-classification-matched-no-entries' }
          : { methodId, status: 'measured', value: payload[field], rawRefs: [{ file: payloadFile, line: 1, text: payloadLine }] }));
      }
    }
    if (!builds[c.id].frozen.some((x) => x.kind === 'aab')) {
      allObs.push(makeObservation(sizeBase, { methodId: 'size.android.aab/file-bytes/1', status: 'not-measured', reason: 'artifact-not-provided' }));
    }
    allObs.push(await apkDownloadEstimate(apkanalyzer, f.absFrozen, sizeBase, (rel, t) => write(`${base}/${rel}`, t)));
    C[c.id].sizeBase = sizeBase;
  }
  // installed bytes: one unmeasured first launch per candidate, then one forced diskstats collection for all
  if (Object.keys(C).length > 0) {
    for (const id of Object.keys(C)) {
      const jid = `${sid4}.size.first.${C[id].c.token}`;
      await dev.sh(`am force-stop ${C[id].c.packageName}`);
      await sleep(1000);
      const since = mbStream.mark();
      const am = await dev.sh(`am start -W -f 0x10008000 -n ${C[id].component} --es mb.journey ${jid} --es mb.journeyMode 1 --es mb.profile ${o.profile}`, { timeoutMs: 60000 });
      const fui = am.code === 0 ? await mbStream.waitFor((e) => e.event === 'fui', { since, timeoutMs: 20000 }) : null;
      await sleep(2000);
      await dev.sh(`am force-stop ${C[id].c.packageName}`);
      write(`setup/${C[id].c.token}/size-first-launch.txt`, `${am.stdout}\nfui seen ${Boolean(fui)}\n`);
    }
    const ds = await forcedDiskstats(dev, (rel, t) => write(`setup/${rel}`, t));
    for (const id of Object.keys(C)) {
      allObs.push(...installedSizeObservations(ds, C[id].c.packageName, C[id].sizeBase));
    }
  }
  resets['R-INSTALL'] = { applied: true, verify: 'sha256sum of installed base.apk == frozen artifact' };
  resets['R-ART'] = { applied: true, procedure: 'early.art.partial-use-if-available.shell', steps: ART_STEPS };
  const ids = Object.keys(C);
  const finish = (extra) => finishAndroid({ ctx, env, dev, adbPath, bootedBySession, serial, resets, candidateRecords, allObs, journeysOut, tools, mbStream, stayOnBefore, ...extra });
  if (ids.length === 0) {
    return finish({ planned: 0, ran: 0, notAttempted: 0, results: [], C, builds });
  }
  // the schedule was frozen before install; drop candidates that failed setup (recorded above)
  const keep = (b) => ({ ...b, order: b.order.filter((x) => C[x]) });
  const sched = { ...schedule, groups: schedule.groups.map((g) => ({ ...g, blocks: g.blocks.map(keep), debugBlocks: (g.debugBlocks ?? []).map(keep) })) };
  const planned = plannedJourneys(sched, sid4, tokenOf);
  progress({ planned: planned.length, ran: 0 });

  // ---- journey primitives ----
  const pidof = async (pkg) => (await dev.sh(`pidof ${pkg}`, { timeoutMs: 15000 })).stdout.trim().split(/\s+/)[0] || null;
  const forceStopAll = async () => {
    for (const id of ids) {
      await dev.sh(`am force-stop ${C[id].c.packageName}`);
    }
  };
  let lastCand = null;
  let ran = 0;
  const results = [];
  const launchConfig = (jid) => ({ 'mb.journey': jid, 'mb.journeyMode': '1', 'mb.profile': o.profile });
  const amCmd = (component, jid) => `am start -W -f 0x10008000 -n ${component} --es mb.journey ${jid} --es mb.journeyMode 1 --es mb.profile ${o.profile}`;
  // waits for the next fui line on the long-lived MobileBench reader (control signal only, never a timing source)
  const waitFui = (since, timeoutMs) => mbStream.waitFor((e) => e.event === 'fui', { since, timeoutMs });
  // ---- early.scroll: fling plan with SurfaceFlinger per-layer polling and a FrameTimeline trace ----
  const wm = (await dev.sh('wm size', { timeoutMs: 15000 })).stdout;
  const wmM = /Override size: (\d+)x(\d+)/.exec(wm) ?? /Physical size: (\d+)x(\d+)/.exec(wm);
  const screen = wmM ? { width: Number(wmM[1]), height: Number(wmM[2]) } : { width: 1080, height: 2400 };
  const plan = swipePlan(o.seed, o.scrollSwipes);
  const planMs = planDurationMs(plan);
  const traceMs = planMs + 4000;
  const ftConfig = `buffers { size_kb: 16384 fill_policy: RING_BUFFER }\ndata_sources { config { name: "android.surfaceflinger.frametimeline" } }\nduration_ms: ${traceMs}\n`;
  const scrollPhase = async (j, pkg, jdir) => {
    const sc = { plan: { seed: o.seed, swipes: plan.length, screen, planMs } };
    j.scroll = sc;
    j.pid = await pidof(pkg);
    const list = await dev.sh('dumpsys SurfaceFlinger --list', { timeoutMs: 30000 });
    const listW = write(`${jdir}/sf-list.txt`, list.stdout);
    j.rawFiles.push(listW.file);
    const layers = sfLayersFor(listW.text, pkg);
    sc.layers = layers;
    const poll = async (tag) => {
      const out = [];
      for (const [i, name] of layers.entries()) {
        const r = await dev.sh(`dumpsys SurfaceFlinger --latency '${name}'`, { timeoutMs: 15000 });
        out.push({ layer: name, text: `# layer ${name}\n${r.stdout}`, i });
      }
      return out.map((p) => ({ ...p, tag }));
    };
    // config via a pushed file (the config is the same for every journey of the session)
    await dev.sh(`echo '${ftConfig.replace(/\n/g, ' ')}' > /data/misc/perfetto-configs/early-scroll.pbtx`, { timeoutMs: 15000 });
    const traceDev = `/data/misc/perfetto-traces/early-scroll-${j.journeyId}.pftrace`;
    const pf = await dev.sh(`perfetto --background --txt -c /data/misc/perfetto-configs/early-scroll.pbtx -o ${traceDev}`, { timeoutMs: 30000 });
    write(`${jdir}/perfetto-start.txt`, `${pf.stdout}${pf.stderr}`);
    sc.perfettoPid = /^\d+$/.test(pf.stdout.trim()) ? pf.stdout.trim() : null;
    await sleep(1000);
    const baseline = await poll('baseline');
    const script = swipeScript(plan, screen);
    write(`${jdir}/swipes.sh`, `${script}\n`);
    const t0 = Date.now();
    const swipes = dev.sh(script, { timeoutMs: planMs + 60000 });
    const polls = [];
    let done = false;
    swipes.then(() => { done = true; });
    while (!done) {
      polls.push(...(await poll(`p${String(polls.length).padStart(3, '0')}`)));
      await sleep(500);
    }
    const sw = await swipes;
    await sleep(2500); // settle: the last fling decelerates
    polls.push(...(await poll('settle')));
    sc.swipesExit = sw.code;
    sc.windowMs = Date.now() - t0;
    // wait for the trace to finish (duration_ms) and pull it
    const left = traceMs + 1000 - (Date.now() - t0) - 1000;
    if (left > 0) {
      await sleep(left);
    }
    for (let k = 0; k < 20; k += 1) {
      const alive = sc.perfettoPid ? (await dev.sh(`kill -0 ${sc.perfettoPid} 2>/dev/null && echo alive`, { timeoutMs: 10000 })).stdout.includes('alive') : false;
      if (!alive) {
        break;
      }
      await sleep(500);
    }
    const local = join(rawDir, jdir, 'frametimeline.pftrace');
    mkdirSync(dirname(local), { recursive: true });
    const pull = await dev.adb(['pull', traceDev, local], { timeoutMs: 60000 });
    await dev.sh(`rm -f ${traceDev}`, { timeoutMs: 15000 });
    sc.trace = pull.code === 0 && existsSync(local) ? { file: `raw/${jdir}/frametimeline.pftrace`, abs: local } : null;
    if (sc.trace) {
      j.rawFiles.push(sc.trace.file);
    }
    // write SF polls: one file per layer, polls concatenated in order
    sc.sf = layers.map((name, i) => {
      const parts = [...baseline, ...polls].filter((p) => p.i === i);
      let text = '';
      const parsedPolls = [];
      let base = null;
      for (const p of parts) {
        const startLine = text.split('\n').length; // 1-based line of "# poll" header
        text += `# poll ${p.tag}\n${p.text.replace(/\r/g, '')}${p.text.endsWith('\n') ? '' : '\n'}`;
        const parsed = parseSfLatency(p.text.replace(/\r/g, '').split('\n').slice(1).join('\n'));
        // shift line numbers to the file: header "# poll" + "# layer" lines precede the dumpsys output
        parsed.frames = parsed.frames.map((f) => ({ ...f, line: f.line + startLine + 1 }));
        if (p.tag === 'baseline') {
          base = parsed;
        } else {
          parsedPolls.push({ parsed });
        }
      }
      const w = write(`${jdir}/sf-latency-${i}.txt`, text);
      j.rawFiles.push(w.file);
      const frames = mergeSfPolls(base, parsedPolls).map((f) => ({ ...f, file: w.file }));
      const refreshNs = base?.refreshNs ?? parsedPolls[0]?.parsed.refreshNs ?? null;
      return { layer: name, file: w.file, frames, refreshNs, metrics: sfLatencyMetrics(frames, refreshNs) };
    });
    const sumLines = sc.sf.map((x) => sfSummaryLine(x.layer, x.metrics));
    const sumW = write(`${jdir}/sf-summary.txt`, `${sumLines.join('\n')}\n`);
    j.rawFiles.push(sumW.file);
    sc.sf.forEach((x, i) => { x.summaryRef = { file: sumW.file, line: i + 1, text: sumLines[i] }; });
    if (sc.trace) {
      const m = frameTimelineMetrics(readFileSync(sc.trace.abs), j.pid);
      const t = frameTimelineText(m, j.pid);
      const ftW = write(`${jdir}/frametimeline-frames.txt`, t.text);
      j.rawFiles.push(ftW.file);
      const { list, ...rest } = m;
      sc.ft = { ...rest, summaryRef: { file: ftW.file, line: t.summaryLine, text: t.summary } };
    }
  };
  // ---- early.energy (physical device only): power-model estimate and thermal HAL over a fixed workload ----
  const thermalByBlock = [];
  const thermalSnap = async (rel, meta) => {
    if (!physical) {
      return null;
    }
    const w = write(rel, (await dev.sh('dumpsys thermalservice', { timeoutMs: 30000 })).stdout);
    const t = parseThermalservice(w.text);
    thermalByBlock.push({ ...meta, file: w.file, status: t.status?.value ?? null, skinC: t.hal.SKIN?.value ?? null, apC: t.hal.AP?.value ?? null, batC: t.hal.BAT?.value ?? null });
    return { ...t, file: w.file };
  };
  const energyPlan = swipePlan(o.seed, Math.max(1, Math.round((o.energyS * 1000) / (planDurationMs(plan) / plan.length))));
  const energyPhase = async (j, pkg, jdir) => {
    const en = { workloadS: o.energyS, swipes: energyPlan.length };
    j.energy = en;
    en.uid = parsePackageUid((await dev.sh(`cmd package list packages -U ${pkg}`, { timeoutMs: 15000 })).stdout.replace(/\r/g, ''), pkg);
    en.t0 = await thermalSnap(`${jdir}/thermal-start.txt`, { journeyId: j.journeyId, phase: 'energy-start' });
    const steps = [];
    try {
      const r1 = await dev.sh('dumpsys batterystats --reset', { timeoutMs: 30000 });
      const r2 = await dev.sh('dumpsys battery unplug', { timeoutMs: 15000 });
      steps.push(`batterystats --reset exit ${r1.code}: ${r1.stdout.trim()}`, `battery unplug exit ${r2.code}`);
      const t0 = Date.now();
      const script = swipeScript(energyPlan, screen);
      write(`${jdir}/energy-swipes.sh`, `${script}\n`);
      const sw = await dev.sh(script, { timeoutMs: o.energyS * 1000 + 120000 });
      const left = o.energyS * 1000 - (Date.now() - t0);
      if (left > 0) {
        await sleep(left);
      }
      en.swipesExit = sw.code;
      en.elapsedMs = Date.now() - t0;
      const ck = await dev.sh('dumpsys batterystats --checkin', { timeoutMs: 60000 });
      const ckW = write(`${jdir}/batterystats-checkin.txt`, ck.stdout);
      j.rawFiles.push(ckW.file);
      en.checkinFile = ckW.file;
      en.est = en.uid === null ? null : parseBatterystatsUidMah(ckW.text, en.uid);
      en.t1 = await thermalSnap(`${jdir}/thermal-end.txt`, { journeyId: j.journeyId, phase: 'energy-end' });
    } finally {
      const r3 = await dev.sh('dumpsys battery reset', { timeoutMs: 15000 });
      steps.push(`battery reset exit ${r3.code}`);
      en.batteryReset = r3.code === 0;
      j.rawFiles.push(write(`${jdir}/energy-steps.txt`, `${steps.join('\n')}\n`).file);
    }
  };
  const launch = async (j, { mode, memory = false, scroll = false, energy = false }) => {
    const x = C[j.candidateId];
    const pkg = x.c.packageName;
    const jdir = `journeys/${j.journeyId}`;
    j.resetProcedures = j.resetProcedures ?? [];
    j.rawFiles = [];
    j.diagnostics = {};
    j.launchConfig = launchConfig(j.journeyId);
    if (mode === 'cold') {
      await dev.sh(`am force-stop ${pkg}`);
      j.resetProcedures.push('R-PROC');
      await sleep(2000);
    } else {
      // activity-warm: the process must be alive; HOME stops the activity
      j.diagnostics.processAliveBeforeHome = Boolean(await pidof(pkg));
      await dev.sh('am start -a android.intent.action.MAIN -c android.intent.category.HOME');
      await sleep(2000);
    }
    await dev.adb(['logcat', '-c']);
    j.previousCandidateId = lastCand;
    j.startedAt = isoNow();
    const since = mbStream.mark();
    const am = await dev.sh(amCmd(x.component, j.journeyId), { timeoutMs: 60000 });
    const amW = write(`${jdir}/am-start.txt`, `${am.stdout}${am.stderr ? `\n# stderr\n${am.stderr}` : ''}`);
    j.rawFiles.push(amW.file);
    const amP = parseAmStart(amW.text);
    j.am = { ...amP, file: amW.file, code: am.code, timedOut: am.timedOut };
    const fuiLine = am.code === 0 ? await waitFui(since, 20000) : null;
    j.fuiSeenByStream = Boolean(fuiLine);
    j.fuiStreamJourneyId = fuiLine ? fuiLine.journeyId : null;
    await sleep(2000);
    if (scroll && j.role === 'measured') {
      await scrollPhase(j, pkg, jdir);
    }
    if (energy && j.role === 'measured') {
      await energyPhase(j, pkg, jdir);
    }
    if (memory) {
      await sleep(o.idleS * 1000);
      const pid = await pidof(pkg);
      j.pid = pid;
      const mi = await dev.sh(`dumpsys meminfo ${pkg}`, { timeoutMs: 60000 });
      const miW = write(`${jdir}/meminfo.txt`, mi.stdout);
      j.meminfoFile = miW.file;
      j.rawFiles.push(miW.file);
      j.meminfo = parseMeminfo(miW.text);
      if (pid) {
        const ps = await dev.sh(`cat /proc/${pid}/status`, { timeoutMs: 15000 });
        const psW = write(`${jdir}/proc-status.txt`, ps.stdout);
        j.rawFiles.push(psW.file);
        j.proc = ps.code === 0 ? parseProcStatus(psW.text) : null;
      }
    }
    j.alive = Boolean(await pidof(pkg));
    const lc = await dev.adb(['logcat', '-d', '-v', 'epoch', '-b', 'main', '-b', 'system', '-b', 'crash'], { timeoutMs: 60000 });
    const lcW = write(`${jdir}/logcat.txt`, lc.stdout);
    j.logcatFile = lcW.file;
    j.rawFiles.push(lcW.file);
    const mb = parseMbLogcat(lcW.text, null);
    j.fui = mb.find((m) => m.event === 'fui' && m.n >= 1) ?? null;
    j.fuiCheck = j.fui ? checkFuiPayload(j.fui.payload, fixtureSel, { hRef: null }) : null;
    j.fullyDrawn = parseFullyDrawn(lcW.text, pkg)[0] ?? null;
    const disp = parseDisplayed(lcW.text, pkg)[0] ?? null;
    j.diagnostics.displayedMs = disp ? disp.ms : null;
    j.crash = findCrash(lcW.text, pkg);
    j.expectedLaunchState = mode === 'cold' ? 'COLD' : 'WARM';
    j.endedAt = isoNow();
    j.checks = {
      launchState: amP.launchState === j.expectedLaunchState ? 'pass' : `fail:${amP.launchState}`,
      fuiMarker: j.fui ? 'present' : 'absent',
      fuiJourneyId: j.fui ? (j.fui.journeyId === j.journeyId ? 'match' : `other:${j.fui.journeyId}`) : 'n/a',
      fuiOrdinal: j.fui ? j.fui.n : null,
      fuiPayload: j.fuiCheck ? (j.fuiCheck.pass ? 'pass' : `fail:${j.fuiCheck.problems.join(',')}`) : 'n/a',
      fuiPayloadNotChecked: [...(j.fuiCheck?.notChecked ?? []), 'stream-order:stream.connect-not-mirrored-on-android (needs the trace)'],
      fuiWait: j.fuiSeenByStream ? 'stream' : 'timeout-20s',
      process: j.alive ? 'alive' : 'not-running',
    };
    lastCand = j.candidateId;
    ctx.journal?.(j);
  };

  // ---- scenario groups ----
  for (const g of sched.groups) {
    if (ctx.abort) {
      break;
    }
    const mode = g.id === 'early.warm' ? 'warm' : 'cold';
    // R-PROC for every candidate, R-DATA, re-check ART, priming launch per candidate
    await forceStopAll();
    for (const id of ids) {
      const pkg = C[id].c.packageName;
      const clr = await dev.sh(`pm clear ${pkg}`, { timeoutMs: 60000 });
      write(`groups/${g.id}/R-DATA-${C[id].c.token}.txt`, clr.stdout);
      const d = await readDexopt(pkg, `groups/${g.id}/dexopt-after-R-DATA-${C[id].c.token}.txt`);
      if (d.summary === null) {
        C[id].artUnreadable = true;
      } else if (d.summary !== C[id].artCurrent) {
        const again = await applyArt(dev, pkg, (rel, t) => write(`groups/${g.id}/reart-${C[id].c.token}-${rel}`, t), readDexopt, `groups/${g.id}/reart-${C[id].c.token}-dexopt.txt`);
        C[id].artCurrent = again.after.summary;
        log.warn('art.reapplied', { candidate: id, group: g.id, before: d.summary, after: again.after.summary });
      }
    }
    resets[`R-DATA@${g.id}`] = { applied: true, cmd: 'pm clear <pkg>' };
    const firstOrder = [...(g.blocks[0]?.order ?? []), ...(g.debugBlocks?.[0]?.order ?? [])];
    for (const id of (firstOrder.length > 0 ? firstOrder : ids)) {
      if (ctx.abort) {
        break;
      }
      const pj = { journeyId: `${sid4}.${g.id.replace('early.', '')}.prime.${C[id].c.token}`, scenarioId: g.id, candidateId: id, role: 'priming' };
      await launch(pj, { mode: 'cold' });
      await dev.sh(`am force-stop ${C[id].c.packageName}`);
      results.push(pj);
    }
    // blocks (release blocks first, then debug-variant blocks)
    let artBefore = {};
    for (const id of ids) {
      artBefore[id] = (await readDexopt(C[id].c.packageName, `groups/${g.id}/dexopt-b00-${C[id].c.token}.txt`)).summary;
    }
    const blockList = [...g.blocks.map((b) => ({ ...b, set: 'release' })), ...(g.debugBlocks ?? []).map((b) => ({ ...b, set: 'debug' }))];
    for (const b of blockList) {
      const blockJourneys = planned.filter((p) => p.scenarioId === g.id && p.block === b.block && p.blockSet === b.set);
      const tag = `${b.set === 'debug' ? 'd' : 'b'}${String(b.block).padStart(2, '0')}`;
      let rerunIds = null; // attempt 2 re-runs only the candidates whose ART state changed; the others keep attempt 1
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const runList = blockJourneys.filter((p) => rerunIds === null || rerunIds.includes(p.candidateId)).map((p) => ({ ...p, attempt, journeyId: attempt === 1 ? p.journeyId : `${p.journeyId}.a2` }));
        if (!ctx.abort) {
          await thermalSnap(`groups/${g.id}/thermal-${tag}-a${attempt}-start.txt`, { group: g.id, block: tag, attempt, phase: 'block-start' });
          await forceStopAll(); // R-PROC at the start of every block (driver invocation)
        }
        for (const j of runList) {
          if (ctx.abort) {
            results.push(markNotRun(j, ctx.abort));
            continue;
          }
          j.resetProcedures = ['R-PROC@block'];
          if (mode === 'warm' && !(await pidof(C[j.candidateId].c.packageName))) {
            // tool-warmup: one unmeasured launch to FUI that leaves the process alive (retained, not analysed)
            const tw = { journeyId: `${j.journeyId}.tw`, scenarioId: g.id, candidateId: j.candidateId, role: 'tool-warmup', forJourneyId: j.journeyId, block: j.block, blockSet: j.blockSet, attempt };
            await launch(tw, { mode: 'cold' });
            results.push(tw);
          }
          await launch(j, { mode, memory: g.id === 'early.idle-memory', scroll: g.id === 'early.scroll', energy: g.id === 'early.energy' });
          ran += 1;
          results.push(j);
          progress({ planned: planned.length, ran, current: j.journeyId });
        }
        if (ctx.abort) {
          break;
        }
        await thermalSnap(`groups/${g.id}/thermal-${tag}-a${attempt}-end.txt`, { group: g.id, block: tag, attempt, phase: 'block-end' });
        const artAfter = {};
        const changed = [];
        for (const id of ids) {
          artAfter[id] = (await readDexopt(C[id].c.packageName, `groups/${g.id}/dexopt-${tag}-a${attempt}-${C[id].c.token}.txt`)).summary;
          if (artAfter[id] !== null && artBefore[id] !== null && artAfter[id] !== artBefore[id]) {
            changed.push(id);
          }
        }
        for (const j of runList) {
          j.art = { before: artBefore[j.candidateId], after: artAfter[j.candidateId] };
          if (j.art.before === null || j.art.after === null) {
            j.art.unreadable = true;
          }
          if (changed.includes(j.candidateId)) {
            j.failure = { class: 'environment-violation', message: attempt === 1 ? 'art-state-changed' : 'art-state-changed (art-unstable)' };
          }
        }
        if (changed.length === 0 || attempt === 2) {
          artBefore = artAfter;
          break;
        }
        for (const id of changed) {
          const again = await applyArt(dev, C[id].c.packageName, (rel, t) => write(`groups/${g.id}/reart-${tag}-${C[id].c.token}-${rel}`, t), readDexopt, `groups/${g.id}/reart-${tag}-${C[id].c.token}-dexopt.txt`);
          C[id].artCurrent = again.after.summary;
          artAfter[id] = again.after.summary;
        }
        artBefore = artAfter;
        rerunIds = changed;
        log.warn('block.rerun', { group: g.id, block: tag, changed });
      }
    }
  }
  // journeys never reached because of an abort before their group started
  const seen = new Set(results.map((r) => r.journeyId));
  for (const p of planned.filter((x) => !seen.has(x.journeyId))) {
    results.push(markNotRun({ ...p }, ctx.abort ?? 'unknown'));
  }
  env.device.thermalByBlock = physical ? thermalByBlock : null;
  return finish({ planned: planned.length, ran, results, C, builds });
}

// SDK cmdline-tools apkanalyzer: "latest" first, else the highest numbered version.
function findApkanalyzer() {
  const home = process.env.ANDROID_HOME ?? join(homedir(), 'Library', 'Android', 'sdk');
  const root = join(home, 'cmdline-tools');
  if (!existsSync(root)) {
    return null;
  }
  const dirs = readdirSync(root).filter((d) => existsSync(join(root, d, 'bin', 'apkanalyzer')))
    .sort((a, b) => (a === 'latest' ? 1 : (b === 'latest' ? -1 : a.localeCompare(b, 'en', { numeric: true }))));
  return dirs.length > 0 ? join(root, dirs[dirs.length - 1], 'bin', 'apkanalyzer') : null;
}

function cmdlineToolsRevision(apkanalyzer) {
  const p = join(dirname(dirname(apkanalyzer)), 'source.properties');
  const m = existsSync(p) ? /Pkg\.Revision=(\S+)/.exec(readFileSync(p, 'utf8')) : null;
  return `apkanalyzer (cmdline-tools ${m ? m[1] : 'unknown revision'})`;
}

async function apkDownloadEstimate(apkanalyzer, apk, sizeBase, write) {
  const methodId = 'size.android.download_estimate/apkanalyzer-download-size/1';
  if (!apkanalyzer) {
    return makeObservation(sizeBase, { methodId, status: 'unavailable', reason: 'toolchain-missing:apkanalyzer' });
  }
  const r = await run(apkanalyzer, ['apk', 'download-size', apk], { timeoutMs: 120000 });
  const w = write('apkanalyzer-download-size.txt', `${r.stdout}${r.stderr ? `\n# stderr\n${r.stderr}` : ''}`);
  const p = r.code === 0 ? parseApkanalyzerBytes(w.text) : null;
  return p
    ? makeObservation(sizeBase, { methodId, status: 'measured', value: p.bytes, rawRefs: [rawRef(w.file, p.ref)] })
    : makeObservation(sizeBase, { methodId, status: 'failed', failure: { class: 'instrument-error', message: `apkanalyzer exit ${r.code}` } });
}

// Forces the DiskStatsLoggingService job and waits for its cache file to be rewritten, then dumps diskstats.
async function forcedDiskstats(dev, write) {
  const mtime = async () => (await dev.sh('stat -c %Y /data/system/diskstats_cache.json', { timeoutMs: 15000 })).stdout.trim();
  const jobs = (await dev.sh('dumpsys jobscheduler', { timeoutMs: 60000 })).stdout;
  const job = /JOB #\d+\/(-?\d+): \S+ android\/com\.android\.server\.storage\.DiskStatsLoggingService/.exec(jobs)?.[1] ?? null;
  if (!job) {
    write('diskstats-job.txt', 'DiskStatsLoggingService job not found in dumpsys jobscheduler\n');
    return { ok: false, reason: 'diskstats-job-not-found' };
  }
  const m0 = await mtime();
  let m1 = m0;
  const log = [];
  // a forced run is sometimes dropped (seen on a physical API 36 device): up to 3 runs, 45 s each
  for (let attempt = 1; attempt <= 3 && m1 === m0; attempt += 1) {
    const rr = await dev.sh(`cmd jobscheduler run -f android ${job}`, { timeoutMs: 30000 });
    log.push(`run ${attempt}: ${rr.stdout.trim()} (exit ${rr.code})`);
    const deadline = Date.now() + 45000;
    while (m1 === m0 && Date.now() < deadline) {
      await sleep(2000);
      m1 = await mtime();
    }
  }
  write('diskstats-job.txt', `job ${job}\n${log.join('\n')}\ncache mtime before ${m0 || 'absent'} after ${m1 || 'absent'}\n`);
  if (m1 === m0 || !m1) {
    return { ok: false, reason: 'diskstats-cache-not-refreshed (3 forced runs x 45 s)' };
  }
  const d = await dev.sh('dumpsys diskstats', { timeoutMs: 60000 });
  const w = write('diskstats.txt', d.stdout);
  return { ok: true, file: w.file, text: w.text };
}

function installedSizeObservations(ds, pkg, sizeBase) {
  const ids = ['size.android.installed_code/early-diskstats-app-size/1', 'size.android.installed_data/early-diskstats-data-size/1',
    'size.android.installed/early-diskstats-code-plus-data/1'];
  if (!ds.ok) {
    return ids.map((methodId) => makeObservation(sizeBase, { methodId, status: 'failed', failure: { class: 'instrument-error', message: ds.reason } }));
  }
  const p = parseDiskstatsPackage(ds.text, pkg);
  if (!p) {
    return ids.map((methodId) => makeObservation(sizeBase, { methodId, status: 'failed', failure: { class: 'instrument-error', message: 'package not in diskstats' } }));
  }
  const refs = (...k) => [rawRef(ds.file, p.refs.names), ...k.map((x) => rawRef(ds.file, p.refs[x]))];
  return [
    makeObservation(sizeBase, { methodId: ids[0], status: 'measured', value: p.codeBytes, rawRefs: refs('code') }),
    makeObservation(sizeBase, { methodId: ids[1], status: 'measured', value: p.dataBytes, rawRefs: refs('data') }),
    makeObservation(sizeBase, { methodId: ids[2], status: 'measured', value: p.codeBytes + p.dataBytes, rawRefs: refs('code', 'data') }),
  ];
}

const ART_STEPS = [
  'cmd package compile --reset <pkg>',
  'am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE -f 0x00000020 <pkg>/androidx.profileinstaller.ProfileInstallReceiver',
  'cmd package compile -f -m speed-profile <pkg>',
  'am force-stop <pkg>',
  'dumpsys package <pkg> (full output; the "Dexopt state" section is parsed)',
];

// Shell equivalent of Macrobenchmark CompilationMode.Partial(BaselineProfileMode.UseIfAvailable,
// warmupIterations = 0), applied identically to every candidate.
async function applyArt(dev, pkg, write, readDexopt, dexoptRel) {
  const steps = [];
  const cmds = [
    ['reset', `cmd package compile --reset ${pkg}`],
    ['profile-broadcast', `am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE -f 0x00000020 ${pkg}/androidx.profileinstaller.ProfileInstallReceiver`],
    ['compile', `cmd package compile -f -m speed-profile ${pkg}`],
    ['force-stop', `am force-stop ${pkg}`],
  ];
  let broadcastResult = null;
  for (const [name, cmd] of cmds) {
    const r = await dev.sh(cmd, { timeoutMs: 180000 });
    const w = write(`art-${name}.txt`, `${r.stdout}${r.stderr}`);
    if (name === 'profile-broadcast') {
      broadcastResult = parseBroadcastResult(w.text);
    }
    steps.push({ name, code: r.code, output: w.text.trim().split('\n').slice(-1)[0] ?? '' });
  }
  const after = await readDexopt(pkg, dexoptRel);
  return { procedure: 'early.art.partial-use-if-available.shell', steps, profileBroadcastResult: broadcastResult, after };
}

async function finishAndroid({ ctx, env, dev, adbPath, bootedBySession, serial, resets, candidateRecords, allObs, journeysOut, tools, mbStream, stayOnBefore, planned, ran, results, C, builds }) {
  const { log } = ctx;
  await mbStream.stop();
  if (env.device.physical) {
    // safety net: the energy phase restores the charging state itself; never leave the device "unplugged"
    env.device.batteryResetAtEnd = (await dev.sh('dumpsys battery reset', { timeoutMs: 15000 })).code === 0;
  }
  for (const r of candidateRecords.filter((x) => x.status === 'included')) {
    await dev.sh(`am force-stop ${r.packageName}`);
  }
  // restore the stay-awake setting this session changed
  if (/^\d+$/.test(stayOnBefore ?? '')) {
    const r = await dev.sh(`settings put global stay_on_while_plugged_in ${stayOnBefore}`, { timeoutMs: 15000 });
    env.device.stayOnRestored = { to: stayOnBefore, code: r.code };
  } else {
    env.device.stayOnRestored = { to: null, reason: `unreadable original value (${stayOnBefore})` };
  }
  const devEnd = await android.deviceSnapshot(dev);
  env.device.end = devEnd.state;
  const changedSettings = Object.keys(env.deviceSettings ?? {}).filter((k) => devEnd.state.keySettings[k] !== env.deviceSettings[k]);
  env.device.keySettingsChanged = changedSettings;
  if (changedSettings.length > 0) {
    env.limitations.push('device-settings-changed');
  }
  env.device.logcatStreamRestarts = mbStream.restarts();
  const after = await android.listEmulators(adbPath);
  const simBooted = (await ios.listDevices().catch(() => [])).filter((d) => d.state === 'Booted');
  env.otherDevices.end = { adb: after.devices.filter((d) => d.serial !== serial).length, simulatorsBooted: simBooted.length };

  // ---- observations (post-hoc marker classification per candidate and launch kind) ----
  const kindOf = (j) => (j.scenarioId === 'early.warm' && j.role === 'measured' ? 'warm' : 'cold');
  const seenFui = {};
  const seenFd = {};
  const seenFt = {};
  for (const j of results.filter((r) => !r.notRun)) {
    seenFt[j.candidateId] = Boolean(seenFt[j.candidateId] || (j.scroll?.ft?.frames > 0));
    const k = `${j.candidateId}|${kindOf(j)}`;
    seenFui[k] = Boolean(seenFui[k] || j.fui);
    seenFd[k] = Boolean(seenFd[k] || j.fullyDrawn);
  }
  let notAttempted = 0;
  for (const j of results) {
    const x = C[j.candidateId];
    const build = buildRef(x.c, builds, x.buildClass);
    if (j.role !== 'measured') {
      journeysOut.push(journeyRecord(ctx, env, x.c, x.buildClass, j));
      continue;
    }
    const methods = j.scenarioId === 'early.idle-memory' ? A_MEM : (j.scenarioId === 'early.scroll' ? A_SCROLL
      : (j.scenarioId === 'early.energy' ? A_ENERGY : A_START));
    if (j.notRun) {
      notAttempted += 1;
      journeysOut.push(journeyRecord(ctx, env, x.c, x.buildClass, j));
      allObs.push(...notRunObservations(journeyBase(ctx, env, x.c, build, j), methods, j.notRunReason));
      continue;
    }
    const artUnknown = x.artUnreadable || Boolean(j.art?.unreadable);
    j.limitations = artUnknown ? ['art-state-unknown'] : [];
    const base = journeyBase(ctx, env, x.c, build, j);
    const k = `${j.candidateId}|${kindOf(j)}`;
    const diag = j.am?.totalTimeMs ? { [A_START[0]]: j.am.totalTimeMs * 1e6 } : {};
    const cc = crashClass(j.crash);
    let failure = j.failure ?? null;
    if (!failure) {
      if (j.am.code !== 0 || j.am.status !== 'ok' || j.am.errors.length > 0) {
        failure = cc ? { class: cc, message: j.crash[0].text.trim() }
          : { class: 'harness-error', message: `am start failed (code ${j.am.code}, status ${j.am.status})` };
      } else if (cc || !j.alive) {
        failure = { class: cc ?? 'candidate-crash', message: j.crash[0]?.text.trim() ?? 'process not running at journey end' };
      } else if (j.am.launchState !== j.expectedLaunchState) {
        failure = { class: 'harness-error', message: `launch-state-mismatch: ${j.am.launchState}, expected ${j.expectedLaunchState}` };
      } else if (j.fui && !j.fuiCheck.pass) {
        failure = { class: 'functional-mismatch', message: `fui payload: ${j.fuiCheck.problems.join(', ')}` };
      } else if (!j.fui && seenFui[k]) {
        failure = { class: 'timeout', message: 'fui marker not observed within 20 s' };
      }
    }
    j.failure = failure;
    journeysOut.push(journeyRecord(ctx, env, x.c, x.buildClass, j));
    if (failure) {
      allObs.push(...failAll(base, methods, failure, diag));
      continue;
    }
    const lim = j.fui ? [] : ['fui-marker-missing'];
    if (methods === A_ENERGY) {
      allObs.push(...(j.energy ? energyObservations(base, j.energy, lim) : failAll(base, A_ENERGY, { class: 'harness-error', message: 'energy phase did not run' })));
    } else if (methods === A_SCROLL) {
      const sc = j.scroll;
      const windowNs = (sc?.windowMs ?? 0) * 1e6;
      const best = (sc?.sf ?? []).slice().sort((a, b) => b.metrics.frames - a.metrics.frames)[0] ?? null;
      if (!sc || sc.swipesExit !== 0 || !best) {
        allObs.push(...failAll(base, A_SCROLL, { class: 'harness-error', message: !sc ? 'scroll phase did not run' : (best ? `swipe script exit ${sc.swipesExit}` : 'no app layer found in SurfaceFlinger') }));
        continue;
      }
      j.diagnostics.scrollFrameSource = { sfLayer: best.layer, sfFrames: best.metrics.frames, frametimelineFrames: sc.ft?.frames ?? null, frametimelineLayers: sc.ft?.layers ?? null };
      allObs.push(...scrollObservations(base, A_SCROLL_SF, best.metrics, best.summaryRef, { windowNs, refreshNs: best.refreshNs,
        limitations: [...lim, 'sf-latency-polled-during-scroll', /SurfaceView/.test(best.layer) ? 'frame-layer-surfaceview' : 'frame-layer-window'] }));
      if (!sc.ft) {
        allObs.push(...failAll(base, A_SCROLL_FT, { class: 'instrument-error', message: 'perfetto trace missing' }));
      } else if (sc.ft.frames === 0 && !seenFt[j.candidateId]) {
        allObs.push(...A_SCROLL_FT.map((methodId) => makeObservation(base, { methodId, status: 'unavailable',
          reason: `no-frametimeline-surface-frames-for-app-pid (${sc.ft.allSurfaceFrames} surface frames of other processes in the trace; toolkit submits buffers without a frame-timeline vsync id)` })));
      } else {
        allObs.push(...scrollObservations(base, A_SCROLL_FT, sc.ft, sc.ft.summaryRef, { windowNs: windowNs + 4e9, refreshNs: best.refreshNs, limitations: [...lim, 'sf-latency-polled-during-scroll'] }));
      }
    } else if (methods === A_START) {
      allObs.push(j.am.totalTimeMs !== null
        ? makeObservation(base, { methodId: A_START[0], status: 'measured', value: j.am.totalTimeMs * 1e6, limitations: lim, rawRefs: [rawRef(j.am.file, j.am.refs.totalTime)] })
        : makeObservation(base, { methodId: A_START[0], status: 'failed', failure: { class: 'instrument-error', message: 'TotalTime missing' } }));
      if (j.fullyDrawn) {
        allObs.push(makeObservation(base, { methodId: A_START[1], status: 'measured', value: j.fullyDrawn.ms * 1e6, limitations: lim, rawRefs: [rawRef(j.logcatFile, j.fullyDrawn)] }));
      } else if (seenFd[k]) {
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
  const headline = {};
  for (const id of Object.keys(C)) {
    headline[id] = summarizeHeadline(allObs.filter((x) => x.candidateId === id));
  }
  writeJsonl(join(ctx.sdir, 'journeys.jsonl'), journeysOut);
  writeJsonl(join(ctx.sdir, 'observations.jsonl'), allObs);
  if (bootedBySession) {
    const killed = await android.killEmulator(adbPath, serial);
    env.device.shutdownBySession = killed;
    if (killed && process.env.EB_EMU_PID_FILE) {
      rmSync(process.env.EB_EMU_PID_FILE, { force: true });
    }
  }
  log.info('android.finished', { planned, ran, notAttempted });
  return { environment: env, device: { deviceKey: env.deviceKey }, resets, candidateRecords, planned, ran, notAttempted, byStatus: countStatuses(allObs), headline, tools };
}

function writeJsonl(path, rows) {
  writeFileSync(path, SCRUB(rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : '')));
}

function fixturePath(repo, profile) {
  return join(repo, 'fixtures', 'v1', `${profile}.json`);
}

function fixtureInfo(repo, profile) {
  const p = fixturePath(repo, profile);
  if (!existsSync(p)) {
    return null;
  }
  const f = JSON.parse(readFileSync(p, 'utf8'));
  return { version: f.fixtureVersion ?? null, profile: f.profile ?? profile, sha256: sha256(readFileSync(p)),
    profileSource: 'launch config mb.profile' };
}

// startup.process_to_fui from the marker buffer alone: (t[fui] - t[proc.anchor]) + (ws - ps) * 1000 ns.
export function processToFui(j) {
  if (!j.fui || !j.anchor) {
    return { value: null, error: null };
  }
  const a = parsePayload(j.anchor.payload);
  if (!/^\d+$/.test(String(j.fui.t)) || !/^\d+$/.test(String(j.anchor.t)) || !/^\d+$/.test(a.ws ?? '') || !/^\d+$/.test(a.ps ?? '')) {
    return { value: null, error: 'unparsable proc.anchor or fui timestamps' };
  }
  const v = (BigInt(j.fui.t) - BigInt(j.anchor.t)) + (BigInt(a.ws) - BigInt(a.ps)) * 1000n;
  if (BigInt(j.fui.t) < BigInt(j.anchor.t) || BigInt(a.ws) < BigInt(a.ps) || v <= 0n) {
    return { value: null, error: 'non-positive process_to_fui (markers out of order)' };
  }
  return { value: Number(v), error: null };
}

function readFixtureSelection(repo, profile) {
  const p = fixturePath(repo, profile);
  if (!existsSync(p)) {
    return null;
  }
  const f = JSON.parse(readFileSync(p, 'utf8'));
  return Array.isArray(f.selection) ? f.selection.length : null;
}

function summarizeHeadline(obs) {
  const out = {};
  for (const x of obs.filter((y) => y.status === 'measured')) {
    const k = `${x.scenarioId}|${x.methodId}`;
    (out[k] ??= []).push(x.value);
  }
  return Object.fromEntries(Object.entries(out).sort().map(([k, v]) => {
    const d = describe(v);
    return [k, { n: d.n, median: d.median }];
  }));
}

// ======================================================================================================
// iOS simulator
// ======================================================================================================
// Installed bundle bytes (after install), data container bytes (after one unmeasured first launch to FUI + 2 s)
// and the deflate (zip -9) estimate of the frozen .app.
async function iosSizeObservations({ c, f, ins, sizeBase, base, write, udid, stream, o, sdir }) {
  const out = [];
  const lim = ['descriptive-simulator-build'];
  const w1 = `installed app container ${ins.installed?.bytes ?? 'n/a'} bytes in ${ins.installed?.files ?? 'n/a'} files, tree sha256 ${ins.installed?.sha256 ?? 'n/a'}`;
  const f1 = write(`${base}/installed-app-bytes.txt`, `${w1}\n`).file;
  out.push(ins.installed ? makeObservation(sizeBase, { methodId: 'size.ios.simulator_installed_app/app-container-file-bytes/1', status: 'measured',
    value: ins.installed.bytes, limitations: lim, rawRefs: [{ file: f1, line: 1, text: w1 }] })
    : makeObservation(sizeBase, { methodId: 'size.ios.simulator_installed_app/app-container-file-bytes/1', status: 'failed', failure: { class: 'instrument-error', message: 'app container unreadable' } }));
  const jid = `size-first-${c.token}`;
  const lr = await ios.simctl(['launch', udid, c.bundleId, '-mb.journey', jid, '-mb.journeyMode', '1', '-mb.profile', o.profile], { timeoutMs: 60000 });
  const fui = lr.code === 0 ? await stream.waitFor((e) => e.journeyId === jid && e.event === 'fui', 30000) : null;
  await sleep(2000);
  await ios.simctl(['terminate', udid, c.bundleId], { timeoutMs: 30000 });
  await sleep(1000);
  const data = existsSync(ins.dataPath) ? sha256Tree(ins.dataPath) : null;
  const w2 = `data container after first launch (fui seen ${Boolean(fui)}): ${data?.bytes ?? 'n/a'} bytes in ${data?.files ?? 'n/a'} files`;
  const f2 = write(`${base}/data-container-bytes.txt`, `${w2}\n`).file;
  out.push(data && fui ? makeObservation(sizeBase, { methodId: 'size.ios.simulator_data_container/data-container-file-bytes/1', status: 'measured',
    value: data.bytes, limitations: lim, rawRefs: [{ file: f2, line: 1, text: w2 }] })
    : makeObservation(sizeBase, { methodId: 'size.ios.simulator_data_container/data-container-file-bytes/1', status: 'failed',
      failure: { class: data ? 'timeout' : 'instrument-error', message: data ? 'fui not observed on the first launch' : 'data container unreadable' } }));
  const tmp = join(sdir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  const zipPath = join(tmp, `${c.token}.zip`);
  rmSync(zipPath, { force: true });
  const z = await run('sh', ['-c', 'cd "$1" && /usr/bin/zip -r -9 -X -y -q "$2" "$3"', 'sh', dirname(f.absFrozen), zipPath, f.absFrozen.split('/').pop()], { timeoutMs: 300000 });
  const zipBytes = z.code === 0 && existsSync(zipPath) ? readFileSync(zipPath).length : null;
  rmSync(tmp, { recursive: true, force: true });
  const w3 = `zip -r -9 -X -y of the frozen .app: ${zipBytes ?? 'n/a'} bytes (exit ${z.code}; descriptive estimate, not the App Store thinned size)`;
  const f3 = write(`${base}/app-deflate-bytes.txt`, `${w3}\n${z.stderr}`).file;
  out.push(zipBytes !== null ? makeObservation(sizeBase, { methodId: 'size.ios.simulator_app_deflate_estimate/zip-9-bytes/1', status: 'measured',
    value: zipBytes, limitations: [...lim, 'descriptive-estimate-not-app-store-size'], rawRefs: [{ file: f3, line: 1, text: w3 }] })
    : makeObservation(sizeBase, { methodId: 'size.ios.simulator_app_deflate_estimate/zip-9-bytes/1', status: 'failed', failure: { class: 'instrument-error', message: `zip exit ${z.code}` } }));
  return out;
}
const I_START = ['startup.process_to_fui/early-ios-markers/1'];
const I_MEM = ['memory.ios.phys_footprint/early-mem-marker-background/1'];
const BACKGROUND_APP = 'com.apple.Preferences';

async function runIos(ctx, { selected, builds, schedule, sid4, hostStart, progress, tokenOf }) {
  const { o, log, rawDir, redactor } = ctx;
  const resets = {};
  const write = rawWriter(ctx);
  const tools = { xcodebuild: await ios.xcodeVersion() };
  const devices = await ios.listDevices();
  let dev = devices.find((d) => d.name === o.simName && d.runtime === o.simRuntime && d.isAvailable);
  if (!dev && devices.some((d) => d.name === o.simName)) {
    return { notStarted: `simulator-name-exists-on-other-runtime:${o.simName}`, planned: 0, ran: 0, tools };
  }
  if (dev && dev.deviceTypeIdentifier && dev.deviceTypeIdentifier !== o.simType) {
    return { notStarted: `simulator-device-type-mismatch:${dev.deviceTypeIdentifier}`, planned: 0, ran: 0, tools };
  }
  const probe = async () => {
    const list = await ios.listDevices();
    const booted = list.filter((d) => d.state === 'Booted' && d.udid !== dev?.udid);
    const adbDevs = await android.listEmulators(tool('adb')).catch(() => ({ devices: [] }));
    return { count: booted.length + adbDevs.devices.length, simulatorsBooted: booted.length, adb: adbDevs.devices.length, summary: { simulatorsBooted: booted.length, adb: adbDevs.devices.length } };
  };
  const other = await checkOtherDevices(o, probe, log);
  const otherStart = { simulatorsBooted: other.simulatorsBooted, adb: other.adb, policy: o.otherDevices };
  if (!other.proceed) {
    return { notStarted: `other-devices-running (simulators ${other.simulatorsBooted}, adb ${other.adb})`, planned: 0, ran: 0, tools };
  }
  let created = false;
  const runtime = await ios.runtimeInfo(o.simRuntime);
  if (!runtime || !runtime.isAvailable) {
    return { notStarted: `simulator-runtime-unavailable:${o.simRuntime}`, planned: 0, ran: 0, tools };
  }
  if (!dev) {
    const type = o.simType;
    if (!type || !runtime.supportedDeviceTypes.includes(type)) {
      return { notStarted: `simulator-device-type-unsupported:${type ?? 'none'}`, planned: 0, ran: 0, tools };
    }
    const r = await ios.simctl(['create', o.simName, type, o.simRuntime], { timeoutMs: 120000 });
    if (r.code !== 0) {
      return { notStarted: `simulator-create-failed: ${redactor.scrub(r.stderr.trim())}`, planned: 0, ran: 0, tools };
    }
    created = true;
    dev = (await ios.listDevices()).find((d) => d.udid === r.stdout.trim());
  }
  const udid = dev.udid;
  redactor.add(udid, '<udid>');
  let bootedBySession = false;
  if (dev.state !== 'Booted') {
    const b0 = Date.now();
    const r = await ios.simctl(['boot', udid], { timeoutMs: 180000 });
    if (r.code !== 0) {
      return { fatal: `simulator-boot-failed: ${redactor.scrub(r.stderr.trim())}`, planned: 0, ran: 0, tools };
    }
    bootedBySession = true;
    if (process.env.EB_SIM_BOOTED_FILE) {
      writeFileSync(process.env.EB_SIM_BOOTED_FILE, `${udid}\n`);
    }
    await ios.waitBooted(udid, 300000);
    await sleep(5000);
    resets['R-BOOT'] = { applied: true, bootS: Math.round((Date.now() - b0) / 1000), cmd: 'xcrun simctl boot' };
  } else {
    resets['R-BOOT'] = { applied: false, reason: 'reused booted simulator' };
  }
  const deviceKey = hashedId('d', udid, ctx.sessionId);
  const comparability = {
    environmentClass: 'simulator', platform: 'ios', deviceType: dev.deviceTypeIdentifier ?? null,
    runtime: runtime ? `${runtime.version} (${runtime.buildversion})` : o.simRuntime, xcode: tools.xcodebuild, host: hostStart.identity,
  };
  const env = {
    key: environmentKey(comparability), class: 'simulator', platform: 'ios', deviceKey,
    limitations: envLimitationsFromHost(hostStart, otherStart),
    comparabilityKey: comparability, deviceSettings: null,
    host: { key: hostKey(hostStart.identity), identity: hostStart.identity, start: hostStart.state, end: null },
    device: { identity: { deviceType: comparability.deviceType, runtime, xcode: tools.xcodebuild, name: o.simName }, createdBySession: created,
      bootedBySession, refreshRate: null, refreshRateReason: 'no host-side source for the simulated display rate in the early runner',
      layoutReference: null, layoutReferenceReason: 'calibration app not built yet (no h_ref)',
      start: { capturedAt: isoNow(), state: 'Booted' }, end: null },
    otherDevices: { start: otherStart, end: null },
  };
  ctx.checkpoint?.({ environment: env });
  const stream = ios.startLogStream(udid, join(rawDir, 'oslog-stream.ndjson'), (s) => redactor.scrub(s));
  await sleep(2500);

  // R-INSTALL / R-DATA: uninstall, install the frozen copy, verify the installed bundle (mismatch is fatal)
  const installFresh = async (c, f, rel) => {
    await ios.simctl(['uninstall', udid, c.bundleId], { timeoutMs: 60000 });
    const inst = await ios.simctl(['install', udid, f.absFrozen], { timeoutMs: 180000 });
    write(`${rel}/install.txt`, `${inst.stdout}${inst.stderr}`);
    const appPath = (await ios.simctl(['get_app_container', udid, c.bundleId, 'app'])).stdout.trim();
    const dataPath = (await ios.simctl(['get_app_container', udid, c.bundleId, 'data'])).stdout.trim();
    redactor.add(dataPath, '<data-container>');
    redactor.add(appPath, '<app-container>');
    const installed = appPath && existsSync(appPath) ? sha256Tree(appPath) : null;
    const verified = installed?.sha256 === f.sha256;
    write(`${rel}/install-verify.txt`, `installed bundle tree sha256 ${installed?.sha256 ?? 'n/a'}\nfrozen artifact tree sha256 ${f.sha256}\nmatch ${verified}\n`);
    if (inst.code !== 0 || !dataPath) {
      return { ok: false, reason: 'install-failed' };
    }
    if (!verified) {
      return { ok: false, reason: 'installed-artifact-mismatch' };
    }
    return { ok: true, dataPath, appPath, installed };
  };

  const C = {};
  const candidateRecords = [];
  const allObs = [];
  const journeysOut = [];
  for (const c of selected) {
    const f = builds[c.id].frozen[0];
    const base = `setup/${c.token}`;
    const buildClass = c.declaredBuildClass;
    const ins = await installFresh(c, f, base);
    if (!ins.ok) {
      candidateRecords.push({ id: c.id, status: 'not-measured', reason: ins.reason });
      continue;
    }
    C[c.id] = { c, buildClass, dataPath: ins.dataPath, f };
    const build = buildRef(c, builds, buildClass);
    candidateRecords.push({
      id: c.id, status: 'included', bundleId: c.bundleId, variant: c.variant, buildClass, buildClassSource: c.buildClassSource,
      family: c.family, architectureClass: c.architectureClass, buildId: builds[c.id].buildId,
      artifacts: builds[c.id].frozen.map(({ absFrozen, ...rest }) => rest), buildInputs: c.buildInputs,
      provenance: builds[c.id].prov, versions: c.versions, candidateJson: c.candidateJson, overridesApplied: c.overridesApplied,
      streamSource: c.streamSource, streamSourceBasis: c.streamSourceBasis, instrumentationId: c.instrumentationId,
      verified: c.verified, installVerified: true,
      limitations: c.limitations,
    });
    const sizeBase = journeyBase(ctx, env, c, build, { buildId: builds[c.id].buildId, scenarioId: 'early.size' });
    const sizeLine = `app ${f.bytes} bytes in ${f.files} files, tree sha256 ${f.sha256}`;
    const sizeFile = write(`${base}/artifact-sizes.txt`, `${sizeLine}\n`).file;
    allObs.push(makeObservation(sizeBase, { methodId: 'size.ios.simulator_app/app-dir-file-bytes/1', status: 'measured', value: f.bytes,
      limitations: ['descriptive-simulator-build'], rawRefs: [{ file: sizeFile, line: 1, text: sizeLine }] }));
    allObs.push(...(await iosSizeObservations({ c, f, ins, sizeBase, base, write, udid, stream, o, sdir: ctx.sdir })));
  }
  resets['R-INSTALL'] = { applied: true, verify: 'tree sha256 of the installed bundle == frozen copy (mismatch: candidate not measured)' };
  resets['R-ART'] = { applied: false, reason: 'not applicable on iOS (no OS-controlled compilation state for app code)' };
  const ids = Object.keys(C);
  const keep = (b) => ({ ...b, order: b.order.filter((x) => C[x]) });
  const sched = { ...schedule, groups: schedule.groups.map((g) => ({ ...g, blocks: g.blocks.map(keep), debugBlocks: (g.debugBlocks ?? []).map(keep) })) };
  const planned = plannedJourneys(sched, sid4, tokenOf);
  progress({ planned: planned.length, ran: 0 });

  const fixtureSel = readFixtureSelection(o.repo, o.profile);
  let lastCand = null;
  let ran = 0;
  const results = [];
  const terminateAll = async () => {
    for (const id of ids) {
      await ios.simctl(['terminate', udid, C[id].c.bundleId], { timeoutMs: 30000 });
    }
  };
  const launch = async (j, { memory = false }) => {
    const x = C[j.candidateId];
    const bid = x.c.bundleId;
    const jdir = `journeys/${j.journeyId}`;
    j.rawFiles = [];
    j.diagnostics = {};
    j.resetProcedures = [...(j.resetProcedures ?? []), 'R-PROC'];
    j.launchConfig = { 'mb.journey': j.journeyId, 'mb.journeyMode': '1', 'mb.profile': o.profile };
    await ios.simctl(['terminate', udid, bid], { timeoutMs: 30000 });
    await sleep(2000);
    j.previousCandidateId = lastCand;
    j.startedAt = isoNow();
    const t0 = process.hrtime.bigint();
    const lr = await ios.simctl(['launch', udid, bid, '-mb.journey', j.journeyId, '-mb.journeyMode', '1', '-mb.profile', o.profile], { timeoutMs: 60000 });
    const t1 = process.hrtime.bigint();
    const runnerW = write(`${jdir}/runner.txt`, `t0_uptime_raw_ns=${t0}\nlaunch_returned_uptime_raw_ns=${t1}\nlaunch_exit=${lr.code}\nlaunch_stdout=${lr.stdout.trim()}\n`);
    j.rawFiles.push(runnerW.file);
    j.launchCode = lr.code;
    j.pid = parseSimctlLaunch(lr.stdout);
    const fuiLine = lr.code === 0 ? await stream.waitFor((e) => e.journeyId === j.journeyId && e.event === 'fui', 30000) : null;
    j.fuiControl = Boolean(fuiLine);
    await sleep(2000);
    if (memory) {
      await sleep(o.idleS * 1000);
    }
    j.alive = j.pid ? (() => {
      try {
        process.kill(j.pid, 0);
        return true;
      } catch {
        return false;
      }
    })() : false;
    // background checkpoint: BenchKit flushes its buffer (and writes mem) on didEnterBackground
    await ios.simctl(['launch', udid, BACKGROUND_APP], { timeoutMs: 30000 });
    await sleep(3000);
    const mfile = join(x.dataPath, 'Library', 'Caches', 'mobilebench', `markers-${j.journeyId}.jsonl`);
    const mW = write(`${jdir}/markers.jsonl`, existsSync(mfile) ? readFileSync(mfile, 'utf8') : '');
    j.markersFile = mW.file;
    j.rawFiles.push(mW.file);
    const lines = stream.forJourney(j.journeyId).map((e) => e.raw);
    j.rawFiles.push(write(`${jdir}/oslog.ndjson`, lines.join('\n') + (lines.length ? '\n' : '')).file);
    const markers = parseMarkersJsonl(mW.text);
    j.fui = markers.find((m) => m.event === 'fui' && m.n === 1) ?? null;
    j.anchor = markers.find((m) => m.event === 'proc.anchor') ?? null;
    j.fuiCheck = j.fui ? checkFuiPayload(j.fui.payload, fixtureSel, { hRef: null }) : null;
    j.streamOrder = streamConnectBeforeFui(markers);
    const mems = markers.filter((m) => m.event === 'mem');
    j.mem = mems.length > 0 ? mems[mems.length - 1] : null;
    await ios.simctl(['terminate', udid, bid], { timeoutMs: 30000 });
    await ios.simctl(['terminate', udid, BACKGROUND_APP], { timeoutMs: 30000 });
    j.endedAt = isoNow();
    j.checks = {
      fuiControlLine: j.fuiControl ? 'present' : 'absent', fuiMarker: j.fui ? 'present' : 'absent',
      fuiPayload: j.fuiCheck ? (j.fuiCheck.pass ? 'pass' : `fail:${j.fuiCheck.problems.join(',')}`) : 'n/a',
      fuiPayloadNotChecked: j.fuiCheck?.notChecked ?? [],
      streamConnectAfterFui: j.streamOrder.pass === null ? 'n/a' : (j.streamOrder.pass ? 'pass' : 'fail'),
      process: j.alive ? 'alive' : 'not-running',
    };
    lastCand = j.candidateId;
    ctx.journal?.(j);
  };

  const dataFailed = {};
  for (const g of sched.groups) {
    if (ctx.abort) {
      break;
    }
    await terminateAll();
    // R-DATA before each group: uninstall + install + verify
    for (const id of ids) {
      const ins = await installFresh(C[id].c, C[id].f, `groups/${g.id}/R-DATA-${C[id].c.token}`);
      dataFailed[`${g.id}|${id}`] = ins.ok ? null : ins.reason;
      if (ins.ok) {
        C[id].dataPath = ins.dataPath;
      }
    }
    resets[`R-DATA@${g.id}`] = { applied: true, cmd: 'xcrun simctl uninstall + install + verify' };
    const live = ids.filter((id) => !dataFailed[`${g.id}|${id}`]);
    const firstOrder = [...(g.blocks[0]?.order ?? []), ...(g.debugBlocks?.[0]?.order ?? [])].filter((id) => live.includes(id));
    for (const id of firstOrder) {
      if (ctx.abort) {
        break;
      }
      const pj = { journeyId: `${sid4}.${g.id.replace('early.', '')}.prime.${C[id].c.token}`, scenarioId: g.id, candidateId: id, role: 'priming' };
      await launch(pj, {});
      results.push(pj);
    }
    const blockList = [...g.blocks.map((b) => ({ ...b, set: 'release' })), ...(g.debugBlocks ?? []).map((b) => ({ ...b, set: 'debug' }))];
    for (const b of blockList) {
      if (!ctx.abort) {
        await terminateAll(); // R-PROC at the start of every block
      }
      for (const p of planned.filter((x) => x.scenarioId === g.id && x.block === b.block && x.blockSet === b.set)) {
        const j = { ...p, resetProcedures: ['R-PROC@block'] };
        if (ctx.abort) {
          results.push(markNotRun(j, ctx.abort));
          continue;
        }
        if (dataFailed[`${g.id}|${j.candidateId}`]) {
          j.notRun = true;
          j.notRunReason = `setup-failed:R-DATA:${dataFailed[`${g.id}|${j.candidateId}`]}`;
          results.push(j);
          continue;
        }
        await launch(j, { memory: g.id === 'early.idle-memory' });
        ran += 1;
        results.push(j);
        progress({ planned: planned.length, ran, current: j.journeyId });
      }
    }
  }
  const seenIds = new Set(results.map((r) => r.journeyId));
  for (const p of planned.filter((x) => !seenIds.has(x.journeyId))) {
    results.push(markNotRun({ ...p }, ctx.abort ?? 'unknown'));
  }
  await stream.stop();

  const seenFui = {};
  const seenCtl = {};
  const seenMem = {};
  const seenAnchor = {};
  for (const j of results.filter((r) => !r.notRun)) {
    seenAnchor[j.candidateId] = Boolean(seenAnchor[j.candidateId] || j.anchor);
    seenFui[j.candidateId] = Boolean(seenFui[j.candidateId] || j.fui);
    seenCtl[j.candidateId] = Boolean(seenCtl[j.candidateId] || j.fuiControl);
    seenMem[j.candidateId] = Boolean(seenMem[j.candidateId] || j.mem);
  }
  let notAttempted = 0;
  for (const j of results) {
    const x = C[j.candidateId];
    const build = buildRef(x.c, builds, x.buildClass);
    const base = journeyBase(ctx, env, x.c, build, j);
    const methods = j.scenarioId === 'early.idle-memory' ? I_MEM : I_START;
    if (j.role === 'measured' && j.notRun) {
      notAttempted += 1;
      journeysOut.push(journeyRecord(ctx, env, x.c, x.buildClass, j));
      allObs.push(...notRunObservations(base, methods, j.notRunReason));
      continue;
    }
    let failure = j.failure ?? null;
    if (j.role === 'measured' && !failure) {
      if (j.launchCode !== 0 || !j.pid) {
        failure = { class: 'harness-error', message: `simctl launch failed (exit ${j.launchCode})` };
      } else if (!j.alive) {
        failure = { class: 'candidate-crash', message: 'process not running at journey end' };
      } else if (!j.fuiControl && seenCtl[j.candidateId]) {
        failure = { class: 'timeout', message: 'fui control line not observed within 30 s' };
      } else if (j.fui && !j.fuiCheck.pass) {
        failure = { class: 'functional-mismatch', message: `fui payload: ${j.fuiCheck.problems.join(', ')}` };
      } else if (j.streamOrder?.pass === false) {
        failure = { class: 'functional-mismatch', message: `stream.connect before fui (markers line ${j.streamOrder.ref.line})` };
      }
      j.failure = failure;
    }
    journeysOut.push(journeyRecord(ctx, env, x.c, x.buildClass, j));
    if (j.role !== 'measured') {
      continue;
    }
    if (failure) {
      allObs.push(...failAll(base, methods, failure));
      continue;
    }
    if (methods === I_START) {
      const p2f = processToFui(j);
      if (p2f.value !== null) {
        allObs.push(makeObservation(base, { methodId: I_START[0], status: 'measured', value: p2f.value,
          rawRefs: [rawRef(j.markersFile, j.anchor), rawRef(j.markersFile, j.fui)] }));
      } else if (p2f.error) {
        allObs.push(makeObservation(base, { methodId: I_START[0], status: 'failed', failure: { class: 'instrument-error', message: p2f.error } }));
      } else if (seenFui[j.candidateId] && seenAnchor[j.candidateId]) {
        allObs.push(makeObservation(base, { methodId: I_START[0], status: 'failed', failure: { class: 'instrument-error', message: 'fui or proc.anchor missing from the marker buffer' } }));
      } else {
        allObs.push(makeObservation(base, { methodId: I_START[0], status: 'unavailable', reason: seenFui[j.candidateId] ? 'marker-missing:proc.anchor' : 'marker-missing:fui' }));
      }
    } else {
      const p = j.mem ? parsePayload(j.mem.payload) : null;
      if (p && /^\d+$/.test(p.fp ?? '')) {
        allObs.push(makeObservation(base, { methodId: I_MEM[0], status: 'measured', value: Number(p.fp), limitations: ['simulator-host-process'], rawRefs: [rawRef(j.markersFile, j.mem)] }));
      } else if (seenMem[j.candidateId]) {
        allObs.push(makeObservation(base, { methodId: I_MEM[0], status: 'failed', failure: { class: 'instrument-error', message: 'mem marker missing' } }));
      } else {
        allObs.push(makeObservation(base, { methodId: I_MEM[0], status: 'unavailable', reason: 'marker-missing:mem' }));
      }
    }
  }
  const headline = {};
  for (const id of ids) {
    headline[id] = summarizeHeadline(allObs.filter((x) => x.candidateId === id));
  }
  writeJsonl(join(ctx.sdir, 'journeys.jsonl'), journeysOut);
  writeJsonl(join(ctx.sdir, 'observations.jsonl'), allObs);
  const endDevices = await ios.listDevices();
  env.otherDevices.end = { simulatorsBooted: endDevices.filter((d) => d.state === 'Booted' && d.udid !== udid).length };
  env.device.end = { capturedAt: isoNow(), state: endDevices.find((d) => d.udid === udid)?.state ?? null };
  if (bootedBySession) {
    await ios.simctl(['shutdown', udid], { timeoutMs: 120000 });
    env.device.shutdownBySession = true;
    if (process.env.EB_SIM_BOOTED_FILE) {
      rmSync(process.env.EB_SIM_BOOTED_FILE, { force: true });
    }
  }
  return { environment: env, device: { deviceKey }, resets, candidateRecords, planned: planned.length, ran, notAttempted, byStatus: countStatuses(allObs), headline, tools };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
