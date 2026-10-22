// Stream client rules (design §7.5, §6.6): apply in seq order; ignore s <= lastApplied (dup); on a gap close and
// reconnect from lastApplied + 1; status words; stale after 2 s without a message, reconnect after 3 s; reconnect
// back-off 250, 500, 1000, 2000, 2000 ... ms; timers suspended after `c` (until `r`) and after `e`; a checkpoint
// fires 500 ms after a `c` or `e` frame once no update arrived in between. Pure TypeScript.

import type { StreamFrame, StreamStatus } from '../domain/types.ts';
import type { Clock, FrameSource } from './source.ts';

export interface StreamCounters {
  received: number;
  applied: number;
  dup: number;
  gap: number;
  first: number;
  last: number;
}

export interface StreamClientHost {
  lastApplied(): number;
  apply(seq: number, item: number, values: readonly number[]): void;
  status(status: StreamStatus): void;
  /** Checkpoint request `k` (0 for the end frame). */
  checkpoint(k: number): void;
  mark(event: string, payload: string): void;
}

const BACKOFF_MS = [250, 500, 1000, 2000];
const STALE_MS = 2000;
const RECONNECT_MS = 3000;
const CHECKPOINT_IDLE_MS = 500;

export class StreamClient {
  readonly counters: StreamCounters = { received: 0, applied: 0, dup: 0, gap: 0, first: 0, last: 0 };
  private readonly source: FrameSource;
  private readonly clock: Clock;
  private readonly host: StreamClientHost;
  private statusValue: StreamStatus = 'Disconnected';
  private attempt = 0;
  private failures = 0;
  private connected = false;
  private stopped = true;
  private liveSinceOpen = false;
  private suspended = false;
  private ended = false;
  private staleTimer: unknown = null;
  private lastFrameAt = 0;
  private reconnectTimer: unknown = null;
  private checkpointTimer: unknown = null;
  private pendingCheckpoint: number | null = null;

  constructor(source: FrameSource, clock: Clock, host: StreamClientHost) {
    this.source = source;
    this.clock = clock;
    this.host = host;
  }

  get status(): StreamStatus {
    return this.statusValue;
  }

  get sourceKind(): string {
    return this.source.kind;
  }

  /** Connects (after FUI, after `restore`, or after `resume`). */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** Closes the stream without reconnecting (background). */
  stop(reason: string): void {
    this.stopped = true;
    this.clearTimers();
    if (this.connected) {
      this.connected = false;
      this.source.close(reason);
      this.host.mark('stream.closed', `why=${reason}`);
    }
    this.setStatus('Disconnected');
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.attempt += 1;
    this.connected = true;
    this.liveSinceOpen = false;
    this.setStatus('Connecting');
    this.host.mark('stream.connect', `a=${this.attempt}`);
    const from = this.host.lastApplied() + 1;
    this.source.open(from, {
      onOpen: () => {
        this.host.mark('stream.open', `from=${from}`);
      },
      onFrame: (frame) => this.onFrame(frame),
      onClose: (reason) => this.onClose(reason),
    });
  }

  private onFrame(frame: StreamFrame): void {
    switch (frame.t) {
      case 'h':
        this.failures = 0;
        this.suspended = false;
        this.ended = false;
        this.setStatus('Live');
        this.armStale();
        return;
      case 'u':
        this.onUpdate(frame.s, frame.i, frame.v);
        return;
      case 'c':
        this.suspended = true;
        this.clearStale();
        this.setStatus('Paused');
        this.requestCheckpoint(frame.k);
        return;
      case 'r':
        this.suspended = false;
        this.setStatus('Live');
        this.armStale();
        return;
      case 'e':
        this.suspended = true;
        this.ended = true;
        this.clearStale();
        this.setStatus('Ended');
        this.requestCheckpoint(0);
        return;
      default:
        return;
    }
  }

  private onUpdate(seq: number, item: number, values: readonly number[]): void {
    const c = this.counters;
    c.received += 1;
    const last = this.host.lastApplied();
    if (seq <= last) {
      c.dup += 1;
      return;
    }
    if (seq > last + 1) {
      c.gap += 1;
      this.host.mark('err', 'code=stream-gap');
      this.reconnectNow('gap');
      return;
    }
    this.host.apply(seq, item, values);
    c.applied += 1;
    if (c.first === 0) {
      c.first = seq;
    }
    c.last = seq;
    if (!this.liveSinceOpen) {
      this.liveSinceOpen = true;
      this.host.mark('stream.live', `s=${seq}`);
    }
    if (this.statusValue === 'Stale') {
      this.setStatus('Live');
    }
    if (!this.suspended) {
      this.armStale();
    }
    if (this.pendingCheckpoint !== null) {
      // An update arrived after the c/e frame: wait for 500 ms of silence again.
      this.armCheckpoint();
    }
  }

  private onClose(reason: string): void {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.clearStale();
    this.host.mark('stream.closed', `why=${reason}`);
    if (reason === 'protocol') {
      this.host.mark('err', 'code=stream-protocol');
    }
    if (this.ended) {
      return; // the stream has ended for good; status stays `Ended`
    }
    this.setStatus('Disconnected');
    this.scheduleReconnect();
  }

  private reconnectNow(reason: string): void {
    if (this.connected) {
      this.connected = false;
      this.source.close(reason);
      this.host.mark('stream.closed', `why=${reason}`);
    }
    this.clearStale();
    this.setStatus('Disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
    this.failures += 1;
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Records message arrival. One timer checks for silence (no timer churn per message): Stale after 2 s,
   * reconnect after 3 s without any frame.
   */
  private armStale(): void {
    this.lastFrameAt = this.clock.now();
    if (this.staleTimer === null && !this.suspended && !this.stopped) {
      this.scheduleStaleCheck(STALE_MS);
    }
  }

  private scheduleStaleCheck(ms: number): void {
    this.staleTimer = this.clock.setTimeout(() => {
      this.staleTimer = null;
      this.checkStale();
    }, ms);
  }

  private checkStale(): void {
    if (this.suspended || this.stopped || !this.connected) {
      return;
    }
    const idle = this.clock.now() - this.lastFrameAt;
    if (idle >= RECONNECT_MS) {
      this.reconnectNow('stale');
      return;
    }
    if (idle >= STALE_MS) {
      if (this.statusValue !== 'Stale') {
        this.setStatus('Stale');
        this.host.mark('stream.stale', '-');
      }
      this.scheduleStaleCheck(RECONNECT_MS - idle);
      return;
    }
    this.scheduleStaleCheck(STALE_MS - idle);
  }

  private clearStale(): void {
    if (this.staleTimer !== null) {
      this.clock.clearTimeout(this.staleTimer);
      this.staleTimer = null;
    }
  }

  private requestCheckpoint(k: number): void {
    this.pendingCheckpoint = k;
    this.armCheckpoint();
  }

  private armCheckpoint(): void {
    if (this.checkpointTimer !== null) {
      this.clock.clearTimeout(this.checkpointTimer);
    }
    this.checkpointTimer = this.clock.setTimeout(() => {
      this.checkpointTimer = null;
      const k = this.pendingCheckpoint;
      this.pendingCheckpoint = null;
      if (k !== null) {
        this.host.checkpoint(k);
      }
    }, CHECKPOINT_IDLE_MS);
  }

  private clearTimers(): void {
    this.clearStale();
    if (this.reconnectTimer !== null) {
      this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.checkpointTimer !== null) {
      this.clock.clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
      this.pendingCheckpoint = null;
    }
  }

  private setStatus(status: StreamStatus): void {
    if (this.statusValue !== status) {
      this.statusValue = status;
      this.host.status(status);
    }
  }
}
