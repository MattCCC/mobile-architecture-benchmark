#!/usr/bin/env node
// Determinism and invariant self-test for the fixture generator. Node.js built-ins only.
//
//   node fixtures/generator/selftest.mjs
//
// 1. Generates all outputs twice in this process and requires byte-identical results.
// 2. Generates them twice more in separate Node processes with different TZ / locale
//    settings and requires byte-identical results across all four generations.
// 3. Requires the committed fixtures/v1 files to be byte-identical to the generator output
//    and to match SHA256SUMS and golden.json.
// 4. Checks the dataset, profile and stream invariants.
// Exit code 0 = all checks passed, 1 = at least one failed.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GOLDEN_SEQS,
  STREAM_GOLDEN_COUNT,
  VALUE_MAX,
  VALUE_MIN,
  createRng,
  generateAll,
  generateDataset,
  loadProfiles,
  serializeUpdate,
  sha256Hex,
  updateStream,
} from './lib.mjs';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const COMMITTED = fileURLToPath(new URL('../v1/', import.meta.url));

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}
function sameFiles(a, b, label) {
  const ka = [...a.keys()].sort();
  const kb = [...b.keys()].sort();
  assert(ka.join('|') === kb.join('|'), `${label}: file sets differ (${ka} vs ${kb})`);
  ka.forEach((k) => assert(Buffer.from(a.get(k)).equals(Buffer.from(b.get(k))), `${label}: ${k} differs`));
}
function readDir(dir) {
  return new Map(readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => [f, readFileSync(join(dir, f))]));
}
function asBuffers(files) {
  return new Map([...files].map(([k, v]) => [k, Buffer.from(v, 'utf8')]));
}

const first = asBuffers(generateAll());

check('in-process: two generations are byte-identical', () => {
  sameFiles(first, asBuffers(generateAll()), 'run 1 vs run 2');
  return `${first.size} files`;
});

check('separate processes (different TZ / locale) are byte-identical to in-process output', () => {
  const envs = [
    { TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
    { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' },
  ];
  const root = mkdtempSync(join(tmpdir(), 'mobilebench-fixtures-selftest-'));
  try {
    envs.forEach((env, n) => {
      const out = join(root, `run${n}`);
      const r = spawnSync(process.execPath, [CLI, 'write', '--out', out], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
      });
      assert(r.status === 0, `subprocess ${n} exited ${r.status}: ${r.stderr}`);
      sameFiles(first, readDir(out), `in-process vs subprocess ${n} (TZ=${env.TZ})`);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return `${envs.length} subprocesses`;
});

check('committed fixtures/v1 are byte-identical to generator output', () => {
  assert(existsSync(COMMITTED), `missing ${COMMITTED}`);
  sameFiles(first, readDir(COMMITTED), 'generated vs committed');
  return 'fixtures/v1';
});

check('SHA256SUMS and golden.json match the file bytes', () => {
  const sums = first.get('SHA256SUMS').toString('utf8').trim().split('\n');
  sums.forEach((line) => {
    const [sha, name] = line.split('  ');
    assert(first.has(name), `SHA256SUMS lists unknown file ${name}`);
    assert(sha256Hex(first.get(name)) === sha, `SHA256SUMS mismatch for ${name}`);
  });
  assert(sums.length === first.size - 1, 'SHA256SUMS must list every other file');
  const golden = JSON.parse(first.get('golden.json').toString('utf8'));
  Object.values(golden.profiles).forEach((p) => {
    assert(sha256Hex(first.get(p.file)) === p.sha256, `golden sha256 mismatch for ${p.file}`);
    assert(first.get(p.file).length === p.bytes, `golden byte count mismatch for ${p.file}`);
    assert(p.stateDigests.map((d) => d.seq).join() === GOLDEN_SEQS.join(), `golden seqs for ${p.file}`);
  });
  return `${sums.length} checksums`;
});

check('canonical form: ASCII, LF only, trailing newline, integers only', () => {
  [...first].forEach(([name, buf]) => {
    const text = buf.toString('utf8');
    assert(/^[\x0a\x20-\x7e]*$/.test(text), `${name}: non-ASCII or control characters`);
    assert(!text.includes('\r'), `${name}: CR found`);
    assert(text.endsWith('\n') && !text.endsWith('\n\n'), `${name}: must end with exactly one LF`);
  });
  loadProfiles().forEach(([name]) => {
    const text = first.get(`${name}.json`).toString('utf8');
    const body = text.slice(text.indexOf('"items"'));
    assert(!/\d\.\d|[eE][+-]?\d/.test(body), `${name}.json: non-integer number in data`);
  });
  return 'ok';
});

check('baseline profile matches the specified workload', () => {
  const rep = new Map(loadProfiles()).get('representative');
  assert(rep, 'representative profile missing');
  const want = { items: 300, optionsPerItem: 3, selections: 50, updateRatePerSecond: 20, valuesPerMessage: 3, seed: 42 };
  Object.entries(want).forEach(([k, v]) => assert(rep[k] === v, `representative.${k} = ${rep[k]}, want ${v}`));
  return '300 x 3, 50 selected, 20 msg/s x 3 values, seed 42';
});

check('dataset invariants per profile (parsed fixture equals generator state)', () => {
  return loadProfiles()
    .map(([name, p]) => {
      const parsed = JSON.parse(first.get(`${name}.json`).toString('utf8'));
      const ds = generateDataset(p);
      assert(parsed.profile === name && parsed.seed === p.seed, `${name}: header`);
      assert(JSON.stringify(parsed.items) === JSON.stringify(ds.items), `${name}: items differ after parse`);
      assert(JSON.stringify(parsed.selection) === JSON.stringify(ds.selection), `${name}: selection differs after parse`);
      assert(parsed.items.length === p.items, `${name}: item count`);
      parsed.items.forEach((it, idx) => {
        assert(it.i === idx, `${name}: item index ${it.i} at ${idx}`);
        assert(Number.isInteger(it.g) && it.g >= 0 && it.g < 8, `${name}: group of item ${idx}`);
        assert(it.v.length === 3, `${name}: values of item ${idx}`);
        it.v.forEach((v) => assert(Number.isInteger(v) && v >= VALUE_MIN && v <= VALUE_MAX, `${name}: value ${v}`));
      });
      assert(parsed.selection.length === p.selections, `${name}: selection count`);
      parsed.selection.forEach((s, k) => {
        assert(s.i >= 0 && s.i < p.items && s.o >= 0 && s.o < 3, `${name}: selection entry ${k}`);
        assert(k === 0 || parsed.selection[k - 1].i < s.i, `${name}: selection not strictly sorted / duplicate item`);
      });
      return `${name} ${p.items}x3/${p.selections}`;
    })
    .join(', ');
});

check(`update stream invariants (first ${STREAM_GOLDEN_COUNT} messages per profile, replayed twice)`, () => {
  return loadProfiles()
    .map(([name, p]) => {
      const ds = generateDataset(p);
      const current = ds.items.map((it) => [...it.v]);
      const a = updateStream(p, ds);
      const b = updateStream(p, ds);
      Array.from({ length: STREAM_GOLDEN_COUNT }, (_, k) => k + 1).forEach((seq) => {
        const m = a.next().value;
        assert(serializeUpdate(m) === serializeUpdate(b.next().value), `${name}: stream replay differs at ${seq}`);
        assert(m.s === seq && m.i >= 0 && m.i < p.items && m.v.length === 3, `${name}: message ${seq} shape`);
        m.v.forEach((v, j) => {
          assert(v >= VALUE_MIN && v <= VALUE_MAX, `${name}: value range at ${seq}`);
          assert(v !== current[m.i][j], `${name}: value unchanged at seq ${seq}`);
        });
        current[m.i] = m.v;
      });
      assert(JSON.stringify(ds.items) === JSON.stringify(generateDataset(p).items), `${name}: stream mutated its input`);
      return name;
    })
    .join(', ');
});

check('nextInt bounds (n = 1 and n = 2^32)', () => {
  const r1 = createRng(42);
  assert(Array.from({ length: 1000 }, () => r1.nextInt(1)).every((x) => x === 0), 'nextInt(1) must be 0');
  const ra = createRng(42);
  const rb = createRng(42);
  assert(Array.from({ length: 1000 }, () => ra.nextInt(4294967296) === rb.next()).every(Boolean), 'nextInt(2^32) must be identity');
  return 'ok';
});

results.forEach((r) => process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}\n`));
const failed = results.filter((r) => !r.ok).length;
process.stdout.write(`${results.length - failed}/${results.length} checks passed\n`);
process.exit(failed === 0 ? 0 : 1);
