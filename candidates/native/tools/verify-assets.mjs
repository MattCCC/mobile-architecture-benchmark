#!/usr/bin/env node
// Verifies a bundled workload directory of the native candidate (for example `<App>.app/fixtures` after an iOS
// build) against fixtures/v1/golden.json: for every profile, `<profile>.json` and `stream-<profile>.jsonl` must be
// present and byte-identical to the committed fixture bytes and the golden stream checksum.
// Node.js built-ins only. Usage: node candidates/native/tools/verify-assets.mjs <dir>
// Exit codes: 0 ok, 1 mismatch or missing file, 2 usage error.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: verify-assets.mjs <dir>\n');
  process.exit(2);
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const golden = JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'v1', 'golden.json'), 'utf8'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const problems = [];
let checked = 0;
for (const [name, p] of Object.entries(golden.profiles)) {
  for (const [file, expected] of [
    [p.file, p.sha256],
    [`stream-${name}.jsonl`, p.stream.sha256],
  ]) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      problems.push(`missing: ${file}`);
    } else if (sha256(path) !== expected) {
      problems.push(`sha256 mismatch: ${file}`);
    } else {
      checked += 1;
    }
  }
}
problems.forEach((p) => process.stderr.write(`${p}\n`));
if (problems.length > 0) {
  process.exit(1);
}
process.stdout.write(`ok: ${checked} bundled files match fixtures/v1/golden.json\n`);
