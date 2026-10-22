// WebSocket source for the local deterministic server (design §7.5, §15.2):
// GET <ws>/v1/stream?session=&profile=&from=[&token=]. Selected with `mb.source=websocket` and `mb.server`.
// Uses the runtime's WebSocket (React Native built-in). Pure TypeScript with an injectable constructor.

import type { StreamFrame } from '../domain/types.ts';
import type { FrameSource, FrameSourceHandlers } from './source.ts';

/** The subset of the WebSocket API the source needs. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface WebSocketSourceOptions {
  wsBase: string;
  profile: string;
  session: string | null;
  token: string | null;
  factory: SocketFactory;
}

export function streamUrl(o: WebSocketSourceOptions, from: number): string {
  let url = `${o.wsBase}/v1/stream?profile=${encodeURIComponent(o.profile)}&from=${from}`;
  if (o.session !== null) {
    url += `&session=${encodeURIComponent(o.session)}`;
  }
  if (o.token !== null) {
    url += `&token=${o.token}`;
  }
  return url;
}

/** Parses one text frame; returns null for anything that is not a valid frame (`err code=stream-protocol`). */
export function parseFrame(data: unknown): StreamFrame | null {
  if (typeof data !== 'string') {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const f = raw as Record<string, unknown>;
  const int = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
  switch (f.t) {
    case 'u':
      if (int(f.s) && int(f.i) && Array.isArray(f.v) && f.v.length === 3 && f.v.every(int)) {
        return { t: 'u', s: f.s, i: f.i, v: f.v as number[] };
      }
      return null;
    case 'h':
      return { t: 'h', from: int(f.from) ? f.from : undefined };
    case 'c':
      return int(f.k) && int(f.last) ? { t: 'c', k: f.k, last: f.last } : null;
    case 'r':
      return int(f.from) ? { t: 'r', from: f.from } : null;
    case 'e':
      return int(f.last) ? { t: 'e', last: f.last } : null;
    default:
      return null;
  }
}

export class WebSocketSource implements FrameSource {
  readonly kind = 'websocket' as const;
  private readonly options: WebSocketSourceOptions;
  private socket: SocketLike | null = null;

  constructor(options: WebSocketSourceOptions) {
    this.options = options;
  }

  open(from: number, handlers: FrameSourceHandlers): void {
    this.close('reopen');
    const socket = this.options.factory(streamUrl(this.options, from));
    this.socket = socket;
    let closed = false;
    const finish = (reason: string): void => {
      if (closed || this.socket !== socket) {
        return;
      }
      closed = true;
      this.socket = null;
      handlers.onClose(reason);
    };
    socket.onopen = () => {
      if (this.socket === socket) {
        handlers.onOpen();
      }
    };
    socket.onmessage = (ev) => {
      if (this.socket !== socket) {
        return;
      }
      const frame = parseFrame(ev.data);
      if (frame === null) {
        finish('protocol');
        socket.close(1002, 'protocol');
        return;
      }
      handlers.onFrame(frame);
    };
    socket.onerror = () => finish('error');
    socket.onclose = (ev) => finish(`close-${ev.code ?? 0}`);
  }

  close(_reason: string): void {
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, 'client');
    }
  }
}
