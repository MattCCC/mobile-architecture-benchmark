import type { ProbeOwner } from './probe-view';

@NativeClass()
class MobileBenchProbeView extends UIView {
  owner!: ProbeOwner | null;
  fillColor!: UIColor;

  drawRect(rect: CGRect): void {
    this.fillColor.setFill();
    UIRectFill(rect);
    const owner = this.owner;
    if (owner) {
      owner.probeDrawn();
    }
  }
}

function colorFromArgb(argb: number): UIColor {
  const a = ((argb >>> 24) & 0xff) / 255;
  const r = ((argb >>> 16) & 0xff) / 255;
  const g = ((argb >>> 8) & 0xff) / 255;
  const b = (argb & 0xff) / 255;
  return UIColor.colorWithRedGreenBlueAlpha(r, g, b, a);
}

export function createProbeView(owner: ProbeOwner, _context: unknown, colorArgb: number): unknown {
  const view = MobileBenchProbeView.new() as MobileBenchProbeView;
  view.owner = owner;
  view.fillColor = colorFromArgb(colorArgb);
  view.opaque = true;
  view.isAccessibilityElement = false;
  view.userInteractionEnabled = false;
  return view;
}

export function releaseProbeView(nativeView: unknown): void {
  if (nativeView) {
    (nativeView as MobileBenchProbeView).owner = null;
  }
}

export function invalidateProbeView(nativeView: unknown): void {
  if (nativeView) {
    (nativeView as UIView).setNeedsDisplay();
  }
}
