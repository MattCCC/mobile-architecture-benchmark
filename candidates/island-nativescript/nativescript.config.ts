import { NativeScriptConfig } from '@nativescript/core';

// android.v8Flags and android.markingMode are the CLI defaults, the same as the nativescript candidate.
export default {
  id: 'org.example.mobilebench.islandnativescript',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none',
  },
} as NativeScriptConfig;
