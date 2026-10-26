// Platform-independent acceptance checks (design §8). A platform driver (android.mjs, ios.mjs) supplies a device
// adapter; every check is decided here against the reference model (fixtures + generator stream), and the result is
// an artifact-bound receipt plus hashed evidence.
//
// Device adapter:
//   platform                     'android' | 'ios'
//   rowExtent                    72 dp / pt in dump coordinates
//   unit                         'dp' | 'pt'
//   markers                      array the adapter appends parsed markers to ({journeyId, event, payload, t, ...})
//   evidenceFiles                raw files (relative to out) the receipt hashes besides evidence.jsonl
//   install(), launch(journey, extras), stop(), resetData(), home(), foreground()
//   dump() -> { nodes, find }    nodes: { id, desc, text, checked, bounds: {l,t,r,b}, all: [descendants] }
//   tap(node), back(ui)
//   secondsSince(marker)         time since the marker on the clock the app's markers use
//   buildPolicy() -> { problems: [], detail }
//   close()
import { appendFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sleep } from '../early-bench/lib/exec.mjs';
import { hashArtifact } from '../early-bench/lib/candidates.mjs';
import { sha256, sha256File } from '../early-bench/lib/hash.mjs';
import { CONTRACT } from './lib.mjs';
import { ReferenceModel, itemLabel, OPTION_KEYS } from './model.mjs';

const SCREEN_ROOT = { list: 'mb.screen.list', selection: 'mb.screen.selection', insights: 'mb.screen.insights' };
// Content that must be on screen before a dump counts: a host's screen container can precede an island's
// accessibility tree, and a list container its rows.
const SCREEN_CONTENT = {
  list: [/^mb\.row\.\d+\.label$/],
  insights: [/^mb\.insights\.top$/, /^mb\.insights\.source$/],
  detail: [/^mb\.detail\.values\.a$/],
};

export function markerFields(payload) {
  return Object.fromEntries(payload.split(';').filter((kv) => kv.includes('=')).map((kv) => kv.split('=')));
}

/** Text of a node: its descendants' text when they carry any (toolkits put button and cell text in child views, and
 * iOS containers repeat their children's labels as an aggregate label), else its own. */
export function textOf(node) {
  if (!node) return '';
  const own = (n) => n.text || n.desc;
  // Leaves only: an element and its static-text child often carry the same label.
  const inner = node.all.filter((n) => own(n) && !n.all.some(own)).map(own);
  return inner.length > 0 ? inner.join('\n') : [node.text, node.desc].filter(Boolean).join('\n');
}

const fmtValue = (v) => `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;

export async function runAcceptance({ repo, candidateId, profile, out, artifactPath, driverFiles, device }) {
  const model = new ReferenceModel(repo, profile);
  const evidencePath = join(out, 'evidence.jsonl');
  writeFileSync(evidencePath, '');
  const { markers } = device;
  const log = (check, step, data = {}) => appendFileSync(evidencePath, `${JSON.stringify({ check, step, ...data })}\n`);
  const results = new Map();
  let selection = model.selection.map((s) => ({ ...s }));
  let journeyNo = 0;

  const expect = (cond, detail) => {
    if (!cond) throw new Error(detail);
  };
  const need = (node, what) => node ?? expect(false, `${what} missing`);
  const valueOf = (node) => /(\d+\.\d\d)/.exec(textOf(node))?.[1];

  async function waitMarker(journey, event, pred = () => true, timeoutMs = 20000, from = 0) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = markers.slice(from).find((x) => x.journeyId === journey && x.event === event && pred(x));
      if (m) return m;
      if (Date.now() > deadline) throw new Error(`timeout waiting for ${event} in ${journey}`);
      await sleep(100);
    }
  }

  async function launch(extras = {}) {
    const journey = `acc${process.pid % 1000}x${++journeyNo}`;
    await device.launch(journey, { 'mb.journeyMode': '1', 'mb.profile': profile, 'mb.markerMirror': 'all', ...extras });
    return journey;
  }

  /** HOME, then both the background marker and the checkpoint (toolkits emit them in either order). */
  async function background(journey) {
    const from = markers.length;
    await device.home();
    await waitMarker(journey, 'bg', () => true, 10000, from);
    return waitMarker(journey, 'state', () => true, 10000, from);
  }

  /** Returns to the List screen (a failed check may leave another screen on top). */
  async function ensureList() {
    for (let i = 0; i < 4; i += 1) {
      const ui = await device.dump();
      if (ui.find('mb.screen.list')) return ui;
      await device.back(ui);
      await sleep(800);
    }
    throw new Error('cannot return to the List screen');
  }

  /** Waits for the route's screen marker (a navigation), then for its root element. */
  async function screen(journey, route, from) {
    await waitMarker(journey, 'screen', (m) => m.payloadFields.r === route, 15000, from);
    return shown(route);
  }

  /** Waits for the route's root element (island content can follow the host's marker; an initial or restored route
   * is not a navigation, and some candidates mark no `screen` for it). */
  async function shown(route) {
    const root = SCREEN_ROOT[route] ?? 'mb.screen.detail';
    const deadline = Date.now() + 10000;
    for (;;) {
      await sleep(400);
      const ui = await device.dump();
      const content = SCREEN_CONTENT[route.split('/')[0]] ?? [];
      const ready = ui.find(root) && content.every((re) => ui.nodes.some((n) => re.test(n.id)));
      if (ready || Date.now() > deadline) return ui;
    }
  }

  /** Highest seq the app can have applied now: the replay is paced at the profile rate from stream.open. */
  function seqUpperBound(journey) {
    const open = [...markers].reverse().find((m) => m.journeyId === journey && m.event === 'stream.open');
    if (!open) return Promise.resolve(0);
    const from = Number(open.payloadFields.from ?? 1);
    return device.secondsSince(open).then((s) => from - 1 + Math.ceil(s * model.rate) + 3);
  }

  /** The list's on-screen bounds: its frame clipped to the window (an iOS table may report its content frame). */
  const listBounds = (ui) => {
    const list = ui.find('mb.list');
    if (!list) return null;
    const w = ui.nodes[0].bounds;
    return { l: Math.max(list.bounds.l, w.l), t: Math.max(list.bounds.t, w.t), r: Math.min(list.bounds.r, w.r), b: Math.min(list.bounds.b, w.b) };
  };

  /** Rows on screen, identified by their labels inside the list's on-screen bounds (iOS snapshots also contain
   * off-screen and not-yet-created cells, the latter as label-less placeholders). */
  const rowIndices = (ui) => {
    const list = listBounds(ui);
    const visible = (n) => !list || (n.bounds.b > list.t + 1 && n.bounds.t < list.b - 1 && n.bounds.b > n.bounds.t);
    return ui.nodes.filter((n) => /^mb\.row\.\d+\.label$/.test(n.id) && visible(n)).map((n) => Number(n.id.split('.')[2]));
  };

  /** Row slots: the row elements when the toolkit exposes them, else derived from the label pitch (rows are
   * contiguous with a fixed extent, so each row starts where its label starts minus the first label's offset). */
  const rowSlots = (ui, list) => {
    const labels = rowIndices(ui).map((i) => ({ i, label: ui.find(`mb.row.${i}.label`) })).sort((a, b) => a.label.bounds.t - b.label.bounds.t);
    const rows = labels.map(({ i, label }) => {
      const row = ui.find(`mb.row.${i}`);
      const contains = row && row.bounds.t <= label.bounds.t && row.bounds.b >= label.bounds.b;
      return { i, bounds: contains ? row.bounds : null, label };
    });
    if (rows.every((r) => r.bounds)) return rows;
    const offset = rows[0].label.bounds.t - list.t;
    const pitch = rows.length > 1 ? rows[1].label.bounds.t - rows[0].label.bounds.t : device.rowExtent;
    return rows.map((r) => {
      const t = r.label.bounds.t - offset;
      return { ...r, bounds: { l: list.l, r: list.r, t, b: t + pitch }, derived: true };
    });
  };

  /** Visible rows: labels exact; option state exact; values and total consistent with the stream window. */
  function checkList(id, ui, lo, hi) {
    const rows = rowIndices(ui);
    expect(rows.length > 0, 'no list rows (mb.row.<i>) visible');
    for (const i of rows) {
      const label = ui.find(`mb.row.${i}.label`);
      expect(label && textOf(label).includes(itemLabel(i, model.items)), `row ${i} label ${textOf(label)}`);
      OPTION_KEYS.forEach((k, o) => {
        const opt = need(ui.find(`mb.row.${i}.opt.${k}`), `row ${i} option ${k}`);
        const selected = selection.some((s) => s.i === i && s.o === o);
        expect(opt.checked === selected, `row ${i} option ${k} checked/selected=${opt.checked}, expected ${selected}`);
        const v = valueOf(opt);
        const allowed = [...model.valueSet(i, o, lo, hi)].map(fmtValue);
        expect(v && allowed.includes(v), `row ${i} option ${k} shows ${v}, expected one of ${allowed.join('|')} (seq ${lo}..${hi})`);
      });
    }
    const count = textOf(ui.find('mb.summary.count'));
    expect(count.includes(`Selected ${selection.length}`), `summary count "${count}"`);
    const total = valueOf(ui.find('mb.summary.total'));
    expect(model.totalTexts(selection, lo, hi).has(total), `summary total ${total} not in seq ${lo}..${hi}`);
    log(id, 'list', { rows, count, total, window: [lo, hi] });
    return rows;
  }

  async function runCheck(id, fn) {
    try {
      const detail = await fn();
      results.set(id, { id, status: 'passed', ...(detail ? { detail } : {}) });
      log(id, 'passed', { detail: detail ?? null });
    } catch (e) {
      results.set(id, { id, status: 'failed', detail: e.message });
      log(id, 'failed', { detail: e.message });
    }
  }

  // ---------------------------------------------------------------------------------------------- checks
  const designSha256 = sha256File(join(repo, 'design.md'));
  // The runner's artifact identity: file bytes for an APK, the tree hash for an .app directory.
  const artifactSha256 = hashArtifact(artifactPath).sha256;
  log('setup', 'artifact', { candidate: candidateId, platform: device.platform, artifact: relative(repo, artifactPath),
    artifactSha256, designSha256, rowExtent: device.rowExtent });

  await runCheck('build-policy', async () => {
    const { problems, detail } = await device.buildPolicy();
    expect(problems.length === 0, problems.join('; '));
    return detail;
  });
  results.set('instrumentation-overhead', { id: 'instrumentation-overhead', status: 'waived',
    reason: CONTRACT.descriptiveWaivable['instrumentation-overhead'] });

  // R-INSTALL from the frozen artifact, R-DATA.
  await device.install();
  await device.resetData();

  let j = await launch();
  const fui = await waitMarker(j, 'fui', () => true, 30000);
  let ui = await shown('list');
  const hi0 = await seqUpperBound(j);

  await runCheck('initial-state', async () => {
    expect(fui.payloadFields.seq === '0', `fui seq=${fui.payloadFields.seq}`);
    expect(Number(fui.payloadFields.sel) === model.golden.seq0Summary.selectedCount, `fui sel=${fui.payloadFields.sel}`);
    expect(ui.find('mb.screen.list'), 'mb.screen.list missing');
    const rows = checkList('initial-state', ui, 0, hi0);
    return `${rows.length} rows, labels/selection exact, values within seq 0..${hi0}`;
  });

  await runCheck('list-geometry', async () => {
    need(ui.find('mb.list'), 'mb.list');
    const list = { bounds: listBounds(ui) };
    const extent = device.rowExtent;
    const rows = rowSlots(ui, list.bounds).map((r) => ({ id: `mb.row.${r.i}`, bounds: r.bounds }));
    // Dumped bounds may be clipped to the viewport: a row touching a list edge may be partly visible.
    const inside = (n) => n.bounds.t >= list.bounds.t - 1 && n.bounds.b <= list.bounds.b + 1;
    const atEdge = (n) => Math.abs(n.bounds.t - list.bounds.t) <= 1 || Math.abs(n.bounds.b - list.bounds.b) <= 1;
    const fullHeight = (n) => Math.abs(n.bounds.b - n.bounds.t - extent) <= 2;
    for (const r of rows.filter((n) => inside(n) && !atEdge(n))) {
      expect(fullHeight(r), `row ${r.id} height ${r.bounds.b - r.bounds.t}, expected ${extent.toFixed(1)} (72 ${device.unit})`);
    }
    const full = rows.filter((n) => inside(n) && fullHeight(n));
    const expected = Math.max(1, Math.floor((list.bounds.b - list.bounds.t) / extent));
    expect(full.length === Number(fui.payloadFields.rows), `fully visible rows ${full.length} != fui rows ${fui.payloadFields.rows}`);
    expect(Number(fui.payloadFields.rows) === expected, `fui rows ${fui.payloadFields.rows} != floor(h/72) ${expected}`);
    return `${full.length} rows of 72 ${device.unit} in a ${((list.bounds.b - list.bounds.t) / (extent / 72)).toFixed(0)} ${device.unit} list`;
  });

  await runCheck('navigation', async () => {
    ui = await ensureList();
    let from = markers.length;
    await device.tap(need(ui.find('mb.nav.selection'), 'mb.nav.selection'));
    let s = await screen(j, 'selection', from);
    expect(s.find('mb.screen.selection'), 'mb.screen.selection missing');
    from = markers.length;
    await device.back(s);
    s = await screen(j, 'list', from);
    checkList('navigation', s, 0, await seqUpperBound(j));
    from = markers.length;
    await device.tap(need(s.find('mb.row.1.label'), 'mb.row.1.label'));
    s = await screen(j, 'detail/1', from);
    expect(s.find('mb.screen.detail'), 'mb.screen.detail missing');
    const a = valueOf(s.find('mb.detail.values.a'));
    const allowed = [...model.valueSet(1, 0, 0, await seqUpperBound(j))].map(fmtValue);
    expect(allowed.includes(a), `detail value A ${a} not in ${allowed.join('|')}`);
    from = markers.length;
    await device.back(s);
    s = await screen(j, 'list', from);
    checkList('navigation', s, 0, await seqUpperBound(j));
    ui = s;
    return 'list -> selection -> list -> detail/1 -> list with live state';
  });

  await runCheck('insights', async () => {
    ui = await ensureList();
    const from = markers.length;
    await device.tap(need(ui.find('mb.nav.insights'), 'mb.nav.insights'));
    const s = await screen(j, 'insights', from);
    await waitMarker(j, 'remote.ready', () => true, 15000, from);
    const src = await waitMarker(j, 'remote.source', () => true, 1000, from);
    expect(src.payloadFields.src === 'embedded', `remote.source ${src.payload}`);
    expect(s.find('mb.screen.insights'), 'mb.screen.insights missing');
    const top = [...textOf(s.find('mb.insights.top')).matchAll(/Item (\d+)\D+?(\d+\.\d\d)/g)].map((m) => [Number(m[1]), m[2]]);
    const buckets = (textOf(s.find('mb.insights.buckets')).match(/\d+/g) ?? []).map(Number);
    const sourceText = textOf(s.find('mb.insights.source'));
    expect(sourceText.includes('embedded'), `mb.insights.source shows "${sourceText}"`);
    const hi = await seqUpperBound(j);
    let match = null;
    for (const m of model.insights(0, hi)) {
      const same = m.top.length === top.length && m.top.every(([i, a], k) => top[k][0] === i && top[k][1] === fmtValue(a))
        && m.buckets.join() === buckets.join();
      if (same) match = m.seq;
    }
    log('insights', 'shown', { top, buckets });
    expect(match !== null, `top ${JSON.stringify(top)} buckets ${buckets} match no seq in 0..${hi}`);
    const from2 = markers.length;
    await device.back(s);
    ui = await screen(j, 'list', from2);
    return `top 5 and buckets equal the reference at seq ${match}; source embedded; remote.ready`;
  });

  await runCheck('selection-semantics', async () => {
    ui = await ensureList();
    const row = rowIndices(ui).find((i) => !selection.some((s) => s.i === i));
    expect(row !== undefined, 'no visible unselected row');
    for (const [key, o, what] of [['a', 0, 'select'], ['b', 1, 'replace'], ['b', null, 'deselect']]) {
      const from = markers.length;
      await device.tap(need(ui.find(`mb.row.${row}.opt.${key}`), `mb.row.${row}.opt.${key}`));
      await waitMarker(j, 'resp', () => true, 10000, from);
      selection = selection.filter((s) => s.i !== row);
      if (o !== null) selection.push({ i: row, o });
      await sleep(300);
      ui = await device.dump();
      checkList('selection-semantics', ui, 0, await seqUpperBound(j));
      log('selection-semantics', what, { row, option: key });
    }
    return `row ${row}: select A, replace with B, deselect B; count and total follow`;
  });

  let bgState = null;
  await runCheck('live-update', async () => {
    await sleep(3000);
    bgState = await background(j);
    const seq = Number(bgState.payloadFields.s);
    const expected = model.stateDigest(seq, selection).slice(0, 16);
    expect(seq > 0, `no updates applied (s=${seq})`);
    expect(bgState.payloadFields.d === expected, `state digest ${bgState.payloadFields.d} != reference ${expected} at seq ${seq}`);
    return `${seq} updates applied; state digest at seq ${seq} equals the reference`;
  });

  await runCheck('background-foreground', async () => {
    expect(bgState, 'no background checkpoint');
    const s1 = Number(bgState.payloadFields.s);
    const from = markers.length;
    await device.foreground();
    await waitMarker(j, 'fg', () => true, 15000, from);
    const open = await waitMarker(j, 'stream.open', () => true, 15000, from);
    expect(Number(open.payloadFields.from) === s1 + 1, `resumed from ${open.payloadFields.from}, expected ${s1 + 1}`);
    await sleep(3000);
    const st = await background(j);
    const s2 = Number(st.payloadFields.s);
    const expected = model.stateDigest(s2, selection).slice(0, 16);
    expect(s2 > s1, `no progress after foreground (${s1} -> ${s2})`);
    expect(st.payloadFields.d === expected, `digest at seq ${s2} ${st.payloadFields.d} != ${expected}`);
    return `checkpoint at ${s1}, resumed from ${s1 + 1}, digest at ${s2} equals the reference`;
  });

  await runCheck('restore', async () => {
    let from = markers.length;
    await device.foreground();
    await waitMarker(j, 'fg', () => true, 15000, from);
    await sleep(800);
    ui = await ensureList();
    from = markers.length;
    await device.tap(need(ui.find('mb.row.2.label'), 'mb.row.2.label'));
    await screen(j, 'detail/2', from);
    const st = await background(j);
    const s = Number(st.payloadFields.s);
    await device.stop();
    j = await launch({ 'mb.restore': '1' });
    const r = await waitMarker(j, 'restore', () => true, 30000);
    expect(r.payloadFields.r === 'detail/2', `restored route ${r.payloadFields.r}`);
    const open = await waitMarker(j, 'stream.open', () => true, 15000);
    expect(Number(open.payloadFields.from) === s + 1, `restore resumed from ${open.payloadFields.from}, expected ${s + 1}`);
    const d = await shown('detail/2');
    expect(d.find('mb.screen.detail'), 'restored screen is not Detail');
    const a = valueOf(d.find('mb.detail.values.a'));
    const allowed = [...model.valueSet(2, 0, s, await seqUpperBound(j))].map(fmtValue);
    expect(allowed.includes(a), `restored detail value ${a} not in ${allowed.join('|')}`);
    return `process-cold restore to detail/2, state at seq ${s}, resumed from ${s + 1}`;
  });

  await runCheck('error-behavior', async () => {
    await device.stop();
    j = await launch({ 'mb.bogus': '1' });
    const e1 = await waitMarker(j, 'err', () => true, 20000);
    expect(/launch-config/.test(e1.payload), `unknown key gave ${e1.payload}`);
    await device.stop();
    await device.resetData();
    j = await launch({ 'mb.restore': '1' });
    const e2 = await waitMarker(j, 'err', () => true, 20000);
    expect(/persist-read/.test(e2.payload), `missing restore record gave ${e2.payload}`);
    const f = await waitMarker(j, 'fui', () => true, 30000);
    expect(f.payloadFields.seq === '0' && Number(f.payloadFields.sel) === model.golden.seq0Summary.selectedCount,
      `fallback state ${f.payload}`);
    return `unknown launch key -> ${e1.payload}; unreadable restore record -> ${e2.payload} and the initial fixture`;
  });

  await device.stop();
  await device.close();

  // ---------------------------------------------------------------------------------------------- receipt
  const checks = CONTRACT.requiredChecks.map((id) => results.get(id) ?? { id, status: 'failed', detail: 'not run' });
  const passed = checks.every((c) => c.status === 'passed' || (c.status === 'waived' && CONTRACT.descriptiveWaivable?.[c.id]));
  const evidence = ['evidence.jsonl', ...device.evidenceFiles].map((p) => ({ path: p, sha256: sha256File(join(out, p)) }));
  const driverSha = sha256(driverFiles.map((f) => sha256File(f)).join('\n'));
  const receipt = { schema: 'mobilebench.acceptance-receipt/1.0.0', suiteId: CONTRACT.suiteId,
    status: passed ? 'passed' : 'failed', candidateId, platform: device.platform, artifactSha256, designSha256,
    driver: { files: driverFiles.map((f) => relative(repo, f)), sha256: driverSha, profile }, checks, evidence };
  writeFileSync(join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const c of checks) process.stdout.write(`${c.status.padEnd(7)} ${c.id}${c.detail ? `: ${c.detail}` : ''}\n`);
  process.stdout.write(`${receipt.status}: ${relative(repo, join(out, 'receipt.json'))}\n`);
  return passed;
}
