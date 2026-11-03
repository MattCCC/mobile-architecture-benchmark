import type { ProbeOwner } from './probe-view';

@NativeClass()
class MobileBenchProbeView extends android.view.View {
  owner!: ProbeOwner | null;
  red!: number;
  green!: number;
  blue!: number;

  constructor(context: android.content.Context) {
    super(context);
    // Required for TypeScript subclasses of Java classes: returns the JavaScript object bound to the Java instance.
    return globalThis.__native(this);
  }

  onDraw(canvas: android.graphics.Canvas): void {
    // drawRGB(int, int, int) has no long overload; an ARGB value above 2^31 would select drawColor(long), which
    // reads a colour-space id from the low bits and throws.
    canvas.drawRGB(this.red, this.green, this.blue);
    const owner = this.owner;
    if (owner) {
      owner.probeDrawn();
    }
  }
}

/** colorArgb: opaque colour 0xAARRGGBB; the probe is always drawn opaque. */
export function createProbeView(owner: ProbeOwner, context: unknown, colorArgb: number): unknown {
  const view = new MobileBenchProbeView(context as android.content.Context);
  view.owner = owner;
  view.red = (colorArgb >>> 16) & 0xff;
  view.green = (colorArgb >>> 8) & 0xff;
  view.blue = colorArgb & 0xff;
  // Not interesting for accessibility services; keeps the node tree unchanged.
  view.setImportantForAccessibility(android.view.View.IMPORTANT_FOR_ACCESSIBILITY_NO);
  return view;
}

export function releaseProbeView(nativeView: unknown): void {
  if (nativeView) {
    (nativeView as MobileBenchProbeView).owner = null;
  }
}

export function invalidateProbeView(nativeView: unknown): void {
  if (nativeView) {
    (nativeView as android.view.View).invalidate();
  }
}
