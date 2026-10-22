// Host environment capture (macOS host). Records hardware class, OS, load, power and thermal state.
// Never records the host name, user name, serial numbers or home paths.
import { sha256 } from './hash.mjs';
import { run } from './exec.mjs';
import { parseBoottime, parseLoadavg, parsePmsetBatt, parsePmsetTherm } from './parse.mjs';

async function out(cmd, args) {
  const r = await run(cmd, args, { timeoutMs: 15000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

// Identity fields enter the comparability key; state fields are recorded at session start and end.
export async function hostSnapshot() {
  const [model, cpu, ncpu, mem, osVersion, osBuild, loadavg, boottime, batt, therm] = await Promise.all([
    out('sysctl', ['-n', 'hw.model']),
    out('sysctl', ['-n', 'machdep.cpu.brand_string']),
    out('sysctl', ['-n', 'hw.ncpu']),
    out('sysctl', ['-n', 'hw.memsize']),
    out('sw_vers', ['-productVersion']),
    out('sw_vers', ['-buildVersion']),
    out('sysctl', ['-n', 'vm.loadavg']),
    out('sysctl', ['-n', 'kern.boottime']),
    out('pmset', ['-g', 'batt']),
    out('pmset', ['-g', 'therm']),
  ]);
  const bootSec = parseBoottime(boottime);
  const power = parsePmsetBatt(batt);
  const thermal = parsePmsetTherm(therm);
  return {
    identity: {
      hardwareModel: model,
      cpu,
      cpuCount: ncpu === null ? null : Number(ncpu),
      memBytes: mem === null ? null : Number(mem),
      osVersion,
      osBuild,
    },
    state: {
      capturedAt: new Date().toISOString(),
      loadavg: parseLoadavg(loadavg),
      uptimeS: bootSec === null ? null : Math.round(Date.now() / 1000 - bootSec),
      powerSource: power.source,
      batteryPercent: power.percent,
      pmsetTherm: thermal.lines,
      thermalWarning: thermal.warning,
    },
  };
}

export function hostKey(identity) {
  return `h-${sha256(JSON.stringify(identity)).slice(0, 12)}`;
}

// Device keys and other identifiers are salted per session so they are not linkable across sessions.
export function hashedId(prefix, value, salt) {
  return `${prefix}-${sha256(`${value}|${salt}`).slice(0, 8)}`;
}

export function environmentKey(parts) {
  return `env-${sha256(JSON.stringify(parts)).slice(0, 12)}`;
}

// Host sleep detector: the wall clock advances during sleep, the uptime clock does not.
export function startSleepDetector({ intervalMs = 1000, thresholdMs = 5000, onSleep }) {
  let lastWall = Date.now();
  let lastMono = process.hrtime.bigint();
  let maxGapMs = 0;
  const timer = setInterval(() => {
    const wall = Date.now();
    const mono = process.hrtime.bigint();
    const gap = (wall - lastWall) - Number(mono - lastMono) / 1e6;
    maxGapMs = Math.max(maxGapMs, gap);
    lastWall = wall;
    lastMono = mono;
    if (gap > thresholdMs) {
      onSleep(gap);
    }
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), maxGapMs: () => maxGapMs };
}
