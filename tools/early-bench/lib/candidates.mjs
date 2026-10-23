// Candidate resolution from candidates/<id>/candidate.json (+ optional overrides), artifact freezing and
// build provenance.
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';
import { CORE_BUILD_INPUTS, sha256File, sha256Tree, sourceProvenance } from './hash.mjs';

// "<candidate>" or "<candidate>@debug" (the debug-build variant, e.g. Flutter on the iOS simulator).
export const ID_RE = /^([a-z][a-z0-9-]{1,40})(@debug)?$/;

export function parseCandidateId(id) {
  const m = ID_RE.exec(String(id));
  return m ? { baseId: m[1], variant: m[2] ? 'debug' : null } : null;
}

// Safe form for journey ids and launch arguments ("flutter@debug" -> "flutter-debug").
export function journeyToken(id) {
  return String(id).replace('@', '-');
}

function deepMerge(a, b) {
  if (b === undefined || b === null) {
    return a;
  }
  if (typeof a !== 'object' || a === null || Array.isArray(a) || typeof b !== 'object' || Array.isArray(b)) {
    return b;
  }
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = deepMerge(a[k], v);
  }
  return out;
}

// Virtual-device limitation labels by framework family.
function familyLimitations(family, platform) {
  if (family === 'flutter' && platform === 'android') {
    return ['framework-unsupported-on-emulator'];
  }
  if (family === 'flutter' && platform === 'ios') {
    return ['flutter-semantics-forced-on-simulator'];
  }
  return [];
}

// Build inputs: the candidate's own directory, its shared build inputs (declared `sharedBuildInputs`, else the
// directories named by `adapters[].path`) and the core directories every candidate consumes.
export function buildInputs(cj, dir) {
  let shared = [];
  let basis = 'none declared';
  if (Array.isArray(cj.sharedBuildInputs)) {
    shared = cj.sharedBuildInputs.map(String);
    basis = 'candidate.json sharedBuildInputs';
  } else if (Array.isArray(cj.adapters) && cj.adapters.length > 0) {
    shared = cj.adapters.map((a) => normalize(join(dir, String(a.path ?? ''))).split('\\').join('/'))
      .filter((p) => p.startsWith('candidates/') && !p.startsWith(`${dir}/`));
    basis = 'candidate.json adapters[].path (sharedBuildInputs not declared)';
  }
  const withSlash = (p) => (p.endsWith('/') ? p : `${p}/`);
  const dirs = [...new Set([`${dir}/`, ...shared.map(withSlash), ...CORE_BUILD_INPUTS])].sort();
  return { dirs, shared: [...new Set(shared.map(withSlash))].sort(), basis };
}

// Returns { id, ok, status?, reason?, ... }. Never throws for a missing candidate: the caller records it.
export function resolveCandidate({ repo, id, platform, overrides = {} }) {
  const parsed = parseCandidateId(id);
  if (!parsed) {
    return { id, ok: false, status: 'not-measured', reason: 'invalid-candidate-id' };
  }
  const { baseId, variant } = parsed;
  const dir = `candidates/${baseId}`;
  const cjPath = join(repo, dir, 'candidate.json');
  let cj = {};
  let candidateJsonSha256 = null;
  if (existsSync(cjPath)) {
    cj = JSON.parse(readFileSync(cjPath, 'utf8'));
    candidateJsonSha256 = sha256File(cjPath);
  }
  const ov = overrides[id] ?? overrides[baseId] ?? {};
  const p = deepMerge(cj.platforms?.[platform] ?? {}, ov[platform] ?? {});
  const family = ov.family ?? cj.family ?? null;
  // Stream source: declared, or derived from the candidate's own description of its stream client.
  const streamText = String(p.streamClient ?? '');
  const streamSource = p.streamSource ?? (/replay/i.test(streamText) ? 'replay' : (/websocket|server/i.test(streamText) ? 'server' : 'unknown'));
  const inputs = buildInputs(cj, dir);
  const base = {
    id,
    baseId,
    variant,
    token: journeyToken(id),
    dir,
    family,
    architectureClass: ov.architectureClass ?? cj.architectureClass ?? null,
    versions: cj.versions ?? null,
    candidateJson: existsSync(cjPath) ? { path: `${dir}/candidate.json`, sha256: candidateJsonSha256 } : null,
    overridesApplied: Boolean(ov[platform] || ov.family),
    limitations: familyLimitations(family, platform),
    streamSource,
    streamSourceBasis: p.streamSource ? 'candidate.json streamSource' : (streamText ? 'candidate.json streamClient text' : 'not declared'),
    buildInputs: inputs.dirs,
    sharedBuildInputs: inputs.shared,
    sharedBuildInputsBasis: inputs.basis,
  };
  if (!existsSync(cjPath) && !ov[platform]) {
    return { ...base, ok: false, status: 'not-measured', reason: 'candidate-manifest-missing' };
  }
  if (platform === 'android') {
    if (variant) {
      return { ...base, ok: false, status: 'not-measured', reason: 'variant-not-supported-on-platform' };
    }
    const pkg = p.applicationId ?? null;
    const apk = p.artifacts?.apk ?? null;
    if (!pkg) {
      return { ...base, ok: false, status: 'not-measured', reason: 'application-id-missing' };
    }
    if (!apk || !existsSync(join(repo, dir, apk))) {
      return { ...base, ok: false, status: 'not-measured', reason: 'artifact-missing', packageName: pkg };
    }
    const declared = typeof p.buildClass === 'string' ? p.buildClass : (p.buildClass?.emulator ?? null);
    return {
      ...base,
      ok: true,
      packageName: pkg,
      launchActivity: p.launchActivity ?? p.activity ?? null,
      artifacts: [
        { kind: 'apk', rel: apk },
        ...(p.artifacts?.aab && existsSync(join(repo, dir, p.artifacts.aab)) ? [{ kind: 'aab', rel: p.artifacts.aab }] : []),
      ],
      declaredBuildClass: declared,
    };
  }
  const bundleId = p.bundleId ?? null;
  const app = p.artifacts?.simulatorApp ?? p.artifacts?.app ?? null;
  if (!bundleId) {
    return { ...base, ok: false, status: 'not-measured', reason: 'bundle-id-missing' };
  }
  // iOS simulator build class: declared per candidate, else the Xcode products directory of the artifact path
  // (`Build/Products/<Configuration>-iphonesimulator/`); the bundle itself carries no reliable marker.
  const explicit = typeof p.buildClass === 'string' ? p.buildClass : (p.buildClass?.simulator ?? null);
  const fromPath = /(?:^|\/)Release-iphonesimulator\//.test(String(app ?? '')) ? 'release' : (/(?:^|\/)Debug-iphonesimulator\//.test(String(app ?? '')) ? 'debug' : null);
  const declared = explicit ?? fromPath;
  const buildClassSource = explicit ? 'candidate.json buildClass' : (fromPath ? 'artifact path (Xcode <Configuration>-iphonesimulator products directory)' : null);
  if (!declared) {
    return { ...base, ok: false, status: 'not-measured', reason: 'build-class-undeclared', bundleId };
  }
  if (!variant && declared === 'debug') {
    return {
      ...base, ok: false, status: 'unavailable', bundleId,
      reason: family === 'flutter' ? 'framework-no-release-on-simulator' : 'no-release-build-on-simulator',
      hint: `measure the debug build as ${baseId}@debug`,
    };
  }
  if (variant === 'debug' && declared !== 'debug') {
    return { ...base, ok: false, status: 'not-measured', reason: `variant-build-class-mismatch:${declared}`, bundleId };
  }
  if (!app || !existsSync(join(repo, dir, app))) {
    return { ...base, ok: false, status: 'not-measured', reason: 'artifact-missing', bundleId };
  }
  return { ...base, ok: true, bundleId, artifacts: [{ kind: 'app', rel: app }], declaredBuildClass: declared, buildClassSource };
}

export function hashArtifact(absPath) {
  const st = statSync(absPath);
  if (st.isDirectory()) {
    const t = sha256Tree(absPath);
    return { sha256: t.sha256, bytes: t.bytes, files: t.files, hashMethod: 'tree', algorithm: t.algorithm };
  }
  return { sha256: sha256File(absPath), bytes: st.size, files: 1, hashMethod: 'file', algorithm: 'sha256-file-bytes' };
}

// "<64 hex>" or the abbreviated "<prefix>…<suffix>" / "<prefix>...<suffix>" form (prefix >= 8, suffix >= 4 hex).
export function parseExpectedHash(text) {
  const t = String(text ?? '').trim();
  if (/^[0-9a-f]{64}$/.test(t)) {
    return { full: t, prefix: t, suffix: t, form: 'full' };
  }
  const m = /^([0-9a-f]{8,63})(?:…|\.\.\.)([0-9a-f]{4,63})$/.exec(t);
  return m ? { full: null, prefix: m[1], suffix: m[2], form: 'abbreviated' } : null;
}

export function matchesExpected(expected, sha) {
  if (!expected) {
    return true;
  }
  return expected.full ? expected.full === sha : (sha.startsWith(expected.prefix) && sha.endsWith(expected.suffix));
}

// Copies the artifact to <root>/<candidate>/<platform>/<sha256>/<name> (once) and verifies the copy.
export function freezeArtifact({ repo, candidate, platform, artifact, frozenRoot }) {
  const src = join(repo, candidate.dir, artifact.rel);
  const h = hashArtifact(src);
  const name = basename(artifact.rel);
  const destDir = join(frozenRoot, candidate.baseId ?? candidate.id, platform, h.sha256);
  const dest = join(destDir, name);
  if (!existsSync(dest)) {
    mkdirSync(destDir, { recursive: true });
    if (h.hashMethod === 'tree') {
      cpSync(src, dest, { recursive: true, verbatimSymlinks: true });
    } else {
      copyFileSync(src, dest);
    }
  }
  const copy = hashArtifact(dest);
  return {
    kind: artifact.kind,
    sourcePath: `<repo>/${candidate.dir}/${artifact.rel}`,
    frozenPath: `${candidate.baseId ?? candidate.id}/${platform}/${h.sha256}/${name}`,
    absFrozen: dest,
    sha256: h.sha256,
    hashAlgorithm: h.algorithm,
    bytes: h.bytes,
    files: h.files,
    hashMethod: h.hashMethod,
    copyVerified: copy.sha256 === h.sha256,
    sourceMtime: statSync(src).mtime.toISOString(),
  };
}

// Source provenance of the candidate dir plus its shared build-input dirs (e.g. candidates/_rn-shared).
export function candidateProvenance(repo, candidate) {
  const own = sourceProvenance(repo, candidate.dir);
  const shared = (candidate.sharedBuildInputs ?? [])
    .map((d) => d.replace(/\/$/, ''))
    .filter((d) => existsSync(join(repo, d)))
    .map((d) => sourceProvenance(repo, d));
  return { source: own, shared, sharedBuildInputs: candidate.sharedBuildInputs ?? [], sharedBuildInputsBasis: candidate.sharedBuildInputsBasis };
}
