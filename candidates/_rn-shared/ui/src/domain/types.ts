// Neutral domain model (Item, Option A/B/C, Selection, UpdateMessage, Insights).
// Pure TypeScript: no React or React Native imports, so the module runs under `node --test`.

export type ProfileName = 'small' | 'representative' | 'stress';

export const PROFILES: readonly ProfileName[] = ['small', 'representative', 'stress'];

export const OPTION_KEYS = ['A', 'B', 'C'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export const ROW_HEIGHT = 72;
export const VALUE_MIN = 100;
export const VALUE_MAX = 9999;
export const VALUE_SPAN = VALUE_MAX - VALUE_MIN + 1;

/** One item line of `fixtures/v1/<profile>.json`. */
export interface FixtureItem {
  i: number;
  g: number;
  v: number[];
}

/** One initial selection entry: item index and option index (0 = A, 1 = B, 2 = C). */
export interface FixtureSelection {
  i: number;
  o: number;
}

/** The committed fixture file (schema `mobilebench.fixture/1.0.0`). */
export interface FixtureFile {
  schema: string;
  fixtureVersion: string;
  profile: string;
  seed: number;
  generator: { prng: string; algorithmVersion: number };
  valueScale: number;
  valueRange: number[];
  items: FixtureItem[];
  selection: FixtureSelection[];
}

/** One update message: replaces all three values of item `i` (absolute, idempotent). */
export interface UpdateMessage {
  s: number;
  i: number;
  v: number[];
}

/** Wire frames of the update stream (design §7.5). */
export type StreamFrame =
  | { t: 'h'; session?: string; profile?: string; seed?: number; rate?: number; from?: number }
  | { t: 'u'; s: number; i: number; v: number[] }
  | { t: 'c'; k: number; last: number }
  | { t: 'r'; from: number }
  | { t: 'e'; last: number };

/** The six status words of `mb.stream.status`. */
export type StreamStatus = 'Connecting' | 'Live' | 'Paused' | 'Stale' | 'Disconnected' | 'Ended';
