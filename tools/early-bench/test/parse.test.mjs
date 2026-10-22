// Parsers against logs captured from a candidate on the emulator (fixtures/*.txt) and documented formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkFuiPayload, findCrash, parseAdbDevices, parseAmStart, parseBadging, parseBroadcastResult, parseDexopt,
  parseDisplayed, parseDurationMs, parseFullyDrawn, parseLoadavg, parseMarkersJsonl, parseMbLogcat, parseMeminfo,
  parseOslogNdjson, parsePayload, parsePmsetBatt, parsePmsetTherm, parseProcStatus, parseResolveActivity,
  parseSfRefreshPeriod, parseSimctlLaunch, parseBoottime, parseIni, crashClass, streamConnectBeforeFui,
} from '../lib/parse.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (f) => readFileSync(join(FIX, f), 'utf8');
const PKG = 'org.example.mobilebench.nativeapp';

test('am start -W output (captured)', () => {
  const r = parseAmStart(read('am-start-cold.txt'));
  assert.equal(r.status, 'ok');
  assert.equal(r.launchState, 'COLD');
  assert.equal(r.totalTimeMs, 1143);
  assert.equal(r.waitTimeMs, 1147);
  assert.deepEqual(r.refs.totalTime, { line: 5, text: 'TotalTime: 1143' });
  assert.deepEqual(r.errors, []);
  const bad = parseAmStart('Starting: Intent { cmp=x/.A }\nError: Activity class {x/.A} does not exist.\n');
  assert.equal(bad.totalTimeMs, null);
  assert.equal(bad.errors.length, 1);
});

test('logcat Fully drawn / Displayed lines and MB marker mirror (captured)', () => {
  const t = read('logcat-cold.txt');
  const fd = parseFullyDrawn(t, PKG);
  assert.equal(fd.length, 1);
  assert.equal(fd[0].ms, 1146);
  assert.equal(fd[0].line, 9);
  assert.ok(fd[0].text.includes('Fully drawn org.example.mobilebench.nativeapp/.MainActivity: +1s146ms'));
  assert.equal(parseDisplayed(t, PKG)[0].ms, 1143);
  assert.deepEqual(parseFullyDrawn(t, 'org.example.other'), []);
  const mb = parseMbLogcat(t, 'none');
  assert.deepEqual(mb.map((m) => m.event), ['launch', 'a11y', 'fui']);
  const fui = mb[2];
  assert.equal(fui.payload, 'rows=10;h=730;sel=50;seq=0');
  assert.equal(fui.t, '124811096017');
  assert.equal(fui.line, 7);
  assert.equal(parseMbLogcat(t, 'other').length, 0);
});

test('marker mirror variants: extra fields and unified-log messages', () => {
  const l = '1792668593.191  5179  5179 I MobileBench: MB j1 sel.drawn 2 rev=2;sel=51;tot=12345 t=99 w=1700000000000000';
  const [m] = parseMbLogcat(l);
  assert.equal(m.event, 'sel.drawn');
  assert.equal(m.t, '99');
  assert.equal(m.extras.w, '1700000000000000');
  assert.equal(parseMbLogcat('MB j1 fui 1 rows=9;h=700;sel=50;seq=0').length, 1);
});

test('fui payload check (C-3 subset)', () => {
  assert.deepEqual(checkFuiPayload('rows=10;h=730;sel=50;seq=0', 50), { pass: true, problems: [], notChecked: ['h-vs-h_ref:no-layout-reference'] });
  assert.equal(checkFuiPayload('rows=10;h=730;sel=50;seq=0', 49).pass, false);
  assert.equal(checkFuiPayload('rows=11;h=730;sel=50;seq=0', 50).pass, false);
  assert.equal(checkFuiPayload('rows=10;h=730;sel=50;seq=3', 50).pass, false);
  assert.equal(checkFuiPayload('rows=10;h=730;sel=50;seq=0', null).pass, true);
  assert.deepEqual(parsePayload('fp=123;pk=456'), { fp: '123', pk: '456' });
});

test('Android duration tokens', () => {
  assert.equal(parseDurationMs('+1s146ms'), 1146);
  assert.equal(parseDurationMs('850ms'), 850);
  assert.equal(parseDurationMs('1m2s3ms'), 62003);
  assert.equal(parseDurationMs('2s'), 2000);
  assert.equal(parseDurationMs('abc'), null);
  assert.equal(parseDurationMs(''), null);
});

test('dumpsys meminfo (captured): TOTAL PSS and App Summary rows, not the table rows', () => {
  const m = parseMeminfo(read('meminfo.txt'));
  assert.equal(m.pid, 5678);
  assert.equal(m.totalPssKb, 22386);
  assert.ok(m.refs.totalPssKb.text.includes('TOTAL PSS:'));
  assert.equal(m.javaHeapKb, 4776);
  assert.equal(m.nativeHeapKb, 9164);
  assert.equal(m.graphicsKb, 0);
  const tableOnly = parseMeminfo('** MEMINFO in pid 7 [x] **\n        TOTAL    32466    14132\n');
  assert.equal(tableOnly.totalPssKb, 32466);
});

test('dexopt state section (ART service format) and a truncated capture', () => {
  const t = [
    'Dexopt state:',
    '  [org.example.mobilebench.nativeapp]',
    '    path: /data/app/~~abc==/org.example.mobilebench.nativeapp-def==/base.apk',
    '      arm64: [status=speed-profile] [reason=install-dm] [primary-abi]',
    '        [location is /data/app/~~abc==/org.example.mobilebench.nativeapp-def==/oat/arm64/base.odex]',
    'Compiler stats:',
    '  arm64: [status=verify] [reason=ignored]',
  ].join('\n');
  const d = parseDexopt(t);
  assert.equal(d.summary, 'arm64=speed-profile');
  assert.equal(d.entries[0].reason, 'install-dm');
  assert.equal(d.entries[0].line, 4);
  assert.equal(parseDexopt('Dexopt state:\n  [pkg]\n    path: /data/app/x/base.apk\n').summary, null);
});

test('proc status, badging, resolve-activity, broadcast, crash', () => {
  const p = parseProcStatus('Name:\tx\nVmHWM:\t  120000 kB\nVmRSS:\t   98000 kB\n');
  assert.deepEqual([p.vmRssKb, p.vmHwmKb, p.refs.vmRssKb.line], [98000, 120000, 3]);
  assert.deepEqual(parseBadging("package: name='org.example.a' versionCode='1'\napplication-debuggable\n"), { packageName: 'org.example.a', debuggable: true });
  assert.equal(parseBadging("package: name='org.example.a'\n").debuggable, false);
  assert.equal(parseResolveActivity('priority=0 preferredOrder=0\norg.example.a/.MainActivity\n'), 'org.example.a/.MainActivity');
  assert.equal(parseResolveActivity('No activity found\n'), null);
  assert.equal(parseBroadcastResult('Broadcasting: Intent { ... }\nBroadcast completed: result=1\n'), 1);
  const crash = '1.0 10 10 E AndroidRuntime: FATAL EXCEPTION: main\n1.0 10 10 E AndroidRuntime: Process: org.example.a, PID: 10\n';
  assert.equal(findCrash(crash, 'org.example.a').length, 1);
  assert.equal(findCrash(crash, 'org.example.b').length, 0);
});

test('iOS: simctl launch, unified log ndjson, marker buffer (one JSON object per line)', () => {
  assert.equal(parseSimctlLaunch('org.example.mobilebench.flutter: 12345\n'), 12345);
  assert.equal(parseSimctlLaunch('An error was encountered'), null);
  const nd = [
    'Filtering the log data using "eventMessage BEGINSWITH \\"MB \\""',
    JSON.stringify({ eventMessage: 'MB j7 fui 1 rows=9;h=700;sel=50;seq=0 t=5000', processID: 42 }),
    JSON.stringify({ eventMessage: 'MB j8 fui 1 rows=9;h=700;sel=50;seq=0 t=6000', processID: 43 }),
  ].join('\n');
  const o = parseOslogNdjson(nd, 'j7');
  assert.equal(o.length, 1);
  assert.equal(o[0].t, '5000');
  assert.equal(o[0].line, 2);
  const mk = parseMarkersJsonl('{"e":"fui","n":1,"t":123456789012,"p":"rows=9;h=700;sel=50;seq=0"}\n{"e":"mem","n":1,"t":2,"p":"fp=100;pk=200"}\n{"e":"st');
  assert.deepEqual(mk.map((m) => [m.event, m.t]), [['fui', '123456789012'], ['mem', '2']]);
});

test('host and device helpers', () => {
  assert.deepEqual(parsePmsetBatt("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t85%; charged;"), { source: 'AC Power', percent: 85 });
  assert.equal(parsePmsetTherm('Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded').warning, false);
  assert.equal(parsePmsetTherm('CPU_Scheduler_Limit = 100\nThermal warning level: 2').warning, true);
  assert.deepEqual(parseLoadavg('{ 74.03 91.58 88.85 }'), [74.03, 91.58, 88.85]);
  assert.equal(parseBoottime('{ sec = 1700000000, usec = 5 } Thu'), 1700000000);
  assert.equal(parseSfRefreshPeriod('16666666\n\n'), 16666666);
  assert.equal(parseSfRefreshPeriod(''), null);
  assert.deepEqual(parseAdbDevices('List of devices attached\nemulator-5554\tdevice\n\n'), [{ serial: 'emulator-5554', state: 'device' }]);
  assert.deepEqual(parseIni('hw.cpu.ncore=4\n# c\nhw.ramSize = 4096\n'), { 'hw.cpu.ncore': '4', 'hw.ramSize': '4096' });
});

test('ANR evidence is candidate-anr, crash evidence candidate-crash', () => {
  const anr = '1.0 10 10 E ActivityManager: ANR in org.example.a (org.example.a/.MainActivity)\n1.0 10 10 E ActivityManager: PID: 10\n';
  const hits = findCrash(anr, 'org.example.a');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'anr');
  assert.equal(crashClass(hits), 'candidate-anr');
  const both = `${anr}1.0 10 10 E AndroidRuntime: FATAL EXCEPTION: main\n1.0 10 10 E AndroidRuntime: Process: org.example.a, PID: 10\n`;
  assert.equal(crashClass(findCrash(both, 'org.example.a')), 'candidate-crash');
  assert.equal(crashClass([]), null);
});

test('dexopt state inside a full dumpsys package dump; reason optional; unreadable is null', () => {
  const full = [
    'Activity Resolver Table:', '  Non-Data Actions:', '      android.intent.action.MAIN:', '',
    'Dexopt state:', '  [org.example.a]', '    path: /data/app/~~x==/org.example.a-y==/base.apk',
    '      arm64: [status=verify]', '', 'Compiler stats:', '  [org.example.a]',
  ].join('\n');
  const d = parseDexopt(full);
  assert.equal(d.summary, 'arm64=verify');
  assert.equal(d.entries[0].reason, null);
  assert.equal(d.entries[0].line, 8);
  assert.equal(parseDexopt('Packages:\n  Package [org.example.a]\n').summary, null);
});

test('fui payload check reports what it cannot check and uses h_ref when present', () => {
  const r = checkFuiPayload('rows=10;h=730;sel=50;seq=0', 50);
  assert.equal(r.pass, true);
  assert.deepEqual(r.notChecked, ['h-vs-h_ref:no-layout-reference']);
  assert.equal(checkFuiPayload('rows=10;h=730;sel=50;seq=0', 50, { hRef: 731 }).pass, true);
  const off = checkFuiPayload('rows=10;h=730;sel=50;seq=0', 50, { hRef: 760 });
  assert.equal(off.pass, false);
  assert.deepEqual(off.notChecked, []);
});

test('stream.connect must not precede fui in the marker buffer', () => {
  const ok = parseMarkersJsonl('{"e":"launch","n":1,"t":1,"p":"x"}\n{"e":"fui","n":1,"t":2,"p":"rows=1;h=72;sel=50;seq=0"}\n{"e":"stream.connect","n":1,"t":3,"p":"a=1"}\n');
  assert.deepEqual(streamConnectBeforeFui(ok), { pass: true, ref: null });
  const bad = parseMarkersJsonl('{"e":"stream.connect","n":1,"t":1,"p":"a=1"}\n{"e":"fui","n":1,"t":2,"p":"rows=1;h=72;sel=50;seq=0"}\n');
  const r = streamConnectBeforeFui(bad);
  assert.equal(r.pass, false);
  assert.equal(r.ref.line, 1);
  assert.equal(streamConnectBeforeFui([]).pass, null);
});
