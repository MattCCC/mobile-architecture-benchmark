#!/usr/bin/env node
// Writes the bundled update-stream asset of the Flutter candidate:
//   <dir>/<profile>.stream.jsonl = update frames seq 1..10000 in wire form, each followed by LF.
//
// The frames come from the shared Node generator (fixtures/generator/lib.mjs); the app never runs the
// PRNG. The file bytes are exactly what golden.json `profiles.<p>.stream.sha256` hashes, so every
// written file is verified against the committed golden digest.
//
//   node candidates/flutter/tool/stream_asset.mjs <dir> [--profiles a,b]
//
// Exit codes: 0 ok, 1 verification failure, 2 usage error. Node.js built-ins only.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STREAM_GOLDEN_COUNT,
  generateDataset,
  loadProfiles,
  serializeUpdate,
  sha256Hex,
  updateStream,
} from '../../../fixtures/generator/lib.mjs';

const GOLDEN = fileURLToPath(new URL('../../../fixtures/v1/golden.json', import.meta.url));

function usage(msg) {
  process.stderr.write(`${msg}\nusage: stream_asset.mjs <dir> [--profiles a,b]\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
const at = args.indexOf('--profiles');
let wanted;
if (at !== -1) {
  if (!args[at + 1]) {
    usage('missing value for --profiles');
  }
  wanted = args[at + 1].split(',');
  args.splice(at, 2);
}
if (args.length !== 1) {
  usage('expected exactly one destination directory');
}
const dest = resolve(args[0]);
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const profiles = new Map(loadProfiles());
const names = wanted ?? [...profiles.keys()];
const unknown = names.filter((n) => !profiles.has(n) || !golden.profiles[n]);
if (unknown.length > 0) {
  usage(`unknown profile(s): ${unknown.join(', ')}`);
}

mkdirSync(dest, { recursive: true });
const failures = names.flatMap((name) => {
  const profile = profiles.get(name);
  const expected = golden.profiles[name].stream;
  if (expected.messages !== STREAM_GOLDEN_COUNT) {
    return [`${name}: golden stream covers ${expected.messages} messages, generator ${STREAM_GOLDEN_COUNT}`];
  }
  const stream = updateStream(profile, generateDataset(profile));
  const lines = Array.from({ length: expected.messages }, () => `${serializeUpdate(stream.next().value)}\n`);
  const text = lines.join('');
  const actual = sha256Hex(text);
  if (actual !== expected.sha256) {
    return [`${name}: stream sha256 ${actual} != golden.json ${expected.sha256}`];
  }
  const file = join(dest, `${name}.stream.jsonl`);
  writeFileSync(file, text);
  process.stdout.write(`wrote ${file} (${expected.messages} frames, ${Buffer.byteLength(text)} bytes, sha256 ok)\n`);
  return [];
});
failures.forEach((f) => process.stderr.write(`${f}\n`));
process.exit(failures.length === 0 ? 0 : 1);
