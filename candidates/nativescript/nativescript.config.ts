import { NativeScriptConfig } from '@nativescript/core';

// android.v8Flags and android.markingMode are the values the NativeScript CLI writes into every new project
// (kept as the idiomatic defaults; see README "Release settings").
export default {
  id: 'org.example.mobilebench.nativescript',
  appPath: 'app',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none',
  },
} as NativeScriptConfig;
