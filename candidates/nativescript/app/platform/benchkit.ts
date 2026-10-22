// NativeScript BenchKit wrapper (design §6). Markers are synchronous direct native calls on the UI thread:
// Android writes a zero-length atrace section `mb|<event>|<n>|<payload>` and mirrors the control set to
// logcat; iOS appends to an in-memory marker buffer (flushed to Library/Caches/mobilebench/markers-<journey>.jsonl
// at checkpoints, on background and at 75 % fill), mirrors the control set to standard error and posts a
// Darwin notification. Timestamps come from the platform monotonic clock in ns.
//
// This is a candidate-local implementation of the BenchKit contract: the shared core libraries
// (instrumentation/android-benchkit, instrumentation/ios-benchkit) do not exist yet. When they do, this file
// forwards to their facade instead (design §6.1 rule 1).

import { CONTROL_EVENTS, isValidEvent, isValidPayload, jsonlRecord, mirrorLine, Ordinals, traceSectionName } from '../core/markers';
import * as native from './native';

const BUFFER_CAPACITY = 4096;
const FLUSH_AT = Math.floor(BUFFER_CAPACITY * 0.75);

export class BenchKit {
  journey = '-';
  mirrorAll = false;
  private readonly ordinals = new Ordinals();
  private buffer: string[] = [];
  private markerFile: string | null = null;

  configure(journey: string, mirrorAll: boolean): void {
    this.journey = journey;
    this.mirrorAll = mirrorAll;
    const dir = native.markerDir();
    this.markerFile = dir === null ? null : `${dir}/markers-${journey === '-' ? 'nojourney' : journey}.jsonl`;
  }

  nowNs(): number {
    return native.nowNs();
  }

  mark(event: string, payload = ''): void {
    const tNs = native.nowNs();
    if (!isValidEvent(event) || !isValidPayload(payload)) {
      // Contract violation in candidate code: report it instead of writing a malformed marker.
      this.mark('err', 'code=unexpected-exception');
      return;
    }
    const n = this.ordinals.next(event);
    native.traceMarker(traceSectionName(event, n, payload));
    if (this.markerFile !== null) {
      this.buffer.push(jsonlRecord(event, n, tNs, payload));
    }
    if (this.mirrorAll || CONTROL_EVENTS.includes(event)) {
      native.logLine(mirrorLine(this.journey, event, n, payload, tNs));
      native.controlSignal(event);
    }
    if (this.buffer.length >= FLUSH_AT) {
      this.flush();
      this.mark('flush', '');
    }
  }

  /** Writes buffered iOS markers to the marker file (checkpoints and background only). */
  flush(): void {
    if (this.markerFile === null || this.buffer.length === 0) {
      return;
    }
    const text = `${this.buffer.join('\n')}\n`;
    this.buffer = [];
    if (!native.appendTextFile(this.markerFile, text)) {
      this.mark('err', 'code=persist-write');
    }
  }
}
