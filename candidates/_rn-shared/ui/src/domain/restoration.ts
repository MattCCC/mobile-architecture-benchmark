// Restoration record v2 (design §8.8): written on background, read on launch with `mb.restore=1`.
// {"v":2,"route":["list","detail/21"],"anchor":20,"selection":[[i,o],...],"lastSeq":n,"values":[[a,b,c],...]}
// Canonical compact JSON with this key order. Pure TypeScript.

import { VALUE_MAX, VALUE_MIN } from './types.ts';

export interface RestorationRecord {
  v: 2;
  route: string[];
  anchor: number;
  selection: number[][];
  lastSeq: number;
  values: number[][];
}

const ROUTE_RE = /^(list|selection|insights|detail\/\d{1,5})$/;

export function serializeRecord(r: RestorationRecord): string {
  const route = r.route.map((x) => JSON.stringify(x)).join(',');
  const selection = r.selection.map((p) => `[${p[0]},${p[1]}]`).join(',');
  const values = r.values.map((t) => `[${t[0]},${t[1]},${t[2]}]`).join(',');
  return `{"v":2,"route":[${route}],"anchor":${r.anchor},"selection":[${selection}],"lastSeq":${r.lastSeq},"values":[${values}]}`;
}

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

export type ParseResult = { ok: true; record: RestorationRecord } | { ok: false; reason: string };

/**
 * Parses and validates a record for a profile with `itemCount` items. A missing, unparsable or v1 record is
 * rejected; the caller then launches normally and emits `err code=persist-read`.
 */
export function parseRecord(text: string | null, itemCount: number): ParseResult {
  if (text === null || text.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'unparsable' };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'not-object' };
  }
  const o = raw as Record<string, unknown>;
  if (o.v !== 2) {
    return { ok: false, reason: 'version' };
  }
  const route = o.route;
  if (!Array.isArray(route) || route.length < 1 || route[0] !== 'list') {
    return { ok: false, reason: 'route' };
  }
  for (const r of route) {
    if (typeof r !== 'string' || !ROUTE_RE.test(r)) {
      return { ok: false, reason: 'route' };
    }
  }
  if (!isInt(o.anchor) || o.anchor < 0 || o.anchor >= itemCount) {
    return { ok: false, reason: 'anchor' };
  }
  if (!isInt(o.lastSeq) || o.lastSeq < 0) {
    return { ok: false, reason: 'lastSeq' };
  }
  const values = o.values;
  if (!Array.isArray(values) || values.length !== itemCount) {
    return { ok: false, reason: 'values' };
  }
  for (const t of values) {
    if (!Array.isArray(t) || t.length !== 3) {
      return { ok: false, reason: 'values' };
    }
    for (const x of t) {
      if (!isInt(x) || x < VALUE_MIN || x > VALUE_MAX) {
        return { ok: false, reason: 'values' };
      }
    }
  }
  const selection = o.selection;
  if (!Array.isArray(selection)) {
    return { ok: false, reason: 'selection' };
  }
  const seen = new Set<number>();
  for (const p of selection) {
    if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0]) || !isInt(p[1])) {
      return { ok: false, reason: 'selection' };
    }
    if (p[0] < 0 || p[0] >= itemCount || p[1] < 0 || p[1] > 2 || seen.has(p[0])) {
      return { ok: false, reason: 'selection' };
    }
    seen.add(p[0]);
  }
  for (const r of route) {
    const m = /^detail\/(\d+)$/.exec(r);
    if (m && Number(m[1]) >= itemCount) {
      return { ok: false, reason: 'route' };
    }
  }
  return {
    ok: true,
    record: {
      v: 2,
      route: route as string[],
      anchor: o.anchor,
      selection: selection as number[][],
      lastSeq: o.lastSeq,
      values: values as number[][],
    },
  };
}
