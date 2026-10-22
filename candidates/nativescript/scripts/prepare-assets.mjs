#!/usr/bin/env node
// Writes the generated, gitignored app assets from the shared, committed workload data (Node.js built-ins only):
//   1. app/generated/fixtures: the committed fixture bytes of fixtures/v1, copied with the verifying copy
//      command of fixtures/README.md (source verified first, copy verified after);
//   2. the replay stream of every profile: the first N update frames in wire form, one per LF-terminated line,
//      produced by the shared generator (fixtures/generator/lib.mjs, not ported) and checked byte for byte
//      against golden.json (stream SHA-256 of the same N frames). Written to app/generated/stream (iOS: copied
//      into the app folder by webpack) and App_Resources/Android/src/main/assets/mobilebench (Android assets).
// Files are rewritten only when their content changes. Exit code 0 ok, 1 verification failure.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROFILES = ['small', 'representative', 'stress'];

const candidateDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(candidateDir, '..', '..');
const generatorDir = join(repoRoot, 'fixtures', 'generator');
const fixturesOut = join(candidateDir, 'app', 'generated', 'fixtures');
const streamDirs = [
  join(candidateDir, 'app', 'generated', 'stream'),
  join(candidateDir, 'App_Resources', 'Android', 'src', 'main', 'assets', 'mobilebench'),
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const rel = (p) => relative(candidateDir, p);

function fail(message) {
  process.stderr.write(`prepare-assets: ${message}\n`);
  process.exit(1);
}

function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) {
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

const copy = spawnSync(process.execPath, [join(generatorDir, 'cli.mjs'), 'copy', fixturesOut, '--profiles', PROFILES.join(',')], {
  stdio: 'inherit',
});
if (copy.status !== 0) {
  fail(`fixture copy failed (exit ${copy.status})`);
}

const lib = await import(pathToFileURL(join(generatorDir, 'lib.mjs')).href);
const golden = JSON.parse(readFileSync(join(fixturesOut, 'golden.json'), 'utf8'));
const profiles = new Map(lib.loadProfiles());

for (const name of PROFILES) {
  const profile = profiles.get(name);
  const expected = golden.profiles[name];
  if (profile === undefined || expected === undefined) {
    fail(`profile ${name} missing from profiles.json or golden.json`);
  }
  const dataset = lib.generateDataset(profile);
  if (sha256(lib.serializeFixture(name, profile, dataset)) !== expected.sha256) {
    fail(`${name}: generator dataset does not reproduce the committed fixture bytes`);
  }
  const count = expected.stream.messages;
  const stream = lib.updateStream(profile, dataset);
  const lines = [];
  for (let k = 0; k < count; k += 1) {
    lines.push(lib.serializeUpdate(stream.next().value));
  }
  const text = `${lines.join('\n')}\n`;
  if (sha256(text) !== expected.stream.sha256) {
    fail(`${name}: stream frames do not match golden.json stream.sha256`);
  }
  const written = streamDirs.map((dir) => writeIfChanged(join(dir, `${name}.stream.jsonl`), text));
  process.stdout.write(
    `stream ${name}: ${count} frames, ${Buffer.byteLength(text)} bytes, sha256 ${expected.stream.sha256.slice(0, 12)} ok` +
      ` (${written.some(Boolean) ? 'written' : 'unchanged'}: ${streamDirs.map((d) => rel(d)).join(', ')})\n`,
  );
}
