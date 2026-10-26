#!/usr/bin/env node
// Prints the early-bench session arguments for every candidate whose acceptance receipt passes verification against
// its current artifact: --candidates <ids> and one --acceptance-receipt per candidate. Simulator debug builds are
// passed as <id>@debug, as the runner requires. Candidates without a valid receipt are listed on stderr.
//
//   node tools/acceptance/session-args.mjs --platform android|ios [--repo .] [--receipts results/local/acceptance]
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { run } from '../early-bench/lib/exec.mjs';
import { hashArtifact, iosSimulatorBuildClass } from '../early-bench/lib/candidates.mjs';
import { sha256File } from '../early-bench/lib/hash.mjs';
import { verifyAcceptanceReceipt } from './lib.mjs';

const { values: args } = parseArgs({ options: {
  platform: { type: 'string' }, repo: { type: 'string', default: '.' }, receipts: { type: 'string' },
}, strict: true });
if (!['android', 'ios'].includes(args.platform)) {
  process.stderr.write('usage: session-args.mjs --platform android|ios [--repo .] [--receipts <dir>]\n');
  process.exit(2);
}
const repo = resolve(args.repo);
const receipts = resolve(args.receipts ?? join(repo, 'results/local/acceptance'));
const design = sha256File(join(repo, 'design.md'));
const ids = [];
const out = [];

for (const id of readdirSync(join(repo, 'candidates')).filter((d) => !d.startsWith('_')).sort()) {
  const cfile = join(repo, 'candidates', id, 'candidate.json');
  const receipt = join(receipts, `${id}-${args.platform}`, 'receipt.json');
  if (!existsSync(cfile)) continue;
  const platform = JSON.parse(readFileSync(cfile, 'utf8')).platforms?.[args.platform];
  if (!platform) continue;
  const lines = (await run('make', ['-s', '-C', repo, `artifacts-${id}-${args.platform}`])).stdout.trim().split('\n');
  const ext = args.platform === 'android' ? '.apk' : '.app';
  const artifact = lines.filter((l) => l.endsWith(ext)).find((l) => !l.includes('iphoneos')) ?? null;
  const problems = !existsSync(receipt) ? ['no receipt'] : !artifact || !existsSync(resolve(repo, artifact)) ? ['no artifact']
    : verifyAcceptanceReceipt(receipt, { candidateId: id, platform: args.platform,
      artifactSha256: hashArtifact(resolve(repo, artifact)).sha256, designSha256: design }).problems;
  if (problems.length > 0) {
    process.stderr.write(`skipped ${id}:${args.platform}: ${problems.join('; ')}\n`);
    continue;
  }
  const debug = args.platform === 'ios' && iosSimulatorBuildClass(platform).declared === 'debug';
  const runId = debug ? `${id}@debug` : id;
  ids.push(runId);
  out.push(`--acceptance-receipt ${runId}:${args.platform}=${relative(process.cwd(), receipt)}`);
}
if (ids.length === 0) {
  process.stderr.write('no candidate has a valid receipt\n');
  process.exit(1);
}
process.stdout.write(`--candidates ${ids.join(',')} ${out.join(' ')}\n`);
