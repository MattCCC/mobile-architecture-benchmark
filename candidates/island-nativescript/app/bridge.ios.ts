// iOS host bridge: synchronous NSNotificationCenter posts on the main thread to and from the shared island host's
// Swift (this candidate's ios/App/EmbeddingProvider.swift). The host's container view drives the layout of each
// island root; draw probes are reported after each layout pass.
import { Utils, View } from '@nativescript/core';
import type { IslandHandlers } from './bridge';

const TO_ISLAND = 'org.example.mobilebench.island.toIsland';
const TO_HOST = 'org.example.mobilebench.island.toHost';

interface Mounted {
  root: View;
  container: UIView;
  drawn?: () => void;
}

const mounted = new Map<number, Mounted>();
const pendingDraw = new WeakMap<View, () => void>();
/** The observer token must stay referenced for the life of the runtime. */
export let observer: NSObjectProtocol | undefined;

function post(fields: Record<string, string | number>): void {
  const d = NSMutableDictionary.new<string, string | number>();
  for (const k of Object.keys(fields)) {
    d.setObjectForKey(fields[k], k);
  }
  NSNotificationCenter.defaultCenter.postNotificationNameObject(TO_HOST, d);
}

function find(root: View): Mounted | undefined {
  for (const m of mounted.values()) {
    if (m.root === root) {
      return m;
    }
  }
  return undefined;
}

function layout(m: Mounted, widthPt: number, heightPt: number): void {
  const w = Utils.layout.toDevicePixels(widthPt);
  const h = Utils.layout.toDevicePixels(heightPt);
  const exactly = Utils.layout.EXACTLY;
  View.measureChild(null as unknown as View, m.root, Utils.layout.makeMeasureSpec(w, exactly), Utils.layout.makeMeasureSpec(h, exactly));
  View.layoutChild(null as unknown as View, m.root, 0, 0, w, h);
  m.drawn?.();
}

export function start(handlers: IslandHandlers): void {
  observer = NSNotificationCenter.defaultCenter.addObserverForNameObjectQueueUsingBlock(
    TO_ISLAND,
    null,
    null,
    (n: NSNotification) => {
      const d = n.object as NSDictionary<string, unknown>;
      const sid = d.objectForKey('sid') as number;
      switch (d.objectForKey('op') as string) {
        case 'create': {
          const root = handlers.create(sid, d.objectForKey('json') as string);
          if (root === null) {
            return;
          }
          const container = d.objectForKey('container') as UIView;
          const m: Mounted = { root, container, drawn: pendingDraw.get(root) };
          pendingDraw.delete(root);
          mounted.set(sid, m);
          root._setupAsRootView({});
          root.callLoaded();
          container.addSubview(root.nativeViewProtected as UIView);
          container.setNeedsLayout();
          return;
        }
        case 'layout': {
          const m = mounted.get(sid);
          if (m !== undefined) {
            layout(m, d.objectForKey('w') as number, d.objectForKey('h') as number);
          }
          return;
        }
        case 'send':
          handlers.send(d.objectForKey('json') as string);
          // The host container drives NativeScript layout: changed text is measured in its next layout pass.
          mounted.get(sid)?.container.setNeedsLayout();
          return;
        case 'release':
          handlers.release(sid);
          mounted.delete(sid);
          return;
        default:
          return;
      }
    },
  );
}

export function toHost(sid: number, json: string): void {
  post({ op: 'msg', sid, json });
}

export function mark(event: string, payload: string): void {
  post({ op: 'mark', sid: 0, e: event, p: payload });
}

export function probeDrawn(kind: string, index: number, token: string): void {
  post({ op: 'probe', sid: 0, kind, i: index, tk: token });
}

export function onEachDraw(root: View, cb: () => void): void {
  // Called from handlers.create, before the root is mounted; the 'create' case picks it up.
  pendingDraw.set(root, cb);
}

export function requestDraw(root: View): void {
  find(root)?.container.setNeedsLayout();
}

export function unmount(root: View): void {
  const nativeView = root.nativeViewProtected as UIView | undefined;
  nativeView?.removeFromSuperview();
  root.callUnloaded();
  root._tearDownUI(true);
}
