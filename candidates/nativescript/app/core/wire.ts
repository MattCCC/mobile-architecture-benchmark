// Stream wire protocol (design §7.5): compact JSON text frames.
//   hello {"t":"h","session":…,"profile":…,"seed":…,"rate":…,"from":…}
//   update {"t":"u","s":17,"i":42,"v":[1234,567,8910]}
//   end {"t":"e","last":600}   checkpoint {"t":"c","k":3,"last":417}   resume {"t":"r","from":418}

import { isValidValue } from './fixture';

export type Frame =
  | { readonly t: 'h'; readonly from: number; readonly rate: number }
  | { readonly t: 'u'; readonly s: number; readonly i: number; readonly a: number; readonly b: number; readonly c: number }
  | { readonly t: 'e'; readonly last: number }
  | { readonly t: 'c'; readonly k: number; readonly last: number }
  | { readonly t: 'r'; readonly from: number };

function nonNegInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0;
}

/** Parses one frame; returns null for anything that violates the protocol (error code stream-protocol). */
export function parseFrame(text: string, itemCount: number): Frame | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) {
    return null;
  }
  const f = doc as Record<string, unknown>;
  switch (f.t) {
    case 'u': {
      const v = f.v;
      if (!nonNegInt(f.s) || f.s < 1 || !nonNegInt(f.i) || f.i >= itemCount || !Array.isArray(v) || v.length !== 3) {
        return null;
      }
      if (!isValidValue(v[0]) || !isValidValue(v[1]) || !isValidValue(v[2])) {
        return null;
      }
      return { t: 'u', s: f.s, i: f.i, a: v[0], b: v[1], c: v[2] };
    }
    case 'h':
      return nonNegInt(f.from) && f.from >= 1 && nonNegInt(f.rate) && f.rate >= 1 ? { t: 'h', from: f.from, rate: f.rate } : null;
    case 'e':
      return nonNegInt(f.last) ? { t: 'e', last: f.last } : null;
    case 'c':
      return nonNegInt(f.k) && nonNegInt(f.last) ? { t: 'c', k: f.k, last: f.last } : null;
    case 'r':
      return nonNegInt(f.from) && f.from >= 1 ? { t: 'r', from: f.from } : null;
    default:
      return null;
  }
}

export function helloFrame(session: string, profile: string, seed: number, rate: number, from: number): string {
  return `{"t":"h","session":${JSON.stringify(session)},"profile":${JSON.stringify(profile)},"seed":${seed},"rate":${rate},"from":${from}}`;
}

export function endFrame(last: number): string {
  return `{"t":"e","last":${last}}`;
}
