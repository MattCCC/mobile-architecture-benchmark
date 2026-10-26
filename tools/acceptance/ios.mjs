#!/usr/bin/env node
// Black-box iOS acceptance driver (design §8): the iOS simulator adapter for checks.mjs. UI primitives run in an
// XCUITest command server (ios-driver/); markers come from the app's unified-log mirror (mb.markerMirror=all), as the
// runner reads them. Writes an artifact-bound receipt plus evidence.
//
//   node tools/acceptance/ios.mjs --candidate <id> [--app <path.app>] [--udid <id> | --sim-name mobilebench-iphone]
//     [--profile small] [--out results/local/acceptance/<id>-ios]
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run, sleep } from '../early-bench/lib/exec.mjs';
import { parseMbMessage } from '../early-bench/lib/parse.mjs';
import { declaredBuildProblems, loadBuildPolicy } from '../early-bench/lib/build-policy.mjs';
import { markerFields, runAcceptance } from './checks.mjs';

const { values: args } = parseArgs({ options: {
  repo: { type: 'string', default: '.' }, candidate: { type: 'string' }, app: { type: 'string' },
  udid: { type: 'string' }, 'sim-name': { type: 'string', default: 'mobilebench-iphone' },
  profile: { type: 'string', default: 'small' }, out: { type: 'string' },
}, strict: true });
if (!args.candidate) {
  process.stderr.write('usage: ios.mjs --candidate <id> [--app <path.app>] [--udid <id>] [--profile small] [--out <dir>]\n');
  process.exit(2);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(args.repo);
const candidate = JSON.parse(readFileSync(join(repo, 'candidates', args.candidate, 'candidate.json'), 'utf8'));
const platform = candidate.platforms.ios;
const bundle = platform.bundleId;
const out = resolve(args.out ?? join(repo, 'results/local/acceptance', `${args.candidate}-ios`));
mkdirSync(out, { recursive: true });
const app = resolve(args.app ?? await artifactPath());
const markersPath = join(out, 'markers.log');
writeFileSync(markersPath, '');
const simctl = (a, opts) => run('xcrun', ['simctl', ...a], { timeoutMs: 120000, ...opts });

async function artifactPath() {
  const r = await run('make', ['-s', '-C', repo, `artifacts-${args.candidate}-ios`], { timeoutMs: 60000 });
  // Some candidates also list a device build; the driver installs the simulator app.
  const lines = r.stdout.trim().split('\n').filter((l) => l.endsWith('.app'));
  const line = lines.find((l) => !l.includes('iphoneos')) ?? lines[0];
  if (r.code !== 0 || !line) throw new Error(`no iOS simulator artifact for ${args.candidate}: ${r.stderr.trim()}`);
  return resolve(repo, line);
}

async function simulator() {
  if (args.udid) return args.udid;
  const list = JSON.parse((await simctl(['list', 'devices', '-j'])).stdout).devices;
  const dev = Object.values(list).flat().find((d) => d.name === args['sim-name'] && d.isAvailable);
  if (!dev) throw new Error(`simulator ${args['sim-name']} not found (create it or pass --udid)`);
  return dev.udid;
}

// ------------------------------------------------------------------------------------------------ command server

const serverDir = join(repo, 'results/local/acceptance/.ios-driver/session');
let server = null;
let cmdNo = 0;

async function startServer(udid) {
  const work = join(repo, 'results/local/acceptance/.ios-driver');
  const gemHome = /GEM_HOME="([^"]*)"/.exec(readFileSync((await run('sh', ['-c', 'command -v pod'])).stdout.trim(), 'utf8'))?.[1];
  const gen = await run('ruby', [join(here, 'ios-driver/generate-project.rb'), work], { env: { ...process.env, ...(gemHome ? { GEM_HOME: gemHome } : {}) } });
  if (gen.code !== 0) throw new Error(`driver project: ${gen.stderr}`);
  const build = await run('xcodebuild', ['build-for-testing', '-project', join(work, 'MBDriver.xcodeproj'), '-scheme', 'MBDriver',
    '-destination', `id=${udid}`, '-derivedDataPath', join(work, 'derived')], { timeoutMs: 900000 });
  if (build.code !== 0) throw new Error(`driver build failed: ${build.stdout.slice(-2000)}`);
  const products = join(work, 'derived/Build/Products');
  const xctestrun = readdirSync(products).find((f) => f.endsWith('.xctestrun'));
  rmSync(serverDir, { recursive: true, force: true });
  mkdirSync(serverDir, { recursive: true });
  server = spawn('xcodebuild', ['test-without-building', '-xctestrun', join(products, xctestrun), '-destination', `id=${udid}`,
    '-only-testing:MBDriverUITests/CommandServer/testServe'],
  { env: { ...process.env, TEST_RUNNER_MB_DIR: serverDir }, stdio: ['ignore', 'ignore', 'ignore'] });
  const deadline = Date.now() + 300000;
  while (!existsSync(join(serverDir, 'server-ready'))) {
    if (Date.now() > deadline) throw new Error('XCUITest command server did not start');
    await sleep(500);
  }
  cmdNo = 0;
}

async function command(op, fields = {}, timeoutMs = 180000) {
  const n = cmdNo++;
  const res = join(serverDir, `res-${n}.json`);
  writeFileSync(join(serverDir, `cmd-${n}.json.tmp`), JSON.stringify({ op, bundle, ...fields }));
  await run('mv', [join(serverDir, `cmd-${n}.json.tmp`), join(serverDir, `cmd-${n}.json`)]);
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(res)) {
    if (Date.now() > deadline) throw new Error(`command server timeout on ${op}`);
    await sleep(30);
  }
  const reply = JSON.parse(readFileSync(res, 'utf8'));
  if (!reply.ok) throw new Error(`${op}: ${reply.error}`);
  return reply;
}

// ------------------------------------------------------------------------------------------------ hierarchy

/** Snapshot tree as a flat node list (same shape as the Android dump). */
async function dump() {
  const { tree } = await command('snapshot');
  const nodes = [];
  const walk = (s, ancestors) => {
    const [l, t, r, b] = s.frame;
    const text = [s.label, s.value !== s.label ? s.value : ''].filter(Boolean).join('\n');
    const node = { id: s.id ?? '', desc: '', text, checked: Boolean(s.selected), type: s.type, bounds: { l, t, r, b }, all: [] };
    for (const a of ancestors) a.all.push(node);
    nodes.push(node);
    for (const c of s.children ?? []) walk(c, [...ancestors, node]);
  };
  walk(tree, []);
  return { nodes, find: (id) => nodes.find((n) => n.id === id) ?? null };
}

async function tap(node) {
  await command('tap', { x: (node.bounds.l + node.bounds.r) / 2, y: (node.bounds.t + node.bounds.b) / 2 });
}

// ------------------------------------------------------------------------------------------------ markers

const markers = [];
let logStream = null;

function startMarkers(udid) {
  logStream = spawn('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'ndjson', '--level', 'default',
    '--predicate', 'eventMessage BEGINSWITH "MB "'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let pending = '';
  logStream.stdout.on('data', (chunk) => {
    pending += chunk.toString('utf8');
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const raw of lines) {
      let msg;
      try {
        msg = JSON.parse(raw).eventMessage;
      } catch {
        continue;
      }
      appendFileSync(markersPath, `${raw}\n`);
      const mb = msg && parseMbMessage(msg);
      if (mb) markers.push({ ...mb, payloadFields: markerFields(mb.payload), recvMs: Date.now() });
    }
  });
}

// ------------------------------------------------------------------------------------------------ adapter

let udid = null;

async function install() {
  await simctl(['uninstall', udid, bundle]);
  const r = await simctl(['install', udid, app], { timeoutMs: 300000 });
  if (r.code !== 0) throw new Error(`install failed: ${r.stderr}`);
}

const device = {
  platform: 'ios',
  unit: 'pt',
  rowExtent: 72,
  markers,
  evidenceFiles: ['markers.log'],
  install,
  // R-DATA: the frozen app reinstalled (simctl has no per-app data reset).
  resetData: install,
  async launch(journey, extras) {
    const argv = Object.entries({ 'mb.journey': journey, ...extras }).flatMap(([k, v]) => [`-${k}`, String(v)]);
    await command('launch', { args: argv });
  },
  async stop() {
    await simctl(['terminate', udid, bundle]);
  },
  home: () => command('home'),
  foreground: () => command('activate'),
  dump,
  tap,
  async back(ui) {
    const b = ui?.find('mb.nav.back') ?? ui?.nodes.find((n) => n.text.split('\n')[0] === 'Back' && n.bounds.t < 200);
    if (b) await tap(b);
  },
  // Markers carry the host uptime clock; elapsed time is taken from when the marker reached the driver, plus 1 s for
  // the log pipeline (an upper bound is what the value window needs).
  secondsSince: async (marker) => (Date.now() - marker.recvMs) / 1000 + 1,
  async buildPolicy() {
    const policy = loadBuildPolicy(repo).value;
    const problems = declaredBuildProblems(platform, 'ios', policy);
    const plist = (key) => run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, join(app, 'Info.plist')]).then((r) => r.stdout.trim());
    const minOs = await plist('MinimumOSVersion');
    const exe = await plist('CFBundleExecutable');
    const id = await plist('CFBundleIdentifier');
    const archs = (await run('lipo', ['-archs', join(app, exe)])).stdout.trim().split(/\s+/);
    if (minOs !== policy.ios.deploymentTarget) problems.push(`MinimumOSVersion ${minOs} != policy ${policy.ios.deploymentTarget}`);
    if (!archs.includes(policy.ios.arch) || archs.some((a) => a !== policy.ios.arch)) problems.push(`executable archs ${archs.join(',')}`);
    if (id !== bundle) problems.push(`bundle id ${id} != ${bundle}`);
    const buildClass = platform.benchmarkBuild?.buildClass;
    return { problems, detail: `MinimumOSVersion ${minOs}, arch ${archs.join(',')}, simulator ${buildClass} build` };
  },
  async close() {
    try {
      await command('quit', {}, 30000);
    } catch {
      // The server is killed below either way.
    }
    server?.kill();
    logStream?.kill();
  },
};

try {
  udid = await simulator();
  await simctl(['boot', udid]);
  await simctl(['bootstatus', udid, '-b'], { timeoutMs: 300000 });
  startMarkers(udid);
  await startServer(udid);
  const passed = await runAcceptance({ repo, candidateId: args.candidate, profile: args.profile, out, artifactPath: app,
    driverFiles: ['ios.mjs', 'checks.mjs', 'model.mjs', 'ios-driver/UITests/CommandServer.swift'].map((f) => join(here, f)), device });
  process.exitCode = passed ? 0 : 1;
} catch (e) {
  server?.kill();
  logStream?.kill();
  process.stderr.write(`driver error: ${e.stack}\n`);
  process.exitCode = 2;
}
