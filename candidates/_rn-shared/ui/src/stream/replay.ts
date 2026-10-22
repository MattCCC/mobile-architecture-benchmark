// In-app replay of the bundled deterministic stream (default data source of the PoC).
// The stream asset is generated at build time from fixtures/generator (lib.mjs `updateStream`) and verified
// against the stream SHA-256 in fixtures/v1/golden.json (see tools/gen-assets.mjs). Messages follow the server's
// absolute schedule (design §7.5): message k is due at t0 + (k - from0) / rate on a monotonic clock, so a
// reconnect after background receives every message already due at once (catch-up), then real time.
// Pure TypeScript.

import type { Clock, FrameSource, FrameSourceHandlers } from './source.ts';

/** Compact form of the first N update messages of one profile (flat [i, a, b, c] per seq, seq = index + 1). */
export interface StreamAsset {
  schema: string;
  profile: string;
  rate: number;
  messages: number;
  sha256: string;
  data: number[];
}

export class ReplaySource implements FrameSource {
  readonly kind = 'replay' as const;
  private readonly asset: StreamAsset;
  private readonly clock: Clock;
  private readonly lastToSend: number;
  private anchor: { t: number; seq: number } | null = null;
  private timer: unknown = null;
  private handlers: FrameSourceHandlers | null = null;
  private next = 1;
  private generation = 0;

  constructor(asset: StreamAsset, clock: Clock, count: number | null) {
    this.asset = asset;
    this.clock = clock;
    this.lastToSend = count === null ? asset.messages : Math.min(asset.messages, count);
  }

  open(from: number, handlers: FrameSourceHandlers): void {
    this.close('reopen');
    this.handlers = handlers;
    this.next = from;
    const generation = ++this.generation;
    this.timer = this.clock.setTimeout(() => {
      if (generation !== this.generation) {
        return;
      }
      this.timer = null;
      if (this.anchor === null) {
        this.anchor = { t: this.clock.now(), seq: from };
      }
      handlers.onOpen();
      handlers.onFrame({ t: 'h', profile: this.asset.profile, rate: this.asset.rate, from });
      this.pump(generation);
    }, 0);
  }

  close(_reason: string): void {
    this.generation += 1;
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    this.handlers = null;
  }

  private due(seq: number): number {
    const a = this.anchor as { t: number; seq: number };
    return a.t + ((seq - a.seq) * 1000) / this.asset.rate;
  }

  private pump(generation: number): void {
    const handlers = this.handlers;
    if (handlers === null || generation !== this.generation) {
      return;
    }
    const now = this.clock.now();
    const data = this.asset.data;
    while (this.next <= this.lastToSend && this.due(this.next) <= now) {
      const s = this.next;
      const o = (s - 1) * 4;
      this.next += 1;
      handlers.onFrame({ t: 'u', s, i: data[o], v: [data[o + 1], data[o + 2], data[o + 3]] });
      if (generation !== this.generation) {
        return; // closed from inside a handler (e.g. background)
      }
    }
    if (this.next > this.lastToSend) {
      handlers.onFrame({ t: 'e', last: this.lastToSend });
      return;
    }
    const wait = Math.max(0, this.due(this.next) - now);
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.pump(generation);
    }, wait);
  }
}
