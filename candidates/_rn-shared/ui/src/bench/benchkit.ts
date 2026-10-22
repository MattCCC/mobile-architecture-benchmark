// JS facade over the `MobileBenchKit` TurboModule (synchronous JSI calls). Without the native module (unit tests,
// web) a no-op fallback keeps the app usable: it counts markers in memory and treats the JS list layout as FUI.
import { NativeMobileBenchKit } from '@mobilebench/rn-benchkit';
import type { BenchPort } from '../app/session';

export interface BenchKit extends BenchPort {
  readonly native: boolean;
  nowNs(): number;
  launchConfigRaw(): Record<string, string>;
  /** JS-side list container height (dp/pt); only used when the native list probe is unavailable. */
  listLayoutFallback(height: number): void;
  echo(value: string): string;
  echoAsync(value: string): Promise<string>;
}

const native = NativeMobileBenchKit;

function parseConfig(json: string): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(json);
    if (typeof raw === 'object' && raw !== null) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        out[k] = String(v);
      }
      return out;
    }
  } catch {
    // fall through
  }
  return {};
}

function createNativeBench(m: NonNullable<typeof native>): BenchKit {
  return {
    native: true,
    mark: (event, payload) => {
      m.mark(event, payload);
    },
    nowNs: () => m.nowNs(),
    markerCount: (event) => m.markerCount(event),
    launchConfigRaw: () => parseConfig(m.launchConfig()),
    fgSeq: () => m.fgSeq(),
    sessionStart: (count) => {
      m.sessionStart(count);
    },
    selectionChanged: (count) => m.selectionChanged(count),
    navStart: (route) => m.navStart(route),
    restoreToken: (route, anchor) => m.restoreToken(route, anchor),
    listLayoutFallback: () => {},
    publishState: (k, seq, digest, counters) => {
      m.publishState(k, seq, digest, counters);
    },
    memoryCheckpoint: (label) => {
      m.memoryCheckpoint(label);
    },
    flush: () => {
      m.flush();
    },
    echo: (value) => m.echo(value),
    echoAsync: (value) => m.echoAsync(value),
  };
}

function createFallbackBench(): BenchKit {
  const counts = new Map<string, number>();
  let rev = 0;
  let nav = 0;
  const mark = (event: string): void => {
    counts.set(event, (counts.get(event) ?? 0) + 1);
  };
  return {
    native: false,
    mark,
    nowNs: () => Math.round((globalThis as unknown as { performance: { now(): number } }).performance.now() * 1e6),
    markerCount: (event) => counts.get(event) ?? 0,
    launchConfigRaw: () => ({}),
    fgSeq: () => 0,
    sessionStart: () => {
      rev = 0;
      nav = 0;
      counts.delete('fui');
    },
    selectionChanged: () => {
      rev += 1;
      return rev;
    },
    navStart: () => {
      nav += 1;
      return nav;
    },
    restoreToken: (route, anchor) => `restore:${route}:${anchor}`,
    listLayoutFallback: () => {
      if ((counts.get('fui') ?? 0) === 0) {
        mark('fui');
      }
    },
    publishState: () => {},
    memoryCheckpoint: () => {},
    flush: () => {},
    echo: (value) => value,
    echoAsync: async (value) => value,
  };
}

export const bench: BenchKit = native ? createNativeBench(native) : createFallbackBench();
