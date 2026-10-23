#!/usr/bin/env node
// Post-hoc finalization of a killed Android session (manifest status `running`): rebuilds journeys.jsonl,
// observations.jsonl and the manifest from the session's raw files. Refuses sessions that already finished.
// usage: node finalize.mjs --session <session dir> --repo <repo> --abort-reason <cause> [--ended-at <ISO>] [--avd <name>]
import { parseArgs } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRedactor, run } from './lib/exec.mjs';
import { hostSnapshot } from './lib/env.mjs';
import { finalizeAndroidSession } from './lib/finalize.mjs';

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      session: { type: 'string' }, repo: { type: 'string' }, 'abort-reason': { type: 'string' }, 'ended-at': { type: 'string' },
      avd: { type: 'string', default: 'mobilebench_api37' },
    },
    strict: true,
  });
  if (!values.session || !values.repo || !values['abort-reason'] || !/^[a-z0-9:-]+$/i.test(values['abort-reason'])) {
    process.stderr.write('usage: node finalize.mjs --session <dir> --repo <repo> --abort-reason <cause> [--ended-at <ISO>] [--avd <name>]\n');
    return 2;
  }
  const sdir = resolve(values.session);
  if (values['ended-at'] && Number.isNaN(Date.parse(values['ended-at']))) {
    throw new Error('--ended-at must be an ISO timestamp');
  }
  const host = await hostSnapshot();
  const adb = process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb';
  const v = existsSync(adb) ? await run(adb, ['version'], { timeoutMs: 15000 }) : null;
  const { manifest, journeys, observations } = finalizeAndroidSession({
    sdir, repo: resolve(values.repo), avd: values.avd, abortReason: values['abort-reason'], endedAt: values['ended-at'] ?? null,
    hostIdentity: host.identity, tools: { node: process.version, adb: v && v.code === 0 ? v.stdout.split('\n').slice(0, 2).join(' / ').trim() : null },
  });
  const r = makeRedactor();
  r.add(resolve(values.repo), '<repo>');
  r.add(homedir(), '<home>');
  r.add(hostname(), '<host>');
  const jl = (rows) => r.scrub(rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length > 0 ? '\n' : ''));
  writeFileSync(join(sdir, 'journeys.jsonl'), jl(journeys));
  writeFileSync(join(sdir, 'observations.jsonl'), jl(observations));
  writeFileSync(join(sdir, 'manifest.json'), r.scrub(`${JSON.stringify(manifest, null, 2)}\n`));
  process.stdout.write(`${JSON.stringify({ sessionId: manifest.sessionId, status: manifest.status, counts: manifest.counts })}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
