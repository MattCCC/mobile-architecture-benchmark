#!/usr/bin/env node
// Content hash of the shared island host (decision 38: the host is byte-identical across island candidates).
//
//   sha256 over, for every file of candidates/_island-host that git would publish (tracked + untracked, honouring
//   .gitignore files; Markdown excluded, design §14.1), sorted by path: "<path>\n<sha256 of content>\n".
//
// Usage: node candidates/_island-host/tools/host-hash.mjs              prints the hash
//        node candidates/_island-host/tools/host-hash.mjs --check <candidate.json> [...]
//                                                                      fails unless each file's host.sha256 equals it
// Node.js built-ins only. Exit codes: 0 ok, 1 mismatch, 2 usage or git error.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(hostDir, '..', '..');
const rel = relative(repoRoot, hostDir);

function files() {
  const out = execFileSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-co', '--exclude-per-directory=.gitignore', '-z', '--', rel],
    { encoding: 'utf8' },
  );
  return out
    .split('\0')
    .filter((p) => p.length > 0 && !p.endsWith('.md'))
    .sort();
}

export function hostHash() {
  const h = createHash('sha256');
  for (const p of files()) {
    const content = createHash('sha256').update(readFileSync(join(repoRoot, p))).digest('hex');
    h.update(`${p}\n${content}\n`);
  }
  return h.digest('hex');
}

const args = process.argv.slice(2);
let hash;
try {
  hash = hostHash();
} catch (e) {
  process.stderr.write(`host-hash: ${e.message}\n`);
  process.exit(2);
}
if (args.length === 0) {
  process.stdout.write(`${hash}\n`);
} else if (args[0] === '--check' && args.length > 1) {
  let bad = 0;
  for (const f of args.slice(1)) {
    const recorded = JSON.parse(readFileSync(resolve(f), 'utf8'))?.host?.sha256;
    if (recorded !== hash) {
      bad += 1;
      process.stderr.write(`host-hash: ${f} records ${recorded}, the host is ${hash}\n`);
    }
  }
  if (bad > 0) process.exit(1);
  process.stdout.write(`host-hash: ok (${hash})\n`);
} else {
  process.stderr.write('usage: host-hash.mjs [--check <candidate.json>...]\n');
  process.exit(2);
}
