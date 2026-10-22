// Application session: launch configuration, state, stream, navigation, lifecycle, checkpoints and the
// marker logic of design §6 and §8 (FUI gate, probe tokens, restoration record v2).

import { Application, Frame, Page, View } from '@nativescript/core';
import { computeInsights, insightsDigest, stateDigest } from '../core/digest';
import { Fixture, FixtureError, parseFixture } from '../core/fixture';
import { labelWidth } from '../core/format';
import { FuiGate } from '../core/fui-gate';
import { LaunchConfig, parseLaunchConfig, Profile } from '../core/launch-config';
import { ReplayTransport } from '../core/replay';
import { parseRecord, recordFromStore, RestoreRecord, serializeRecord } from '../core/restore';
import { Store, StoreListener } from '../core/store';
import { StreamClient, StreamEvents, StreamStatus, Timers } from '../core/stream-client';
import { loadFixtureDocument, profileRate } from '../platform/assets';
import { BenchKit } from '../platform/benchkit';
import * as native from '../platform/native';
import { ItemVM } from './item-vm';
import { DetailScreen, ErrorScreen, InsightsScreen, ListScreen, Screen, SelectionScreen } from './screens';

export interface Emission {
  readonly event: string;
  readonly payload: string;
  readonly after?: () => void;
}

const RECORD_FILE = 'restore-v2.json';

const timers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as number),
};

export class Session implements StoreListener, StreamEvents {
  readonly bench = new BenchKit();
  config!: LaunchConfig;
  fixture!: Fixture;
  store!: Store;
  labelWidth = 3;
  readonly gate: FuiGate;

  private rate = 1;
  private stream: StreamClient | null = null;
  private vms: Array<ItemVM | undefined> = [];
  private frame: Frame | null = null;
  private list: ListScreen | null = null;
  private selection: SelectionScreen | null = null;
  private detail: DetailScreen | null = null;
  private insights: InsightsScreen | null = null;
  private readonly screens = new Map<Page, Screen>();
  private roots = 0;
  private navSeq = 0;
  private fgSeq = 0;
  /** True between a background and the next foreground of the app. */
  private inBackground = false;
  private initialListShown = false;
  private listAnchor = 0;
  private restoring: RestoreRecord | null = null;
  private pendingRoutes: string[] = [];
  private summaryRevision = 0;
  /** Selection changes emit `resp` only after FUI (or after a restore). */
  private summaryArmed = false;
  private launchIntent: unknown = null;
  private savedStatePassed = false;
  private activity: unknown = null;

  constructor() {
    this.gate = new FuiGate(
      { selectionCount: () => this.store.selectionCount, lastSeq: () => this.store.lastSeq },
      (event, payload) => {
        this.bench.mark(event, payload);
        if (event === 'fui') {
          this.onFui();
        }
      },
    );
  }

  // --- platform lifecycle -------------------------------------------------------------------------

  /** Application.launchEvent (first root UI only): Android passes the Intent and the raw saved state. */
  onLaunch(args: unknown): void {
    const a = args as { intent?: unknown; savedInstanceState?: unknown };
    this.launchIntent = a.intent ?? null;
    this.savedStatePassed = a.savedInstanceState !== undefined && a.savedInstanceState !== null;
  }

  /** Android activityCreated: the activity for reportFullyDrawn / keep-screen-on and new-root launch extras. */
  onActivityCreated(activity: unknown): void {
    this.activity = activity;
  }

  /** Application.uncaughtErrorEvent: marker plus one diagnostic platform-log line with the error text. */
  onUncaughtError(args: unknown): void {
    this.bench.mark('err', 'code=unexpected-exception');
    const error = (args as { error?: { message?: string; stack?: string; stackTrace?: string } }).error;
    const text = error ? `${error.message ?? ''} | ${error.stackTrace ?? error.stack ?? ''}` : 'unknown error';
    native.logLine(`MBERR ${text.replace(/\s+/g, ' ').slice(0, 800)}`);
  }

  onBackground(): void {
    if (!this.store) {
      return;
    }
    this.inBackground = true;
    this.bench.mark('bg', `fg=${this.fgSeq}`);
    this.writeRestoreRecord();
    this.stream?.disconnect('background');
    this.checkpoint(0);
  }

  onForeground(): void {
    if (!this.inBackground || !this.store) {
      return;
    }
    this.inBackground = false;
    this.fgSeq += 1;
    this.bench.mark('fg', `fg=${this.fgSeq}`);
    const top = this.topScreen();
    if (top === null) {
      this.connectStream();
      return;
    }
    // The stream reconnects only after `resume` was emitted (§6.2, §8.8).
    top.setToken(`fg:${this.fgSeq}`, {
      event: 'resume',
      payload: `r=${top.route};fg=${this.fgSeq}`,
      after: () => this.connectStream(),
    });
  }

  // --- root UI ------------------------------------------------------------------------------------

  /** Application.run create(): first launch, and every new root UI of a live process (§8.3). */
  createRoot(): View {
    this.roots += 1;
    if (this.roots === 1) {
      const failure = this.startProcess();
      if (failure !== null) {
        return this.errorRoot(failure);
      }
    } else {
      this.startNewRoot();
    }
    this.frame = new Frame();
    this.list = new ListScreen(this);
    this.screens.set(this.list.page, this.list);
    if (this.restoring !== null) {
      this.gate.disarm();
      this.list.summaryToken.settle(`rev:${this.store.revision}`);
      this.summaryRevision = this.store.revision;
      this.summaryArmed = true;
      this.list.pendingAnchor = this.restoring.anchor;
      this.pendingRoutes = this.restoring.route.slice(1);
      if (this.pendingRoutes.length === 0) {
        this.markRestored(this.list);
      }
    } else {
      this.gate.arm();
    }
    const listPage = this.list.page;
    this.frame.navigate({ create: () => listPage, animated: false });
    return this.frame;
  }

  private startProcess(): string | null {
    this.config = parseLaunchConfig(native.launchEntries(this.launchIntent ?? this.currentIntent()));
    this.bench.configure(this.config.journey, this.config.markerMirror === 'all');
    if (native.platformName === 'android') {
      this.bench.mark('launch', `ss=${this.savedStatePassed ? 1 : 0}`);
    }
    this.bench.mark('a11y', native.a11yPayload());
    native.watchA11y((payload) => this.bench.mark('a11y', payload));
    native.watchLifecycle(
      () => this.onBackground(),
      () => this.onForeground(),
    );
    if (this.config.unknownKeys.length > 0) {
      this.bench.mark('err', `code=launch-config-unknown;n=${this.config.unknownKeys.length}`);
    }
    if (this.config.invalidKeys.length > 0) {
      this.bench.mark('err', 'code=launch-config-invalid');
    }
    if (this.config.journeyMode) {
      native.keepScreenOn(this.activity);
    }
    try {
      this.fixture = parseFixture(loadFixtureDocument(this.config.profile));
      this.rate = profileRate(this.config.profile);
    } catch (e) {
      const code = e instanceof FixtureError ? e.code : 'fixture-invalid';
      this.bench.mark('err', `code=${code}`);
      return code;
    }
    this.labelWidth = labelWidth(this.fixture.itemCount);
    this.store = new Store(this.fixture);
    this.store.listener = this;
    if (this.config.restore) {
      const record = parseRecord(native.readTextFile(this.recordPath()), this.fixture.itemCount);
      if (record === null) {
        this.bench.mark('err', 'code=persist-read');
      } else {
        this.store.restore(record.values, record.selection, record.lastSeq);
        this.restoring = record;
      }
    }
    return null;
  }

  /** New main activity in a live process without mb.restore: fixture state at seq 0, route list (§8.3). */
  private startNewRoot(): void {
    this.stream?.dispose();
    this.stream = null;
    const config = parseLaunchConfig(native.launchEntries(this.currentIntent()));
    if (config.journey !== this.bench.journey) {
      this.bench.configure(config.journey, config.markerMirror === 'all');
    }
    if (config.journeyMode) {
      native.keepScreenOn(this.activity);
    }
    this.store.resetToFixture();
    this.vms = [];
    this.screens.clear();
    this.selection = null;
    this.detail = null;
    this.insights = null;
    this.restoring = null;
    this.pendingRoutes = [];
    this.initialListShown = false;
    this.inBackground = false;
    this.summaryRevision = 0;
    this.summaryArmed = false;
    this.listAnchor = 0;
  }

  private errorRoot(code: string): View {
    const frame = new Frame();
    const screen = new ErrorScreen(this, code);
    frame.navigate({ create: () => screen.page, animated: false });
    return frame;
  }

  private currentIntent(): unknown {
    if (native.platformName !== 'android') {
      return null;
    }
    const act = (this.activity ?? Application.android.foregroundActivity ?? Application.android.startActivity) as
      | android.app.Activity
      | null
      | undefined;
    return act ? act.getIntent() : null;
  }

  // --- view models and actions --------------------------------------------------------------------

  vm(i: number): ItemVM {
    let vm = this.vms[i];
    if (vm === undefined) {
      vm = new ItemVM(i, this.store, this.labelWidth);
      this.vms[i] = vm;
    }
    return vm;
  }

  toggle(i: number, o: number): void {
    this.store.toggle(i, o);
  }

  openSelection(): void {
    this.navigateTo(new SelectionScreen(this));
  }

  openInsights(): void {
    this.bench.mark('remote.request', '');
    const screen = new InsightsScreen(this);
    this.bench.mark('remote.source', 'src=embedded');
    this.navigateTo(screen);
  }

  openDetail(i: number): void {
    this.navigateTo(new DetailScreen(this, i));
  }

  private navigateTo(screen: Screen, animated = true): void {
    if (this.frame === null) {
      return;
    }
    this.screens.set(screen.page, screen);
    const page = screen.page;
    this.frame.navigate({ create: () => page, animated });
  }

  private createScreen(route: string): Screen {
    if (route === 'selection') {
      return new SelectionScreen(this);
    }
    if (route === 'insights') {
      return new InsightsScreen(this);
    }
    return new DetailScreen(this, Number(route.slice('detail/'.length)));
  }

  // --- navigation hooks (Screen page events) ------------------------------------------------------

  screenNavigatingTo(screen: Screen, isBack: boolean): void {
    this.trackActive(screen);
    if (screen === this.list && !this.initialListShown) {
      // The initial route is not a transition; no `screen` marker.
      this.initialListShown = true;
      return;
    }
    if (this.restoring !== null && !isBack) {
      return;
    }
    this.navSeq += 1;
    screen.setToken(`nav:${this.navSeq}`, { event: 'screen', payload: `r=${screen.route};nav=${this.navSeq}` });
  }

  screenNavigatedTo(_screen: Screen, _isBack: boolean): void {
    if (this.restoring === null || this.pendingRoutes.length === 0) {
      return;
    }
    const route = this.pendingRoutes.shift() as string;
    const next = this.createScreen(route);
    if (this.pendingRoutes.length === 0) {
      this.markRestored(next);
    }
    this.navigateTo(next, false);
  }

  screenNavigatingFrom(screen: Screen, isBack: boolean): void {
    if (screen === this.list && !isBack) {
      this.listAnchor = native.firstVisibleRow(this.list.listView);
    }
  }

  private trackActive(screen: Screen): void {
    this.selection = screen instanceof SelectionScreen ? screen : this.selection;
    this.detail = screen instanceof DetailScreen ? screen : this.detail;
    this.insights = screen instanceof InsightsScreen ? screen : this.insights;
    if (screen === this.list) {
      this.selection = null;
      this.detail = null;
      this.insights = null;
    }
  }

  private markRestored(screen: Screen): void {
    const record = this.restoring as RestoreRecord;
    screen.setToken(`restore:${screen.route}:${record.anchor}`, {
      event: 'restore',
      payload: `r=${screen.route};a=${record.anchor}`,
      after: () => {
        this.restoring = null;
        this.connectStream();
      },
    });
  }

  private topScreen(): Screen | null {
    const page = this.frame?.currentPage;
    return page ? (this.screens.get(page) ?? null) : null;
  }

  private routeStack(): string[] {
    const frame = this.frame;
    if (frame === null) {
      return ['list'];
    }
    const pages: Page[] = frame.backStack.map((e) => e.resolvedPage);
    if (frame.currentPage) {
      pages.push(frame.currentPage);
    }
    const routes = pages.map((p) => this.screens.get(p)?.route).filter((r): r is string => r !== undefined);
    return routes.length > 0 && routes[0] === 'list' ? routes : ['list'];
  }

  // --- probes -------------------------------------------------------------------------------------

  listLaidOut(heightDp: number): void {
    this.gate.listLayout(heightDp);
  }

  rowProbeDrawn(index: number): void {
    if (this.gate.active) {
      this.gate.rowDrawn(index);
    }
  }

  summaryProbeDrawn(): void {
    if (this.gate.active) {
      this.gate.summaryProbeDrawn();
      return;
    }
    const due = this.list?.summaryToken.drawn();
    if (due) {
      this.bench.mark(due.event, due.payload);
    }
  }

  rootProbeDrawn(screen: Screen): void {
    const due = screen.rootToken.drawn();
    if (due) {
      this.bench.mark(due.event, due.payload);
      due.after?.();
    }
  }

  private onFui(): void {
    const list = this.list as ListScreen;
    this.summaryRevision = this.store.revision;
    this.summaryArmed = true;
    list.summaryToken.settle(`rev:${this.store.revision}`);
    // Posted: reportFullyDrawn and the stream connect run after the FUI frame, not inside its draw pass.
    setTimeout(() => {
      native.reportFullyDrawn(this.activity ?? Application.android?.foregroundActivity);
      this.connectStream();
    }, 0);
  }

  // --- stream -------------------------------------------------------------------------------------

  private connectStream(): void {
    if (this.stream === null) {
      const reader = native.openStreamReader(this.config.profile as Profile);
      if (reader === null) {
        this.bench.mark('err', 'code=stream-protocol');
        this.status('Disconnected');
        return;
      }
      const transport = new ReplayTransport({
        reader,
        profile: this.fixture.profile,
        seed: this.fixture.seed,
        rate: this.rate,
        limit: this.config.replayCount,
        nowNs: () => native.nowNs(),
        timers,
      });
      this.stream = new StreamClient(this.store, transport, timers, this);
    }
    this.stream.connect();
  }

  // StreamEvents
  status(status: StreamStatus): void {
    if (this.list) {
      this.list.statusLabel.text = status;
    }
  }

  marker(event: string, payload: string): void {
    this.bench.mark(event, payload);
  }

  applied(_seq: number): void {
    // UI updates happen in the store listener.
  }

  error(code: string): void {
    this.bench.mark('err', `code=${code}`);
  }

  /** Checkpoint (§6.6): digest, counters, digest elements, marker flush. k = 0 for background and `e`. */
  checkpoint(k: number): void {
    const digest = stateDigest(this.store);
    const seq = this.store.lastSeq;
    const c = this.store.counters;
    this.bench.mark('state', `k=${k};s=${seq};d=${digest.slice(0, 16)}`);
    this.bench.mark('ctr', `r=${c.received};a=${c.applied};dup=${c.dup};gap=${c.gap};rows=${c.rows}`);
    if (this.list) {
      this.list.digestLabel.text = `k=${k};seq=${seq};d=${digest.slice(0, 12)}`;
    }
    if (this.insights !== null && this.topScreen() === this.insights) {
      this.insights.refresh();
    }
    this.bench.flush();
  }

  // StoreListener
  itemValues(i: number): void {
    this.vms[i]?.refreshValues(this.store);
    if (this.detail !== null && this.detail.index === i) {
      this.detail.itemValues();
    }
    if (this.selection !== null && this.store.selected[i] >= 0) {
      this.selection.itemValues(i);
    }
  }

  itemSelection(i: number): void {
    this.vms[i]?.refreshSelection(this.store);
  }

  summary(): void {
    this.list?.updateSummary();
    this.selection?.updateTotal();
    const list = this.list;
    if (list !== null && this.store.revision !== this.summaryRevision && this.summaryArmed) {
      this.summaryRevision = this.store.revision;
      const rev = this.store.revision;
      if (list.summaryToken.set(`rev:${rev}`, { event: 'resp', payload: `rev=${rev};sel=${this.store.selectionCount}` })) {
        list.summaryProbe.requestRedraw();
      }
    }
  }

  // --- restoration --------------------------------------------------------------------------------

  private recordPath(): string {
    return `${native.dataDir()}/${RECORD_FILE}`;
  }

  private writeRestoreRecord(): void {
    const routes = this.routeStack();
    const top = routes[routes.length - 1];
    const anchor = top === 'list' && this.list !== null ? native.firstVisibleRow(this.list.listView) : this.listAnchor;
    const record = recordFromStore(this.store, routes, anchor);
    if (!native.writeFileAtomically(this.recordPath(), serializeRecord(record))) {
      this.bench.mark('err', 'code=persist-write');
    }
  }

  /** Insights digest helper for the current state (diagnostics, tests). */
  insightsDigestNow(): string {
    return insightsDigest(this.store.lastSeq, computeInsights(this.store));
  }
}
