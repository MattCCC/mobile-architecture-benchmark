import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './hash.mjs';

export function loadBuildPolicy(repo) {
  const path = join(repo, 'config', 'build-policy.json');
  const bytes = readFileSync(path);
  return { path: 'config/build-policy.json', sha256: sha256(bytes), value: JSON.parse(bytes) };
}

export function declaredBuildProblems(candidate, platform, policy) {
  const b = candidate.benchmarkBuild;
  if (!b || typeof b !== 'object') return ['benchmarkBuild missing'];
  const p = policy[platform];
  if (!p) return [`platform policy missing: ${platform}`];
  const keys = platform === 'android' ? ['minSdk', 'targetSdk', 'abi'] : ['deploymentTarget', 'arch'];
  const problems = keys.filter((key) => b[key] !== p[key]).map((key) => `${key} ${b[key] ?? 'missing'} != policy ${p[key]}`);
  const allowed = new Set([p.eligibleBuildClass, ...(p.descriptiveBuildClasses ?? [])]);
  if (!allowed.has(b.buildClass)) problems.push(`buildClass ${b.buildClass ?? 'missing'} is not allowed`);
  return problems;
}

export function androidArtifactBuildProblems(badging, policy) {
  const p = policy.android;
  const problems = [];
  if (badging.minSdk !== p.minSdk) problems.push(`artifact minSdk ${badging.minSdk ?? 'unknown'} != policy ${p.minSdk}`);
  if (badging.targetSdk !== p.targetSdk) problems.push(`artifact targetSdk ${badging.targetSdk ?? 'unknown'} != policy ${p.targetSdk}`);
  if (!badging.nativeCode.includes(p.abi)) problems.push(`artifact native-code lacks ${p.abi}`);
  if (badging.nativeCode.some((abi) => abi !== p.abi)) problems.push(`artifact contains non-policy ABI: ${badging.nativeCode.join(',')}`);
  return problems;
}
