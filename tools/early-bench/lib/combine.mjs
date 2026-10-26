// Combine early-bench sessions into one descriptive summary. Pure functions except loadSessions().
// Deterministic: the output depends only on the input files (sorted everywhere, no clock reads).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './hash.mjs';
import { LABELS, METHODS, SCENARIOS } from './methods.mjs';
import { describe, median } from './stats.mjs';

export { LABELS };
const TABLE_LABEL = `_${LABELS.join(' · ')}_`;
const POOLABLE = new Set(['completed', 'incomplete']);

function cmp(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function readJsonl(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function loadSessions(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, 'manifest.json')))
    .sort(cmp)
    .map((d) => {
      const obsPath = join(dir, d, 'observations.jsonl');
      return {
        dirName: d,
        manifest: JSON.parse(readFileSync(join(dir, d, 'manifest.json'), 'utf8')),
        observations: readJsonl(obsPath),
        observationsSha256: existsSync(obsPath) ? sha256(readFileSync(obsPath)) : null,
      };
    });
}

function fixtureKey(o) {
  return o.fixture ? `${o.fixture.version}/${o.fixture.profile}` : 'none';
}

// Pooling key: method id, comparability key (environmentRef), fixture version and profile, artifact SHA-256,
// stream source and build class (plus candidate, platform and scenario).
export function poolKey(o) {
  return [o.platform, o.build?.buildClass ?? 'unknown', o.scenarioId, o.methodId, o.candidateId, o.environmentRef,
    o.build?.artifactSha256 ?? 'none', o.streamSource ?? 'unknown', o.instrumentationId ?? 'unknown', fixtureKey(o)].join('|');
}

// Comparison group of the shared-session view: the pool key without candidate and artifact.
function groupKey(r) {
  return [r.platform, r.buildClass, r.scenarioId, r.methodId, r.environmentRef, r.streamSource, r.instrumentationId, r.fixture].join('|');
}

function statusKey(o) {
  return o.status === 'measured' ? 'measured' : `${o.status} (${o.failure?.class ?? o.reason ?? '?'})`;
}

// Returns the model rendered by renderSummary().
export function combine(sessions, { invalid = [] } = {}) {
  const invalidSet = new Set(invalid);
  const included = [];
  const excluded = [];
  for (const s of sessions) {
    const id = s.manifest.sessionId;
    if (invalidSet.has(id)) {
      excluded.push({ id, reason: 'marked invalid by review' });
    } else if (!POOLABLE.has(s.manifest.status)) {
      excluded.push({ id, reason: `session status ${s.manifest.status}${s.manifest.failureReason ? ` (${s.manifest.failureReason})` : ''}` });
    } else {
      included.push(s);
    }
  }
  const cells = new Map();
  const builds = new Map();
  for (const s of included) {
    for (const o of s.observations) {
      if (o.buildId) {
        // build-unit observations (sizes): exact values per build, never pooled into an N
        const k = [o.platform, o.candidateId, o.methodId, o.build?.artifactSha256 ?? 'none', o.build?.buildClass ?? 'unknown'].join('|');
        if (!builds.has(k)) {
          builds.set(k, {
            key: k, platform: o.platform, candidateId: o.candidateId, methodId: o.methodId, unit: o.unit,
            artifactSha256: o.build?.artifactSha256 ?? null, buildClass: o.build?.buildClass ?? 'unknown', buildId: o.buildId,
            values: new Set(), sessions: new Set(), statuses: new Map(), limitations: new Set(),
          });
        }
        const b = builds.get(k);
        b.sessions.add(o.sessionId);
        b.statuses.set(statusKey(o), (b.statuses.get(statusKey(o)) ?? 0) + 1);
        for (const l of o.limitations ?? []) {
          b.limitations.add(l);
        }
        if (o.status === 'measured') {
          b.values.add(o.value);
        }
        continue;
      }
      const k = poolKey(o);
      if (!cells.has(k)) {
        cells.set(k, {
          key: k, platform: o.platform, buildClass: o.build?.buildClass ?? 'unknown', scenarioId: o.scenarioId,
          methodId: o.methodId, metricId: o.metricId, unit: o.unit, candidateId: o.candidateId,
          environmentRef: o.environmentRef, artifactSha256: o.build?.artifactSha256 ?? null,
          streamSource: o.streamSource ?? 'unknown', fixture: fixtureKey(o),
          instrumentationId: o.instrumentationId ?? 'unknown',
          bySession: new Map(), statuses: new Map(), limitations: new Set(),
        });
      }
      const c = cells.get(k);
      c.statuses.set(statusKey(o), (c.statuses.get(statusKey(o)) ?? 0) + 1);
      for (const l of o.limitations ?? []) {
        c.limitations.add(l);
      }
      if (o.status === 'measured') {
        if (!c.bySession.has(o.sessionId)) {
          c.bySession.set(o.sessionId, []);
        }
        c.bySession.get(o.sessionId).push(o.value);
      }
    }
  }
  const rows = [...cells.values()].sort((a, b) => cmp(a.key, b.key)).map((c) => {
    const sessionIds = [...c.bySession.keys()].sort(cmp);
    const all = sessionIds.flatMap((sid) => c.bySession.get(sid));
    return {
      ...c,
      sessions: sessionIds.map((sid) => ({ sessionId: sid, n: c.bySession.get(sid).length, median: median(c.bySession.get(sid)) })),
      pooled: describe(all),
      statuses: [...c.statuses.entries()].sort((a, b) => cmp(a[0], b[0])),
      limitations: [...c.limitations].sort(cmp),
    };
  });
  const buildRows = [...builds.values()].sort((a, b) => cmp(a.key, b.key)).map((b) => ({
    ...b,
    values: [...b.values].sort((x, y) => x - y),
    sessions: [...b.sessions].sort(cmp),
    statuses: [...b.statuses.entries()].sort((x, y) => cmp(x[0], y[0])),
    limitations: [...b.limitations].sort(cmp),
  }));
  // candidate coverage per session (for the shared-session view and the timing confound)
  const coverage = included.map((s) => {
    const measured = s.observations.filter((o) => o.status === 'measured' && o.journeyId);
    const artifacts = {};
    for (const o of measured) {
      (artifacts[o.candidateId] ??= new Set()).add(o.build?.artifactSha256 ?? 'none');
    }
    return {
      sessionId: s.manifest.sessionId,
      platform: s.manifest.platform,
      candidates: Object.keys(artifacts).sort(cmp),
      artifacts: Object.fromEntries(Object.entries(artifacts).sort((a, b) => cmp(a[0], b[0])).map(([c, set]) => [c, [...set].sort(cmp)])),
    };
  });
  return { included, excluded: excluded.sort((a, b) => cmp(a.id, b.id)), rows, buildRows, coverage, shared: sharedGroups(rows) };
}

// Shared-session view. For every comparison group (same platform, build class, scenario, method, environment,
// stream source and fixture), the sessions shared by every candidate of the group; then one line per pool cell
// (candidate x artifact) with the median of its per-session medians over the shared sessions it has data in.
// Cells of a rebuilt artifact stay separate lines, and different environments are different groups.
export function sharedGroups(rows) {
  const groups = new Map();
  for (const r of rows.filter((x) => x.sessions.length > 0)) {
    const k = groupKey(r);
    if (!groups.has(k)) {
      groups.set(k, []);
    }
    groups.get(k).push(r);
  }
  return [...groups.entries()].sort((a, b) => cmp(a[0], b[0])).map(([k, cellsOfGroup]) => {
    const candidates = [...new Set(cellsOfGroup.map((c) => c.candidateId))].sort(cmp);
    const sessionsOf = (cand) => new Set(cellsOfGroup.filter((c) => c.candidateId === cand).flatMap((c) => c.sessions.map((s) => s.sessionId)));
    const allSessions = [...new Set(cellsOfGroup.flatMap((c) => c.sessions.map((s) => s.sessionId)))].sort(cmp);
    const shared = allSessions.filter((sid) => candidates.every((cand) => sessionsOf(cand).has(sid)));
    const first = cellsOfGroup[0];
    return {
      key: k, platform: first.platform, buildClass: first.buildClass, scenarioId: first.scenarioId, methodId: first.methodId,
      unit: first.unit, environmentRef: first.environmentRef, streamSource: first.streamSource,
      instrumentationId: first.instrumentationId, fixture: first.fixture,
      candidates, sharedSessions: shared,
      lines: cellsOfGroup.map((c) => {
        const used = c.sessions.filter((s) => shared.includes(s.sessionId));
        return {
          candidateId: c.candidateId, artifactSha256: c.artifactSha256,
          sessions: used.map((s) => s.sessionId),
          medianOfSessionMedians: used.length === 0 ? null : median(used.map((s) => s.median)),
          journeys: used.reduce((acc, s) => acc + s.n, 0),
        };
      }).sort((a, b) => cmp(`${a.candidateId}|${a.artifactSha256}`, `${b.candidateId}|${b.artifactSha256}`)),
    };
  });
}

// ---------- rendering ----------
function fmt(value, unit) {
  if (value === null || value === undefined) {
    return '–';
  }
  if (unit === 'ns') {
    return (value / 1e6).toFixed(1);
  }
  if (unit === 'bytes') {
    return (value / 1048576).toFixed(2);
  }
  return String(value);
}

function unitLabel(unit) {
  if (unit === 'ns') {
    return 'ms';
  }
  if (unit === 'bytes') {
    return 'MiB';
  }
  return unit ?? '';
}

function short(sha) {
  return sha ? sha.slice(0, 12) : '–';
}

function table(header, body) {
  const line = (cols) => `| ${cols.join(' | ')} |`;
  return [TABLE_LABEL, '', line(header), line(header.map(() => '---')), ...body.map(line)].join('\n');
}

function sessionShort(id) {
  return id.replace(/^s-/, '');
}

function rowTable(rows) {
  const body = rows.map((r) => [
    r.candidateId,
    `\`${r.methodId}\``,
    unitLabel(r.unit),
    short(r.artifactSha256),
    r.environmentRef,
    `${r.streamSource}, ${r.fixture}`,
    r.instrumentationId,
    r.sessions.length === 0 ? '–' : r.sessions.map((s) => `${sessionShort(s.sessionId)}: ${fmt(s.median, r.unit)} (n=${s.n})`).join('<br>'),
    String(r.pooled.n),
    fmt(r.pooled.median, r.unit),
    r.pooled.n === 0 ? '–' : `${fmt(r.pooled.p95, r.unit)}${r.pooled.flags.includes('tail-dominated-by-max') ? ' †' : ''}`,
    fmt(r.pooled.min, r.unit),
    fmt(r.pooled.max, r.unit),
    r.statuses.map(([k, n]) => `${k}: ${n}`).join('<br>'),
  ]);
  return table(['candidate', 'method id', 'unit', 'artifact sha256', 'environment', 'stream, fixture', 'instrumentation', 'per-session median (n)', 'pooled N',
    'median', 'p95', 'min', 'max', 'observation status'], body);
}

function buildTable(rows) {
  const body = rows.map((b) => [
    b.candidateId,
    `\`${b.methodId}\``,
    short(b.artifactSha256),
    b.values.length === 0 ? '–' : b.values.map(String).join(', '),
    b.values.length === 0 ? '–' : b.values.map((v) => fmt(v, b.unit)).join(', '),
    b.sessions.map(sessionShort).join(', '),
    b.statuses.map(([k, n]) => `${k}: ${n}`).join('<br>'),
  ]);
  return table(['candidate', 'method id', 'artifact sha256', 'bytes (exact)', 'MiB', 'recorded in sessions', 'observation status'], body);
}

function platformTitle(p) {
  return p === 'android' ? 'Android emulator' : 'iOS simulator';
}

function sectionFor(model, buildClassFilter) {
  const out = [];
  const rows = model.rows.filter(buildClassFilter);
  const brows = model.buildRows.filter(buildClassFilter);
  for (const platform of ['android', 'ios']) {
    const pr = rows.filter((r) => r.platform === platform);
    const pb = brows.filter((r) => r.platform === platform);
    if (pr.length === 0 && pb.length === 0) {
      continue;
    }
    out.push(`### ${platformTitle(platform)}`, '');
    const scenarios = [...new Set(pr.map((r) => r.scenarioId))].sort(cmp);
    for (const sc of scenarios) {
      const info = SCENARIOS[sc];
      out.push(`#### ${sc} (scenario ref ${info?.designRef ?? '?'}; ${info?.cacheState ?? ''})`, '');
      out.push(rowTable(pr.filter((r) => r.scenarioId === sc)), '');
    }
    if (pb.length > 0) {
      out.push('#### early.size (build-unit observations: one exact value per artifact, not pooled)', '');
      out.push(buildTable(pb), '');
    }
  }
  return out;
}

function sharedView(model) {
  const out = [];
  for (const platform of ['android', 'ios']) {
    const cov = model.coverage.filter((c) => c.platform === platform);
    if (cov.length === 0) {
      continue;
    }
    const cands = [...new Set(cov.flatMap((c) => c.candidates))].sort(cmp);
    out.push(`### ${platformTitle(platform)}: candidate coverage per session (artifact sha256 prefix)`, '');
    out.push(table(['session', ...cands], cov.map((c) => [sessionShort(c.sessionId),
      ...cands.map((x) => (c.artifacts[x] ? c.artifacts[x].map(short).join(', ') : ''))])), '');
    const groups = model.shared.filter((g) => g.platform === platform && g.buildClass === 'release');
    const multi = groups.filter((g) => g.candidates.length >= 2);
    if (multi.length === 0) {
      out.push('No comparison group with two or more candidates on this platform yet: nothing to read side by side.', '');
      continue;
    }
    out.push('One line per pool cell (candidate x artifact). Each comparison group has one method, environment, stream',
      'source, fixture, instrumentation id and build class; its shared sessions are those in which every candidate of the group has data.',
      'Values are medians of per-session medians over those sessions (descriptive, no ranking).', '');
    const body = [];
    for (const g of multi) {
      if (g.sharedSessions.length === 0) {
        body.push([g.scenarioId, `\`${g.methodId}\``, g.environmentRef, `${g.streamSource}, ${g.fixture}`, g.instrumentationId,
          '–', '–', 'no shared session', '–', '–']);
        continue;
      }
      for (const l of g.lines) {
        body.push([g.scenarioId, `\`${g.methodId}\``, g.environmentRef, `${g.streamSource}, ${g.fixture}`, g.instrumentationId,
          l.candidateId, short(l.artifactSha256),
          l.sessions.length === 0 ? 'none (artifact not in the shared sessions)' : l.sessions.map(sessionShort).join(', '),
          String(l.journeys), `${fmt(l.medianOfSessionMedians, g.unit)} ${unitLabel(g.unit)}`]);
      }
    }
    out.push(table(['scenario', 'method id', 'environment', 'stream, fixture', 'instrumentation', 'candidate', 'artifact sha256', 'shared sessions used',
      'journeys', 'median of session medians'], body), '');
  }
  return out;
}

export function renderSummary(model) {
  const out = [];
  out.push('# Early benchmark sessions: combined summary', '');
  for (const l of LABELS) {
    out.push(`**${l}**`, '');
  }
  out.push('Descriptive only: no significance tests, no rankings, no composite score. Values are pooled only when',
    'method id, environment (class, platform, host, device configuration and settings) and artifact SHA-256 all',
    'match; each session is one block (two-stage session/block structure); stream source, fixture and build class are',
    'part of the key too. Percentiles: Hyndman-Fan type 7. † p95 with N < 20 is dominated by the maximum.',
    'ms = ns / 1e6; MiB = bytes / 1048576. Journeys a session never started are `not-measured`, never failures.', '');

  out.push('## Sessions', '');
  const srows = model.included.map((s) => {
    const m = s.manifest;
    const st = m.environment?.host?.start ?? {};
    const en = m.environment?.host?.end ?? {};
    const included = (m.candidates ?? []).filter((c) => c.status === 'included').map((c) => c.id).sort(cmp);
    return [sessionShort(m.sessionId), m.platform, m.status, m.startedAt ?? '–', String(m.elapsedS ?? '–'),
      included.join(', ') || '–', `${m.counts?.journeysRun ?? 0} / ${m.counts?.journeysPlanned ?? 0}`, short(m.design?.sha256),
      `${st.loadavg ? st.loadavg[0] : '–'} → ${en.loadavg ? en.loadavg[0] : '–'}`, st.powerSource ?? '–',
      (m.environment?.limitations ?? []).join(', ') || '–', m.plan?.incompleteBlockDesign ? `subset (excluded: ${m.plan.incompleteBlockDesign.excluded.join(', ')})` : 'all requested',
      short(s.observationsSha256)];
  });
  out.push(table(['session', 'platform', 'status', 'started (UTC)', 'duration s', 'candidates', 'journeys run / planned', 'design sha256',
    'host load 1-min start → end', 'power', 'environment flags', 'block design', 'observations.jsonl sha256'], srows), '');
  if (model.excluded.length > 0) {
    out.push('Excluded sessions (files kept):', '');
    for (const e of model.excluded) {
      out.push(`- ${sessionShort(e.id)}: ${e.reason}`);
    }
    out.push('');
  }

  out.push('## Release builds', '');
  out.push(...sectionFor(model, (r) => r.buildClass === 'release'));
  const other = [...model.rows, ...model.buildRows].filter((r) => r.buildClass !== 'release');
  if (other.length > 0) {
    out.push('## Debug and unclassified builds (separate; never compared with release builds)', '');
    out.push('Limitation: Flutter builds only debug (JIT) for the iOS simulator (variant `flutter@debug`), and Flutter',
      'enables its semantics tree unconditionally on the simulator (`flutter-semantics-forced-on-simulator`).', '');
    out.push(...sectionFor(model, (r) => r.buildClass !== 'release'));
  }

  out.push('## Shared sessions and the timing confound', '');
  out.push('Candidates that became verified later joined later sessions. Sessions differ in time of day, host load and',
    'other work on the host, so pooled values of candidates with different session sets are not side by side.',
    'Read candidates together only within sessions they share.', '');
  out.push(...sharedView(model));

  out.push('## Methods and scenarios not yet in design', '');
  const usedMethods = [...new Set([...model.rows, ...model.buildRows].map((r) => r.methodId))].sort(cmp);
  out.push('Early methods are harness-free procedures of early sessions. They are not yet registered in the core',
    '`config/methods.json` and are never pooled with the driver methods of the same metric.', '');
  out.push(table(['method id', 'metric', 'procedure', 'basis'], usedMethods.filter((m) => METHODS[m]).map((m) => [
    `\`${m}\``, METHODS[m].metricId, METHODS[m].procedure, METHODS[m].designRef])), '');
  const usedScen = [...new Set([...model.rows, ...model.buildRows].map((r) => r.scenarioId ?? 'early.size'))].sort(cmp);
  out.push(table(['early scenario', 'scenario ref', 'differences from the benchmark scenario'], usedScen.map((s) => [
    s, SCENARIOS[s]?.designRef ?? '?', SCENARIOS[s]?.differences ?? '?'])), '');

  out.push('## Limitations', '');
  const lim = new Map();
  for (const r of [...model.rows, ...model.buildRows]) {
    for (const l of r.limitations) {
      const k = `${r.platform}|${r.candidateId}`;
      if (!lim.has(k)) {
        lim.set(k, new Set());
      }
      lim.get(k).add(l);
    }
  }
  for (const k of [...lim.keys()].sort(cmp)) {
    const [p, c] = k.split('|');
    out.push(`- ${p} / ${c}: ${[...lim.get(k)].sort(cmp).join(', ')}`);
  }
  out.push('- All sessions: emulator/simulator on a shared Apple silicon host that ran other workflows (builds) between',
    '  sessions; host load is recorded per session. Frame, energy and thermal metrics are not part of early sessions.',
    '- Early sessions use shell-level instruments (`early.*`), not the benchmark drivers; their values are not',
    '  interchangeable with the driver instruments of the same metric.', '');

  out.push('## Traceability', '');
  out.push('Every value above comes from `measured` rows of `<session>/observations.jsonl`; each row lists `rawRefs`',
    '(file, 1-based line, exact text) inside the session directory.', '');
  return `${out.join('\n')}\n`;
}
