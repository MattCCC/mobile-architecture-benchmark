// Host bridge of the island bundle; bridge.android.ts and bridge.ios.ts implement it. Every call is synchronous and
// happens on the main thread: NativeScript calls the native host's Kotlin / Swift code directly.
import type { View } from '@nativescript/core';

export interface IslandHandlers {
  /** Builds the island `sid` from its `init` message; returns its root view, or null for a malformed message. */
  create(sid: number, initJson: string): View | null;
  /** One host message (JSON text) for an island instance. */
  send(json: string): void;
  /** The island left the screen for good. */
  release(sid: number): void;
}

/** Registers the handlers with the native host. */
export function start(handlers: IslandHandlers): void;

/** Island-to-host protocol message (`ready`). */
export function toHost(sid: number, json: string): void;

/** Benchmark marker through the host BenchKit (synchronous native call). */
export function mark(event: string, payload: string): void;

/** Draw probe through the host BenchKit: `screen` (route index, token) or `insights` (`ready:` token). */
export function probeDrawn(kind: string, index: number, token: string): void;

/** Calls `cb` after every frame in which the island root was drawn. */
export function onEachDraw(root: View, cb: () => void): void;

/** Schedules a frame of the island root (a token changed without a layout change). */
export function requestDraw(root: View): void;

/** Detaches the island root from its native parent and tears its native views down. */
export function unmount(root: View): void;
