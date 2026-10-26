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
import { LABELS, NOT_COLLECTED, SCENARIOS } from './lib/methods.mjs';
import { describe } from './lib/stats.mjs';
import { JOURNEY_SCHEMA, journeyStatus, makeObservation, notAttemptedReason, rawRef } from './lib/records.mjs';
import {
  checkFuiPayload, crashClass, findCrash, parseAmStart, parseBadging, parseBroadcastResult, parseDexopt, parseDisplayed,
  parseFullyDrawn, parseMarkersJsonl, parseMbLogcat, parseMeminfo, parsePayload, parseProcStatus,
  parseResolveActivity, parseSimctlLaunch, streamConnectBeforeFui,
} from './lib/parse.mjs';
import * as android from './lib/android.mjs';
import * as ios from './lib/ios.mjs';
import { verifyAcceptanceReceipt } from '../acceptance/lib.mjs';

export const TOOL_VERSION = '0.2.0';
const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: node session.mjs --platform android|ios --repo <repo> --out <sessions dir> --artifacts <frozen dir>
  --candidates a,b --run-id <id> [--design <path>] [options]
options:
  --journeys <n>           journeys per candidate for each startup scenario (default 10)
  --memory-journeys <n>    journeys per candidate for idle memory (default: --journeys)
  --idle-s <s>             idle time on List before the memory read (default 30)
  --profile <name>         fixture profile passed as mb.profile (default representative)
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
      profile: { type: 'string', default: 'representative' },
      seed: { type: 'string' }, 'budget-min': { type: 'string', default: '30' }, 'watchdog-min': { type: 'string', default: '35' },
      anchor: { type: 'string', default: 'native' }, 'pooled-n': { type: 'string' }, overrides: { type: 'string' },
      'expect-artifact': { type: 'string', multiple: true, default: [] }, 'other-devices': { type: 'string', default: 'abort' },
      'acceptance-receipt': { type: 'string', multiple: true, default: [] },
      'other-devices-wait-s': { type: 'string', default: '120' },
      avd: { type: 'string', default: 'mobilebench_api37' }, 'sim-name': { type: 'string', default: 'mobilebench-iphone' },
      'sim-runtime': { type: 'string', default: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0' },
      'sim-type': { type: 'string', default: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' },
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
    profile: values.profile,
    seed: values.seed === undefined ? randomBytes(4).readUInt32BE(0) : int('seed', 0, 4294967295),
    budgetMin: int('budget-min', 1, 120),
    watchdogMin: int('watchdog-min', 1, 180),
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
    planOnly: values['plan-only'],
  };
}

// ---------- time estimates (seconds) used only for the budget plan ----------
// Android per candidate: setup (install, ART) 40; priming 10 per group; cold journey 8; warm journey 13 (its
// tool-warmup launch included); memory journey idle + 12; 1.5 per block for R-PROC and the dexopt read.
export function estimate(platform, { journeys, memoryJourneys, idleS }) {
  if (platform === 'android') {
    const groups = 2 + (memoryJourneys > 0 ? 1 : 0);
    const blocks = 2 * journeys + memoryJourneys;
    const perCandidate = 40 + groups * 10 + journeys * 8 + journeys * 13 + memoryJourneys * (idleS + 12) + blocks * 1.5;
    return { overheadS: 150 + 60, perCandidateS: perCandidate };
  }
  const groups = 1 + (memoryJourneys > 0 ? 1 : 0);
  const blocks = journeys + memoryJourneys;
  const perCandidate = 25 + groups * 20 + journeys * 16 + memoryJourneys * (idleS + 18) + blocks * 1;
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
  const ctx = { abort: null, sessionFailed: null, o, sessionId, sdir, rawDir, log, redactor, fixture: fixtureInfo(o.repo, o.profile) };

  // ---- candidates, artifacts, provenance (no device) ----
  const resolved = o.candidates.map((id) => resolveCandidate({ repo: o.repo, id, platform: o.platform, overrides: o.overrides }));
  const usable = [];
  const candidateRecords = [];
  for (const c of resolved) {
    if (!c.ok) {
      candidateRecords.push({ id: c.id, status: c.status ?? 'not-measured', reason: c.reason, ...(c.hint ? { hint: c.hint } : {}) });
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
      acceptance: { sha256: acceptance.sha256, suiteId: acceptance.receipt.suiteId },
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
    memoryJourneysPerCandidate: o.memoryJourneys, idleS: o.idleS, profile: o.profile, seed: o.seed,
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
    environmentClass: o.platform === 'android' ? 'emulator' : 'simulator',
    status: 'running', failureReason: null, startedAt, endedAt: null, lockAcquiredAt: o.lockAcquiredAt,
    design: { sha256: o.designSha256, ref: o.designRef },
    verification: { note: o.verificationNote, candidatesRequested: o.candidates,
      expectedArtifacts: Object.fromEntries(Object.entries(o.expect).map(([k, v]) => [k, v.text])),
      acceptanceReceipts: Object.fromEntries(selected.map((c) => [c.id, c.acceptance])) },
    tool: { name: 'early-bench', version: TOOL_VERSION, source: toolSource() },
    source: ident.source,
    schedule: { file: 'schedule.json', sha256: sha256(readFileSync(join(sdir, 'schedule.json'))) },
    launchConfigBase: { 'mb.journeyMode': '1', 'mb.profile': o.profile },
    watchdog: { softMin: o.watchdogMin, hardStop: 'caller (lock wrapper): SIGTERM, then SIGKILL after a grace period' },
    plan, fixture: ctx.fixture, notCollected: NOT_COLLECTED[o.platform],
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
    buildClass, environmentClass: env.class, environmentRef: env.key, streamSource: c.streamSource, fixture: ctx.fixture,
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
  const resets = {};
  const write = rawWriter(ctx);
  const tools = {
    adb: await firstLine(adbPath, ['version'], 2),
    emulator: await firstLine(emulatorPath, ['-version'], 1),
    aapt2: aapt2 ? await firstLine(aapt2, ['version'], 1) : null,
  };

  // ---- device: reuse a running mobilebench AVD, else cold-boot it ----
  const before = await android.listEmulators(adbPath);
  for (const d of before.devices) {
    redactor.add(d.serial, hashedId('serial', d.serial, ctx.sessionId));
  }
  write('setup/adb-devices-start.txt', before.raw);
  let serial = before.devices.find((d) => d.avd === o.avd && d.state === 'device')?.serial ?? null;
  const probe = async () => {
    const list = await android.listEmulators(adbPath);
    const foreign = list.devices.filter((d) => d.serial !== serial);
    const sims = (await ios.listDevices().catch(() => [])).filter((d) => d.state === 'Booted');
    return { count: foreign.length + sims.length, adb: foreign.length, simulatorsBooted: sims.length, summary: { adb: foreign.length, simulatorsBooted: sims.length } };
  };
  const other = await checkOtherDevices(o, probe, log);
  const otherDevicesStart = { adb: other.adb, simulatorsBooted: other.simulatorsBooted, policy: o.otherDevices };
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
  const cmdline = bootedBySession ? null : await android.emulatorCmdlineFlags(o.avd);
  const gpuMode = bootedBySession ? 'host' : (cmdline?.gpu ?? 'unknown');
  const effective = bootedBySession
    ? { cores: intOrNull(bootFlags[bootFlags.indexOf('-cores') + 1]), memoryMb: intOrNull(bootFlags[bootFlags.indexOf('-memory') + 1]), source: 'boot flags of this session' }
    : { cores: intOrNull(cmdline?.cores) ?? intOrNull(avdCfg?.['hw.cpu.ncore']), memoryMb: intOrNull(cmdline?.memory) ?? intOrNull(avdCfg?.['hw.ramSize']),
      source: cmdline?.cores || cmdline?.memory ? 'emulator command line (missing flags from config.ini)' : 'AVD config.ini (no -cores / -memory on the command line)' };

  // device preparation (recorded and restored): screen on and awake for the whole session
  const stayOnBefore = (await dev.sh('settings get global stay_on_while_plugged_in', { timeoutMs: 15000 })).stdout.trim();
  const prep = [];
  for (const cmd of ['svc power stayon true', 'input keyevent KEYCODE_WAKEUP', 'wm dismiss-keyguard']) {
    const r = await dev.sh(cmd, { timeoutMs: 15000 });
    prep.push({ cmd, code: r.code });
  }
  const devStart = await android.deviceSnapshot(dev);
  const comparability = {
    environmentClass: 'emulator', platform: 'android', avd: o.avd, avdHardware: avdCfg, gpuMode,
    emulatorCores: effective.cores, emulatorMemoryMb: effective.memoryMb, deviceCpuCount: devStart.identity.cpuCount,
    emulatorVersion: tools.emulator, fingerprint: devStart.identity.props['ro.build.fingerprint'],
    wmSize: devStart.identity.wmSize, wmDensity: devStart.identity.wmDensity, deviceSettings: devStart.state.keySettings,
    host: hostStart.identity,
  };
  const env = {
    key: environmentKey(comparability), class: 'emulator', platform: 'android', deviceKey,
    limitations: envLimitationsFromHost(hostStart, otherDevicesStart),
    comparabilityKey: comparability, deviceSettings: devStart.state.keySettings,
    host: { key: hostKey(hostStart.identity), identity: hostStart.identity, start: hostStart.state, end: null },
    device: { identity: devStart.identity, start: devStart.state, end: null, avdHardware: avdCfg, emulatorVersion: tools.emulator,
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
    const bad = badging ? parseBadging(badging.stdout) : { debuggable: null, packageName: null };
    if (badging) {
      write(`${base}/badging.txt`, badging.stdout);
    }
    const buildClass = bad.debuggable === null ? (c.declaredBuildClass ?? 'unknown') : (bad.debuggable ? 'debug' : 'release');
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
      streamSource: c.streamSource, streamSourceBasis: c.streamSourceBasis, verified: c.verified,
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
    if (!builds[c.id].frozen.some((x) => x.kind === 'aab')) {
      allObs.push(makeObservation(sizeBase, { methodId: 'size.android.aab/file-bytes/1', status: 'not-measured', reason: 'artifact-not-provided' }));
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
  const launch = async (j, { mode, memory = false }) => {
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
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const runList = blockJourneys.map((p) => ({ ...p, attempt, journeyId: attempt === 1 ? p.journeyId : `${p.journeyId}.a2` }));
        if (!ctx.abort) {
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
          await launch(j, { mode, memory: g.id === 'early.idle-memory' });
          ran += 1;
          results.push(j);
          progress({ planned: planned.length, ran, current: j.journeyId });
        }
        if (ctx.abort) {
          break;
        }
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
        log.warn('block.rerun', { group: g.id, block: tag, changed });
      }
    }
  }
  // journeys never reached because of an abort before their group started
  const seen = new Set(results.map((r) => r.journeyId));
  for (const p of planned.filter((x) => !seen.has(x.journeyId))) {
    results.push(markNotRun({ ...p }, ctx.abort ?? 'unknown'));
  }
  return finish({ planned: planned.length, ran, results, C, builds });
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
  for (const j of results.filter((r) => !r.notRun)) {
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
    const methods = j.scenarioId === 'early.idle-memory' ? A_MEM : A_START;
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
    if (methods === A_START) {
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
    return { ok: true, dataPath };
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
      streamSource: c.streamSource, streamSourceBasis: c.streamSourceBasis, verified: c.verified, installVerified: true,
      limitations: c.limitations,
    });
    const sizeBase = journeyBase(ctx, env, c, build, { buildId: builds[c.id].buildId, scenarioId: 'early.size' });
    const sizeLine = `app ${f.bytes} bytes in ${f.files} files, tree sha256 ${f.sha256}`;
    const sizeFile = write(`${base}/artifact-sizes.txt`, `${sizeLine}\n`).file;
    allObs.push(makeObservation(sizeBase, { methodId: 'size.ios.simulator_app/app-dir-file-bytes/1', status: 'measured', value: f.bytes,
      limitations: ['descriptive-simulator-build'], rawRefs: [{ file: sizeFile, line: 1, text: sizeLine }] }));
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
