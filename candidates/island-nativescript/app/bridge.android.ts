// Android host bridge: direct calls into the shared island host's Kotlin (candidates/_island-host and this
// candidate's App_Resources/Android/.../EmbeddingProvider.kt). The host drives the bundle through one
// android.os.Handler.Callback implemented here; markers and draw probes call IslandBenchApi synchronously.
import { Application } from '@nativescript/core';
import type { View } from '@nativescript/core';
import type { IslandHandlers } from './bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const org: any;
const NsIslands = org.example.mobilebench.islandhost.island.NsIslands;
const benchApi = org.example.mobilebench.islandhost.bench.IslandBenchApi.INSTANCE;
/* eslint-enable @typescript-eslint/no-explicit-any */

const OP_CREATE = 1;
const OP_SEND = 2;
const OP_RELEASE = 3;

const drawListeners = new WeakMap<View, android.view.ViewTreeObserver.OnDrawListener>();

export function start(handlers: IslandHandlers): void {
  Application.android.init(NsIslands.getApplication());
  const callback = new android.os.Handler.Callback({
    handleMessage(msg: android.os.Message): boolean {
      switch (msg.what) {
        case OP_CREATE: {
          const activity: android.content.Context = NsIslands.getActivity();
          const root = handlers.create(msg.arg1, String(msg.obj));
          if (root === null) {
            msg.obj = new android.view.View(activity);
            return true;
          }
          root._setupAsRootView(activity);
          root.callLoaded();
          const nativeView = root.nativeViewProtected as android.view.View;
          const listener = drawListeners.get(root);
          if (listener !== undefined) {
            nativeView.getViewTreeObserver().addOnDrawListener(listener);
          }
          msg.obj = nativeView;
          return true;
        }
        case OP_SEND:
          handlers.send(String(msg.obj));
          return true;
        case OP_RELEASE:
          handlers.release(msg.arg1);
          return true;
        default:
          return false;
      }
    },
  });
  NsIslands.register(callback);
}

export function toHost(sid: number, json: string): void {
  NsIslands.toHost(sid, json);
}

export function mark(event: string, payload: string): void {
  benchApi.mark(event, payload);
}

export function probeDrawn(kind: string, index: number, token: string): void {
  benchApi.probeDrawn(kind, index, token);
}

export function onEachDraw(root: View, cb: () => void): void {
  const listener = new android.view.ViewTreeObserver.OnDrawListener({
    onDraw(): void {
      cb();
    },
  });
  // Registered when the native view exists (OP_CREATE, after _setupAsRootView).
  drawListeners.set(root, listener);
}

export function requestDraw(root: View): void {
  (root.nativeViewProtected as android.view.View | undefined)?.invalidate();
}

export function unmount(root: View): void {
  const nativeView = root.nativeViewProtected as android.view.View | undefined;
  const listener = drawListeners.get(root);
  drawListeners.delete(root);
  if (nativeView !== undefined && listener !== undefined) {
    // Listeners cannot be removed while the tree draws; the release may arrive from a draw-time callback.
    const observer = nativeView.getViewTreeObserver();
    nativeView.post(
      new java.lang.Runnable({
        run(): void {
          if (observer.isAlive()) {
            observer.removeOnDrawListener(listener);
          }
        },
      }),
    );
  }
  root.callUnloaded();
  root._tearDownUI(true);
}
