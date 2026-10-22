// NativeScript wrapper around the native draw probe (design §6.2): a 1 x 1 opaque view whose draw
// callback reports to BenchKit. It forwards calls only; token and gate rules live in the BenchKit wrapper.

import { View } from '@nativescript/core';
import { createProbeView, invalidateProbeView, ProbeOwner, releaseProbeView } from './probe-view';

export class DrawProbe extends View implements ProbeOwner {
  /** Called from the native draw callback. */
  onDrawn: (() => void) | null = null;

  constructor(private readonly colorArgb: number) {
    super();
    this.width = 1;
    this.height = 1;
    this.horizontalAlignment = 'left';
    this.verticalAlignment = 'top';
    this.isUserInteractionEnabled = false;
  }

  createNativeView(): object {
    return createProbeView(this, this._context, this.colorArgb) as object;
  }

  disposeNativeView(): void {
    releaseProbeView(this.nativeViewProtected);
    super.disposeNativeView();
  }

  probeDrawn(): void {
    const cb = this.onDrawn;
    if (cb !== null) {
      cb();
    }
  }

  /** Forces the next frame to call the draw callback (token change). */
  requestRedraw(): void {
    invalidateProbeView(this.nativeViewProtected);
  }
}
