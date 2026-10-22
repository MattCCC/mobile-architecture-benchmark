// Update-stream client (design §7.5): applies frames to the store by the client rules and drives the
// six status words. The transport behind it is swappable: the default is the in-app replay of the bundled
// fixture stream (replay.ts); a WebSocket transport to the local server can implement the same interface.

import { Store } from './store';
import { parseFrame } from './wire';

export type StreamStatus = 'Connecting' | 'Live' | 'Paused' | 'Stale' | 'Disconnected' | 'Ended';

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Receives transport callbacks; implemented by StreamClient. */
export interface TransportClient {
  onOpen(): void;
  onFrame(text: string): void;
  onClosed(why: string): void;
}

/** The data-source interface: a session-scoped producer of wire frames. */
export interface Transport {
  readonly kind: 'replay' | 'websocket';
  /** Opens (or reopens) the session from seq `from`; frames arrive through client.onFrame. */
  open(from: number, client: TransportClient): void;
  close(): void;
  dispose(): void;
}

export interface StreamEvents {
  status(status: StreamStatus): void;
  marker(event: string, payload: string): void;
  /** One update was applied to the store (after the store notified its listener). */
  applied(seq: number): void;
  /** Checkpoint trigger: a `c` or `e` frame followed by 500 ms without updates (§6.6). */
  checkpoint(k: number): void;
  error(code: string): void;
}

const STALE_MS = 2000;
const RECONNECT_AFTER_STALE_MS = 1000;
const CHECKPOINT_IDLE_MS = 500;
const BACKOFF_MS = [250, 500, 1000, 2000];
/** Diagnostic `update.applied` marker on the first update after each open and on every multiple of this. */
export const UPDATE_MARKER_EVERY = 100;

export class StreamClient implements TransportClient {
  status: StreamStatus = 'Disconnected';
  private attempt = 0;
  private reconnects = 0;
  private wanted = false;
  private firstAfterOpen = false;
  private suspended = false;
  private pendingCheckpoint = -1;
  private watchdog: unknown = null;
  private checkpointTimer: unknown = null;
  private reconnectTimer: unknown = null;

  constructor(
    private readonly store: Store,
    private readonly transport: Transport,
    private readonly timers: Timers,
    private readonly events: StreamEvents,
  ) {}

  get transportKind(): string {
    return this.transport.kind;
  }

  /** Connects from lastApplied + 1 (after FUI, after `resume`, after `restore`). */
  connect(): void {
    this.wanted = true;
    this.clearReconnect();
    this.attempt += 1;
    this.events.marker('stream.connect', `a=${this.attempt}`);
    this.setStatus('Connecting');
    this.transport.open(this.store.lastSeq + 1, this);
  }

  /** Closes on purpose (background); no automatic reconnect. */
  disconnect(why: string): void {
    this.wanted = false;
    this.clearAllTimers();
    this.transport.close();
    this.closed(why);
  }

  dispose(): void {
    this.wanted = false;
    this.clearAllTimers();
    this.transport.dispose();
  }

  onOpen(): void {
    this.events.marker('stream.open', `from=${this.store.lastSeq + 1}`);
    this.firstAfterOpen = true;
    this.suspended = false;
    // An open connection that delivers nothing is stale as well (2 s), then reconnects (3 s).
    this.armWatchdog();
  }

  onFrame(text: string): void {
    const frame = parseFrame(text, this.store.itemCount);
    if (frame === null) {
      this.events.error('stream-protocol');
      return;
    }
    switch (frame.t) {
      case 'h':
        // The session is established: the reconnect back-off starts over.
        this.reconnects = 0;
        this.suspended = false;
        this.setStatus('Live');
        this.armWatchdog();
        return;
      case 'u':
        this.update(frame.s, frame.i, frame.a, frame.b, frame.c);
        return;
      case 'e':
        this.suspendFor(0);
        this.setStatus('Ended');
        return;
      case 'c':
        this.suspendFor(frame.k);
        this.setStatus('Paused');
        return;
      case 'r':
        this.suspended = false;
        this.clearCheckpoint();
        this.setStatus('Live');
        this.armWatchdog();
        return;
      default:
        return;
    }
  }

  onClosed(why: string): void {
    this.closed(why);
    if (this.wanted && this.status !== 'Ended') {
      this.scheduleReconnect();
    }
  }

  private update(seq: number, i: number, a: number, b: number, c: number): void {
    this.store.counters.received += 1;
    const result = this.store.applyUpdate(seq, i, a, b, c);
    if (result === 'gap') {
      this.events.error('stream-gap');
      this.transport.close();
      this.closed('gap');
      this.scheduleReconnect();
      return;
    }
    if (result === 'dup') {
      return;
    }
    if (this.firstAfterOpen) {
      this.firstAfterOpen = false;
      this.events.marker('stream.live', `s=${seq}`);
      this.events.marker('update.applied', `s=${seq}`);
    } else if (seq % UPDATE_MARKER_EVERY === 0) {
      this.events.marker('update.applied', `s=${seq}`);
    }
    if (this.status === 'Stale') {
      this.setStatus('Live');
    }
    if (this.pendingCheckpoint >= 0) {
      // An update during the idle window restarts the 500 ms wait.
      this.startCheckpointTimer();
    } else {
      this.armWatchdog();
    }
    this.events.applied(seq);
  }

  private suspendFor(k: number): void {
    this.suspended = true;
    this.clearWatchdog();
    this.pendingCheckpoint = k;
    this.startCheckpointTimer();
  }

  private startCheckpointTimer(): void {
    if (this.checkpointTimer !== null) {
      this.timers.clearTimeout(this.checkpointTimer);
    }
    this.checkpointTimer = this.timers.setTimeout(() => {
      this.checkpointTimer = null;
      const k = this.pendingCheckpoint;
      this.pendingCheckpoint = -1;
      if (k >= 0) {
        this.events.checkpoint(k);
      }
    }, CHECKPOINT_IDLE_MS);
  }

  private clearCheckpoint(): void {
    if (this.checkpointTimer !== null) {
      this.timers.clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    this.pendingCheckpoint = -1;
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    if (this.suspended) {
      return;
    }
    this.watchdog = this.timers.setTimeout(() => {
      this.watchdog = null;
      this.events.marker('stream.stale', '');
      this.setStatus('Stale');
      this.watchdog = this.timers.setTimeout(() => {
        this.watchdog = null;
        this.transport.close();
        this.closed('stale');
        this.scheduleReconnect();
      }, RECONNECT_AFTER_STALE_MS);
    }, STALE_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      this.timers.clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer !== null) {
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.reconnects, BACKOFF_MS.length - 1)];
    this.reconnects += 1;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) {
        this.connect();
      }
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearWatchdog();
    this.clearReconnect();
    this.clearCheckpoint();
  }

  private closed(why: string): void {
    this.clearWatchdog();
    this.events.marker('stream.closed', `why=${why}`);
    if (this.status !== 'Ended') {
      this.setStatus('Disconnected');
    }
  }

  private setStatus(status: StreamStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.events.status(status);
    }
  }
}
