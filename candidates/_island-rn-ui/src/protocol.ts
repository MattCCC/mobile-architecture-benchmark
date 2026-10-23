// Island protocol, island side (the host side is `IslandHub` in candidates/_island-host). JSON objects, the same for
// every island runtime; every message carries the island instance id `sid`. Pure TypeScript (no React Native
// imports), so it runs under `node --test`.

export type IslandKindName = 'detail' | 'insights';
export type InsightsSourceKind = 'embedded' | 'cache' | 'network' | 'embedded-fallback';

interface StateBase {
  sid: number;
  /** Item count of the profile (label width). */
  n: number;
  /** Last applied update seq. */
  s: number;
  /** Screen-root probe token (`nav:<n>`, `fg:<n>`, `restore:<route>:<anchor>`). */
  tk: string;
  /** 1: mark `xr.js` per received update (scenario C7). */
  xr: number;
}

export interface DetailState extends StateBase {
  k: 'detail';
  i: number;
  g: number;
  v: number[];
}

export interface InsightsState extends StateBase {
  k: 'insights';
  /** Top 5 by option A as [item, valueA]. */
  top: number[][];
  /** Option B counts in 5 buckets. */
  b: number[];
  src: InsightsSourceKind;
  ver: string;
  open: number;
  idg: string;
}

export type IslandState = DetailState | InsightsState;

export type HostMessage =
  | ({ t: 'init' | 'snap' } & IslandState)
  | { t: 'v'; sid: number; s: number; v: number[] }
  | { t: 'ins'; sid: number; s: number; top: number[][]; b: number[] }
  | { t: 'tk'; sid: number; k: string }
  | { t: 'idg'; sid: number; x: string };

export type IslandMessage =
  | { t: 'ready'; sid: number }
  | { t: 'mark'; sid: number; e: string; p: string }
  | { t: 'probe'; sid: number; kind: string; i: number; tk: string };

const SOURCES: readonly string[] = ['embedded', 'cache', 'network', 'embedded-fallback'];

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

function isIntArray(x: unknown, len?: number): x is number[] {
  return Array.isArray(x) && (len === undefined || x.length === len) && x.every(isInt);
}

function isPairs(x: unknown): x is number[][] {
  return Array.isArray(x) && x.length <= 5 && x.every((p) => isIntArray(p, 2));
}

function isState(m: Record<string, unknown>): boolean {
  if (!isInt(m.sid) || !isInt(m.n) || m.n < 1 || !isInt(m.s) || typeof m.tk !== 'string' || !isInt(m.xr)) {
    return false;
  }
  if (m.k === 'detail') {
    return isInt(m.i) && m.i >= 0 && m.i < (m.n as number) && isInt(m.g) && isIntArray(m.v, 3);
  }
  if (m.k === 'insights') {
    return (
      isPairs(m.top) &&
      isIntArray(m.b, 5) &&
      typeof m.src === 'string' &&
      SOURCES.includes(m.src) &&
      typeof m.ver === 'string' &&
      isInt(m.open) &&
      typeof m.idg === 'string'
    );
  }
  return false;
}

/** Parses and validates one host message (object or JSON text); returns null for anything else. */
export function parseHostMessage(input: unknown): HostMessage | null {
  let o: unknown = input;
  if (typeof input === 'string') {
    try {
      o = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (typeof o !== 'object' || o === null) {
    return null;
  }
  const m = o as Record<string, unknown>;
  if (!isInt(m.sid)) {
    return null;
  }
  switch (m.t) {
    case 'init':
    case 'snap':
      return isState(m) ? (m as unknown as HostMessage) : null;
    case 'v':
      return isInt(m.s) && isIntArray(m.v, 3) ? (m as unknown as HostMessage) : null;
    case 'ins':
      return isInt(m.s) && isPairs(m.top) && isIntArray(m.b, 5) ? (m as unknown as HostMessage) : null;
    case 'tk':
      return typeof m.k === 'string' ? (m as unknown as HostMessage) : null;
    case 'idg':
      return typeof m.x === 'string' ? (m as unknown as HostMessage) : null;
    default:
      return null;
  }
}
