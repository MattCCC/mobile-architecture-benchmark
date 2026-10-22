#!/usr/bin/env node
// Lockfile and manifest pin check for an RN-family candidate:
//   - every `resolved` URL in package-lock.json is on https://registry.npmjs.org/ (local `file:` links are allowed:
//     the shared ../_rn-shared/rn-benchkit package is linked, not downloaded);
//   - every direct dependency in package.json is an exact version or a `file:` link (no ranges);
//   - .npmrc contains only `registry=https://registry.npmjs.org/`.
// Usage: node candidates/_rn-shared/tools/check-lock.mjs <candidate-dir>. Exit 0 ok, 1 violation.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const problems = [];
const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
let registry = 0;
let links = 0;
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === '') {
    continue;
  }
  if (entry.link === true) {
    links += 1;
    continue;
  }
  if (typeof entry.resolved === 'string') {
    if (entry.resolved.startsWith('https://registry.npmjs.org/')) {
      registry += 1;
    } else if (!path.startsWith('../')) {
      problems.push(`non-public resolved URL: ${path} -> ${entry.resolved}`);
    }
  }
}
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
const exact = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
for (const field of ['dependencies', 'devDependencies']) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (!exact.test(spec) && !spec.startsWith('file:')) {
      problems.push(`${field}.${name} is not pinned exactly: ${spec}`);
    }
  }
}
const npmrc = readFileSync(join(dir, '.npmrc'), 'utf8').trim();
if (npmrc !== 'registry=https://registry.npmjs.org/') {
  problems.push('.npmrc must contain only registry=https://registry.npmjs.org/');
}
if (problems.length > 0) {
  process.stderr.write(`check-lock: ${dir}\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`check-lock: ok (${registry} registry.npmjs.org entries, ${links} local link(s), exact pins)\n`);
