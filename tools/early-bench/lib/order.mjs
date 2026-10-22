// Seeded, blocked execution order (randomized Latin square when the block count is a multiple of the
// candidate count, otherwise one independent Fisher-Yates permutation per block) and the seeded
// candidate subset used when a session cannot fit every candidate into its time budget.

export function fnv1a32(text) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(String(text), 'utf8')) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function fmix32(input) {
  let h = input >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One PRNG stream per purpose: mulberry32(fmix32(seed ^ fnv1a32(key))).
export function rngFor(seed, key) {
  return mulberry32(fmix32((seed ^ fnv1a32(key)) >>> 0));
}

export function shuffle(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

// Returns { method, orders } with one candidate order per block.
export function blockOrders(candidates, blocks, rng) {
  const k = candidates.length;
  if (k === 0 || blocks <= 0) {
    return { method: 'empty', orders: [] };
  }
  if (blocks % k === 0) {
    const orders = [];
    for (let square = 0; square < blocks / k; square += 1) {
      const rows = shuffle(range(k), rng);
      const cols = shuffle(range(k), rng);
      const labels = shuffle(candidates, rng);
      for (const r of rows) {
        orders.push(cols.map((c) => labels[(r + c) % k]));
      }
    }
    return { method: 'randomized-latin-square', orders };
  }
  return { method: 'fisher-yates-per-block', orders: range(blocks).map(() => shuffle(candidates, rng)) };
}

// groups: [{ id, blocks }]. The schedule is computed before the session starts and frozen.
export function buildSchedule({ seed, platform, groups, candidates }) {
  return {
    seed: seed >>> 0,
    prng: 'mulberry32(fmix32(seed ^ fnv1a32(platform|group)))',
    candidates: [...candidates],
    groups: groups.map((g) => {
      const { method, orders } = blockOrders(candidates, g.blocks, rngFor(seed, `${platform}|${g.id}`));
      return { id: g.id, method, blocks: orders.map((order, i) => ({ block: i + 1, order })) };
    }),
  };
}

// Picks at most maxCandidates: the anchor first (if present), then the candidates with the fewest pooled
// journeys so far; ties are broken by a seeded shuffle.
export function selectSubset({ candidates, anchor, pooledN = {}, maxCandidates, seed }) {
  if (maxCandidates >= candidates.length) {
    return { selected: [...candidates], excluded: [] };
  }
  const shuffled = shuffle(candidates.filter((c) => c !== anchor), rngFor(seed, 'subset'));
  const ranked = shuffled
    .map((c, i) => ({ c, i, n: Number(pooledN[c] ?? 0) }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((x) => x.c);
  const head = candidates.includes(anchor) ? [anchor] : [];
  const selected = [...head, ...ranked].slice(0, Math.max(maxCandidates, head.length));
  return { selected, excluded: candidates.filter((c) => !selected.includes(c)) };
}
