// Restoration record v2 (design §8.8): written on background, read on launch with mb.restore=1.
// {"v":2,"route":["list","detail/21"],"anchor":20,"selection":[[i,o],…],"lastSeq":n,"values":[[a,b,c],…]}

import { isValidValue, OPTIONS } from './fixture';
import { Store } from './store';

export interface RestoreRecord {
  readonly v: 2;
  readonly route: readonly string[];
  readonly anchor: number;
  readonly selection: ReadonlyArray<readonly [number, number]>;
  readonly lastSeq: number;
  readonly values: ReadonlyArray<readonly [number, number, number]>;
}

const MAX_ROUTE_DEPTH = 8;

export function isValidRoute(route: string, itemCount: number): boolean {
  if (route === 'list' || route === 'selection' || route === 'insights') {
    return true;
  }
  const m = /^detail\/(0|[1-9][0-9]*)$/.exec(route);
  return m !== null && Number(m[1]) < itemCount;
}

export function recordFromStore(store: Store, route: readonly string[], anchor: number): RestoreRecord {
  const values: Array<[number, number, number]> = [];
  for (let i = 0; i < store.itemCount; i += 1) {
    values.push([store.values[i * OPTIONS], store.values[i * OPTIONS + 1], store.values[i * OPTIONS + 2]]);
  }
  return { v: 2, route: [...route], anchor, selection: store.selectionList(), lastSeq: store.lastSeq, values };
}

/** Canonical form: fixed key order, no whitespace, integers only, trailing LF. */
export function serializeRecord(record: RestoreRecord): string {
  const pairs = record.selection.map(([i, o]) => `[${i},${o}]`).join(',');
  const values = record.values.map(([a, b, c]) => `[${a},${b},${c}]`).join(',');
  const route = record.route.map((r) => JSON.stringify(r)).join(',');
  return `{"v":2,"route":[${route}],"anchor":${record.anchor},"selection":[${pairs}],"lastSeq":${record.lastSeq},"values":[${values}]}\n`;
}

function isNonNegInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0;
}

/** Returns null for a missing, unparsable, v1 or inconsistent record (error code persist-read). */
export function parseRecord(text: string | null, itemCount: number): RestoreRecord | null {
  if (text === null || text.length === 0) {
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) {
    return null;
  }
  const r = doc as Record<string, unknown>;
  if (r.v !== 2 || !Array.isArray(r.route) || !Array.isArray(r.selection) || !Array.isArray(r.values)) {
    return null;
  }
  const route = r.route;
  if (route.length === 0 || route.length > MAX_ROUTE_DEPTH || route[0] !== 'list') {
    return null;
  }
  if (!route.every((x: unknown) => typeof x === 'string' && isValidRoute(x, itemCount))) {
    return null;
  }
  if (!isNonNegInt(r.anchor) || r.anchor >= itemCount || !isNonNegInt(r.lastSeq)) {
    return null;
  }
  if (r.values.length !== itemCount) {
    return null;
  }
  const values: Array<[number, number, number]> = [];
  for (const raw of r.values as unknown[]) {
    if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(isValidValue)) {
      return null;
    }
    values.push([raw[0], raw[1], raw[2]]);
  }
  const selection: Array<[number, number]> = [];
  let previous = -1;
  for (const raw of r.selection as unknown[]) {
    if (!Array.isArray(raw) || raw.length !== 2 || !isNonNegInt(raw[0]) || !isNonNegInt(raw[1])) {
      return null;
    }
    if (raw[0] <= previous || raw[0] >= itemCount || raw[1] >= OPTIONS) {
      return null;
    }
    previous = raw[0];
    selection.push([raw[0], raw[1]]);
  }
  return { v: 2, route: route as string[], anchor: r.anchor, selection, lastSeq: r.lastSeq, values };
}
