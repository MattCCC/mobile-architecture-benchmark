// Compile-time contract check (never bundled: outside app/): both platform implementations must satisfy the
// facades that the shared code imports (app/platform/native.d.ts, app/platform/probe-view.d.ts).
import type * as NativeFacade from '../app/platform/native';
import * as nativeAndroid from '../app/platform/native.android';
import * as nativeIos from '../app/platform/native.ios';
import type * as ProbeFacade from '../app/platform/probe-view';
import * as probeAndroid from '../app/platform/probe-view.android';
import * as probeIos from '../app/platform/probe-view.ios';

export const androidNative: typeof NativeFacade = nativeAndroid;
export const iosNative: typeof NativeFacade = nativeIos;
export const androidProbe: typeof ProbeFacade = probeAndroid;
export const iosProbe: typeof ProbeFacade = probeIos;
