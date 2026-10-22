// TurboModule spec of the RN BenchKit wrapper (design §6.1, §6.2). Every method returns a value, so the
// New Architecture invokes it synchronously on the JS thread through JSI (no asynchronous hop between the event
// and its timestamp, design §6.1 rule 3). `echoAsync` is the asynchronous bridge class (Promise, design §14.7 R8a).
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Records `event` with an automatic per-event ordinal; returns the monotonic timestamp in ns. */
  mark(event: string, payload: string): number;
  /** Monotonic clock in ns (Android `SystemClock.elapsedRealtimeNanos`, iOS `CLOCK_UPTIME_RAW`). */
  nowNs(): number;
  /** How often `event` has been emitted in this process (control signal for the JS side). */
  markerCount(event: string): number;
  /** The `mb.*` launch keys as a JSON object of strings. */
  launchConfig(): string;
  /** Foreground sequence (incremented by the platform foreground callback in the core). */
  fgSeq(): number;
  /** Starts or re-arms the session: FUI gate, selection revision 0, nav sequence 0. Returns 1. */
  sessionStart(selectedCount: number): number;
  /** Reports a selection change; returns the new selection revision. */
  selectionChanged(selectedCount: number): number;
  /** Reports a new top route at transition start; returns the new nav sequence. */
  navStart(route: string): number;
  /** Returns the restore token `restore:<route>:<anchor>`. */
  restoreToken(route: string, anchor: number): string;
  /** JS fallback for the list container height (dp/pt); the native list probe reports it first. Returns kReq. */
  listLayout(height: number): number;
  /** Checkpoint publication: `state` and `ctr` markers. Returns 1. */
  publishState(k: number, seq: number, digest: string, counters: string): number;
  /** iOS: phys_footprint / peak in a `mem` marker; Android: no-op. Returns the payload. */
  memoryCheckpoint(label: string): string;
  /** iOS: writes the marker buffer to Library/Caches/mobilebench; Android: no-op. Returns entries written. */
  flush(): number;
  /** Bridge micro-benchmark, synchronous class (design §10.1 C6). */
  echo(value: string): string;
  /** Bridge micro-benchmark, asynchronous class. */
  echoAsync(value: string): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('MobileBenchKit');
