// Marker encoding (design §6.2, §6.3). Pure helpers; the platform layer writes the results to the
// platform trace / log / buffer.

/** Driver-visible control set, mirrored to the platform log by default (§6.2). */
export const CONTROL_EVENTS: readonly string[] = [
  'fui',
  'resume',
  'restore',
  'remote.ready',
  'remote.error',
  'state',
  'err',
  'a11y',
  'launch',
];

const EVENT_RE = /^[a-z0-9.]{1,24}$/;
const PAYLOAD_RE = /^[\x21-\x7b\x7d\x7e]{0,64}$/; // printable ASCII without space and '|'

export function isValidEvent(event: string): boolean {
  return EVENT_RE.test(event);
}

export function isValidPayload(payload: string): boolean {
  return PAYLOAD_RE.test(payload);
}

/** atrace section name: mb|<event>|<n>|<payload> (at most 103 characters). */
export function traceSectionName(event: string, n: number, payload: string): string {
  return `mb|${event}|${n}|${payload}`;
}

/** Platform-log mirror line. The trailing t=<ns> monotonic timestamp is a candidate-local addition. */
export function mirrorLine(journey: string, event: string, n: number, payload: string, tNs: number): string {
  return `MB ${journey} ${event} ${n} ${payload === '' ? '-' : payload} t=${Math.round(tNs)}`;
}

/** markers.jsonl record (§6.4). */
export function jsonlRecord(event: string, n: number, tNs: number, payload: string): string {
  return `{"e":${JSON.stringify(event)},"n":${n},"t":${Math.round(tNs)},"p":${JSON.stringify(payload)}}`;
}

/** Ordinal per event, starting at 1. */
export class Ordinals {
  private readonly counts = new Map<string, number>();

  next(event: string): number {
    const n = (this.counts.get(event) ?? 0) + 1;
    this.counts.set(event, n);
    return n;
  }
}
