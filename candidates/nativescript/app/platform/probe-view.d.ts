// Native draw-probe view (design §6.2): a 1 x 1 dp/pt opaque view painted in its parent's background
// colour. Its draw callback (Android View.onDraw, UIKit drawRect:) calls owner.probeDrawn().
// Implementations: probe-view.android.ts, probe-view.ios.ts (selected by the NativeScript bundler).

export interface ProbeOwner {
  probeDrawn(): void;
}

/** Creates the native view. `context` is the Android Context (unused on iOS). */
export function createProbeView(owner: ProbeOwner, context: unknown, colorArgb: number): unknown;

/** Detaches the owner (the native view may outlive the NativeScript view). */
export function releaseProbeView(nativeView: unknown): void;

/** Forces a redraw so the next frame calls the draw callback (token change, §6.2). */
export function invalidateProbeView(nativeView: unknown): void;
