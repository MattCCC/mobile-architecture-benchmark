#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export function auditCandidate(candidate, platform, policy) {
  const reasons = [];
  const p = candidate.platforms?.[platform];
  if (candidate.status?.[platform] !== 'implemented' || !p) reasons.push('platform-not-implemented');
  if (p?.benchmarkBuild?.buildClass !== policy.eligibleBuildClass) reasons.push('non-release-build');
  if (!String(p?.instrumentationId ?? '').startsWith(policy.eligibleInstrumentationPrefix)) reasons.push('instrumentation-not-shared-and-calibrated');
  if (policy.requiresIndependentReview && candidate.independentReview?.status !== 'accepted') reasons.push('independent-review-pending');
  return { candidateId: candidate.id, platform, eligible: reasons.length === 0, reasons };
}

export function auditRepository(repo) {
  const policy = JSON.parse(readFileSync(join(repo, 'config', 'eligibility.json'), 'utf8'));
  const root = join(repo, 'candidates');
  const rows = [];
  for (const name of readdirSync(root).sort()) {
    const path = join(root, name, 'candidate.json');
    if (!existsSync(path)) continue;
    const candidate = JSON.parse(readFileSync(path, 'utf8'));
    for (const platform of ['android', 'ios']) rows.push(auditCandidate(candidate, platform, policy));
  }
  return { schema: 'mobilebench.eligibility-audit/1.0.0', policy: 'config/eligibility.json', rows,
    eligible: rows.filter((r) => r.eligible).map((r) => `${r.candidateId}:${r.platform}`) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const { values } = parseArgs({ options: { repo: { type: 'string', default: '.' }, 'require-eligible': { type: 'boolean', default: false } } });
  const result = auditRepository(resolve(values.repo));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (values['require-eligible'] && result.rows.some((r) => !r.eligible)) process.exitCode = 1;
}
