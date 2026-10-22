#!/usr/bin/env node
// Fixture generator CLI. Node.js built-ins only.
//
//   node fixtures/generator/cli.mjs check              regenerate in memory, byte-compare with fixtures/v1 (default)
//   node fixtures/generator/cli.mjs write [--out DIR]  write the generated files (default DIR: fixtures/v1)
//   node fixtures/generator/cli.mjs verify [DIR] [--all]
//                                                      verify the files in DIR against DIR/SHA256SUMS and golden.json
//                                                      (no DIR: fixtures/v1, every file required; with DIR: the files
//                                                      present, every file only with --all)
//   node fixtures/generator/cli.mjs copy DEST [--profiles a,b]
//                                                      copy committed fixture bytes into a candidate's asset dir,
//                                                      after verifying the source, then verify the copy
//
// Exit codes: 0 ok, 1 mismatch / verification failure, 2 usage error.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAll, sha256Hex } from './lib.mjs';

const DEFAULT_DIR = fileURLToPath(new URL('../v1/', import.meta.url));
const rel = (p) => relative(process.cwd(), p) || '.';

function usage(msg) {
  process.stderr.write(`${msg}\nusage: cli.mjs check | write [--out DIR] | verify [DIR] [--all] | copy DEST [--profiles a,b]\n`);
  process.exit(2);
}

function optionValue(args, name) {
  const at = args.indexOf(name);
  if (at === -1) {
    return undefined;
  }
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    usage(`missing value for ${name}`);
  }
  args.splice(at, 2);
  return value;
}

function writeAll(dir) {
  mkdirSync(dir, { recursive: true });
  const files = generateAll();
  files.forEach((content, name) => writeFileSync(join(dir, name), content));
  process.stdout.write(`wrote ${files.size} files to ${rel(dir)}\n`);
}

function check(dir) {
  const files = generateAll();
  const problems = [...files].flatMap(([name, content]) => {
    const path = join(dir, name);
    if (!existsSync(path)) {
      return [`missing: ${name}`];
    }
    return readFileSync(path).equals(Buffer.from(content, 'utf8')) ? [] : [`differs: ${name}`];
  });
  problems.forEach((p) => process.stderr.write(`${p}\n`));
  if (problems.length > 0) {
    process.stderr.write(
      'fixtures are not byte-identical to the generator output (regenerate with "node fixtures/generator/cli.mjs write" only together with a fixtureVersion bump)\n',
    );
    return false;
  }
  process.stdout.write(`ok: ${files.size} files byte-identical to generator output\n`);
  return true;
}

/**
 * Verifies the bytes in dir against dir/SHA256SUMS and dir/golden.json (both required).
 * requireAll: every listed file must be present (the committed dir). Otherwise (a candidate's
 * asset dir holding a subset of profiles) absent fixture files are skipped, but at least one
 * fixture must be present and every present file must match.
 */
function verify(dir, requireAll) {
  const sumsPath = join(dir, 'SHA256SUMS');
  const goldenPath = join(dir, 'golden.json');
  const absent = [sumsPath, goldenPath].filter((p) => !existsSync(p));
  if (absent.length > 0) {
    absent.forEach((p) => process.stderr.write(`missing: ${rel(p)}\n`));
    return false;
  }
  const entries = readFileSync(sumsPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const m = /^([0-9a-f]{64}) {2}([A-Za-z0-9._-]+)$/.exec(line);
      if (!m) {
        throw new Error(`malformed SHA256SUMS line: ${line}`);
      }
      return { sha: m[1], name: m[2] };
    });
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const goldenSha = new Map(Object.values(golden.profiles).map((p) => [p.file, p.sha256]));
  const present = entries.filter(({ name }) => existsSync(join(dir, name)));
  const problems = [
    ...(requireAll ? entries.filter((e) => !present.includes(e)).map(({ name }) => `missing: ${name}`) : []),
    ...[...goldenSha.keys()]
      .filter((f) => !entries.some((e) => e.name === f))
      .map((f) => `golden.json lists ${f}, SHA256SUMS does not`),
    ...present.flatMap(({ sha, name }) => {
      const actual = sha256Hex(readFileSync(join(dir, name)));
      return [
        ...(actual === sha ? [] : [`checksum mismatch: ${name}`]),
        ...(goldenSha.has(name) && actual !== goldenSha.get(name) ? [`golden.json sha256 mismatch: ${name}`] : []),
      ];
    }),
  ];
  const fixturesPresent = present.filter(({ name }) => goldenSha.has(name)).map((e) => e.name);
  if (fixturesPresent.length === 0) {
    problems.push('no fixture file present');
  }
  problems.forEach((p) => process.stderr.write(`${p}\n`));
  if (problems.length > 0) {
    return false;
  }
  process.stdout.write(
    `ok: ${present.length} files match SHA256SUMS and golden.json in ${rel(dir)} (fixtures: ${fixturesPresent.join(', ')})\n`,
  );
  return true;
}

function copy(dest, profiles) {
  if (!verify(DEFAULT_DIR, true)) {
    return false;
  }
  const golden = JSON.parse(readFileSync(join(DEFAULT_DIR, 'golden.json'), 'utf8'));
  const known = Object.keys(golden.profiles);
  const wanted = profiles ?? known;
  const unknown = wanted.filter((p) => !known.includes(p));
  if (unknown.length > 0) {
    usage(`unknown profile(s): ${unknown.join(', ')} (known: ${known.join(', ')})`);
  }
  const names = [...wanted.map((p) => golden.profiles[p].file), 'golden.json', 'SHA256SUMS'];
  mkdirSync(dest, { recursive: true });
  names.forEach((name) => copyFileSync(join(DEFAULT_DIR, name), join(dest, name)));
  process.stdout.write(`copied ${names.length} files to ${rel(dest)}\n`);
  return verify(dest, false);
}

const [command = 'check', ...rest] = process.argv.slice(2);
const args = [...rest];
let ok = true;
switch (command) {
  case 'check':
    ok = check(DEFAULT_DIR);
    break;
  case 'write': {
    const out = optionValue(args, '--out');
    writeAll(out ? resolve(out) : DEFAULT_DIR);
    break;
  }
  case 'verify': {
    const all = args.includes('--all');
    const dirArg = args.find((a) => a !== '--all');
    ok = dirArg ? verify(resolve(dirArg), all) : verify(DEFAULT_DIR, true);
    break;
  }
  case 'copy': {
    const list = optionValue(args, '--profiles');
    if (!args[0]) {
      usage('copy needs a destination directory');
    }
    ok = copy(resolve(args[0]), list ? list.split(',') : undefined);
    break;
  }
  default:
    usage(`unknown command: ${command}`);
}
process.exit(ok ? 0 : 1);
