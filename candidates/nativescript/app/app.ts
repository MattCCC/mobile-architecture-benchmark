// Entry point: NativeScript core + TypeScript, no UI framework (design §14.3).
import { AndroidActivityEventData, Application } from '@nativescript/core';
import { Session } from './ui/session';

const session = new Session();

Application.on(Application.launchEvent, (args) => session.onLaunch(args));
Application.on(Application.uncaughtErrorEvent, (args) => session.onUncaughtError(args));
// Background / foreground come from the platform lifecycle (platform/native.*.ts watchLifecycle).
if (__ANDROID__) {
  Application.android.on(Application.android.activityCreatedEvent, (args) =>
    session.onActivityCreated((args as AndroidActivityEventData).activity),
  );
}

Application.run({ create: () => session.createRoot() });
