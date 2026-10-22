#!/usr/bin/env node
// Rewrites the direct dependency ranges in package.json to the exact versions recorded in package-lock.json
// (decision 8: pin exactly). Run `npm install` afterwards so the lockfile's root entry records the exact pins.
// Usage: node candidates/_rn-shared/tools/pin-exact.mjs <candidate-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const pkgPath = join(dir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
let changed = 0;
for (const field of ['dependencies', 'devDependencies']) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (spec.startsWith('file:')) {
      continue;
    }
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry?.version) {
      process.stderr.write(`pin-exact: ${name} missing from package-lock.json\n`);
      process.exit(1);
    }
    if (entry.version !== spec) {
      process.stdout.write(`${field}.${name}: ${spec} -> ${entry.version}\n`);
      pkg[field][name] = entry.version;
      changed += 1;
    }
  }
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
process.stdout.write(`pin-exact: ${changed} change(s)\n`);
