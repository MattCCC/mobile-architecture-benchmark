import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditCandidate } from '../audit.mjs';

const policy = { eligibleInstrumentationPrefix: 'shared-benchkit/', eligibleBuildClass: 'release', requiresIndependentReview: true };

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
