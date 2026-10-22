// Shared test helpers: repository paths, fixture loading, a deterministic fake clock and an event recorder.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Fixture, parseFixture } from '../app/core/fixture';
import type { StreamEvents, StreamStatus, Timers } from '../app/core/stream-client';

/** Compiled tests run from build/test/test. */
export const candidateRoot = resolve(__dirname, '..', '..', '..');
export const repoRoot = resolve(candidateRoot, '..', '..');
export const fixturesDir = join(repoRoot, 'fixtures', 'v1');

export const PROFILES = ['small', 'representative', 'stress'] as const;

export interface GoldenProfile {
  file: string;
  sha256: string;
  seq0Summary: { selectedCount: number; total: number; totalText: string };
  stateDigests: Array<{ seq: number; digest: string }>;
  insightsDigests: Array<{ seq: number; digest: string }>;
  stream: { messages: number; sha256: string };
}

export function golden(): { profiles: Record<string, GoldenProfile> } {
  return JSON.parse(readFileSync(join(fixturesDir, 'golden.json'), 'utf8'));
}

export function loadFixture(profile: string): Fixture {
  return parseFixture(JSON.parse(readFileSync(join(fixturesDir, `${profile}.json`), 'utf8')));
}

/** Replay stream written by scripts/prepare-assets.mjs (npm test runs it first). */
export function streamText(profile: string): string {
  return readFileSync(join(candidateRoot, 'app', 'generated', 'stream', `${profile}.stream.jsonl`), 'utf8');
}

/** The shared generator (ESM), for reference values computed independently of the app code. */
export interface GeneratorLib {
  stateText(profile: string, seq: number, values: number[][], selection: Array<{ i: number; o: number }>): string;
  sha256Hex(text: string): string;
}

export async function generatorLib(): Promise<GeneratorLib> {
  return import(pathToFileURL(join(repoRoot, 'fixtures', 'generator', 'lib.mjs')).href) as Promise<GeneratorLib>;
}

/** Deterministic timers on a fake monotonic clock (ns). */
export class FakeClock implements Timers {
  private now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void }>();

  readonly nowNs = (): number => this.now;

  get nowMs(): number {
    return this.now / 1e6;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { at: this.now + Math.max(0, ms) * 1e6, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get pending(): number {
    return this.tasks.size;
  }

  /** Runs every task due within the next ms milliseconds, in due-time order. */
  advanceMs(ms: number): void {
    const end = this.now + ms * 1e6;
    for (;;) {
      let pick = -1;
      let at = Number.POSITIVE_INFINITY;
      this.tasks.forEach((task, id) => {
        if (task.at <= end && task.at < at) {
          pick = id;
          at = task.at;
        }
      });
      if (pick === -1) {
        break;
      }
      const task = this.tasks.get(pick) as { at: number; fn: () => void };
      this.tasks.delete(pick);
      this.now = task.at;
      task.fn();
    }
    this.now = end;
  }
}

export class Recorder implements StreamEvents {
  readonly statuses: StreamStatus[] = [];
  readonly markers: string[] = [];
  readonly errors: string[] = [];
  readonly checkpoints: Array<{ k: number; atMs: number }> = [];
  readonly appliedSeqs: number[] = [];

  constructor(private readonly clock: FakeClock) {}

  status(status: StreamStatus): void {
    this.statuses.push(status);
  }

  marker(event: string, payload: string): void {
    this.markers.push(payload === '' ? event : `${event} ${payload}`);
  }

  applied(seq: number): void {
    this.appliedSeqs.push(seq);
  }

  checkpoint(k: number): void {
    this.checkpoints.push({ k, atMs: this.clock.nowMs });
  }

  error(code: string): void {
    this.errors.push(code);
  }

  get lastStatus(): StreamStatus | undefined {
    return this.statuses[this.statuses.length - 1];
  }
}
