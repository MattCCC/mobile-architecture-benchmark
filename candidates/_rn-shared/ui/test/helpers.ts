// Test helpers: deterministic fake clock, fixture/golden loading, a recording BenchKit port.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clock } from '../src/stream/source.ts';
import type { BenchPort } from '../src/app/session.ts';
import type { FixtureFile } from '../src/domain/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..', '..');
export const fixturesDir = join(repoRoot, 'fixtures', 'v1');

export function loadFixture(profile: string): FixtureFile {
  return JSON.parse(readFileSync(join(fixturesDir, `${profile}.json`), 'utf8')) as FixtureFile;
}

export interface GoldenProfile {
  sha256: string;
  seq0Summary: { selectedCount: number; total: number; totalText: string };
  stateDigests: { seq: number; digest: string }[];
  insightsDigests: { seq: number; digest: string }[];
  stream: { messages: number; sha256: string };
  updateRatePerSecond: number;
}

export function loadGolden(profile: string): GoldenProfile {
  const g = JSON.parse(readFileSync(join(fixturesDir, 'golden.json'), 'utf8')) as {
    profiles: Record<string, GoldenProfile>;
  };
  return g.profiles[profile];
}

interface Timer {
  id: number;
  due: number;
  fn: () => void;
}

/** Fake monotonic clock with ordered timers. */
export class FakeClock implements Clock {
  t = 1000;
  private timers: Timer[] = [];
  private nextId = 1;

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const timer = { id: this.nextId++, due: this.t + Math.max(0, ms), fn };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  /** Advances time by `ms`, running every timer that becomes due, in due order. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.due > end) {
        break;
      }
      this.timers.shift();
      this.t = Math.max(this.t, next.due);
      next.fn();
    }
    this.t = end;
  }

  get pending(): number {
    return this.timers.length;
  }
}

export interface MarkRecord {
  event: string;
  payload: string;
}

/** BenchKit port fake: records markers and mirrors the core token counters. */
export class RecordingBench implements BenchPort {
  readonly marks: MarkRecord[] = [];
  readonly states: { k: number; seq: number; digest: string; counters: string }[] = [];
  rev = 0;
  nav = 0;
  fg = 0;
  sessions = 0;

  mark(event: string, payload: string): void {
    this.marks.push({ event, payload });
  }

  sessionStart(_selectedCount: number): void {
    this.sessions += 1;
    this.rev = 0;
    this.nav = 0;
  }

  selectionChanged(_selectedCount: number): number {
    this.rev += 1;
    return this.rev;
  }

  navStart(_route: string): number {
    this.nav += 1;
    return this.nav;
  }

  restoreToken(route: string, anchor: number): string {
    return `restore:${route}:${anchor}`;
  }

  fgSeq(): number {
    return this.fg;
  }

  markerCount(event: string): number {
    return this.marks.filter((m) => m.event === event).length;
  }

  publishState(k: number, seq: number, digest: string, counters: string): void {
    this.states.push({ k, seq, digest, counters });
  }

  memoryCheckpoint(_label: string): void {}

  flush(): void {}

  events(name: string): MarkRecord[] {
    return this.marks.filter((m) => m.event === name);
  }
}
