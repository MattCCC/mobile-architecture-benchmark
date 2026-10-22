// Data-source interface of the update stream. Both sources deliver the wire frames of design §7.5
// (hello, update, checkpoint, resume, end) to the stream client, which applies the client rules
// (order, duplicates, gaps, status words, stale and reconnect timers). Swapping the in-app replay for the
// local server's WebSocket stream changes only the source, never the client or the UI. Pure TypeScript.

import type { StreamFrame } from '../domain/types.ts';

export interface FrameSourceHandlers {
  /** The connection is open (WebSocket `open`; replay: immediately). */
  onOpen(): void;
  onFrame(frame: StreamFrame): void;
  /** The connection closed; `reason` is a short code without spaces. */
  onClose(reason: string): void;
}

export interface FrameSource {
  readonly kind: 'replay' | 'websocket';
  /** Opens the stream starting at message `from` (= last applied seq + 1). */
  open(from: number, handlers: FrameSourceHandlers): void;
  /** Closes the stream; no `onClose` callback follows a requested close. */
  close(reason: string): void;
}

/** Timer and monotonic-clock functions, injected so the stream logic is testable without a runtime. */
export interface Clock {
  /** Monotonic milliseconds (`performance.now()`). */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const runtimeClock: Clock = {
  now: () => (globalThis as unknown as { performance: { now(): number } }).performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};
