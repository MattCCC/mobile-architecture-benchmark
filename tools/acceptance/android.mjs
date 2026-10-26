#!/usr/bin/env node
// Black-box Android acceptance driver (design §8): the Android device adapter for checks.mjs. Drives one frozen APK on
// a running emulator with adb, accessibility-tree dumps (android-dump/MbDump.java) and the app's marker mirror
// (logcat tag MobileBench, mb.markerMirror=all), and writes an artifact-bound receipt plus evidence.
//
//   node tools/acceptance/android.mjs --candidate <id> [--apk <path>] [--serial emulator-5554] [--profile small]
//     [--out results/local/acceptance/<id>-android]
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run, sleep } from '../early-bench/lib/exec.mjs';
import { parseBadging, parseLogcatLine, parseMbMessage } from '../early-bench/lib/parse.mjs';
import { androidArtifactBuildProblems, declaredBuildProblems, loadBuildPolicy } from '../early-bench/lib/build-policy.mjs';
import { markerFields, runAcceptance } from './checks.mjs';

const { values: args } = parseArgs({ options: {
  repo: { type: 'string', default: '.' }, candidate: { type: 'string' }, apk: { type: 'string' },
  serial: { type: 'string' }, profile: { type: 'string', default: 'small' }, out: { type: 'string' },
  adb: { type: 'string', default: `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb` },
}, strict: true });
if (!args.candidate) {
  process.stderr.write('usage: android.mjs --candidate <id> [--apk <path>] [--serial <s>] [--profile small] [--out <dir>]\n');
  process.exit(2);
}

const SDK = process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`;
const repo = resolve(args.repo);
const candidate = JSON.parse(readFileSync(join(repo, 'candidates', args.candidate, 'candidate.json'), 'utf8'));
const platform = candidate.platforms.android;
const pkg = platform.applicationId;
// As the runner: declared launch activity, else the launcher activity the package resolves to (after install).
let component = platform.launchActivity ?? platform.activity ?? null;
const out = resolve(args.out ?? join(repo, 'results/local/acceptance', `${args.candidate}-android`));
mkdirSync(out, { recursive: true });
const apk = resolve(args.apk ?? await artifactPath());
const markersPath = join(out, 'markers.log');
writeFileSync(markersPath, '');

async function artifactPath() {
  const r = await run('make', ['-s', '-C', repo, `artifacts-${args.candidate}-android`], { timeoutMs: 60000 });
  // Some candidates also list an AAB; the driver installs the APK.
  const line = r.stdout.trim().split('\n').filter((l) => l.endsWith('.apk')).pop();
  if (r.code !== 0 || !line) throw new Error(`no Android artifact for ${args.candidate}: ${r.stderr.trim()}`);
  return resolve(repo, line);
}

const base = args.serial ? ['-s', args.serial] : [];
const adb = (a, opts) => run(args.adb, [...base, ...a], { timeoutMs: 60000, ...opts });
const sh = (cmd, opts) => adb(['shell', cmd], opts);
const latest = async (dir, filter = () => true) => (await run('ls', [dir])).stdout.trim().split('\n').filter(filter).sort().pop();

// ------------------------------------------------------------------------------------------------ hierarchy

const DUMP_FILE = '/data/local/tmp/mb-ui.xml';
const DUMPER_JAR = '/data/local/tmp/mbdump.jar';
let dumper = false;

/** Compiles android-dump/MbDump.java (javac + d8 from the SDK) and pushes it to the device. */
async function installDumper() {
  const androidJar = join(SDK, 'platforms', await latest(join(SDK, 'platforms'), (p) => p.startsWith('android-')), 'android.jar');
  const work = join(repo, 'results/local/acceptance/.mbdump');
  mkdirSync(join(work, 'classes'), { recursive: true });
  const javac = await run('javac', ['-nowarn', '--release', '11', '-cp', androidJar, '-d', join(work, 'classes'),
    join(repo, 'tools/acceptance/android-dump/MbDump.java')], { timeoutMs: 120000 });
  const d8 = javac.code === 0 && await run(join(SDK, 'build-tools', await latest(join(SDK, 'build-tools')), 'd8'),
    ['--min-api', '24', '--lib', androidJar, '--output', join(work, 'mbdump.jar'), join(work, 'classes', 'MbDump.class')],
    { timeoutMs: 120000 });
  const push = d8?.code === 0 && await adb(['push', join(work, 'mbdump.jar'), DUMPER_JAR]);
  dumper = push?.code === 0;
}

/** Accessibility tree as a flat node list. The file is removed first, so a failed dump never returns the previous
 * screen. MbDump does not wait for an idle UI; `uiautomator dump` (which gives up on continuously updating screens)
 * is the fallback. */
async function dump() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const cmd = dumper
      ? `rm -f ${DUMP_FILE}; CLASSPATH=${DUMPER_JAR} app_process / MbDump ${DUMP_FILE} >/dev/null 2>&1; cat ${DUMP_FILE} 2>/dev/null`
      : `rm -f ${DUMP_FILE}; uiautomator dump ${DUMP_FILE} >/dev/null 2>&1; cat ${DUMP_FILE} 2>/dev/null`;
    const r = await sh(cmd, { timeoutMs: 30000 });
    if (r.stdout.includes('<hierarchy')) return parseHierarchy(r.stdout);
    await sleep(200);
  }
  throw new Error('hierarchy dump failed');
}

function parseHierarchy(xml) {
  const nodes = [];
  const stack = [];
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0] === '</node>') {
      stack.pop();
      continue;
    }
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], unescapeXml(a[2])]));
    const b = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? '') ?? [0, 0, 0, 0, 0];
    const node = { id: (attrs['resource-id'] ?? '').replace(/^.*:id\//, ''), desc: attrs['content-desc'] ?? '',
      text: attrs.text ?? '',
      // The selected option of a row: toolkits expose it as checked (toggle) or selected (chosen item).
      checked: attrs.checked === 'true' || attrs.selected === 'true',
      bounds: { l: +b[1], t: +b[2], r: +b[3], b: +b[4] }, all: [] };
    for (const parent of stack) parent.all.push(node);
    nodes.push(node);
    if (m[2] !== '/') stack.push(node);
  }
  return { nodes, find: (id) => nodes.find((n) => n.id === id || n.desc === id) ?? null };
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
}

async function tap(node) {
  await sh(`input tap ${Math.round((node.bounds.l + node.bounds.r) / 2)} ${Math.round((node.bounds.t + node.bounds.b) / 2)}`);
}

// ------------------------------------------------------------------------------------------------ markers

const markers = [];
const logcat = spawn(args.adb, [...base, 'logcat', '-v', 'epoch', '-s', 'MobileBench:I'], { stdio: ['ignore', 'pipe', 'ignore'] });
let pending = '';
logcat.stdout.on('data', (chunk) => {
  pending += chunk.toString('utf8');
  const lines = pending.split('\n');
  pending = lines.pop();
  for (const raw of lines) {
    appendFileSync(markersPath, `${raw}\n`);
    const l = parseLogcatLine(raw);
    const mb = l && parseMbMessage(l.message);
    if (mb) markers.push({ ...mb, payloadFields: markerFields(mb.payload) });
  }
});

// ------------------------------------------------------------------------------------------------ adapter

const device = {
  platform: 'android',
  unit: 'dp',
  rowExtent: 72,
  markers,
  evidenceFiles: ['markers.log'],
  async install() {
    await adb(['uninstall', pkg], { timeoutMs: 60000 });
    const install = await adb(['install', apk], { timeoutMs: 180000 });
    if (install.code !== 0) throw new Error(`install failed: ${install.stdout}${install.stderr}`);
    if (!component) {
      const resolved = await sh(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`);
      component = resolved.stdout.trim().split('\n').pop().trim();
    }
  },
  async launch(journey, extras) {
    const es = Object.entries({ 'mb.journey': journey, ...extras }).map(([k, v]) => `--es ${k} ${v}`).join(' ');
    await sh(`am start -W -f 0x10008000 -n ${component} ${es}`, { timeoutMs: 60000 });
  },
  stop: () => sh(`am force-stop ${pkg}`),
  resetData: () => sh(`pm clear ${pkg}`),
  home: () => sh('input keyevent KEYCODE_HOME'),
  // Brings the existing task back: the same explicit, action-less intent the task was started with, NEW_TASK only
  // (a launcher MAIN/LAUNCHER intent does not match that root intent and would stack a new activity instead).
  foreground: () => sh(`am start -W -f 0x10000000 -n ${component}`, { timeoutMs: 60000 }),
  dump,
  tap,
  async back(ui) {
    const b = ui?.find('mb.nav.back');
    if (b) await tap(b);
    else await sh('input keyevent KEYCODE_BACK');
  },
  // Android markers carry t=<elapsedRealtimeNanos>; /proc/uptime is the same boot-time clock.
  async secondsSince(marker) {
    const up = Number((await sh('cat /proc/uptime')).stdout.split(/\s+/)[0]);
    return up - Number(BigInt(marker.t)) / 1e9;
  },
  async buildPolicy() {
    const tools = join(SDK, 'build-tools');
    const badging = parseBadging((await run(join(tools, await latest(tools), 'aapt2'), ['dump', 'badging', apk])).stdout);
    const policy = loadBuildPolicy(repo).value;
    const problems = [...declaredBuildProblems(platform, 'android', policy), ...androidArtifactBuildProblems(badging, policy)];
    if (badging.debuggable) problems.push('artifact is debuggable');
    if (badging.packageName !== pkg) problems.push(`package ${badging.packageName} != ${pkg}`);
    return { problems, detail: `minSdk ${badging.minSdk}, targetSdk ${badging.targetSdk}, abi ${badging.nativeCode.join(',')}, not debuggable` };
  },
  async close() {
    logcat.kill();
  },
};

try {
  await adb(['wait-for-device']);
  await installDumper();
  const density = Number(/(\d+)\s*$/m.exec((await sh('wm density')).stdout)?.[1] ?? 160) / 160;
  device.rowExtent = 72 * density;
  const here = fileURLToPath(new URL('.', import.meta.url));
  const passed = await runAcceptance({ repo, candidateId: args.candidate, profile: args.profile, out, artifactPath: apk,
    driverFiles: ['android.mjs', 'checks.mjs', 'model.mjs', 'android-dump/MbDump.java'].map((f) => join(here, f)), device });
  process.exitCode = passed ? 0 : 1;
} catch (e) {
  logcat.kill();
  process.stderr.write(`driver error: ${e.stack}\n`);
  process.exitCode = 2;
}
