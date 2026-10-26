// early.scroll and installed/download size parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrameTimeline, isJanky, jankNames } from '../lib/frametimeline.mjs';
import {
  frameTimelineMetrics, mergeSfPolls, parseSfLatency, planDurationMs, plausibleFrameCount, sfLatencyMetrics, sfLayersFor,
  swipePlan, swipeScript,
} from '../lib/scroll.mjs';
import {
  parseApkanalyzerBytes, parseBatterystatsUidMah, parseDiskstatsPackage, parsePackageUid, parseThermalservice,
} from '../lib/parse.mjs';

// --- minimal protobuf encoder for synthetic traces ---
function varint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) {
      b |= 0x80;
    }
    out.push(b);
  } while (v > 0n);
  return Buffer.from(out);
}
const key = (f, w) => varint((f << 3) | w);
const vf = (f, n) => Buffer.concat([key(f, 0), varint(n)]);
const lf = (f, buf) => Buffer.concat([key(f, 2), varint(buf.length), buf]);
const str = (s) => Buffer.from(s, 'utf8');
const packet = (ts, ev) => lf(1, Buffer.concat([vf(8, ts), lf(76, ev)]));

function syntheticTrace() {
  const parts = [];
  // pid 100: three frames, one app-deadline-missed (64), one buffer-stuffing (128)
  const frames = [[1, 1000n, 16000000n, 1], [2, 20000000n, 17000000n, 64], [3, 40000000n, 33000000n, 128]];
  for (const [cookie, start, dur, jank] of frames) {
    parts.push(packet(start, lf(4, Buffer.concat([vf(1, cookie), vf(2, cookie + 10), vf(4, 100), lf(5, str('VRI-app#1')), vf(6, 1), vf(9, jank)]))));
    parts.push(packet(start + dur, lf(5, vf(1, cookie))));
  }
  // other pid, and a display frame with a frame_end
  parts.push(packet(5n, lf(4, Buffer.concat([vf(1, 9), vf(4, 200), lf(5, str('other#2')), vf(9, 1)]))));
  parts.push(packet(6n, lf(2, Buffer.concat([vf(1, 50), vf(3, 1)]))));
  parts.push(packet(7n, lf(5, vf(1, 50))));
  return Buffer.concat(parts);
}

test('frametimeline decoder: surface frames, frame_end durations, jank classification', () => {
  const ft = decodeFrameTimeline(syntheticTrace());
  assert.equal(ft.packets, 9);
  assert.equal(ft.actual.length, 4);
  const a = ft.actual.find((x) => x.cookie === 2n);
  assert.equal(a.pid, 100);
  assert.equal(a.layerName, 'VRI-app#1');
  assert.equal(a.durNs, 17000000);
  assert.equal(isJanky(64), true);
  assert.equal(isJanky(128), false);
  assert.equal(isJanky(2048), false);
  assert.equal(isJanky(0), false);
  assert.deepEqual(jankNames(64 | 128), ['app-deadline-missed', 'buffer-stuffing']);
  const m = frameTimelineMetrics(syntheticTrace(), 100);
  assert.equal(m.frames, 3);
  assert.equal(m.janky, 1);
  assert.ok(Math.abs(m.jankyPct - 100 / 3) < 1e-9);
  assert.equal(m.p50, 17000000);
  assert.deepEqual(m.layers, { 'VRI-app#1': 3 });
  assert.equal(frameTimelineMetrics(syntheticTrace(), 999).frames, 0);
});

const SF = (rows) => `16666666\n${rows.map((r) => r.join('\t')).join('\n')}\n0\t0\t0\n`;

test('SurfaceFlinger --latency: parse, merge polls minus baseline, interval metrics', () => {
  const p = parseSfLatency(SF([[100, 1000, 90], [200, 9223372036854775807n, 0]]));
  assert.equal(p.refreshNs, 16666666);
  assert.equal(p.frames.length, 1);
  assert.equal(p.frames[0].line, 2);
  const base = parseSfLatency(SF([[0, 1000, 0]]));
  const t = (k) => 1000 + k * 16666666;
  const poll1 = parseSfLatency(SF([[0, 1000, 0], [0, t(1), 0], [0, t(2), 0]]));
  const poll2 = parseSfLatency(SF([[0, t(4), 0], [0, t(2), 0], [0, t(3), 0], [0, t(3) + 900e6, 0]]));
  const frames = mergeSfPolls(base, [{ parsed: poll1 }, { parsed: poll2 }]);
  assert.deepEqual(frames.map((f) => Number(f.actual)), [t(1), t(2), t(3), t(4), t(3) + 900e6]);
  const m = sfLatencyMetrics(frames, 16666666);
  // intervals t1..t4 (3 x 16.67 ms); t4 -> t3+900ms is ~883 ms > idle gap: excluded
  assert.equal(m.frames, 5);
  assert.equal(m.intervals, 3);
  assert.equal(m.janky, 0);
  assert.equal(m.jankyPct, 0);
  assert.equal(m.p50, 16666666);
  const m2 = sfLatencyMetrics([{ actual: 0n }, { actual: 16666666n }, { actual: 66666666n }], 16666666);
  assert.equal(m2.janky, 1);
  assert.equal(m2.jankyPct, 50);
  assert.deepEqual(parseSfLatency(''), { refreshNs: null, frames: [] });
});

test('frame count plausibility', () => {
  assert.equal(plausibleFrameCount(0, 1e9, 16666666).pass, false);
  assert.equal(plausibleFrameCount(60, 1e9, 16666666).pass, true);
  assert.equal(plausibleFrameCount(200, 1e9, 16666666).pass, false);
});

test('SurfaceFlinger layer list: app window and SurfaceView BLAST layers', () => {
  const text = [
    'RequestedLayerState{b82e8f9 ActivityRecordInputSink org.x.app/.MainActivity#113 parentId=105 z=-2147483648}',
    'RequestedLayerState{c82227e SurfaceView[org.x.app/org.x.app.MainActivity](BLAST)#116 parentId=115}',
    'RequestedLayerState{Background for c82227e SurfaceView[org.x.app/org.x.app.MainActivity]#117 parentId=115}',
    'RequestedLayerState{VRI-org.x.app/org.x.app.MainActivity#109 parentId=107}',
    'RequestedLayerState{VRI-org.other/org.other.Main#5 parentId=1}',
  ].join('\n');
  assert.deepEqual(sfLayersFor(text, 'org.x.app'), ['c82227e SurfaceView[org.x.app/org.x.app.MainActivity](BLAST)#116', 'VRI-org.x.app/org.x.app.MainActivity#109']);
  // API 36 (Samsung One UI): window buffer layer "<pkg>/<activity>$_<pid>#n", SurfaceView "...]@0(BLAST)#n"
  const oneUi = [
    'RequestedLayerState{org.x.app/org.x.app.MainActivity$_16221#581 parentId=580}',
    'RequestedLayerState{15137da org.x.app/org.x.app.MainActivity#580 parentId=573}',
    'RequestedLayerState{f1927e9 SurfaceView[org.x.app/org.x.app.MainActivity]@0(BLAST)#602 parentId=601}',
  ].join('\n');
  assert.deepEqual(sfLayersFor(oneUi, 'org.x.app'), ['org.x.app/org.x.app.MainActivity$_16221#581', 'f1927e9 SurfaceView[org.x.app/org.x.app.MainActivity]@0(BLAST)#602']);
});

test('swipe plan is seeded and stays on screen', () => {
  const a = swipePlan(7, 8);
  assert.deepEqual(a, swipePlan(7, 8));
  assert.notDeepEqual(a, swipePlan(8, 8));
  assert.equal(a.length, 8);
  for (const s of a) {
    assert.ok(s.y1 > 0 && s.y1 < 1 && s.y2 > 0 && s.y2 < 1 && s.x > 0 && s.x < 1);
    assert.ok(s.durationMs >= 80 && s.durationMs <= 180);
  }
  assert.ok(a[3].y2 > a[3].y1);
  assert.ok(a[0].y2 < a[0].y1);
  assert.equal(planDurationMs(a), a.reduce((x, s) => x + s.durationMs + 1200, 0));
  assert.match(swipeScript(a.slice(0, 1), { width: 1000, height: 2000 }), /^input swipe \d+ \d+ \d+ \d+ \d+; sleep 1\.200$/);
});

test('thermalservice HAL temperatures, batterystats uid estimate, package uid (captured on SM-A165F, API 36)', () => {
  const th = [
    'Thermal Status: 0', 'Cached temperatures:', '\tTemperature{mValue=31.0, mType=3, mName=SKIN, mStatus=0}', 'HAL Ready: true',
    'Current temperatures from HAL:', '\tTemperature{mValue=35.6, mType=0, mName=AP, mStatus=0}',
    '\tTemperature{mValue=33.0, mType=3, mName=SKIN, mStatus=0}', 'Current cooling devices from HAL:',
  ].join('\n');
  const t = parseThermalservice(th);
  assert.equal(t.status.value, 0);
  assert.equal(t.hal.SKIN.value, 33.0);
  assert.equal(t.hal.SKIN.ref.line, 7);
  assert.equal(t.hal.AP.value, 35.6);
  assert.deepEqual(Object.keys(t.hal).sort(), ['AP', 'SKIN']);
  const ck = '9,0,i,vers,36,1179864,BP4A.251205.006,BP4A.251205.006\n9,0,l,pwi,uid,9.80,1,0,0\n9,10234,l,pwi,uid,0.368,0,0.1,0\n';
  assert.deepEqual(parseBatterystatsUidMah(ck, 10234), { mah: 0.368, ref: { line: 3, text: '9,10234,l,pwi,uid,0.368,0,0.1,0' } });
  assert.equal(parseBatterystatsUidMah(ck, 10235), null);
  assert.equal(parsePackageUid('package:org.x.app uid:10234\n', 'org.x.app'), 10234);
  assert.equal(parsePackageUid('package:org.x.appz uid:1\n', 'org.x.app'), null);
});

test('diskstats per-package arrays and apkanalyzer output', () => {
  const text = [
    'App Size: 1', 'Package Names: ["a.b","org.x.app"]', 'App Sizes: [8192,6774784]', 'App Data Sizes: [57344,114688]',
    'Cache Sizes: [32768,32768]', '',
  ].join('\n');
  const p = parseDiskstatsPackage(text, 'org.x.app');
  assert.equal(p.codeBytes, 6774784);
  assert.equal(p.dataBytes, 114688);
  assert.equal(p.cacheBytes, 32768);
  assert.equal(p.refs.code.line, 3);
  assert.equal(parseDiskstatsPackage(text, 'missing'), null);
  assert.equal(parseDiskstatsPackage('Package Names: ["a"]\nApp Sizes: [1,2]\nApp Data Sizes: [1]\nCache Sizes: [1]\n', 'a'), null);
  assert.deepEqual(parseApkanalyzerBytes('1320286\n'), { bytes: 1320286, ref: { line: 1, text: '1320286' } });
  assert.equal(parseApkanalyzerBytes('error: no such file\n'), null);
});
