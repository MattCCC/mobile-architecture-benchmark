// In-app replay of the bundled fixture stream (default transport). It plays the role of the local server:
// it sends the same wire frames (hello, updates in seq order, end) on the absolute schedule of design §7.5,
// message k due at t0 + (k - from) / rate, measured on the monotonic clock. The schedule keeps running while
// the transport is closed (background), so a reopen from lastApplied + 1 first catches up with every message
// already due, then continues in real time, like a reconnect to the server.

import { Timers, Transport, TransportClient } from './stream-client';
import { endFrame, helloFrame } from './wire';

/** Sequential access to the bundled frames: line k (1-based) is the update frame with seq k. */
export interface FrameReader {
  /** Number of frames available, or null when only the end of the data tells (lazy readers). */
  readonly count: number | null;
  /** Positions the reader so that the next read returns the frame with this seq (1-based). */
  seek(seq: number): void;
  /** Returns the next frame text, or null after the last frame. */
  next(): string | null;
  close(): void;
}

export interface ReplayOptions {
  readonly reader: FrameReader;
  readonly profile: string;
  readonly seed: number;
  /** Messages per second (profile update rate). */
  readonly rate: number;
  /** Optional session length (like the server's session count); default: every bundled frame. */
  readonly limit: number | null;
  /** Monotonic clock in nanoseconds. */
  readonly nowNs: () => number;
  readonly timers: Timers;
}

export class ReplayTransport implements Transport {
  readonly kind = 'replay' as const;
  private client: TransportClient | null = null;
  private timer: unknown = null;
  private t0 = 0;
  private scheduleFrom = 0;
  private next = 0;
  private started = false;
  private ended = false;
  /** Scheduling lag of the most recently delivered frame, in ns (diagnostic). */
  lastLagNs = 0;

  constructor(private readonly opts: ReplayOptions) {}

  /** Last seq of the session (Infinity until a lazy reader reaches the end of its data). */
  get last(): number {
    const available = this.opts.reader.count ?? Number.POSITIVE_INFINITY;
    return this.opts.limit === null ? available : Math.min(available, this.opts.limit);
  }

  /** Due time of message seq in ns on the monotonic clock. */
  dueNs(seq: number): number {
    return this.t0 + ((seq - this.scheduleFrom) * 1e9) / this.opts.rate;
  }

  open(from: number, client: TransportClient): void {
    this.cancelTimer();
    this.client = client;
    if (!this.started) {
      this.started = true;
      this.t0 = this.opts.nowNs();
      this.scheduleFrom = from;
    }
    this.next = from;
    client.onOpen();
    client.onFrame(helloFrame('replay', this.opts.profile, this.opts.seed, this.opts.rate, from));
    if (this.next <= this.last) {
      this.opts.reader.seek(this.next);
    }
    this.ended = false;
    this.tick();
  }

  close(): void {
    this.cancelTimer();
    this.client = null;
  }

  dispose(): void {
    this.close();
    this.opts.reader.close();
  }

  private tick(): void {
    this.timer = null;
    const client = this.client;
    if (client === null || this.ended) {
      return;
    }
    const last = this.last;
    let now = this.opts.nowNs();
    while (this.next <= last && this.dueNs(this.next) <= now) {
      const text = this.opts.reader.next();
      if (text === null) {
        // End of the bundled data before the session limit.
        this.finish(client, this.next - 1);
        return;
      }
      this.lastLagNs = now - this.dueNs(this.next);
      this.next += 1;
      client.onFrame(text);
      if (this.client !== client) {
        // The client closed the transport while handling the frame.
        return;
      }
      now = this.opts.nowNs();
    }
    if (this.next > last) {
      this.finish(client, last);
      return;
    }
    const waitMs = Math.max(0, Math.ceil((this.dueNs(this.next) - now) / 1e6));
    this.timer = this.opts.timers.setTimeout(() => this.tick(), waitMs);
  }

  private finish(client: TransportClient, last: number): void {
    this.ended = true;
    client.onFrame(endFrame(last));
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.opts.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** FrameReader over an in-memory text with one frame per LF-terminated line (iOS reader, unit tests). */
export class TextFrameReader implements FrameReader {
  readonly count: number;
  private pos = 0;

  constructor(private readonly text: string) {
    let lines = 0;
    for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
      lines += 1;
    }
    this.count = lines;
  }

  seek(seq: number): void {
    this.pos = 0;
    for (let k = 1; k < seq && this.pos !== -1; k += 1) {
      const at = this.text.indexOf('\n', this.pos);
      this.pos = at === -1 ? -1 : at + 1;
    }
  }

  next(): string | null {
    if (this.pos === -1 || this.pos >= this.text.length) {
      return null;
    }
    const at = this.text.indexOf('\n', this.pos);
    const end = at === -1 ? this.text.length : at;
    const line = this.text.slice(this.pos, end);
    this.pos = at === -1 ? -1 : at + 1;
    return line;
  }

  close(): void {
    this.pos = -1;
  }
}
