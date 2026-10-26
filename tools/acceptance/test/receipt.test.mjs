import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONTRACT, verifyAcceptanceReceipt } from '../lib.mjs';
import { sha256 } from '../../early-bench/lib/hash.mjs';

test('receipt binds passed checks and evidence to design and artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-'));
  try {
    const evidence = 'black-box evidence\n';
    writeFileSync(join(dir, 'evidence.txt'), evidence);
    const expected = { candidateId: 'native', platform: 'android', artifactSha256: 'a'.repeat(64), designSha256: 'd'.repeat(64) };
    const receipt = { schema: 'mobilebench.acceptance-receipt/1.0.0', suiteId: CONTRACT.suiteId, status: 'passed', ...expected,
      checks: CONTRACT.requiredChecks.map((id) => ({ id, status: 'passed' })),
      evidence: [{ path: 'evidence.txt', sha256: sha256(evidence) }] };
    const path = join(dir, 'receipt.json');
    writeFileSync(path, `${JSON.stringify(receipt)}\n`);
    assert.equal(verifyAcceptanceReceipt(path, expected).ok, true);
    assert.match(verifyAcceptanceReceipt(path, { ...expected, artifactSha256: 'b'.repeat(64) }).problems.join(), /artifactSha256 mismatch/);
    writeFileSync(join(dir, 'evidence.txt'), 'changed\n');
    assert.match(verifyAcceptanceReceipt(path, expected).problems.join(), /evidence hash mismatch/);
    writeFileSync(join(dir, 'evidence.txt'), evidence);

    // Only contract-listed checks may be waived, and only with a reason; the waiver is reported.
    const withChecks = (checks) => {
      writeFileSync(path, `${JSON.stringify({ ...receipt, checks })}\n`);
      return verifyAcceptanceReceipt(path, expected);
    };
    const passedExcept = (id, check) => CONTRACT.requiredChecks.map((c) => (c === id ? { id, ...check } : { id: c, status: 'passed' }));
    const waived = withChecks(passedExcept('instrumentation-overhead', { status: 'waived', reason: 'no A/B experiment yet' }));
    assert.equal(waived.ok, true);
    assert.deepEqual(waived.waived, ['instrumentation-overhead']);
    assert.equal(withChecks(passedExcept('instrumentation-overhead', { status: 'waived' })).ok, false);
    assert.match(withChecks(passedExcept('restore', { status: 'waived', reason: 'x' })).problems.join(), /required check not passed: restore/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
