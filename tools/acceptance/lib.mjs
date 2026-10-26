import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, sha256File } from '../early-bench/lib/hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONTRACT = JSON.parse(readFileSync(resolve(HERE, 'contract.json'), 'utf8'));

export function verifyAcceptanceReceipt(path, expected) {
  const problems = [];
  let receipt = null;
  let bytes = null;
  try {
    bytes = readFileSync(path);
    receipt = JSON.parse(bytes);
  } catch (error) {
    return { ok: false, problems: [`unreadable receipt: ${error.message}`], receipt: null, sha256: null };
  }
  if (receipt.schema !== 'mobilebench.acceptance-receipt/1.0.0') problems.push(`bad schema ${receipt.schema}`);
  if (receipt.suiteId !== CONTRACT.suiteId) problems.push(`bad suiteId ${receipt.suiteId}`);
  if (receipt.status !== 'passed') problems.push(`status is ${receipt.status ?? 'missing'}, expected passed`);
  for (const key of ['candidateId', 'platform', 'artifactSha256', 'designSha256']) {
    if (receipt[key] !== expected[key]) problems.push(`${key} mismatch`);
  }
  const checks = new Map((receipt.checks ?? []).map((c) => [c.id, c]));
  for (const id of CONTRACT.requiredChecks) {
    const check = checks.get(id);
    if (!check || check.status !== 'passed') problems.push(`required check not passed: ${id}`);
  }
  if (!Array.isArray(receipt.evidence) || receipt.evidence.length === 0) {
    problems.push('evidence must contain at least one content-hashed file');
  } else {
    for (const item of receipt.evidence) {
      if (!item || typeof item.path !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256 ?? '')) {
        problems.push('bad evidence entry');
        continue;
      }
      const evidencePath = resolve(dirname(path), item.path);
      if (!existsSync(evidencePath)) problems.push(`evidence missing: ${item.path}`);
      else if (sha256File(evidencePath) !== item.sha256) problems.push(`evidence hash mismatch: ${item.path}`);
    }
  }
  return { ok: problems.length === 0, problems, receipt, sha256: sha256(bytes) };
}
