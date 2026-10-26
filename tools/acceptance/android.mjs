#!/usr/bin/env node
// Black-box Android acceptance driver (design §8). Drives one frozen APK on a running emulator with adb, UI Automator
// hierarchy dumps and the app's marker mirror (logcat tag MobileBench, mb.markerMirror=all), checks every contract
// check against the reference model (fixtures + generator stream) and writes an artifact-bound receipt plus evidence.
//
//   node tools/acceptance/android.mjs --candidate <id> [--apk <path>] [--serial emulator-5554] [--profile small]
//     [--out results/local/acceptance/<id>-android]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { run, sleep } from '../early-bench/lib/exec.mjs';
import { sha256, sha256File } from '../early-bench/lib/hash.mjs';
import { parseBadging, parseLogcatLine, parseMbMessage } from '../early-bench/lib/parse.mjs';
import { androidArtifactBuildProblems, declaredBuildProblems, loadBuildPolicy } from '../early-bench/lib/build-policy.mjs';
import { CONTRACT } from './lib.mjs';
import { ReferenceModel, itemLabel, OPTION_KEYS } from './model.mjs';

const { values: args } = parseArgs({ options: {
  repo: { type: 'string', default: '.' }, candidate: { type: 'string' }, apk: { type: 'string' },
  serial: { type: 'string' }, profile: { type: 'string', default: 'small' }, out: { type: 'string' },
  adb: { type: 'string', default: `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb` },
}, strict: true });
if (!args.candidate) {
  process.stderr.write('usage: android.mjs --candidate <id> [--apk <path>] [--serial <s>] [--profile small] [--out <dir>]\n');
  process.exit(2);
}

const repo = resolve(args.repo);
const candidateDir = join(repo, 'candidates', args.candidate);
const candidate = JSON.parse(readFileSync(join(candidateDir, 'candidate.json'), 'utf8'));
const platform = candidate.platforms.android;
const pkg = platform.applicationId;
// As the runner: declared launch activity, else the launcher activity the package resolves to (after install).
let component = platform.launchActivity ?? platform.activity ?? null;
const out = resolve(args.out ?? join(repo, 'results/local/acceptance', `${args.candidate}-android`));
mkdirSync(out, { recursive: true });
const apk = resolve(args.apk ?? await artifactPath());
const model = new ReferenceModel(repo, args.profile);
const evidencePath = join(out, 'evidence.jsonl');
const markersPath = join(out, 'markers.log');
writeFileSync(evidencePath, '');
writeFileSync(markersPath, '');

async function artifactPath() {
  const r = await run('make', ['-s', '-C', repo, `artifacts-${args.candidate}-android`], { timeoutMs: 60000 });
  const line = r.stdout.trim().split('\n').filter(Boolean).pop();
  if (r.code !== 0 || !line) throw new Error(`no Android artifact for ${args.candidate}: ${r.stderr.trim()}`);
  return resolve(repo, line);
}

// ------------------------------------------------------------------------------------------------ device

const base = args.serial ? ['-s', args.serial] : [];
const adb = (a, opts) => run(args.adb, [...base, ...a], { timeoutMs: 60000, ...opts });
const sh = (cmd, opts) => adb(['shell', cmd], opts);
let density = 1;

function log(check, step, data = {}) {
  appendFileSync(evidencePath, `${JSON.stringify({ check, step, ...data })}\n`);
}

/** UI Automator dump as a flat node list with descendant text; retried while the UI is not idle. */
async function dump() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const r = await sh('uiautomator dump /sdcard/mb-ui.xml >/dev/null 2>&1; cat /sdcard/mb-ui.xml', { timeoutMs: 30000 });
    if (r.stdout.includes('<hierarchy')) return parseHierarchy(r.stdout);
    await sleep(300);
  }
  throw new Error('uiautomator dump failed');
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
    const node = { id: attrs['resource-id'] ?? '', desc: attrs['content-desc'] ?? '', text: attrs.text ?? '',
      checked: attrs.checked === 'true', bounds: { l: +b[1], t: +b[2], r: +b[3], b: +b[4] }, all: [] };
    node.id = node.id.replace(/^.*:id\//, '');
    for (const parent of stack) parent.all.push(node);
    nodes.push(node);
    if (m[2] !== '/') stack.push(node);
  }
  return { nodes, find: (id) => nodes.find((n) => n.id === id || n.desc === id) ?? null };
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
}

/** Text of a node and its descendants (toolkits put button and cell text in child views). */
function textOf(node) {
  return [node.text, node.desc, ...node.all.map((n) => n.text || n.desc)].filter(Boolean).join('\n');
}

async function tap(node) {
  const x = Math.round((node.bounds.l + node.bounds.r) / 2);
  const y = Math.round((node.bounds.t + node.bounds.b) / 2);
  await sh(`input tap ${x} ${y}`);
}

async function deviceNowNs() {
  const r = await sh('cat /proc/uptime');
  return BigInt(Math.round(Number(r.stdout.split(/\s+/)[0]) * 1e9));
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
    if (mb) markers.push({ ...mb, payloadFields: fields(mb.payload) });
  }
});

function fields(payload) {
  return Object.fromEntries(payload.split(';').filter((kv) => kv.includes('=')).map((kv) => kv.split('=')));
}

async function waitMarker(journey, event, pred = () => true, timeoutMs = 20000, from = 0) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const m = markers.slice(from).find((x) => x.journeyId === journey && x.event === event && pred(x));
    if (m) return m;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${event} in ${journey}`);
    await sleep(100);
  }
}

// ------------------------------------------------------------------------------------------------ app control

let journeyNo = 0;

async function launch(extras = {}) {
  const journey = `acc${process.pid % 1000}x${++journeyNo}`;
  const all = { 'mb.journey': journey, 'mb.journeyMode': '1', 'mb.profile': args.profile, 'mb.markerMirror': 'all', ...extras };
  const es = Object.entries(all).map(([k, v]) => `--es ${k} ${v}`).join(' ');
  await sh(`am start -W -f 0x10008000 -n ${component} ${es}`, { timeoutMs: 60000 });
  return journey;
}

const resetData = () => sh(`pm clear ${pkg}`);
const stop = () => sh(`am force-stop ${pkg}`);
const home = () => sh('input keyevent KEYCODE_HOME');
// Brings the existing task back: the same explicit, action-less intent the task was started with, NEW_TASK only
// (a launcher MAIN/LAUNCHER intent does not match that root intent and would stack a new activity instead).
const foreground = () => sh(`am start -W -f 0x10000000 -n ${component}`, { timeoutMs: 60000 });

async function back(ui) {
  const b = ui?.find('mb.nav.back');
  if (b) await tap(b);
  else await sh('input keyevent KEYCODE_BACK');
}

async function screen(journey, route, from) {
  await waitMarker(journey, 'screen', (m) => m.payloadFields.r === route, 15000, from);
  await sleep(400);
  return dump();
}

/** Highest seq the app can have applied now: the replay is paced at the profile rate from stream.open. */
async function seqUpperBound(journey) {
  const open = [...markers].reverse().find((m) => m.journeyId === journey && m.event === 'stream.open');
  if (!open) return 0;
  const from = Number(open.payloadFields.from ?? 1);
  const elapsedS = Number((await deviceNowNs()) - BigInt(open.t)) / 1e9;
  return from - 1 + Math.ceil(elapsedS * model.rate) + 3;
}

// ------------------------------------------------------------------------------------------------ checks

const results = new Map();
const pass = (id, detail) => results.set(id, { id, status: 'passed', ...(detail ? { detail } : {}) });
const fail = (id, detail) => {
  results.set(id, { id, status: 'failed', detail });
  log(id, 'failed', { detail });
};
function expect(id, cond, detail) {
  if (!cond) throw Object.assign(new Error(detail), { checkId: id });
}

let selection = model.selection.map((s) => ({ ...s }));
let lastSeqLo = 0;

/** Visible rows: labels exact; option state exact; values and total consistent with the stream window. */
function checkList(id, ui, lo, hi) {
  const rows = ui.nodes.filter((n) => /^mb\.row\.\d+$/.test(n.id)).map((n) => Number(n.id.split('.')[2]));
  expect(id, rows.length > 0, 'no list rows (mb.row.<i>) visible');
  for (const i of rows) {
    const label = ui.find(`mb.row.${i}.label`);
    expect(id, label && textOf(label).includes(itemLabel(i, model.items)), `row ${i} label ${label && textOf(label)}`);
    OPTION_KEYS.forEach((k, o) => {
      const opt = ui.find(`mb.row.${i}.opt.${k}`);
      expect(id, opt, `row ${i} option ${k} missing`);
      const selected = selection.some((s) => s.i === i && s.o === o);
      expect(id, opt.checked === selected, `row ${i} option ${k} checked=${opt.checked}, expected ${selected}`);
      const v = /(\d+\.\d\d)/.exec(textOf(opt))?.[1];
      const allowed = [...model.valueSet(i, o, lo, hi)].map((x) => model.fmtValue(x));
      expect(id, v && allowed.includes(v), `row ${i} option ${k} shows ${v}, expected one of ${allowed.join('|')} (seq ${lo}..${hi})`);
    });
  }
  const count = textOf(ui.find('mb.summary.count') ?? { all: [] });
  expect(id, count.includes(`Selected ${selection.length}`), `summary count "${count}"`);
  const total = /(\d+\.\d\d)/.exec(textOf(ui.find('mb.summary.total') ?? { all: [] }))?.[1];
  const totals = model.totalTexts(selection, lo, hi);
  expect(id, totals.has(total), `summary total ${total} not in seq ${lo}..${hi}`);
  log(id, 'list', { rows, count, total, window: [lo, hi] });
  return rows;
}

async function runCheck(id, fn) {
  try {
    const detail = await fn();
    pass(id, detail);
    log(id, 'passed', { detail: detail ?? null });
  } catch (e) {
    fail(id, e.message);
  }
}

model.fmtValue = (v) => `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;

async function main() {
  await adb(['wait-for-device']);
  density = Number(/(\d+)\s*$/m.exec((await sh('wm density')).stdout)?.[1] ?? 160) / 160;
  const designSha256 = sha256File(join(repo, 'design.md'));
  const artifactSha256 = sha256File(apk);
  log('setup', 'artifact', { candidate: args.candidate, apk: relative(repo, apk), artifactSha256, designSha256, density });

  await runCheck('build-policy', async () => {
    const tools = `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/build-tools`;
    const versions = (await run('ls', [tools])).stdout.trim().split('\n').sort();
    const badging = parseBadging((await run(join(tools, versions.pop(), 'aapt2'), ['dump', 'badging', apk])).stdout);
    const policy = loadBuildPolicy(repo).value;
    const problems = [...declaredBuildProblems(platform, 'android', policy), ...androidArtifactBuildProblems(badging, policy)];
    if (badging.debuggable) problems.push('artifact is debuggable');
    if (badging.packageName !== pkg) problems.push(`package ${badging.packageName} != ${pkg}`);
    expect('build-policy', problems.length === 0, problems.join('; '));
    return `minSdk ${badging.minSdk}, targetSdk ${badging.targetSdk}, abi ${badging.nativeCode.join(',')}, not debuggable`;
  });

  results.set('instrumentation-overhead', { id: 'instrumentation-overhead', status: 'waived',
    reason: CONTRACT.descriptiveWaivable['instrumentation-overhead'] });

  // R-INSTALL from the frozen artifact, R-DATA.
  await adb(['uninstall', pkg], { timeoutMs: 60000 });
  const install = await adb(['install', apk], { timeoutMs: 180000 });
  if (install.code !== 0) throw new Error(`install failed: ${install.stdout}${install.stderr}`);
  if (!component) {
    const resolved = await sh(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`);
    component = resolved.stdout.trim().split('\n').pop().trim();
  }
  log('setup', 'component', { component });
  await resetData();

  let j = await launch();
  const fui = await waitMarker(j, 'fui', () => true, 30000);
  let ui = await dump();
  let hi = await seqUpperBound(j);

  await runCheck('initial-state', async () => {
    expect('initial-state', fui.payloadFields.seq === '0', `fui seq=${fui.payloadFields.seq}`);
    expect('initial-state', Number(fui.payloadFields.sel) === model.golden.seq0Summary.selectedCount, `fui sel=${fui.payloadFields.sel}`);
    expect('initial-state', ui.find('mb.screen.list'), 'mb.screen.list missing');
    const rows = checkList('initial-state', ui, 0, hi);
    return `${rows.length} rows, labels/selection exact, values within seq 0..${hi}`;
  });

  await runCheck('list-geometry', async () => {
    const list = ui.find('mb.list');
    expect('list-geometry', list, 'mb.list missing');
    const rowPx = 72 * density;
    const rows = ui.nodes.filter((n) => /^mb\.row\.\d+$/.test(n.id));
    // Dumped bounds are clipped to the viewport: a row touching a list edge may be partly visible.
    const inside = (n) => n.bounds.t >= list.bounds.t - 1 && n.bounds.b <= list.bounds.b + 1;
    const atEdge = (n) => Math.abs(n.bounds.t - list.bounds.t) <= 1 || Math.abs(n.bounds.b - list.bounds.b) <= 1;
    const fullHeight = (n) => Math.abs(n.bounds.b - n.bounds.t - rowPx) <= 2;
    for (const r of rows.filter((n) => inside(n) && !atEdge(n))) {
      const h = r.bounds.b - r.bounds.t;
      expect('list-geometry', fullHeight(r), `row ${r.id} height ${h}px, expected ${rowPx.toFixed(1)}px (72 dp)`);
    }
    const full = rows.filter((n) => inside(n) && fullHeight(n));
    const expected = Math.floor((list.bounds.b - list.bounds.t) / rowPx);
    expect('list-geometry', full.length === Number(fui.payloadFields.rows), `fully visible rows ${full.length} != fui rows ${fui.payloadFields.rows}`);
    expect('list-geometry', Number(fui.payloadFields.rows) === Math.max(1, expected), `fui rows ${fui.payloadFields.rows} != floor(h/72) ${expected}`);
    return `${full.length} rows of 72 dp in a ${((list.bounds.b - list.bounds.t) / density).toFixed(0)} dp list`;
  });

  await runCheck('navigation', async () => {
    let from = markers.length;
    await tap(ui.find('mb.nav.selection') ?? fail0('mb.nav.selection'));
    let s = await screen(j, 'selection', from);
    expect('navigation', s.find('mb.screen.selection'), 'mb.screen.selection missing');
    from = markers.length;
    await back(s);
    s = await screen(j, 'list', from);
    checkList('navigation', s, 0, await seqUpperBound(j));
    from = markers.length;
    await tap(s.find('mb.row.1.label') ?? fail0('mb.row.1.label'));
    s = await screen(j, 'detail/1', from);
    expect('navigation', s.find('mb.screen.detail'), 'mb.screen.detail missing');
    const a = /(\d+\.\d\d)/.exec(textOf(s.find('mb.detail.values.a') ?? { all: [] }))?.[1];
    const allowed = [...model.valueSet(1, 0, 0, await seqUpperBound(j))].map((x) => model.fmtValue(x));
    expect('navigation', allowed.includes(a), `detail value A ${a} not in ${allowed.join('|')}`);
    from = markers.length;
    await back(s);
    s = await screen(j, 'list', from);
    checkList('navigation', s, 0, await seqUpperBound(j));
    ui = s;
    return 'list -> selection -> list -> detail/1 -> list with live state';
  });

  await runCheck('insights', async () => {
    const from = markers.length;
    await tap(ui.find('mb.nav.insights') ?? fail0('mb.nav.insights'));
    const s = await screen(j, 'insights', from);
    await waitMarker(j, 'remote.ready', () => true, 15000, from);
    const src = await waitMarker(j, 'remote.source', () => true, 1000, from);
    expect('insights', src.payloadFields.src === 'embedded', `remote.source ${src.payload}`);
    expect('insights', s.find('mb.screen.insights'), 'mb.screen.insights missing');
    const topText = textOf(s.find('mb.insights.top') ?? { all: [] });
    const top = [...topText.matchAll(/Item (\d+)\D+?(\d+\.\d\d)/g)].map((m) => [Number(m[1]), m[2]]);
    const buckets = (textOf(s.find('mb.insights.buckets') ?? { all: [] }).match(/\d+/g) ?? []).map(Number);
    expect('insights', textOf(s.find('mb.insights.source') ?? { all: [] }).includes('embedded'), 'Source text');
    const hiSeq = await seqUpperBound(j);
    let match = null;
    for (const m of model.insights(0, hiSeq)) {
      const ok = m.top.length === top.length && m.top.every(([i, a], k) => top[k][0] === i && top[k][1] === model.fmtValue(a))
        && m.buckets.join() === buckets.join();
      if (ok) match = m.seq;
    }
    log('insights', 'shown', { top, buckets });
    expect('insights', match !== null, `top ${JSON.stringify(top)} buckets ${buckets} match no seq in 0..${hiSeq}`);
    const from2 = markers.length;
    await back(s);
    ui = await screen(j, 'list', from2);
    return `top 5 and buckets equal the reference at seq ${match}; source embedded; remote.ready`;
  });

  await runCheck('selection-semantics', async () => {
    const rows = ui.nodes.filter((n) => /^mb\.row\.\d+$/.test(n.id)).map((n) => Number(n.id.split('.')[2]));
    const row = rows.find((i) => !selection.some((s) => s.i === i));
    expect('selection-semantics', row !== undefined, 'no visible unselected row');
    const steps = [['a', 0, 'select'], ['b', 1, 'replace'], ['b', null, 'deselect']];
    for (const [key, o, what] of steps) {
      const from = markers.length;
      await tap(ui.find(`mb.row.${row}.opt.${key}`));
      await waitMarker(j, 'resp', () => true, 10000, from);
      selection = selection.filter((s) => s.i !== row);
      if (o !== null) selection.push({ i: row, o });
      await sleep(300);
      ui = await dump();
      checkList('selection-semantics', ui, 0, await seqUpperBound(j));
      log('selection-semantics', what, { row, option: key });
    }
    return `row ${row}: select A, replace with B, deselect B; count and total follow`;
  });

  let bgState = null;
  await runCheck('live-update', async () => {
    await sleep(3000);
    const from = markers.length;
    await home();
    await waitMarker(j, 'bg', () => true, 10000, from);
    bgState = await waitMarker(j, 'state', () => true, 10000, from);
    const seq = Number(bgState.payloadFields.s);
    const expected = model.stateDigest(seq, selection).slice(0, 16);
    expect('live-update', seq > 0, `no updates applied (s=${seq})`);
    expect('live-update', bgState.payloadFields.d === expected, `state digest ${bgState.payloadFields.d} != reference ${expected} at seq ${seq}`);
    lastSeqLo = seq;
    return `${seq} updates applied; state digest at seq ${seq} equals the reference`;
  });

  await runCheck('background-foreground', async () => {
    expect('background-foreground', bgState, 'no background checkpoint');
    const s1 = Number(bgState.payloadFields.s);
    let from = markers.length;
    await foreground();
    await waitMarker(j, 'fg', () => true, 15000, from);
    const open = await waitMarker(j, 'stream.open', () => true, 15000, from);
    expect('background-foreground', Number(open.payloadFields.from) === s1 + 1, `resumed from ${open.payloadFields.from}, expected ${s1 + 1}`);
    await sleep(3000);
    from = markers.length;
    await home();
    const st = await waitMarker(j, 'state', () => true, 10000, from);
    const s2 = Number(st.payloadFields.s);
    const expected = model.stateDigest(s2, selection).slice(0, 16);
    expect('background-foreground', s2 > s1, `no progress after foreground (${s1} -> ${s2})`);
    expect('background-foreground', st.payloadFields.d === expected, `digest at seq ${s2} ${st.payloadFields.d} != ${expected}`);
    return `checkpoint at ${s1}, resumed from ${s1 + 1}, digest at ${s2} equals the reference`;
  });

  await runCheck('restore', async () => {
    let from = markers.length;
    await foreground();
    await waitMarker(j, 'fg', () => true, 15000, from);
    await sleep(800);
    ui = await dump();
    from = markers.length;
    await tap(ui.find('mb.row.2.label') ?? fail0('mb.row.2.label'));
    await screen(j, 'detail/2', from);
    from = markers.length;
    await home();
    const st = await waitMarker(j, 'state', () => true, 10000, from);
    const s = Number(st.payloadFields.s);
    await stop();
    j = await launch({ 'mb.restore': '1' });
    const r = await waitMarker(j, 'restore', () => true, 30000);
    expect('restore', r.payloadFields.r === 'detail/2', `restored route ${r.payloadFields.r}`);
    const open = await waitMarker(j, 'stream.open', () => true, 15000);
    expect('restore', Number(open.payloadFields.from) === s + 1, `restore resumed from ${open.payloadFields.from}, expected ${s + 1}`);
    const d = await dump();
    expect('restore', d.find('mb.screen.detail'), 'restored screen is not Detail');
    const a = /(\d+\.\d\d)/.exec(textOf(d.find('mb.detail.values.a') ?? { all: [] }))?.[1];
    const allowed = [...model.valueSet(2, 0, s, await seqUpperBound(j))].map((x) => model.fmtValue(x));
    expect('restore', allowed.includes(a), `restored detail value ${a} not in ${allowed.join('|')}`);
    return `process-cold restore to detail/2, state at seq ${s}, resumed from ${s + 1}`;
  });

  await runCheck('error-behavior', async () => {
    await stop();
    j = await launch({ 'mb.bogus': '1' });
    const e1 = await waitMarker(j, 'err', () => true, 20000);
    expect('error-behavior', /launch-config/.test(e1.payload), `unknown key gave ${e1.payload}`);
    await stop();
    await resetData();
    j = await launch({ 'mb.restore': '1' });
    const e2 = await waitMarker(j, 'err', () => true, 20000);
    expect('error-behavior', /persist-read/.test(e2.payload), `missing restore record gave ${e2.payload}`);
    const f = await waitMarker(j, 'fui', () => true, 30000);
    expect('error-behavior', f.payloadFields.seq === '0' && Number(f.payloadFields.sel) === model.golden.seq0Summary.selectedCount,
      `fallback state ${f.payload}`);
    return `unknown launch key -> ${e1.payload}; unreadable restore record -> ${e2.payload} and the initial fixture`;
  });

  await stop();
  logcat.kill();

  // ---------------------------------------------------------------------------------------------- receipt
  const checks = CONTRACT.requiredChecks.map((id) => results.get(id) ?? { id, status: 'failed', detail: 'not run' });
  const passed = checks.every((c) => c.status === 'passed' || (c.status === 'waived' && CONTRACT.descriptiveWaivable?.[c.id]));
  const evidence = ['evidence.jsonl', 'markers.log'].map((p) => ({ path: p, sha256: sha256File(join(out, p)) }));
  const receipt = { schema: 'mobilebench.acceptance-receipt/1.0.0', suiteId: CONTRACT.suiteId,
    status: passed ? 'passed' : 'failed', candidateId: args.candidate, platform: 'android', artifactSha256, designSha256,
    driver: { id: 'tools/acceptance/android.mjs', sha256: sha256(readFileSync(new URL(import.meta.url))), profile: args.profile },
    checks, evidence };
  writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const c of checks) process.stdout.write(`${c.status.padEnd(7)} ${c.id}${c.detail ? `: ${c.detail}` : ''}\n`);
  process.stdout.write(`${receipt.status}: ${relative(repo, join(out, 'receipt.json'))}\n`);
  process.exitCode = passed ? 0 : 1;
}

function fail0(what) {
  throw new Error(`${what} missing`);
}

main().catch((e) => {
  logcat.kill();
  process.stderr.write(`driver error: ${e.stack}\n`);
  process.exitCode = 2;
});
