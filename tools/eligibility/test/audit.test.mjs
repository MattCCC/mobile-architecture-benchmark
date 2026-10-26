import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditCandidate, auditResultSet } from '../audit.mjs';

const policy = { eligibleInstrumentationPrefix: 'shared-benchkit/', eligibleBuildClass: 'release', requiresIndependentReview: true,
  requiresPhysicalDevice: true, forbiddenResultSetKinds: ['early-session', 'emulator', 'simulator', 'debug'] };

test('eligibility fails closed on local instrumentation and pending review', () => {
  const candidate = { id: 'x', status: { android: 'implemented' }, independentReview: { status: 'pending' }, platforms: { android: {
    benchmarkBuild: { buildClass: 'release' }, instrumentationId: 'x-local/1',
  } } };
  assert.deepEqual(auditCandidate(candidate, 'android', policy).reasons,
    ['instrumentation-not-shared-and-calibrated', 'independent-review-pending']);
});

test('only an implemented release platform with shared instrumentation and accepted review is eligible', () => {
  const candidate = { id: 'x', status: { ios: 'implemented' }, independentReview: { status: 'accepted' }, platforms: { ios: {
    benchmarkBuild: { buildClass: 'release' }, instrumentationId: 'shared-benchkit/1',
  } } };
  assert.equal(auditCandidate(candidate, 'ios', policy).eligible, true);
});

test('result eligibility rejects early virtual-device sessions and accepts complete physical release blocks', () => {
  const early = { schema: 'early-bench.session-manifest/2', status: 'completed', environmentClass: 'emulator',
    design: { sha256: 'd'.repeat(64) }, buildPolicy: { sha256: 'b'.repeat(64) }, candidates: [] };
  assert.deepEqual(auditResultSet(early, policy).reasons.slice(0, 3),
    ['forbidden-result-set-kind:early-session', 'not-a-physical-device-result-set', 'fewer-than-two-included-candidates']);
  const physical = { schema: 'mobilebench.result-set/1', resultSetKind: 'benchmark', status: 'completed',
    environmentClass: 'physical-device', design: { sha256: 'd'.repeat(64) }, buildPolicy: { sha256: 'b'.repeat(64) },
    candidates: [{ id: 'a', status: 'included', buildClass: 'release' }, { id: 'b', status: 'included', buildClass: 'release' }],
    verification: { acceptanceReceipts: { a: { sha256: '1' }, b: { sha256: '2' } } } };
  assert.equal(auditResultSet(physical, policy).eligible, true);
});
