// Platform facade used by the BenchKit wrapper and the session. Implementations: native.android.ts and
// native.ios.ts, selected by the NativeScript bundler. Every call is a synchronous direct native call
// on the UI thread (design §6.1 rule 3).

import type { ListView } from '@nativescript/core';
import type { FrameReader } from '../core/replay';

export const platformName: 'android' | 'ios';

/** Monotonic clock in ns: Android SystemClock.elapsedRealtimeNanos(), iOS CLOCK_UPTIME_RAW. */
export function nowNs(): number;

/** Android: zero-length atrace section (android.os.Trace). iOS: no-op (signposts are core BenchKit work). */
export function traceMarker(sectionName: string): void;

/** Platform log line: Android logcat (tag MobileBench, INFO); iOS standard error. */
export function logLine(line: string): void;

/** iOS: Darwin notification org.example.mobilebench.<event> (control signal). Android: no-op. */
export function controlSignal(event: string): void;

/** Launch configuration entries: Android Intent extras (mb.* keys), iOS `-mb.<key> <value>` arguments. */
export function launchEntries(source: unknown): Record<string, string>;

export function keepScreenOn(activity: unknown): void;

/** Android: Activity.reportFullyDrawn(). iOS: no-op. */
export function reportFullyDrawn(activity: unknown): void;

/** Write to a temporary file, then rename atomically over the target. */
export function writeFileAtomically(path: string, text: string): boolean;

export function readTextFile(path: string): string | null;

export function appendTextFile(path: string, text: string): boolean;

/** App-private persistent directory (Android files dir, iOS Application Support/mobilebench). */
export function dataDir(): string;

/** iOS marker-buffer directory (Library/Caches/mobilebench); Android: null (markers live in the trace). */
export function markerDir(): string | null;

/** Opens the bundled replay stream of a profile, or null when it is missing. */
export function openStreamReader(profile: string): FrameReader | null;

/** Index of the first visible row of a ListView (scroll anchor), 0 when unknown. */
export function firstVisibleRow(listView: ListView): number;

/** Removes platform list decorations that the functional spec does not have (dividers, selection highlight). */
export function configureListView(listView: ListView): void;

/** Assistive-technology state payload for the `a11y` marker. */
export function a11yPayload(): string;

/** Android: calls back with a new payload on every accessibility state change. iOS: no-op. */
export function watchA11y(onChange: (payload: string) => void): void;

/** Background / foreground of the app: Android ActivityLifecycleCallbacks, iOS application notifications. */
export function watchLifecycle(onBackground: () => void, onForeground: () => void): void;
