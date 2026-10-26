// Parsers for raw device output. Every parser returns the 1-based line number and the exact line text
// that a value was read from, so each observation can point at its raw source.

export function lines(text) {
  return String(text ?? '').split(/\r?\n/);
}

function ref(lineNo, text) {
  return { line: lineNo, text };
}

// `am start -W` output: Status, LaunchState, Activity, TotalTime, WaitTime, Error/Warning lines.
export function parseAmStart(text) {
  const out = { status: null, launchState: null, activity: null, totalTimeMs: null, waitTimeMs: null, errors: [], refs: {} };
  lines(text).forEach((raw, i) => {
    const l = raw.trim();
    let m;
    if ((m = /^Status:\s*(\S+)/.exec(l))) {
      out.status = m[1];
      out.refs.status = ref(i + 1, raw);
    } else if ((m = /^LaunchState:\s*(\S+)/.exec(l))) {
      out.launchState = m[1];
      out.refs.launchState = ref(i + 1, raw);
    } else if ((m = /^Activity:\s*(\S+)/.exec(l))) {
      out.activity = m[1];
    } else if ((m = /^TotalTime:\s*(\d+)/.exec(l))) {
      out.totalTimeMs = Number(m[1]);
      out.refs.totalTime = ref(i + 1, raw);
    } else if ((m = /^WaitTime:\s*(\d+)/.exec(l))) {
      out.waitTimeMs = Number(m[1]);
    } else if (/^(Error|Warning|Exception)\b/.test(l)) {
      out.errors.push(ref(i + 1, raw));
    }
  });
  return out;
}

// Android TimeUtils.formatDuration tokens such as "1s146ms", "850ms", "1m2s3ms".
export function parseDurationMs(token) {
  const m = /^\+?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(String(token).trim());
  if (!m || m.slice(1).every((x) => x === undefined)) {
    return null;
  }
  const [d, h, mi, s, ms] = m.slice(1).map((x) => Number(x ?? 0));
  return (((d * 24 + h) * 60 + mi) * 60 + s) * 1000 + ms;
}

// logcat -v epoch line: "<sec.ms> <pid> <tid> <level> <tag>: <message>".
export function parseLogcatLine(raw) {
  const m = /^\s*(\d+\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFA])\s+(.*?)\s*:\s(.*)$/.exec(raw);
  if (!m) {
    return null;
  }
  return { epoch: m[1], pid: Number(m[2]), tid: Number(m[3]), level: m[4], tag: m[5], message: m[6] };
}

// Marker mirror lines "MB <journeyId> <event> <n> <payload>[ t=<ns>][ ...]" (logcat or unified log).
export function parseMbMessage(message) {
  const m = /(?:^|\s)MB (\S+) (\S+) (\d+) (\S+)((?: \S+=\S+)*)\s*$/.exec(message);
  if (!m) {
    return null;
  }
  const extras = {};
  for (const kv of m[5].trim().split(/\s+/).filter(Boolean)) {
    const eq = kv.indexOf('=');
    extras[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return { journeyId: m[1], event: m[2], n: Number(m[3]), payload: m[4], t: extras.t ?? null, extras };
}

export function parseMbLogcat(text, journeyId = null) {
  const out = [];
  lines(text).forEach((raw, i) => {
    const l = parseLogcatLine(raw);
    const msg = l ? l.message : raw;
    const mb = parseMbMessage(msg);
    if (mb && (journeyId === null || mb.journeyId === journeyId)) {
      out.push({ ...mb, pid: l ? l.pid : null, ...ref(i + 1, raw) });
    }
  });
  return out;
}

// "Fully drawn <component>: +1s146ms" / "Displayed <component> for user 0: +1s143ms" (ActivityTaskManager).
function parseAtmTiming(text, packageName, kind) {
  const re = kind === 'fully-drawn'
    ? /^Fully drawn (\S+?):\s*\+(\S+?)(?:\s|$)/
    : /^Displayed (\S+?)(?: for user \d+)?:\s*\+(\S+?)(?:\s|$)/;
  const out = [];
  lines(text).forEach((raw, i) => {
    const l = parseLogcatLine(raw);
    if (!l) {
      return;
    }
    const m = re.exec(l.message);
    if (m && m[1].startsWith(`${packageName}/`)) {
      const ms = parseDurationMs(m[2]);
      if (ms !== null) {
        out.push({ component: m[1], ms, ...ref(i + 1, raw) });
      }
    }
  });
  return out;
}

export function parseFullyDrawn(text, packageName) {
  return parseAtmTiming(text, packageName, 'fully-drawn');
}

export function parseDisplayed(text, packageName) {
  return parseAtmTiming(text, packageName, 'displayed');
}

// Crash and ANR evidence for a package in logcat main/system/crash buffers. kind: 'anr' | 'crash'.
export function findCrash(text, packageName) {
  const all = lines(text);
  const hits = [];
  all.forEach((raw, i) => {
    if (/FATAL EXCEPTION|Fatal signal|>>> .* <<<|ANR in /.test(raw)) {
      const window = all.slice(i, i + 4).join('\n');
      if (window.includes(packageName)) {
        hits.push({ ...ref(i + 1, raw), kind: /ANR in /.test(raw) ? 'anr' : 'crash' });
      }
    }
  });
  return hits;
}

// Failure class for crash evidence: an ANR is `candidate-anr`, anything else `candidate-crash`.
export function crashClass(hits) {
  return hits.some((h) => h.kind === 'crash') ? 'candidate-crash' : (hits.some((h) => h.kind === 'anr') ? 'candidate-anr' : null);
}

// `dumpsys package <pkg>` "Dexopt state" section: "<isa>: [status=<filter>] [reason=<reason>]" (ART service
// format; the reason may be absent in other formats).
export function parseDexopt(text) {
  const entries = [];
  let inSection = false;
  lines(text).forEach((raw, i) => {
    if (/^\s*Dexopt state:/.test(raw)) {
      inSection = true;
      return;
    }
    if (inSection && /^\S/.test(raw)) {
      inSection = false;
    }
    const m = /^\s*([A-Za-z0-9_-]+):\s*\[status=([^\]]+)\](?:\s*\[reason=([^\]]+)\])?/.exec(raw);
    if (inSection && m) {
      entries.push({ isa: m[1], status: m[2], reason: m[3] ?? null, ...ref(i + 1, raw) });
    }
  });
  const summary = entries.length === 0 ? null : entries.map((e) => `${e.isa}=${e.status}`).join(',');
  return { entries, summary };
}

// `dumpsys meminfo <pkg>`: TOTAL PSS and the App Summary rows (first column is Pss(KB)).
export function parseMeminfo(text) {
  const out = { pid: null, totalPssKb: null, javaHeapKb: null, nativeHeapKb: null, graphicsKb: null, refs: {} };
  const rows = { 'Java Heap': 'javaHeapKb', 'Native Heap': 'nativeHeapKb', Graphics: 'graphicsKb' };
  let tableTotal = null;
  lines(text).forEach((raw, i) => {
    let m;
    if ((m = /\*\* MEMINFO in pid (\d+) /.exec(raw))) {
      out.pid = Number(m[1]);
    }
    if ((m = /TOTAL PSS:\s+(\d+)/.exec(raw))) {
      out.totalPssKb = Number(m[1]);
      out.refs.totalPssKb = ref(i + 1, raw);
    } else if (tableTotal === null && (m = /^\s+TOTAL\s+(\d+)\s/.exec(raw))) {
      tableTotal = { kb: Number(m[1]), ...ref(i + 1, raw) };
    }
    if ((m = /^\s*(Java Heap|Native Heap|Graphics):\s+(\d+)/.exec(raw))) {
      out[rows[m[1]]] = Number(m[2]);
      out.refs[rows[m[1]]] = ref(i + 1, raw);
    }
  });
  if (out.totalPssKb === null && tableTotal) {
    out.totalPssKb = tableTotal.kb;
    out.refs.totalPssKb = ref(tableTotal.line, tableTotal.text);
  }
  return out;
}

// /proc/<pid>/status VmRSS / VmHWM.
export function parseProcStatus(text) {
  const out = { vmRssKb: null, vmHwmKb: null, refs: {} };
  lines(text).forEach((raw, i) => {
    let m;
    if ((m = /^VmRSS:\s+(\d+)\s*kB/.exec(raw))) {
      out.vmRssKb = Number(m[1]);
      out.refs.vmRssKb = ref(i + 1, raw);
    } else if ((m = /^VmHWM:\s+(\d+)\s*kB/.exec(raw))) {
      out.vmHwmKb = Number(m[1]);
      out.refs.vmHwmKb = ref(i + 1, raw);
    }
  });
  return out;
}

// `aapt2 dump badging <apk>`.
export function parseBadging(text) {
  const t = String(text ?? '');
  const pkg = /package: name='([^']+)'/.exec(t);
  const min = /^sdkVersion:'(\d+)'/m.exec(t);
  const target = /^targetSdkVersion:'(\d+)'/m.exec(t);
  const native = /^native-code:\s*(.*)$/m.exec(t);
  return {
    packageName: pkg ? pkg[1] : null,
    debuggable: /^application-debuggable\b/m.test(t),
    minSdk: min ? Number(min[1]) : null,
    targetSdk: target ? Number(target[1]) : null,
    nativeCode: native ? [...native[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [],
  };
}

// `cmd package resolve-activity --brief <pkg>`: last line is the component.
export function parseResolveActivity(text) {
  const l = lines(text).map((x) => x.trim()).filter((x) => /^[\w.]+\/[\w.$]+$/.test(x));
  return l.length > 0 ? l[l.length - 1] : null;
}

// `am broadcast` result line.
export function parseBroadcastResult(text) {
  const m = /Broadcast completed: result=(-?\d+)/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

// `xcrun simctl launch` prints "<bundleId>: <pid>".
export function parseSimctlLaunch(text) {
  const m = /^[\w.-]+:\s*(\d+)\s*$/m.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

// `log stream --style ndjson` lines; non-JSON lines are skipped.
export function parseOslogNdjson(text, journeyId = null) {
  const out = [];
  lines(text).forEach((raw, i) => {
    if (!raw.startsWith('{')) {
      return;
    }
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      return;
    }
    const mb = parseMbMessage(String(obj.eventMessage ?? ''));
    if (mb && (journeyId === null || mb.journeyId === journeyId)) {
      out.push({ ...mb, pid: obj.processID ?? null, ...ref(i + 1, raw) });
    }
  });
  return out;
}

// BenchKit marker buffer lines {"e":"fui","n":1,"t":123,"p":"..."} (one JSON object per line).
export function parseMarkersJsonl(text) {
  const out = [];
  lines(text).forEach((raw, i) => {
    if (!raw.trim().startsWith('{')) {
      return;
    }
    try {
      const o = JSON.parse(raw);
      if (typeof o.e === 'string') {
        out.push({ event: o.e, n: Number(o.n), t: o.t === undefined ? null : String(o.t), payload: String(o.p ?? ''), ...ref(i + 1, raw) });
      }
    } catch {
      // keep scanning; a torn last line is possible if the app was killed mid-write
    }
  });
  return out;
}

// "k=v;k=v" marker payloads.
export function parsePayload(payload) {
  const out = {};
  for (const part of String(payload ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      out[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  return out;
}

// FUI payload check: rows == floor(h / 72) >= 1, |h - hRef| <= 1 when a layout reference exists, sel == expected,
// seq == 0. `notChecked` lists the parts that could not be checked.
export function checkFuiPayload(payload, expectedSelection, { hRef = null } = {}) {
  const p = parsePayload(payload);
  const rows = Number(p.rows);
  const h = Number(p.h);
  const problems = [];
  const notChecked = [];
  if (!(Number.isInteger(rows) && rows >= 1 && rows === Math.floor(h / 72))) {
    problems.push(`rows=${p.rows} h=${p.h}`);
  }
  if (hRef === null || hRef === undefined) {
    notChecked.push('h-vs-h_ref:no-layout-reference');
  } else if (!(Math.abs(h - hRef) <= 1)) {
    problems.push(`h=${p.h} h_ref=${hRef}`);
  }
  if (expectedSelection !== null && expectedSelection !== undefined && Number(p.sel) !== expectedSelection) {
    problems.push(`sel=${p.sel} expected ${expectedSelection}`);
  }
  if (Number(p.seq) !== 0) {
    problems.push(`seq=${p.seq}`);
  }
  return { pass: problems.length === 0, problems, notChecked };
}

// Marker order check on a full marker buffer: no `stream.connect` may precede the first `fui` (the stream starts
// after FUI). Returns { pass, ref } with the offending line, or pass null when there is no fui.
export function streamConnectBeforeFui(markers) {
  const fuiIdx = markers.findIndex((m) => m.event === 'fui');
  if (fuiIdx < 0) {
    return { pass: null, ref: null };
  }
  const early = markers.slice(0, fuiIdx).find((m) => m.event === 'stream.connect');
  return early ? { pass: false, ref: { line: early.line, text: early.text } } : { pass: true, ref: null };
}

// `pmset -g batt`.
export function parsePmsetBatt(text) {
  const t = String(text ?? '');
  const src = /Now drawing from '([^']+)'/.exec(t);
  const pct = /(\d+)%/.exec(t);
  return { source: src ? src[1] : null, percent: pct ? Number(pct[1]) : null };
}

// `pmset -g therm`: any recorded warning level other than "No ... recorded".
export function parsePmsetTherm(text) {
  const t = String(text ?? '');
  const warnings = lines(t).filter((l) => /warning level/i.test(l) && !/No .*warning level has been recorded/i.test(l));
  return { warning: warnings.length > 0, lines: lines(t).map((l) => l.trim()).filter(Boolean) };
}

// `sysctl -n vm.loadavg`: "{ 1.23 2.34 3.45 }".
export function parseLoadavg(text) {
  const m = /([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(String(text ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// `sysctl -n kern.boottime`: "{ sec = 1700000000, usec = 0 } ...".
export function parseBoottime(text) {
  const m = /sec\s*=\s*(\d+)/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

// `dumpsys SurfaceFlinger --latency` first line: the refresh period in ns.
export function parseSfRefreshPeriod(text) {
  const first = lines(text).map((x) => x.trim()).find((x) => x.length > 0);
  const n = first && /^\d+$/.test(first) ? Number(first) : null;
  return n && n > 0 ? n : null;
}

// AVD config.ini key=value pairs.
export function parseIni(text) {
  const out = {};
  for (const raw of lines(text)) {
    const eq = raw.indexOf('=');
    if (eq > 0 && !raw.trim().startsWith('#')) {
      out[raw.slice(0, eq).trim()] = raw.slice(eq + 1).trim();
    }
  }
  return out;
}

// `adb devices` -> [{ serial, state }].
export function parseAdbDevices(text) {
  return lines(text)
    .slice(1)
    .map((l) => /^(\S+)\s+(\S+)/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => ({ serial: m[1], state: m[2] }));
}
