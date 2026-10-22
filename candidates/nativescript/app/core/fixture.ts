// Parses and validates a fixture document (format mobilebench.fixture/1.0.0, fixtures/README.md).
// The app embeds the committed bytes unchanged; this module only reads them.

export const FIXTURE_SCHEMA = 'mobilebench.fixture/1.0.0';
export const VALUE_MIN = 100;
export const VALUE_MAX = 9999;
export const OPTIONS = 3;
export const GROUPS = 8;

export interface Fixture {
  readonly profile: string;
  readonly seed: number;
  readonly fixtureVersion: string;
  readonly itemCount: number;
  /** values[i * 3 + o], fixed-point integers. */
  readonly values: Int32Array;
  readonly groups: Uint8Array;
  /** Initial selection as [itemIndex, optionIndex], sorted by item index. */
  readonly selection: ReadonlyArray<readonly [number, number]>;
}

export class FixtureError extends Error {
  readonly code = 'fixture-invalid';
}

function isInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x);
}

export function isValidValue(x: unknown): x is number {
  return isInt(x) && x >= VALUE_MIN && x <= VALUE_MAX;
}

function fail(message: string): never {
  throw new FixtureError(message);
}

export function parseFixture(doc: unknown): Fixture {
  if (typeof doc !== 'object' || doc === null) {
    fail('fixture is not an object');
  }
  const d = doc as Record<string, unknown>;
  if (d.schema !== FIXTURE_SCHEMA) {
    fail(`unexpected schema ${String(d.schema)}`);
  }
  if (typeof d.profile !== 'string' || !/^[a-z][a-z0-9-]*$/.test(d.profile)) {
    fail('invalid profile');
  }
  if (!isInt(d.seed) || typeof d.fixtureVersion !== 'string') {
    fail('invalid seed or fixtureVersion');
  }
  const items = d.items;
  const selection = d.selection;
  if (!Array.isArray(items) || items.length === 0 || !Array.isArray(selection)) {
    fail('items or selection missing');
  }
  const n = items.length;
  const values = new Int32Array(n * OPTIONS);
  const groups = new Uint8Array(n);
  items.forEach((raw: unknown, index: number) => {
    const it = raw as Record<string, unknown>;
    const v = it?.v;
    if (it?.i !== index || !isInt(it.g) || it.g < 0 || it.g >= GROUPS || !Array.isArray(v) || v.length !== OPTIONS) {
      fail(`invalid item at index ${index}`);
    }
    v.forEach((x: unknown, o: number) => {
      if (!isValidValue(x)) {
        fail(`invalid value at item ${index} option ${o}`);
      }
      values[index * OPTIONS + o] = x;
    });
    groups[index] = it.g as number;
  });
  let previous = -1;
  const sel = selection.map((raw: unknown) => {
    const s = raw as Record<string, unknown>;
    if (!isInt(s?.i) || !isInt(s.o) || s.i <= previous || s.i >= n || s.o < 0 || s.o >= OPTIONS) {
      fail('invalid or unsorted selection entry');
    }
    previous = s.i;
    return [s.i, s.o] as const;
  });
  return {
    profile: d.profile,
    seed: d.seed,
    fixtureVersion: d.fixtureVersion,
    itemCount: n,
    values,
    groups,
    selection: sel,
  };
}
