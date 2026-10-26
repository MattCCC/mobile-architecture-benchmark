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

export function auditResultSet(manifest, policy) {
  const reasons = [];
  const kind = manifest.resultSetKind ?? (String(manifest.schema ?? '').startsWith('early-bench.') ? 'early-session' : 'unknown');
  if (manifest.status !== 'completed') reasons.push('result-set-not-completed');
  if (policy.forbiddenResultSetKinds.includes(kind)) reasons.push(`forbidden-result-set-kind:${kind}`);
  if (policy.requiresPhysicalDevice && manifest.environmentClass !== 'physical-device') reasons.push('not-a-physical-device-result-set');
  if (!/^[0-9a-f]{64}$/.test(manifest.design?.sha256 ?? '')) reasons.push('design-hash-missing');
  if (!/^[0-9a-f]{64}$/.test(manifest.buildPolicy?.sha256 ?? '')) reasons.push('build-policy-hash-missing');
  const included = (manifest.candidates ?? []).filter((c) => c.status === 'included');
  if (included.length < 2) reasons.push('fewer-than-two-included-candidates');
  for (const candidate of included) {
    if (candidate.buildClass !== policy.eligibleBuildClass) reasons.push(`${candidate.id}:non-release-build`);
    const receipt = manifest.verification?.acceptanceReceipts?.[candidate.id];
    if (!receipt?.sha256) reasons.push(`${candidate.id}:acceptance-receipt-missing`);
    for (const id of receipt?.waived ?? []) reasons.push(`${candidate.id}:acceptance-check-waived:${id}`);
  }
  return { eligible: reasons.length === 0, resultSetKind: kind, reasons };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const { values } = parseArgs({ options: { repo: { type: 'string', default: '.' }, manifest: { type: 'string' },
    'require-eligible': { type: 'boolean', default: false } } });
  const repo = resolve(values.repo);
  const policy = JSON.parse(readFileSync(join(repo, 'config', 'eligibility.json'), 'utf8'));
  const result = values.manifest
    ? { schema: 'mobilebench.result-eligibility-audit/1.0.0', manifest: values.manifest,
      ...auditResultSet(JSON.parse(readFileSync(resolve(values.manifest), 'utf8')), policy) }
    : auditRepository(repo);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (values['require-eligible'] && (result.eligible === false || result.rows?.some((r) => !r.eligible))) process.exitCode = 1;
}
