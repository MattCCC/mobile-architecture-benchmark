// Journey and observation records (early variant of the benchmark's journey / observation records) with the
// status/value coupling enforced at construction time.
import { LABELS, METHODS, SCENARIOS, instrumentId } from './methods.mjs';

export const OBSERVATION_SCHEMA = 'mobilebench.observation/1.1.0-early.3';
export const JOURNEY_SCHEMA = 'mobilebench.journey/1.1.0-early.3';
export const STREAM_SOURCES = new Set(['replay', 'server', 'none', 'unknown']);
export const STATUSES = new Set(['measured', 'failed', 'unavailable', 'not-applicable', 'not-measured']);
export const JOURNEY_STATUSES = new Set(['completed', 'failed', 'not-attempted']);
export const FAILURE_CLASSES = new Set([
  'candidate-crash', 'candidate-anr', 'candidate-hang', 'timeout', 'functional-mismatch', 'instrument-error',
  'harness-error', 'environment-violation', 'remote-unavailable', 'remote-source-mismatch',
]);
export const ROLES = new Set(['measured', 'priming', 'tool-warmup', 'harness-warmup', 'calibration', 'acceptance', 'setup']);

export function validateObservation(o) {
  const problems = [];
  const m = METHODS[o.methodId];
  if (!m) {
    problems.push(`unknown methodId ${o.methodId}`);
  } else if (m.metricId !== o.metricId || !o.methodId.startsWith(`${o.metricId}/`)) {
    problems.push(`metricId ${o.metricId} does not match methodId ${o.methodId}`);
  }
  if (!SCENARIOS[o.scenarioId]) {
    problems.push(`unknown scenarioId ${o.scenarioId}`);
  }
  if (!STATUSES.has(o.status)) {
    problems.push(`bad status ${o.status}`);
  }
  if (!STREAM_SOURCES.has(o.streamSource)) {
    problems.push(`bad streamSource ${o.streamSource}`);
  }
  for (const k of ['sessionId', 'runId', 'candidateId', 'platform', 'environmentRef', 'environmentClass']) {
    if (!o[k]) {
      problems.push(`missing ${k}`);
    }
  }
  // exactly one observation unit: a journey or a build
  if (Boolean(o.journeyId) === Boolean(o.buildId)) {
    problems.push('exactly one of journeyId or buildId is required');
  }
  if (m && o.journeyId && m.unitOfObservation !== 'journey') {
    problems.push(`${o.methodId} is a build-unit method`);
  }
  if (m && o.buildId && m.unitOfObservation !== 'build') {
    problems.push(`${o.methodId} is a journey-unit method`);
  }
  if (o.status === 'measured') {
    if (typeof o.value !== 'number' || !Number.isFinite(o.value)) {
      problems.push('measured needs a finite numeric value');
    }
    if (!Array.isArray(o.rawRefs) || o.rawRefs.length === 0) {
      problems.push('measured needs rawRefs');
    }
  } else if (o.value !== null) {
    problems.push(`status ${o.status} requires value null`);
  }
  if (o.status === 'failed') {
    if (!o.failure || !FAILURE_CLASSES.has(o.failure.class)) {
      problems.push('failed needs failure.class from the taxonomy');
    }
  } else if (o.diagnosticValue !== undefined && o.diagnosticValue !== null) {
    problems.push('diagnosticValue only allowed with failed');
  }
  if (['unavailable', 'not-measured', 'not-applicable'].includes(o.status) && !o.reason) {
    problems.push(`${o.status} needs reason`);
  }
  if (o.status === 'not-applicable' && !o.source) {
    problems.push('not-applicable needs source');
  }
  return problems;
}

// base: session/journey (or build) fields shared by every observation of one journey (or build).
export function makeObservation(base, fields) {
  const m = METHODS[fields.methodId];
  const o = {
    schema: OBSERVATION_SCHEMA,
    labels: LABELS,
    sessionId: base.sessionId,
    runId: base.runId,
    journeyId: base.journeyId ?? null,
    buildId: base.buildId ?? null,
    journeyIndex: base.journeyIndex ?? null,
    block: base.block ?? null,
    position: base.position ?? null,
    attempt: base.attempt ?? 1,
    candidateId: base.candidateId,
    platform: base.platform,
    scenarioId: base.scenarioId,
    designScenarioRef: SCENARIOS[base.scenarioId]?.designRef ?? null,
    metricId: m ? m.metricId : null,
    methodId: fields.methodId,
    instrument: { id: instrumentId(fields.methodId) },
    unit: m ? m.unit : null,
    memoryType: m?.memoryType ?? null,
    statistic: 'single',
    withinJourneyN: null,
    status: fields.status,
    value: fields.status === 'measured' ? fields.value : null,
    failure: fields.failure ?? null,
    reason: fields.reason ?? null,
    source: fields.source ?? null,
    limitations: [...new Set([...(base.limitations ?? []), ...(fields.limitations ?? [])])],
    environmentRef: base.environmentRef,
    environmentClass: base.environmentClass,
    deviceKey: base.deviceKey ?? null,
    build: base.build ?? null,
    streamSource: base.streamSource ?? 'unknown',
    instrumentationId: base.instrumentationId ?? 'unknown',
    fixture: base.fixture ?? null,
    rawRefs: fields.rawRefs ?? [],
  };
  if (fields.diagnosticValue !== undefined && fields.status === 'failed') {
    o.diagnosticValue = fields.diagnosticValue;
  }
  const problems = validateObservation(o);
  if (problems.length > 0) {
    throw new Error(`invalid observation ${base.journeyId ?? base.buildId} ${fields.methodId}: ${problems.join('; ')}`);
  }
  return o;
}

export function rawRef(file, r) {
  return { file, line: r.line, text: r.text };
}

// Journeys a session never started (watchdog, signal, host sleep) are not candidate outcomes: their observations
// are `not-measured` with the abort cause, and the journey record is `not-attempted`.
export function notAttemptedReason(abort) {
  if (abort === 'watchdog') {
    return 'out-of-time:watchdog';
  }
  return `session-aborted:${abort ?? 'unknown'}`;
}

export function notAttemptedObservations(base, methods, abort) {
  const reason = notAttemptedReason(abort);
  return methods.map((methodId) => makeObservation(base, { methodId, status: 'not-measured', reason }));
}

export function journeyStatus(j) {
  if (j.notRun) {
    return 'not-attempted';
  }
  return j.failure ? 'failed' : 'completed';
}
