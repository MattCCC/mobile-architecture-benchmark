import { File, knownFolders, ListView, Utils } from '@nativescript/core';
import type { FrameReader } from '../core/replay';

export const platformName = 'android' as const;

const LOG_TAG = 'MobileBench';

export function nowNs(): number {
  const v: unknown = android.os.SystemClock.elapsedRealtimeNanos();
  return typeof v === 'number' ? v : Number(v);
}

export function traceMarker(sectionName: string): void {
  android.os.Trace.beginSection(sectionName);
  android.os.Trace.endSection();
}

export function logLine(line: string): void {
  android.util.Log.i(LOG_TAG, line);
}

export function controlSignal(_event: string): void {
  // Android drivers read the logcat mirror; no extra signal.
}

export function launchEntries(source: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const intent = source as android.content.Intent | null | undefined;
  const extras = intent ? intent.getExtras() : null;
  if (!extras) {
    return out;
  }
  const keys = extras.keySet().iterator();
  while (keys.hasNext()) {
    const key = String(keys.next());
    if (key.startsWith('mb.')) {
      const value: unknown = extras.get(key);
      if (value !== null && value !== undefined) {
        out[key] = String(value);
      }
    }
  }
  return out;
}

export function keepScreenOn(activity: unknown): void {
  const act = activity as android.app.Activity | null;
  if (act) {
    act.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }
}

export function reportFullyDrawn(activity: unknown): void {
  const act = activity as android.app.Activity | null;
  if (act) {
    act.reportFullyDrawn();
  }
}

export function writeFileAtomically(path: string, text: string): boolean {
  const tmp = `${path}.tmp`;
  let failed = false;
  File.fromPath(tmp).writeTextSync(text, () => {
    failed = true;
  });
  if (failed) {
    return false;
  }
  return new java.io.File(tmp).renameTo(new java.io.File(path));
}

export function readTextFile(path: string): string | null {
  if (!File.exists(path)) {
    return null;
  }
  let failed = false;
  const text = File.fromPath(path).readTextSync(() => {
    failed = true;
  });
  return failed ? null : text;
}

export function appendTextFile(path: string, text: string): boolean {
  let failed = false;
  File.fromPath(path).appendTextSync(text, () => {
    failed = true;
  });
  return !failed;
}

export function dataDir(): string {
  return knownFolders.documents().path;
}

export function markerDir(): string | null {
  return null;
}

/** Reads APK asset mobilebench/<profile>.stream.jsonl line by line, on demand (no upfront parse). The asset
 *  sits outside the NativeScript app folder, which the runtime extracts on the first launch after install. */
class AssetFrameReader implements FrameReader {
  readonly count = null;
  private reader: java.io.BufferedReader | null = null;
  private nextSeq = 1;

  constructor(private readonly assetName: string) {}

  static open(assetName: string): AssetFrameReader | null {
    const r = new AssetFrameReader(assetName);
    try {
      r.reopen();
      return r;
    } catch {
      return null;
    }
  }

  private reopen(): void {
    this.close();
    const stream = Utils.android.getApplicationContext().getAssets().open(this.assetName);
    this.reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream, java.nio.charset.StandardCharsets.UTF_8));
    this.nextSeq = 1;
  }

  seek(seq: number): void {
    if (this.reader === null || seq < this.nextSeq) {
      this.reopen();
    }
    const reader = this.reader as java.io.BufferedReader;
    while (this.nextSeq < seq) {
      if (reader.readLine() === null) {
        return;
      }
      this.nextSeq += 1;
    }
  }

  next(): string | null {
    if (this.reader === null) {
      return null;
    }
    const line = this.reader.readLine();
    if (line === null) {
      return null;
    }
    this.nextSeq += 1;
    return String(line);
  }

  close(): void {
    if (this.reader !== null) {
      try {
        this.reader.close();
      } catch {
        // already closed
      }
      this.reader = null;
    }
  }
}

export function openStreamReader(profile: string): FrameReader | null {
  return AssetFrameReader.open(`mobilebench/${profile}.stream.jsonl`);
}

export function firstVisibleRow(listView: ListView): number {
  const lv = listView.android as android.widget.ListView | undefined;
  return lv ? Math.max(0, lv.getFirstVisiblePosition()) : 0;
}

export function configureListView(listView: ListView): void {
  const lv = listView.android as android.widget.ListView | undefined;
  if (lv) {
    lv.setDivider(null);
    lv.setDividerHeight(0);
    lv.setSelector(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
  }
}

let lifecycle: android.app.Application.ActivityLifecycleCallbacks | null = null;

/**
 * Background / foreground from the platform lifecycle (design §6.3): an ActivityLifecycleCallbacks counter of
 * started activities. Registered during the first activity's onCreate, so its onStart is observed.
 */
export function watchLifecycle(onBackground: () => void, onForeground: () => void): void {
  if (lifecycle !== null) {
    return;
  }
  let started = 0;
  // Only the seven classic callbacks are implemented (as in @nativescript/core's own lifecycle callbacks); the
  // pre/post callbacks added in API 29 are default interface methods, which the typings list as required.
  const implementation = {
    onActivityCreated(): void {
      // not needed
    },
    onActivityStarted(): void {
      started += 1;
      if (started === 1) {
        onForeground();
      }
    },
    onActivityResumed(): void {
      // not needed
    },
    onActivityPaused(): void {
      // not needed
    },
    onActivityStopped(): void {
      started = Math.max(0, started - 1);
      if (started === 0) {
        onBackground();
      }
    },
    onActivitySaveInstanceState(): void {
      // not needed
    },
    onActivityDestroyed(): void {
      // not needed
    },
  };
  lifecycle = new android.app.Application.ActivityLifecycleCallbacks(implementation as never);
  (Utils.android.getApplicationContext() as android.app.Application).registerActivityLifecycleCallbacks(lifecycle);
}

function accessibilityManager(): android.view.accessibility.AccessibilityManager {
  return Utils.android
    .getApplicationContext()
    .getSystemService(android.content.Context.ACCESSIBILITY_SERVICE) as android.view.accessibility.AccessibilityManager;
}

export function a11yPayload(): string {
  return `on=${accessibilityManager().isEnabled() ? 1 : 0}`;
}

let a11yListener: android.view.accessibility.AccessibilityManager.AccessibilityStateChangeListener | null = null;

export function watchA11y(onChange: (payload: string) => void): void {
  if (a11yListener !== null) {
    return;
  }
  a11yListener = new android.view.accessibility.AccessibilityManager.AccessibilityStateChangeListener({
    onAccessibilityStateChanged(enabled: boolean): void {
      onChange(`on=${enabled ? 1 : 0}`);
    },
  });
  accessibilityManager().addAccessibilityStateChangeListener(a11yListener);
}
