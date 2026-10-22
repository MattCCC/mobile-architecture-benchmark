#!/usr/bin/env node
// Prepares the bundled workload of the native candidate (Android and iOS share the output):
//
//   candidates/native/generated/assets/fixtures/<profile>.json          committed fixture bytes, unchanged
//   candidates/native/generated/assets/fixtures/stream-<profile>.jsonl  first 10 000 update frames (wire form + LF)
//
// The fixture files are copied with the verifying copy command of fixtures/generator/cli.mjs. The stream files are
// produced by the shared generator (fixtures/generator/lib.mjs) and must match the stream checksum in
// fixtures/v1/golden.json, so every candidate that replays the stream replays the same bytes.
// Node.js built-ins only. Exit codes: 0 ok, 1 verification failure.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const candidateDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(candidateDir, '..', '..');
const generatorDir = join(repoRoot, 'fixtures', 'generator');
const verifiedDir = join(candidateDir, 'generated', 'fixtures-verified');
const assetsDir = join(candidateDir, 'generated', 'assets', 'fixtures');
const rel = (p) => relative(process.cwd(), p) || '.';

const lib = await import(pathToFileURL(join(generatorDir, 'lib.mjs')).href);

// 1. Verified copy of the committed fixture bytes (cli.mjs verifies the source and the copy).
rmSync(verifiedDir, { recursive: true, force: true });
execFileSync(process.execPath, [join(generatorDir, 'cli.mjs'), 'copy', verifiedDir], { stdio: 'inherit' });
const golden = JSON.parse(readFileSync(join(verifiedDir, 'golden.json'), 'utf8'));

rmSync(assetsDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const problems = [];

for (const [name, profile] of lib.loadProfiles()) {
  const g = golden.profiles[name];
  if (!g) {
    problems.push(`golden.json has no profile ${name}`);
    continue;
  }
  // 2. Fixture bytes, unchanged.
  const fixtureBytes = readFileSync(join(verifiedDir, g.file));
  if (sha256(fixtureBytes) !== g.sha256) {
    problems.push(`${g.file}: sha256 differs from golden.json`);
    continue;
  }
  copyFileSync(join(verifiedDir, g.file), join(assetsDir, g.file));

  // 3. Replay stream: frames 1..messages of the shared generator, wire form, each followed by LF.
  const dataset = lib.generateDataset(profile);
  const stream = lib.updateStream(profile, dataset);
  const lines = [];
  for (let k = 0; k < g.stream.messages; k += 1) {
    lines.push(`${lib.serializeUpdate(stream.next().value)}\n`);
  }
  const text = lines.join('');
  const actual = sha256(text);
  if (actual !== g.stream.sha256) {
    problems.push(`stream-${name}.jsonl: sha256 ${actual} != golden.json ${g.stream.sha256}`);
    continue;
  }
  writeFileSync(join(assetsDir, `stream-${name}.jsonl`), text);
  process.stdout.write(
    `ok: ${name}: ${g.file} (${fixtureBytes.length} B) + stream-${name}.jsonl (${Buffer.byteLength(text)} B, ${g.stream.messages} frames)\n`,
  );
}

if (problems.length > 0) {
  problems.forEach((p) => process.stderr.write(`${p}\n`));
  process.exit(1);
}
process.stdout.write(`bundled workload ready in ${rel(assetsDir)}\n`);
