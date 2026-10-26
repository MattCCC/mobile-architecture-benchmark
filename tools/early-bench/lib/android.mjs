// Android emulator helpers (adb / emulator CLIs only; no device-side test APK).
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run, sleep } from './exec.mjs';
import { parseAdbDevices, parseIni, parseLogcatLine, parseMbMessage, parseSfRefreshPeriod } from './parse.mjs';

export function makeAdb(adbPath, serial) {
  const base = serial ? ['-s', serial] : [];
  return {
    serial,
    adb: (args, opts = {}) => run(adbPath, [...base, ...args], opts),
    // The command string is evaluated by the device shell; callers only pass package names, ids and paths
    // that match [A-Za-z0-9._/-].
    sh: (cmd, opts = {}) => run(adbPath, [...base, 'shell', cmd], opts),
  };
}

export async function listEmulators(adbPath) {
  const r = await run(adbPath, ['devices'], { timeoutMs: 20000 });
  const devices = parseAdbDevices(r.stdout);
  const result = [];
  for (const d of devices) {
    let avd = null;
    if (d.serial.startsWith('emulator-') && d.state === 'device') {
      const n = await run(adbPath, ['-s', d.serial, 'emu', 'avd', 'name'], { timeoutMs: 10000 });
      avd = n.stdout.split(/\r?\n/)[0].trim() || null;
    }
    result.push({ ...d, avd });
  }
  return { devices: result, raw: r.stdout };
}

export function avdConfig(avd) {
  const base = process.env.ANDROID_AVD_HOME || join(homedir(), '.android', 'avd');
  const file = join(base, `${avd}.avd`, 'config.ini');
  if (!existsSync(file)) {
    return null;
  }
  const ini = parseIni(readFileSync(file, 'utf8'));
  const keep = Object.keys(ini)
    .filter((k) => /^(hw\.|image\.sysdir|tag\.id|abi\.type|disk\.dataPartition|vm\.heapSize|PlayStore\.enabled)/.test(k))
    .sort();
  return Object.fromEntries(keep.map((k) => [k, ini[k]]));
}

// The emulator's stdout/stderr pass through the redactor before they reach the raw log (it prints host paths).
export function bootEmulator({ emulatorPath, avd, flags, logFile, scrub = (s) => s }) {
  const child = spawn(emulatorPath, ['-avd', avd, ...flags], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const sink = (chunk) => appendFileSync(logFile, scrub(chunk.toString('utf8')));
  child.stdout.on('data', sink);
  child.stderr.on('data', sink);
  child.stdout.unref?.();
  child.stderr.unref?.();
  child.unref();
  return child.pid;
}

export async function waitForAvd(adbPath, avd, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { devices } = await listEmulators(adbPath);
    const hit = devices.find((d) => d.avd === avd && d.state === 'device');
    if (hit) {
      return hit.serial;
    }
    await sleep(2000);
  }
  return null;
}

export async function waitForBootCompleted(dev, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await dev.sh('getprop sys.boot_completed', { timeoutMs: 10000 });
    if (r.stdout.trim() === '1') {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

export async function killEmulator(adbPath, serial, timeoutMs = 60000) {
  await run(adbPath, ['-s', serial, 'emu', 'kill'], { timeoutMs: 15000 });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { devices } = await listEmulators(adbPath);
    if (!devices.some((d) => d.serial === serial)) {
      return true;
    }
    await sleep(2000);
  }
  return false;
}

// Launch flags of a running emulator from its command line (only when it was not booted by this session).
export async function emulatorCmdlineFlags(avd) {
  const r = await run('ps', ['-Ao', 'args='], { timeoutMs: 10000 });
  const line = r.stdout.split(/\r?\n/).find((l) => /qemu-system|emulator/.test(l) && l.includes(`-avd ${avd}`));
  if (!line) {
    return null;
  }
  const flag = (name) => {
    const m = new RegExp(`(?:^|\\s)-${name}\\s+(\\S+)`).exec(line);
    return m ? m[1] : null;
  };
  return {
    gpu: flag('gpu'),
    cores: flag('cores'),
    memory: flag('memory'),
    noWindow: /\s-no-window\b/.test(line),
    noSnapshotLoad: /\s-no-snapshot-load\b/.test(line),
  };
}

async function shOut(dev, cmd) {
  const r = await dev.sh(cmd, { timeoutMs: 20000 });
  return r.code === 0 ? r.stdout.replace(/\r/g, '').trim() : null;
}

// Settings that change how the UI behaves; they enter the comparability key.
export const KEY_SETTINGS = [
  ['global', 'window_animation_scale'], ['global', 'transition_animation_scale'], ['global', 'animator_duration_scale'],
  ['system', 'font_scale'], ['secure', 'accessibility_enabled'], ['secure', 'enabled_accessibility_services'],
  ['global', 'always_finish_activities'],
];

export async function readSettings(dev, list) {
  const out = {};
  for (const [ns, key] of list) {
    out[`${ns}.${key}`] = await shOut(dev, `settings get ${ns} ${key}`);
  }
  return out;
}

// Device identity (part of the comparability key) and state (start / end of a session).
export async function deviceSnapshot(dev) {
  const props = {};
  for (const p of ['ro.build.fingerprint', 'ro.build.version.sdk', 'ro.build.version.release', 'ro.product.model',
    'ro.product.cpu.abi', 'ro.product.manufacturer', 'ro.hardware.egl', 'ro.kernel.qemu.gles', 'ro.boot.qemu.gltransport']) {
    props[p] = await shOut(dev, `getprop ${p}`);
  }
  const wmSize = await shOut(dev, 'wm size');
  const wmDensity = await shOut(dev, 'wm density');
  const nproc = await shOut(dev, 'nproc');
  const memTotal = await shOut(dev, "grep -m 1 MemTotal /proc/meminfo");
  const sfLatency = await shOut(dev, 'dumpsys SurfaceFlinger --latency');
  const displayLines = await shOut(dev, "dumpsys display | grep -m 4 -E 'renderFrameRate|mRefreshRate|refreshRate='");
  const periodNs = parseSfRefreshPeriod(sfLatency);
  const uptime = await shOut(dev, 'cat /proc/uptime');
  const battery = await shOut(dev, "dumpsys battery | grep -E 'level:|AC powered:|temperature:'");
  const thermal = await shOut(dev, "dumpsys thermalservice | grep -m 1 'Thermal Status'");
  const keySettings = await readSettings(dev, KEY_SETTINGS);
  const other = await readSettings(dev, [['global', 'stay_on_while_plugged_in']]);
  const memKb = memTotal ? Number((/(\d+)\s*kB/.exec(memTotal) ?? [])[1]) : null;
  return {
    identity: { props, wmSize, wmDensity, cpuCount: nproc && /^\d+$/.test(nproc) ? Number(nproc) : null },
    state: {
      capturedAt: new Date().toISOString(),
      uptimeS: uptime ? Number(uptime.split(/\s+/)[0]) : null,
      memTotalKb: Number.isFinite(memKb) ? memKb : null,
      surfaceFlingerRefreshPeriodNs: periodNs,
      reportedRefreshHz: periodNs ? Math.round((1e9 / periodNs) * 100) / 100 : null,
      refreshRateSource: 'dumpsys SurfaceFlinger --latency (first line, SurfaceFlinger vsync period); reported, not measured from frames',
      displayRefreshLines: displayLines ? displayLines.split('\n').map((l) => l.trim()) : [],
      battery: battery ? battery.split('\n').map((l) => l.trim()) : [],
      thermal,
      settings: { ...keySettings, ...other },
      keySettings,
    },
  };
}

// One long-lived `adb logcat -v epoch -s MobileBench:I` reader per session: the FUI wait listens to it instead of
// polling the device inside the measured interval. Lines are appended (redacted) to a raw file and kept in memory
// with their arrival index. If the reader exits (e.g. after `logcat -c`), it is restarted from the last seen
// timestamp; lines already seen are not delivered twice.
export function startLogcatStream({ adbPath, serial, rawFile, scrub = (s) => s }) {
  const entries = [];
  const waiters = [];
  const seen = new Set();
  let lastEpoch = null;
  let child = null;
  let stopped = false;
  let restarts = 0;
  let buf = '';
  const deliver = (raw) => {
    const clean = scrub(raw);
    appendFileSync(rawFile, `${clean}\n`);
    const l = parseLogcatLine(clean);
    if (!l) {
      return;
    }
    if (seen.has(clean)) {
      return;
    }
    seen.add(clean);
    lastEpoch = l.epoch;
    const mb = parseMbMessage(l.message);
    if (!mb) {
      return;
    }
    const entry = { ...mb, index: entries.length, epoch: l.epoch, raw: clean };
    entries.push(entry);
    for (const w of [...waiters]) {
      if (entry.index >= w.since && w.match(entry)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(entry);
      }
    }
  };
  const spawnReader = () => {
    const args = ['-s', serial, 'logcat', '-v', 'epoch', ...(lastEpoch ? ['-T', lastEpoch] : []), '-s', 'MobileBench:I'];
    child = spawn(adbPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop();
      parts.map((p) => p.replace(/\r$/, '')).forEach(deliver);
    });
    child.stderr.on('data', (chunk) => appendFileSync(rawFile, `# stderr: ${scrub(chunk.toString('utf8'))}`));
    child.on('exit', (code, signal) => {
      if (stopped) {
        return;
      }
      restarts += 1;
      appendFileSync(rawFile, `# reader exited (code ${code}, signal ${signal}); restart ${restarts}\n`);
      if (restarts <= 50) {
        setTimeout(spawnReader, 200);
      }
    });
  };
  spawnReader();
  return {
    entries,
    mark: () => entries.length,
    restarts: () => restarts,
    waitFor(match, { since = 0, timeoutMs }) {
      const hit = entries.find((e) => e.index >= since && match(e));
      if (hit) {
        return Promise.resolve(hit);
      }
      return new Promise((resolve) => {
        const w = { match, since, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          resolve(null);
        }, timeoutMs) };
        waiters.push(w);
      });
    },
    async stop() {
      stopped = true;
      child?.kill('SIGTERM');
      await sleep(300);
    },
  };
}
