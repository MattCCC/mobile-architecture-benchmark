#!/usr/bin/env node
// Generates the workload assets that the RN-family apps bundle (output dir is gitignored by the candidate):
//   <out>/fixtures/   byte-identical copies of fixtures/v1 (via `fixtures/generator/cli.mjs copy`, which verifies
//                     the source and the copy against SHA256SUMS and golden.json)
//   <out>/stream/<profile>.json
//                     the first 10000 update messages of each profile in compact form
//                     {"schema","profile","rate","messages","sha256","data":[i,a,b,c,...]} (seq = index + 1),
//                     produced by `updateStream` of fixtures/generator/lib.mjs from the copied fixture and verified
//                     against golden.json `stream.sha256` (wire frames, each followed by LF)
// Usage: node candidates/_rn-shared/tools/gen-assets.mjs <out-dir> [--profiles small,representative,stress]
// Exit codes: 0 ok, 1 verification failure, 2 usage error. Node built-ins only.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const generatorDir = join(repoRoot, 'fixtures', 'generator');

function fail(code, msg) {
  process.stderr.write(`gen-assets: ${msg}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length < 1 || args[0].startsWith('--')) {
  fail(2, 'usage: gen-assets.mjs <out-dir> [--profiles a,b]');
}
const outDir = resolve(args[0]);
let profiles = ['small', 'representative', 'stress'];
for (let k = 1; k < args.length; k += 1) {
  if (args[k] === '--profiles' && k + 1 < args.length) {
    profiles = args[k + 1].split(',').filter((p) => p.length > 0);
    k += 1;
  } else {
    fail(2, `unknown argument ${args[k]}`);
  }
}

// 1. Verified byte-identical fixture copy.
const fixturesOut = join(outDir, 'fixtures');
const copy = spawnSync(
  process.execPath,
  [join(generatorDir, 'cli.mjs'), 'copy', fixturesOut, '--profiles', profiles.join(',')],
  { encoding: 'utf8' },
);
if (copy.status !== 0) {
  fail(1, `fixture copy failed (exit ${copy.status}): ${copy.stderr || copy.stdout}`);
}

// 2. Stream assets from the generator's own stream function, verified against golden.json.
const lib = await import(new URL(`file://${join(generatorDir, 'lib.mjs')}`).href);
const golden = JSON.parse(readFileSync(join(fixturesOut, 'golden.json'), 'utf8'));
const profileDefs = new Map(lib.loadProfiles());
const streamOut = join(outDir, 'stream');
mkdirSync(streamOut, { recursive: true });
const lines = [];
for (const name of profiles) {
  const profile = profileDefs.get(name);
  const g = golden.profiles[name];
  if (!profile || !g) {
    fail(2, `unknown profile ${name}`);
  }
  const fixture = JSON.parse(readFileSync(join(fixturesOut, `${name}.json`), 'utf8'));
  const dataset = { items: fixture.items, selection: fixture.selection };
  const count = g.stream.messages;
  const hash = createHash('sha256');
  const data = new Array(count * 4);
  const stream = lib.updateStream(profile, dataset);
  for (let s = 1; s <= count; s += 1) {
    const msg = stream.next().value;
    if (msg.s !== s) {
      fail(1, `${name}: unexpected seq ${msg.s} at ${s}`);
    }
    hash.update(`${lib.serializeUpdate(msg)}\n`);
    const o = (s - 1) * 4;
    data[o] = msg.i;
    data[o + 1] = msg.v[0];
    data[o + 2] = msg.v[1];
    data[o + 3] = msg.v[2];
  }
  const sha = hash.digest('hex');
  if (sha !== g.stream.sha256) {
    fail(1, `${name}: stream sha256 ${sha} != golden ${g.stream.sha256}`);
  }
  const asset = {
    schema: 'mobilebench.rn-stream/1',
    profile: name,
    rate: profile.updateRatePerSecond,
    messages: count,
    sha256: sha,
    data,
  };
  writeFileSync(join(streamOut, `${name}.json`), `${JSON.stringify(asset)}\n`);
  lines.push(`${name}: fixture ${g.sha256.slice(0, 12)} ok, stream ${count} messages ${sha.slice(0, 12)} ok`);
}
process.stdout.write(`gen-assets: ${outDir}\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
