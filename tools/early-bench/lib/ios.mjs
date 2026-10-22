// iOS simulator helpers (xcrun simctl only; no XCUITest driver).
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { run, sleep } from './exec.mjs';
import { parseMbMessage } from './parse.mjs';

export const simctl = (args, opts = {}) => run('xcrun', ['simctl', ...args], opts);

export async function listDevices() {
  const r = await simctl(['list', 'devices', '-j'], { timeoutMs: 30000 });
  const devices = JSON.parse(r.stdout).devices;
  return Object.entries(devices).flatMap(([runtime, list]) => list.map((d) => ({ runtime, ...d })));
}

export async function runtimeInfo(runtimeId) {
  const r = await simctl(['list', 'runtimes', '-j'], { timeoutMs: 30000 });
  const rt = JSON.parse(r.stdout).runtimes.find((x) => x.identifier === runtimeId);
  return rt ? {
    identifier: rt.identifier, version: rt.version, buildversion: rt.buildversion, isAvailable: rt.isAvailable,
    supportedDeviceTypes: (rt.supportedDeviceTypes ?? []).map((d) => d.identifier).sort(),
  } : null;
}

export async function xcodeVersion() {
  const r = await run('xcodebuild', ['-version'], { timeoutMs: 30000 });
  return r.code === 0 ? r.stdout.trim().split(/\r?\n/).join(' ') : null;
}

export async function waitBooted(udid, timeoutMs) {
  const r = await simctl(['bootstatus', udid, '-b'], { timeoutMs });
  return r.code === 0;
}

// One long-lived `log stream` per session. Lines are redacted (the unified log carries home paths and the
// simulator UDID, also in slash-escaped JSON form), appended to a raw file and kept in memory with their arrival
// order; waitFor() resolves on the first matching marker line (control signal only, never timing).
export function startLogStream(udid, rawFile, scrub = (s) => s) {
  const child = spawn('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--style', 'ndjson', '--level', 'default',
    '--predicate', 'eventMessage BEGINSWITH "MB "'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const entries = [];
  const waiters = [];
  let buf = '';
  const onLine = (line) => {
    const raw = scrub(line);
    appendFileSync(rawFile, `${raw}\n`);
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
    if (!mb) {
      return;
    }
    const entry = { ...mb, raw };
    entries.push(entry);
    for (const w of [...waiters]) {
      if (w.match(entry)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(entry);
      }
    }
  };
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const parts = buf.split('\n');
    buf = parts.pop();
    parts.forEach(onLine);
  });
  child.stderr.on('data', (chunk) => appendFileSync(rawFile, `# stderr: ${scrub(chunk.toString('utf8'))}`));
  return {
    entries,
    forJourney: (journeyId) => entries.filter((e) => e.journeyId === journeyId),
    waitFor(match, timeoutMs) {
      const hit = entries.find(match);
      if (hit) {
        return Promise.resolve(hit);
      }
      return new Promise((resolve) => {
        const w = { match, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          resolve(null);
        }, timeoutMs) };
        waiters.push(w);
      });
    },
    async stop() {
      child.kill('SIGTERM');
      await sleep(500);
    },
  };
}
