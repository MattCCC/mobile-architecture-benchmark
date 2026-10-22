// Host-independent runtime: boot (launch config, fixture, session), stream gate (connect after FUI or `restore`),
// background/foreground, activity-warm reset, bridge micro-benchmark. Hosts wrap their navigator with
// <MobileBenchProvider> and supply a NavAdapter.
import React, { Component, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';
import { Observable } from '../domain/observable';
import { parseLaunchConfig } from '../domain/launchConfig';
import type { LaunchConfig } from '../domain/launchConfig';
import type { FixtureFile } from '../domain/types';
import { ReplaySource } from '../stream/replay';
import { runtimeClock } from '../stream/source';
import type { FrameSource } from '../stream/source';
import { WebSocketSource } from '../stream/websocket';
import type { SocketLike } from '../stream/websocket';
import { bench } from '../bench/benchkit';
import { fetchFixture, isValidFixture, loadEmbeddedFixture, loadStreamAsset } from './assets';
import { asyncStoragePersistence } from './persistence';
import { NavContext, SessionContext } from './context';
import type { NavAdapter } from './context';
import { Session } from './session';
import { ErrorScreen } from '../screens/ErrorScreen';

export type BootState =
  | { kind: 'pending' }
  | { kind: 'ready'; session: Session }
  | { kind: 'error'; code: string };

function createSource(config: LaunchConfig): FrameSource {
  if (config.source === 'websocket' && config.server !== null) {
    return new WebSocketSource({
      wsBase: config.server.wsBase,
      profile: config.profile,
      session: config.session,
      token: config.token,
      factory: (url) => new WebSocket(url) as unknown as SocketLike,
    });
  }
  return new ReplaySource(loadStreamAsset(config.profile), runtimeClock, config.count);
}

let boot: Observable<BootState> | null = null;

/** Boots once per JS runtime (design §8.3 steps 1-3). Normal launches are ready synchronously. */
export function bootSession(): Observable<BootState> {
  if (boot !== null) {
    return boot;
  }
  const state = new Observable<BootState>({ kind: 'pending' });
  boot = state;
  const parsed = parseLaunchConfig(bench.launchConfigRaw());
  if (parsed.unknown.length > 0) {
    bench.mark('err', `code=launch-config-unknown-key;n=${parsed.unknown.length}`);
  }
  if (parsed.invalid.length > 0) {
    bench.mark('err', 'code=launch-config-invalid');
    state.set({ kind: 'error', code: 'launch-config-invalid' });
    return state;
  }
  const config = parsed.config;
  const fail = (code: string): void => {
    bench.mark('err', `code=${code}`);
    state.set({ kind: 'error', code });
  };
  const finish = (fixture: FixtureFile): void => {
    if (!isValidFixture(fixture, config.profile)) {
      fail('fixture-invalid');
      return;
    }
    const session = new Session(config, fixture, {
      bench,
      persistence: asyncStoragePersistence,
      clock: runtimeClock,
      createSource,
    });
    if (session.prepareSync() !== null) {
      state.set({ kind: 'ready', session });
      return;
    }
    session.prepare().then(
      () => state.set({ kind: 'ready', session }),
      () => fail('unexpected-exception'),
    );
  };
  if (config.dataset === 'network' && config.server !== null) {
    fetchFixture(config.server, config.profile, config.token).then(finish, () => fail('fixture-invalid'));
  } else {
    let fixture: FixtureFile | null = null;
    try {
      fixture = loadEmbeddedFixture(config.profile);
    } catch {
      fixture = null;
    }
    if (fixture === null) {
      fail('fixture-invalid');
    } else {
      finish(fixture);
    }
  }
  return state;
}

export function useBoot(): BootState {
  const o = bootSession();
  return useSyncExternalStore(o.subscribe, o.get, o.get);
}

/** Calls `cb` once `event` has been emitted `target` times (polled per frame through a synchronous JSI call). */
function waitForMarker(event: string, target: number, cb: () => void): () => void {
  let cancelled = false;
  let frames = 0;
  const tick = (): void => {
    if (cancelled) {
      return;
    }
    if (bench.markerCount(event) >= target) {
      cb();
      return;
    }
    frames += 1;
    if (frames < 600) {
      requestAnimationFrame(tick);
    } else {
      setTimeout(tick, 250);
    }
  };
  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}

function percentile(sorted: number[], p: number): number {
  // Hyndman-Fan type 7.
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return Math.round(sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]));
}

/** Bridge micro-benchmark (design §10.1 C6): 1000 empty + 1000 x 1 KiB round trips, in-runtime clock. */
async function runBridgeBench(mode: 'sync' | 'async'): Promise<void> {
  const payloads: [string, string][] = [
    ['empty', ''],
    ['1k', 'x'.repeat(1024)],
  ];
  for (const [label, value] of payloads) {
    const samples: number[] = new Array<number>(1000);
    for (let k = 0; k < 1000; k += 1) {
      const t0 = bench.nowNs();
      if (mode === 'sync') {
        bench.echo(value);
      } else {
        await bench.echoAsync(value);
      }
      samples[k] = bench.nowNs() - t0;
    }
    samples.sort((a, b) => a - b);
    bench.mark(
      'bridge',
      `m=${mode};s=${label};p50=${percentile(samples, 0.5)};p95=${percentile(samples, 0.95)};p99=${percentile(samples, 0.99)}`,
    );
  }
}

let providerMounts = 0;

export interface ProviderProps {
  session: Session;
  nav: NavAdapter;
  children: ReactNode;
}

export function MobileBenchProvider({ session, nav, children }: ProviderProps): React.JSX.Element {
  // Activity-warm start (design §31 item 6a): a new root in a live JS runtime resets the session before any child
  // mounts, so the core gate re-arms before the first probe draws.
  const [gateTarget] = useState<number>(() => {
    providerMounts += 1;
    if (providerMounts > 1) {
      session.resetForNewActivity();
    }
    return bench.markerCount(session.streamGateMarker) + 1;
  });

  useEffect(() => {
    let wasBackground = false;
    let cancelResume: (() => void) | null = null;
    const gateEvent = session.streamGateMarker;
    const cancelGate = waitForMarker(gateEvent, gateTarget, () => {
      if (gateEvent === 'restore') {
        session.restoreDone();
      }
      session.startStream();
      const mode = session.config.bridgeBench;
      if (mode === 'sync' || mode === 'async') {
        setTimeout(() => {
          runBridgeBench(mode).catch(() => bench.mark('err', 'code=unexpected-exception'));
        }, 5000);
      }
    });
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        wasBackground = true;
        if (cancelResume !== null) {
          cancelResume();
          cancelResume = null;
        }
        session.onBackground(nav.routes()).catch(() => bench.mark('err', 'code=persist-write'));
      } else if (next === 'active' && wasBackground) {
        wasBackground = false;
        const target = bench.markerCount('resume') + 1;
        session.onForeground();
        // Reconnect only after `resume` was emitted (design §31 item 12).
        cancelResume = waitForMarker('resume', target, () => {
          cancelResume = null;
          session.startStream();
        });
      }
    });
    return () => {
      cancelGate();
      if (cancelResume !== null) {
        cancelResume();
      }
      sub.remove();
      session.stopStream('unmount');
    };
  }, [session, nav, gateTarget]);

  return (
    <SessionContext.Provider value={session}>
      <NavContext.Provider value={nav}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </NavContext.Provider>
    </SessionContext.Provider>
  );
}

interface BoundaryState {
  failed: boolean;
}

/** Unexpected render errors: `err code=unexpected-exception`, then the Error screen content. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    bench.mark('err', 'code=unexpected-exception');
  }

  render(): ReactNode {
    if (this.state.failed) {
      return this.props.fallback ?? <ErrorScreen code="unexpected-exception" />;
    }
    return this.props.children;
  }
}
