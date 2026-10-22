// Content hashes for build provenance. The repository has no commits yet, so provenance is content-addressed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

export const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pubspec.lock',
  'Podfile.lock',
  'Package.resolved',
  'gradle.lockfile',
]);

// Algorithm ids recorded next to every hash.
export const TREE_MANIFEST_ALGORITHM = 'mobilebench-tree-manifest/1';
export const ENTRIES_ALGORITHM = 'early-bench.entries-sha256/1';

// Measurement scope of the source identity: the candidate, instrumentation, tooling, configuration, fixture and
// schema trees plus the root build files. Documentation and results are outside it.
export const SCOPE_ENTRIES = [
  'candidates/', 'instrumentation/', 'domain-ports/', 'drivers/', 'tools/', 'config/', 'fixtures/', 'schemas/',
  'Makefile', 'package.json', 'package-lock.json', '.nvmrc', '.npmrc', '.gitignore', '.gitattributes',
];
// Directories every candidate build consumes in addition to its own directory and its shared build inputs.
export const CORE_BUILD_INPUTS = ['instrumentation/', 'domain-ports/', 'fixtures/'];

export function isLockfile(path) {
  const b = basename(path);
  return LOCKFILE_NAMES.has(b) || b.endsWith('.lockfile');
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ENTRIES_ALGORITHM: hash over a sorted list of relative paths; for each path "<path>\0<kind>\0<length>\0", then
// the content (files) or the link target (symlinks), then "\n". kind is F (file), L (symlink) or M (missing).
export function sha256Entries(root, relPaths) {
  const h = createHash('sha256');
  let bytes = 0;
  const sorted = [...relPaths].sort(byteCompare);
  for (const rel of sorted) {
    const abs = join(root, rel);
    let st = null;
    try {
      st = lstatSync(abs);
    } catch {
      st = null;
    }
    if (st === null) {
      h.update(`${rel}\0M\0${0}\0\n`);
    } else if (st.isSymbolicLink()) {
      const target = Buffer.from(readlinkSync(abs), 'utf8');
      h.update(`${rel}\0L\0${target.length}\0`);
      h.update(target);
      h.update('\n');
    } else if (st.isFile()) {
      const content = readFileSync(abs);
      bytes += content.length;
      h.update(`${rel}\0F\0${content.length}\0`);
      h.update(content);
      h.update('\n');
    }
  }
  return { sha256: h.digest('hex'), files: sorted.length, bytes, algorithm: ENTRIES_ALGORITHM };
}

function walk(root, dir, out) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = lstatSync(abs);
    if (st.isDirectory()) {
      walk(root, abs, out);
    } else {
      out.push(relative(root, abs).split(sep).join('/'));
    }
  }
  return out;
}

// Directory artifacts (an iOS .app bundle): same scheme over every file below the directory.
export function sha256Tree(dir) {
  return sha256Entries(dir, walk(dir, dir, []));
}

// Paths that would be published: `git ls-files -co --exclude-standard -- <pathspec>` (read-only git).
export function publishablePaths(repo, relDir) {
  const args = ['-C', repo, 'ls-files', '-co', '--exclude-standard', '-z'];
  if (relDir) {
    args.push('--', relDir);
  }
  const out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

// TREE_MANIFEST_ALGORITHM: one line per path, "<SHA-256 of the file bytes>  <repo-relative path>\n" (the
// `shasum -a 256 -c` format), sorted by the path's bytes. A symbolic link is hashed over its target string and
// listed in `symlinks`; the executable bit is listed in `executables`. Paths that vanished between listing and
// reading are listed in `missing` and get no line.
export function treeManifest(repo, relPaths) {
  const lines = [];
  const executables = [];
  const symlinks = [];
  const missing = [];
  for (const rel of [...new Set(relPaths)].sort(byteCompare)) {
    const abs = join(repo, rel);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      missing.push(rel);
      continue;
    }
    if (st.isSymbolicLink()) {
      symlinks.push(rel);
      lines.push({ path: rel, sha256: sha256(Buffer.from(readlinkSync(abs), 'utf8')) });
    } else if (st.isFile()) {
      lines.push({ path: rel, sha256: sha256File(abs) });
      if (st.mode & 0o111) {
        executables.push(rel);
      }
    }
  }
  return { algorithm: TREE_MANIFEST_ALGORITHM, lines, executables, symlinks, missing };
}

export function manifestText(lines) {
  return lines.map((l) => `${l.sha256}  ${l.path}\n`).join('');
}

function under(path, entry) {
  return entry.endsWith('/') ? path.startsWith(entry) : path === entry;
}

// SHA-256 of the manifest lines whose path lies under one of the entries ("dir/" prefixes or exact file paths).
export function subsetHash(lines, entries) {
  const sub = lines.filter((l) => entries.some((e) => under(l.path, e)));
  return { sha256: sha256(manifestText(sub)), files: sub.length };
}

// Git identity without touching the index: HEAD if it exists, else null with reason uncommitted-tree.
export function gitIdentity(repo, scopeEntries = SCOPE_ENTRIES) {
  let head = null;
  try {
    head = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    head = null;
  }
  if (!head) {
    return { gitCommit: null, gitCommitReason: 'uncommitted-tree', gitClean: null };
  }
  const st = execFileSync('git', ['-C', repo, '--no-optional-locks', 'status', '--porcelain=v1', '--', ...scopeEntries.map((e) => e.replace(/\/$/, ''))],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { gitCommit: head, gitCommitReason: null, gitClean: st.trim() === '' };
}

// Source identity of the repository (whole repo, measurement scope, per candidate, per candidate build inputs).
// candidates: [{ id, dir: 'candidates/<id>', buildInputs: ['candidates/<id>/', ...] }]
export function sourceIdentity(repo, candidates = []) {
  const all = publishablePaths(repo);
  const tm = treeManifest(repo, all);
  const scope = subsetHash(tm.lines, SCOPE_ENTRIES);
  const candidateTreeSha256 = {};
  const buildInputSha256 = {};
  for (const c of [...candidates].sort((a, b) => byteCompare(a.id, b.id))) {
    candidateTreeSha256[c.id] = subsetHash(tm.lines, [`${c.dir}/`]).sha256;
    buildInputSha256[c.id] = subsetHash(tm.lines, c.buildInputs).sha256;
  }
  return {
    source: {
      kind: 'tree-manifest',
      algorithm: TREE_MANIFEST_ALGORITHM,
      ...gitIdentity(repo),
      repoTreeSha256: sha256(manifestText(tm.lines)),
      repoFiles: tm.lines.length,
      scopeTreeSha256: scope.sha256,
      scopeFiles: scope.files,
      scopeEntries: SCOPE_ENTRIES,
      scopeSource: existsSync(join(repo, 'config', 'provenance.json')) ? 'default list (config/provenance.json present but not read by the early runner)' : 'default list (no config/provenance.json yet)',
      candidateTreeSha256,
      buildInputSha256,
      manifest: 'source-manifest.txt',
      executables: tm.executables,
      symlinks: tm.symlinks,
      missingWhileHashing: tm.missing,
    },
    manifestText: manifestText(tm.lines),
  };
}

export function scopeTreeSha256(repo) {
  const tm = treeManifest(repo, publishablePaths(repo));
  return subsetHash(tm.lines, SCOPE_ENTRIES).sha256;
}

export function sourceProvenance(repo, relDir) {
  const paths = publishablePaths(repo, relDir);
  const tree = sha256Entries(repo, paths);
  const tm = treeManifest(repo, paths);
  const lockfiles = paths
    .filter(isLockfile)
    .sort(byteCompare)
    .map((p) => ({ path: p, sha256: sha256File(join(repo, p)) }));
  return {
    dir: relDir,
    sha256: tree.sha256,
    algorithm: ENTRIES_ALGORITHM,
    treeManifestSha256: sha256(manifestText(tm.lines)),
    treeManifestAlgorithm: TREE_MANIFEST_ALGORITHM,
    files: tree.files,
    bytes: tree.bytes,
    lockfiles,
  };
}
