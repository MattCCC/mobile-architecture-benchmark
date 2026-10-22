// One benchmark session: startup sequence (design §8.3), restoration (§8.8), stream after FUI, checkpoints (§6.6),
// background/foreground, probe tokens from BenchKit core state (§6.2, §31 item 11). Pure TypeScript: every platform
// dependency (BenchKit, persistence, data source, timers) is injected, so the logic runs under `node --test`.

import { insightsText, Store } from '../domain/store.ts';
import { sha256Hex } from '../domain/sha256.ts';
import { Observable } from '../domain/observable.ts';
import { parseRecord, serializeRecord } from '../domain/restoration.ts';
import type { RestorationRecord } from '../domain/restoration.ts';
import type { FixtureFile, StreamStatus } from '../domain/types.ts';
import type { LaunchConfig } from '../domain/launchConfig.ts';
import { StreamClient } from '../stream/client.ts';
import type { Clock, FrameSource } from '../stream/source.ts';

/** The BenchKit calls a session needs (implemented over the native TurboModule, or a fake in tests). */
export interface BenchPort {
  mark(event: string, payload: string): void;
  /** Starts (or re-arms) the session in BenchKit core: FUI gate, selection revision 0, nav sequence 0. */
  sessionStart(selectedCount: number): void;
  /** Reports a selection change; returns the core's new selection revision (`rev:<n>` token). */
  selectionChanged(selectedCount: number): number;
  /** Reports that `route` became the top route (transition start); returns the core's new `navSeq`. */
  navStart(route: string): number;
  /** Returns the core's restore token `restore:<route>:<anchor>`. */
  restoreToken(route: string, anchor: number): string;
  fgSeq(): number;
  markerCount(event: string): number;
  publishState(k: number, seq: number, digest: string, counters: string): void;
  memoryCheckpoint(label: string): void;
  flush(): void;
}

export interface Persistence {
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}

/** Token shown by the root probe of the top screen (`nav:`, `fg:`, `restore:`). */
export interface TopToken {
  route: string;
  token: string;
}

export interface SessionDeps {
  bench: BenchPort;
  persistence: Persistence;
  clock: Clock;
  createSource(config: LaunchConfig): FrameSource;
}

export interface StartupPlan {
  /** Route stack to show, bottom first (`["list"]` or the restored stack). */
  routes: string[];
  /** Row index at the top of the List viewport. */
  anchor: number;
  restored: boolean;
}

export class Session {
  readonly config: LaunchConfig;
  readonly store: Store;
  readonly status = new Observable<StreamStatus>('Disconnected');
  readonly digestText = new Observable<string>('k=-;seq=-;d=-');
  readonly insightsDigest = new Observable<string>('-');
  readonly topToken: Observable<TopToken>;
  /** Summary probe token: `fui0` until the first selection change, then `rev:<n>`. */
  readonly summaryToken = new Observable<string>('fui0');
  private readonly deps: SessionDeps;
  private readonly fixture: FixtureFile;
  private readonly screenTokens = new Map<string, string>();
  private client: StreamClient | null = null;
  private plan: StartupPlan = { routes: ['list'], anchor: 0, restored: false };
  private restorePending: string | null = null;
  private currentRoute = 'list';
  private anchorIndex = 0;
  private insightsShown = 0;
  private backgroundSave: Promise<void> | null = null;

  constructor(config: LaunchConfig, fixture: FixtureFile, deps: SessionDeps) {
    this.config = config;
    this.fixture = fixture;
    this.deps = deps;
    this.store = new Store(config.profile, fixture);
    this.topToken = new Observable<TopToken>({ route: 'list', token: 'nav:0' });
    this.screenTokens.set('list', 'nav:0');
  }

  /** Token of the top screen; every screen keeps the token it had when it was last on top. */
  private setTop(route: string, token: string): void {
    this.screenTokens.set(route, token);
    this.topToken.set({ route, token });
  }

  /** Probe token of a screen root (`init` until the screen has been on top once). */
  tokenFor(route: string): string {
    return this.screenTokens.get(route) ?? 'init';
  }

  /** A screen root unmounted: a later screen with the same route starts again from `init`. */
  forgetScreen(route: string): void {
    if (route !== this.currentRoute) {
      this.screenTokens.delete(route);
    }
  }

  /**
   * Synchronous part of startup: returns the plan when no restoration is requested (normal launch renders the
   * List in the same JS task), or null when `prepare()` must read the restoration record first.
   */
  prepareSync(): StartupPlan | null {
    this.deps.bench.sessionStart(this.store.getSelection().count);
    if (!this.config.restore) {
      this.plan = { routes: ['list'], anchor: 0, restored: false };
      return this.plan;
    }
    return null;
  }

  /** Startup steps 1-4 of design §8.3: fixture at seq 0, or the exact restored state at `lastSeq`. */
  async prepare(): Promise<StartupPlan> {
    const plan = this.prepareSync();
    if (plan !== null) {
      return plan;
    }
    let text: string | null = null;
    try {
      text = await this.deps.persistence.load();
    } catch {
      text = null;
    }
    const parsed = parseRecord(text, this.store.itemCount);
    if (!parsed.ok) {
      this.deps.bench.mark('err', 'code=persist-read');
      this.plan = { routes: ['list'], anchor: 0, restored: false };
      return this.plan;
    }
    const r = parsed.record;
    // Values and selection first, then route and anchor (design §31 item 7).
    this.store.restoreState(r.values, r.selection, r.lastSeq);
    this.deps.bench.sessionStart(this.store.getSelection().count);
    const top = r.route[r.route.length - 1];
    this.restorePending = top;
    this.anchorIndex = r.anchor;
    this.currentRoute = top;
    this.setTop(top, this.deps.bench.restoreToken(top, r.anchor));
    this.plan = { routes: r.route, anchor: r.anchor, restored: true };
    return this.plan;
  }

  get startupPlan(): StartupPlan {
    return this.plan;
  }

  /** The marker whose first emission allows the stream to connect: `restore` or `fui`. */
  get streamGateMarker(): 'restore' | 'fui' {
    return this.plan.restored ? 'restore' : 'fui';
  }

  /** Activity-warm start in a live process (design §31 item 6a): fixture at seq 0, route list, stream after FUI. */
  resetForNewActivity(): void {
    this.stopStream('activity-recreated');
    this.store.resetToFixture(this.fixture);
    this.restorePending = null;
    this.currentRoute = 'list';
    this.anchorIndex = 0;
    this.plan = { routes: ['list'], anchor: 0, restored: false };
    this.summaryToken.set('fui0');
    this.digestText.set('k=-;seq=-;d=-');
    this.deps.bench.sessionStart(this.store.getSelection().count);
    this.screenTokens.clear();
    this.setTop('list', 'nav:0');
  }

  /** Step 6 of design §8.3: connect the update stream (after FUI, after `restore`, after `resume`). */
  startStream(): void {
    if (this.client === null) {
      this.client = new StreamClient(this.deps.createSource(this.config), this.deps.clock, {
        lastApplied: () => this.store.lastSeq,
        apply: (seq, item, values) => this.store.applyUpdate(seq, item, values),
        status: (s) => this.status.set(s),
        checkpoint: (k) => this.checkpoint(k),
        mark: (event, payload) => this.deps.bench.mark(event, payload),
      });
    }
    this.client.start();
  }

  stopStream(reason: string): void {
    if (this.client !== null) {
      this.client.stop(reason);
    }
  }

  /** A tap on option `o` of item `i` (design §8.5). */
  toggle(i: number, o: number): void {
    const snap = this.store.toggle(i, o);
    const rev = this.deps.bench.selectionChanged(snap.count);
    this.summaryToken.set(`rev:${rev}`);
  }

  /** The navigator reports a new top route at transition start (push or pop). */
  routeChanged(route: string): void {
    if (this.restorePending !== null) {
      if (this.plan.routes.includes(route)) {
        // The restored stack is being rebuilt: the restored top keeps its `restore:` token until `restore`.
        this.currentRoute = route;
        return;
      }
      this.restorePending = null;
    }
    if (route === this.currentRoute) {
      return;
    }
    this.currentRoute = route;
    const nav = this.deps.bench.navStart(route);
    this.setTop(route, `nav:${nav}`);
  }

  /** Called once the `restore` marker has been emitted. */
  restoreDone(): void {
    this.restorePending = null;
  }

  get topRoute(): string {
    return this.currentRoute;
  }

  /** Last scroll anchor of the List (row index at the top of the viewport), for the restoration record. */
  setAnchor(index: number): void {
    this.anchorIndex = Math.max(0, Math.min(this.store.itemCount - 1, index));
  }

  get anchor(): number {
    return this.anchorIndex;
  }

  insightsVisible(shown: boolean): void {
    this.insightsShown += shown ? 1 : -1;
  }

  /**
   * Background (design §8.8): close the stream, write record v2 (values at lastSeq), then publish checkpoint k = 0.
   * The stream is closed first so the record equals the final state exactly.
   */
  onBackground(routes: string[]): Promise<void> {
    this.stopStream('background');
    const record: RestorationRecord = {
      v: 2,
      route: routes.length > 0 ? routes : ['list'],
      anchor: this.anchorIndex,
      selection: this.store.selectionPairs(),
      lastSeq: this.store.lastSeq,
      values: this.store.valueTriples(),
    };
    const text = serializeRecord(record);
    const save = this.deps.persistence
      .save(text)
      .catch(() => {
        this.deps.bench.mark('err', 'code=persist-write');
      })
      .then(() => {
        this.checkpoint(0);
      });
    this.backgroundSave = save;
    return save;
  }

  /** Foreground with the process alive: the top screen shows `fg:<fgSeq>`; the stream waits for `resume`. */
  onForeground(): void {
    const fg = this.deps.bench.fgSeq();
    this.setTop(this.currentRoute, `fg:${fg}`);
  }

  get pendingBackgroundSave(): Promise<void> | null {
    return this.backgroundSave;
  }

  /** Checkpoint publication (design §6.6): digest, counters, memory (iOS), element texts, buffer flush. */
  checkpoint(k: number): void {
    const seq = this.store.lastSeq;
    const digest = sha256Hex(this.store.stateText());
    const c = this.client === null ? { received: 0, applied: 0, dup: 0, gap: 0 } : this.client.counters;
    const counters = `r=${c.received};a=${c.applied};dup=${c.dup};gap=${c.gap};rows=${this.store.rowRenders}`;
    this.deps.bench.memoryCheckpoint(`k${k}`);
    this.deps.bench.publishState(k, seq, digest, counters);
    this.digestText.set(`k=${k};seq=${seq};d=${digest.slice(0, 12)}`);
    if (this.insightsShown > 0) {
      this.insightsDigest.set(sha256Hex(insightsText(this.store.insights())).slice(0, 12));
    }
    this.deps.bench.flush();
  }
}
