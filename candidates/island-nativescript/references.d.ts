/// <reference path="./node_modules/@nativescript/types/index.d.ts" />
// iOS SDK modules used by app/platform/native.ios.ts that the default (common) iOS typings do not include:
// clock_gettime_nsec_np / CLOCK_UPTIME_RAW (Darwin foundation) and notify_post (Darwin notifications).
/// <reference path="./node_modules/@nativescript/types-ios/lib/ios/objc-x86_64/objc!_DarwinFoundation1.d.ts" />
/// <reference path="./node_modules/@nativescript/types-ios/lib/ios/objc-x86_64/objc!_DarwinFoundation2.d.ts" />
/// <reference path="./node_modules/@nativescript/types-ios/lib/ios/objc-x86_64/objc!notify.d.ts" />
