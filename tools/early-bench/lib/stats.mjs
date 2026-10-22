// Descriptive statistics for early-bench summaries.
// Percentiles use Hyndman-Fan type 7 (linear interpolation, the default of R and NumPy):
// for sorted x1..xn and probability p, h = (n - 1) * p + 1 and
// Q(p) = x[floor(h)] + (h - floor(h)) * (x[floor(h) + 1] - x[floor(h)]).

export function sortNumeric(values) {
  return [...values].sort((a, b) => a - b);
}

export function quantile7(sorted, p) {
  const n = sorted.length;
  if (n === 0) {
    return null;
  }
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`p must be in [0, 1], got ${p}`);
  }
  const h = (n - 1) * p + 1;
  const lo = Math.floor(h);
  const frac = h - lo;
  const xlo = sorted[lo - 1];
  const xhi = sorted[Math.min(lo, n - 1)];
  return xlo + frac * (xhi - xlo);
}

export function median(values) {
  return quantile7(sortNumeric(values), 0.5);
}

// n, median, p95, min, max. A p95 with n < 20 is flagged: with n = 10 it is effectively the maximum.
export function describe(values) {
  const s = sortNumeric(values);
  const n = s.length;
  if (n === 0) {
    return { n: 0, median: null, p95: null, min: null, max: null, flags: [] };
  }
  return {
    n,
    median: quantile7(s, 0.5),
    p95: quantile7(s, 0.95),
    min: s[0],
    max: s[n - 1],
    flags: n < 20 ? ['tail-dominated-by-max'] : [],
  };
}
