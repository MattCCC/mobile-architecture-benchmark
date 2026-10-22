#!/usr/bin/env node
// Parser dry-run on already captured logs (no device). Prints what each parser extracts, with line refs.
// usage: node dry-run.mjs --package <pkg> [--journey <id>] [--am <file>]... [--logcat <file>]... [--meminfo <file>]...
//        [--dexopt <file>]... [--oslog <file>]... [--markers <file>]...
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkFuiPayload, parseAmStart, parseDexopt, parseDisplayed, parseFullyDrawn, parseMarkersJsonl, parseMbLogcat,
  parseMeminfo, parseOslogNdjson,
} from './lib/parse.mjs';

function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      package: { type: 'string' }, journey: { type: 'string' }, selection: { type: 'string', default: '50' },
      am: { type: 'string', multiple: true, default: [] }, logcat: { type: 'string', multiple: true, default: [] },
      meminfo: { type: 'string', multiple: true, default: [] }, dexopt: { type: 'string', multiple: true, default: [] },
      oslog: { type: 'string', multiple: true, default: [] }, markers: { type: 'string', multiple: true, default: [] },
    },
    strict: true,
  });
  const pkg = values.package ?? '';
  const jid = values.journey ?? null;
  const sel = Number(values.selection);
  const rows = [];
  const add = (kind, file, parsed) => rows.push({ kind, file: basename(file), ...parsed });
  for (const f of values.am) {
    const r = parseAmStart(readFileSync(f, 'utf8'));
    add('am-start', f, { status: r.status, launchState: r.launchState, totalTimeMs: r.totalTimeMs, ref: r.refs.totalTime ?? null, errors: r.errors.length });
  }
  for (const f of values.logcat) {
    const t = readFileSync(f, 'utf8');
    const fd = parseFullyDrawn(t, pkg)[0] ?? null;
    const disp = parseDisplayed(t, pkg)[0] ?? null;
    const fui = parseMbLogcat(t, jid).find((m) => m.event === 'fui') ?? null;
    add('logcat', f, {
      fullyDrawnMs: fd?.ms ?? null, fullyDrawnRef: fd ? { line: fd.line } : null, displayedMs: disp?.ms ?? null,
      fuiMarker: fui ? { journeyId: fui.journeyId, payload: fui.payload, line: fui.line, c3: checkFuiPayload(fui.payload, sel) } : null,
    });
  }
  for (const f of values.meminfo) {
    const m = parseMeminfo(readFileSync(f, 'utf8'));
    add('meminfo', f, { pid: m.pid, totalPssKb: m.totalPssKb, javaHeapKb: m.javaHeapKb, nativeHeapKb: m.nativeHeapKb, graphicsKb: m.graphicsKb, totalRef: m.refs.totalPssKb ?? null });
  }
  for (const f of values.dexopt) {
    const d = parseDexopt(readFileSync(f, 'utf8'));
    add('dexopt', f, { summary: d.summary, entries: d.entries.length });
  }
  for (const f of values.oslog) {
    const o = parseOslogNdjson(readFileSync(f, 'utf8'), jid);
    add('oslog', f, { markers: o.length, fui: o.find((x) => x.event === 'fui')?.t ?? null });
  }
  for (const f of values.markers) {
    const m = parseMarkersJsonl(readFileSync(f, 'utf8'));
    add('markers', f, { markers: m.length, fuiT: m.find((x) => x.event === 'fui')?.t ?? null, mem: m.find((x) => x.event === 'mem')?.payload ?? null });
  }
  process.stdout.write(`${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
