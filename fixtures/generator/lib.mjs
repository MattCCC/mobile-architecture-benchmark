// Deterministic workload generator (fixture format mobilebench.fixture/1.0.0).
//
// Node.js built-ins only. Every value is an integer (fixed-point, scale 100), every
// serialization is hand-written, so the output bytes do not depend on the Node version,
// locale, time zone or platform.
//
// Algorithm (normative, see fixtures/README.md):
//   PRNG            mulberry32, uint32 outputs
//   stream seeding  seedFor(seed, purpose) = fmix32((seed ^ imul(purpose, 0x9E3779B9)) >>> 0)
//                   purposes: 1 values, 2 groups, 3 selection, 4 update stream
//   nextInt(n)      rejection sampling, unbiased

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FIXTURE_SCHEMA = 'mobilebench.fixture/1.0.0';
export const GOLDEN_SCHEMA = 'mobilebench.golden/1.0.0';
export const FIXTURE_VERSION = '1.0.0';
export const ALGORITHM_VERSION = 1;
export const PRNG_NAME = 'mulberry32';

export const VALUE_SCALE = 100;
export const VALUE_MIN = 100;
export const VALUE_MAX = 9999;
const VALUE_SPAN = VALUE_MAX - VALUE_MIN + 1; // 9900
export const GROUPS = 8;
export const OPTIONS_PER_ITEM = 3;
export const VALUES_PER_MESSAGE = 3;
const OPTION_KEYS = ['A', 'B', 'C'];

/** Sequence numbers whose state digests are recorded in golden.json. */
export const GOLDEN_SEQS = [0, 100, 1000, 10000];
/** Number of stream messages covered by the stream checksum in golden.json. */
export const STREAM_GOLDEN_COUNT = 10000;

export const PURPOSE = Object.freeze({ values: 1, groups: 2, selection: 3, stream: 4 });

const TWO_POW_32 = 4294967296;

/** MurmurHash3 32-bit finalizer. Returns a uint32. */
export function fmix32(input) {
  let h = input >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seed of the independent PRNG stream used for one purpose. Returns a uint32. */
export function seedFor(seed, purpose) {
  return fmix32((seed ^ Math.imul(purpose, 0x9e3779b9)) >>> 0);
}

/**
 * mulberry32 PRNG with an unbiased bounded-integer helper.
 * @param {number} seed uint32 seed
 */
export function createRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  /** Uniform integer in [0, n) by rejection sampling. */
  const nextInt = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
      throw new RangeError(`nextInt bound out of range: ${n}`);
    }
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    let u = next();
    while (u >= limit) {
      u = next();
    }
    return u % n;
  };
  return { next, nextInt };
}

/** Purpose-separated PRNG for one fixture seed. */
export function rngFor(seed, purpose) {
  return createRng(seedFor(seed, purpose));
}

// ---------------------------------------------------------------------------
// Profiles

const PROFILES_URL = new URL('./profiles.json', import.meta.url);

/** Reads and validates the profile definitions. Returns an ordered list of [name, profile]. */
export function loadProfiles() {
  const doc = JSON.parse(readFileSync(PROFILES_URL, 'utf8'));
  if (doc.fixtureVersion !== FIXTURE_VERSION) {
    throw new Error(`profiles.json fixtureVersion ${doc.fixtureVersion} != generator ${FIXTURE_VERSION}`);
  }
  return Object.entries(doc.profiles).map(([name, profile]) => {
    validateProfile(name, profile);
    return [name, profile];
  });
}

function isNonNegInt(x) {
  return Number.isSafeInteger(x) && x >= 0;
}

/** Profiles may change counts, rates and the seed only; semantics stay fixed. */
export function validateProfile(name, p) {
  const fail = (msg) => {
    throw new Error(`profile "${name}": ${msg}`);
  };
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    fail('name must match ^[a-z][a-z0-9-]*$');
  }
  if (!isNonNegInt(p.items) || p.items < 1) {
    fail('items must be an integer >= 1');
  }
  if (!isNonNegInt(p.selections) || p.selections > p.items) {
    fail('selections must be an integer in [0, items]');
  }
  if (!isNonNegInt(p.updateRatePerSecond) || p.updateRatePerSecond < 1) {
    fail('updateRatePerSecond must be an integer >= 1');
  }
  if (!isNonNegInt(p.seed) || p.seed > 0xffffffff) {
    fail('seed must be a uint32');
  }
  if (p.optionsPerItem !== OPTIONS_PER_ITEM) {
    fail(`optionsPerItem is fixed by the semantics (${OPTIONS_PER_ITEM})`);
  }
  if (p.valuesPerMessage !== VALUES_PER_MESSAGE) {
    fail(`valuesPerMessage is fixed by the semantics (${VALUES_PER_MESSAGE})`);
  }
  if (!Array.isArray(p.valueRange) || p.valueRange[0] !== VALUE_MIN || p.valueRange[1] !== VALUE_MAX) {
    fail(`valueRange is fixed by the semantics ([${VALUE_MIN}, ${VALUE_MAX}])`);
  }
}

// ---------------------------------------------------------------------------
// Fixture generation

/**
 * Generates the initial dataset of one profile.
 * @returns {{ items: {i:number,g:number,v:number[]}[], selection: {i:number,o:number}[] }}
 */
export function generateDataset(profile) {
  const n = profile.items;
  const groupsRng = rngFor(profile.seed, PURPOSE.groups);
  const valuesRng = rngFor(profile.seed, PURPOSE.values);
  const selRng = rngFor(profile.seed, PURPOSE.selection);

  // Each stream is consumed in ascending item order, independently of the others.
  const groups = Array.from({ length: n }, () => groupsRng.nextInt(GROUPS));
  const values = Array.from({ length: n }, () =>
    Array.from({ length: OPTIONS_PER_ITEM }, () => VALUE_MIN + valuesRng.nextInt(VALUE_SPAN)),
  );
  const items = groups.map((g, i) => ({ i, g, v: values[i] }));

  // Partial Fisher-Yates: the first S positions become the selected items; per position
  // the option index is drawn right after the swap index.
  const pool = Array.from({ length: n }, (_, i) => i);
  const picked = Array.from({ length: profile.selections }, (_, k) => {
    const r = k + selRng.nextInt(n - k);
    [pool[k], pool[r]] = [pool[r], pool[k]];
    return { i: pool[k], o: selRng.nextInt(OPTIONS_PER_ITEM) };
  });
  const selection = [...picked].sort((a, b) => a.i - b.i);

  return { items, selection };
}

/**
 * Canonical fixture serialization: UTF-8 (ASCII only), LF, fixed key order, one item or
 * selection entry per line, integers only, trailing newline.
 */
export function serializeFixture(name, profile, dataset) {
  const itemLines = dataset.items.map((it) => `    { "i": ${it.i}, "g": ${it.g}, "v": [${it.v.join(', ')}] }`);
  const selLines = dataset.selection.map((s) => `    { "i": ${s.i}, "o": ${s.o} }`);
  const block = (lines) => (lines.length === 0 ? '[]' : `[\n${lines.join(',\n')}\n  ]`);
  return [
    '{',
    `  "schema": "${FIXTURE_SCHEMA}",`,
    `  "fixtureVersion": "${FIXTURE_VERSION}",`,
    `  "profile": "${name}",`,
    `  "seed": ${profile.seed},`,
    `  "generator": { "prng": "${PRNG_NAME}", "algorithmVersion": ${ALGORITHM_VERSION} },`,
    `  "valueScale": ${VALUE_SCALE},`,
    `  "valueRange": [${VALUE_MIN}, ${VALUE_MAX}],`,
    `  "items": ${block(itemLines)},`,
    `  "selection": ${block(selLines)}`,
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Update stream

/**
 * Infinite deterministic update stream for a profile, starting at seq 1.
 * Each message replaces all three values of one item; a value never repeats the
 * item's current value, so every message changes visible state.
 * @param {{ items: {v:number[]}[] }} dataset initial dataset (not mutated)
 */
export function* updateStream(profile, dataset) {
  const rng = rngFor(profile.seed, PURPOSE.stream);
  const current = dataset.items.map((it) => [...it.v]);
  const n = current.length;
  for (let s = 1; ; s += 1) {
    const i = rng.nextInt(n);
    const v = current[i].map((cur) => {
      const x = VALUE_MIN + rng.nextInt(VALUE_SPAN);
      return x === cur ? VALUE_MIN + ((x - VALUE_MIN + 1) % VALUE_SPAN) : x;
    });
    current[i] = v;
    yield { s, i, v: [...v] };
  }
}

/** Wire form of an update frame (compact JSON, fixed key order, no trailing newline). */
export function serializeUpdate(msg) {
  return `{"t":"u","s":${msg.s},"i":${msg.i},"v":[${msg.v.join(',')}]}`;
}

// ---------------------------------------------------------------------------
// Digests and derived values

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Formats a fixed-point value without locale APIs: 1234 -> "12.34". */
export function fmt(v) {
  const whole = Math.floor(v / VALUE_SCALE);
  const frac = v % VALUE_SCALE;
  return `${whole}.${frac < 10 ? '0' : ''}${frac}`;
}

/** Canonical state text (mb-state-v1). Every line ends with LF. */
export function stateText(profileName, seq, values, selection) {
  const flat = values.map((v) => v.join(',')).join(',');
  const sel = selection.map((s) => `${s.i}:${OPTION_KEYS[s.o]}`).join(',');
  return `mb-state-v1\nprofile=${profileName}\nseq=${seq}\nvalues=${flat}\nselection=${sel}\n`;
}

/** Canonical Insights text (mb-insights-v1). Every line ends with LF. */
export function insightsText(seq, values) {
  const top = values
    .map((v, i) => ({ i, a: v[0] }))
    .sort((x, y) => y.a - x.a || x.i - y.i)
    .slice(0, 5)
    .map((e) => `${e.i}:${e.a}`)
    .join(',');
  const buckets = values.reduce(
    (acc, v) => {
      const b = Math.min(4, Math.floor(((v[1] - VALUE_MIN) * 5) / VALUE_SPAN));
      acc[b] += 1;
      return acc;
    },
    [0, 0, 0, 0, 0],
  );
  return `mb-insights-v1\nseq=${seq}\ntop=${top}\nbuckets=${buckets.join(',')}\n`;
}

/** Selection count and integer total of the selected option values. */
export function selectionSummary(values, selection) {
  const total = selection.reduce((sum, s) => sum + values[s.i][s.o], 0);
  return { count: selection.length, total, totalText: fmt(total) };
}

// ---------------------------------------------------------------------------
// Whole output set

function profileGolden(name, profile, dataset, fixtureText) {
  const values = dataset.items.map((it) => [...it.v]);
  const targets = new Set(GOLDEN_SEQS);
  const lastSeq = Math.max(STREAM_GOLDEN_COUNT, ...GOLDEN_SEQS);
  const stateDigests = [];
  const insightsDigests = [];
  const record = (seq) => {
    stateDigests.push({ seq, digest: sha256Hex(stateText(name, seq, values, dataset.selection)) });
    insightsDigests.push({ seq, digest: sha256Hex(insightsText(seq, values)) });
  };
  if (targets.has(0)) {
    record(0);
  }
  const streamHash = createHash('sha256');
  const stream = updateStream(profile, dataset);
  for (let seq = 1; seq <= lastSeq; seq += 1) {
    const msg = stream.next().value;
    values[msg.i] = msg.v;
    if (seq <= STREAM_GOLDEN_COUNT) {
      streamHash.update(`${serializeUpdate(msg)}\n`);
    }
    if (targets.has(seq)) {
      record(seq);
    }
  }
  const seq0 = selectionSummary(
    dataset.items.map((it) => it.v),
    dataset.selection,
  );
  return {
    file: `${name}.json`,
    sha256: sha256Hex(fixtureText),
    bytes: Buffer.byteLength(fixtureText, 'utf8'),
    items: profile.items,
    selections: profile.selections,
    updateRatePerSecond: profile.updateRatePerSecond,
    valuesPerMessage: profile.valuesPerMessage,
    seed: profile.seed,
    seq0Summary: { selectedCount: seq0.count, total: seq0.total, totalText: seq0.totalText },
    stateDigests,
    insightsDigests,
    stream: {
      messages: STREAM_GOLDEN_COUNT,
      serialization: 'update frames seq 1..messages, wire form, each followed by LF',
      sha256: streamHash.digest('hex'),
    },
  };
}

/**
 * Generates every output file of fixtures/v1 in memory.
 * @returns {Map<string, string>} file name -> exact file content (insertion order = write order)
 */
export function generateAll() {
  const files = new Map();
  const golden = {
    schema: GOLDEN_SCHEMA,
    fixtureVersion: FIXTURE_VERSION,
    generator: {
      prng: PRNG_NAME,
      algorithmVersion: ALGORITHM_VERSION,
      purposes: { ...PURPOSE },
    },
    digestRules: {
      state: 'sha256 of mb-state-v1 text, every line LF-terminated; selection = initial fixture selection',
      insights: 'sha256 of mb-insights-v1 text, every line LF-terminated',
    },
    profiles: {},
  };
  loadProfiles().forEach(([name, profile]) => {
    const dataset = generateDataset(profile);
    const text = serializeFixture(name, profile, dataset);
    files.set(`${name}.json`, text);
    golden.profiles[name] = profileGolden(name, profile, dataset, text);
  });
  files.set('golden.json', `${JSON.stringify(golden, null, 2)}\n`);
  const sums = [...files.keys()]
    .sort()
    .map((f) => `${sha256Hex(files.get(f))}  ${f}\n`)
    .join('');
  files.set('SHA256SUMS', sums);
  return files;
}
