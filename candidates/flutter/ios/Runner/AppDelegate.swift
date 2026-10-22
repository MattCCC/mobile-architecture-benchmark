import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Launch argument `-mb.journeyMode 1`: keep the screen awake during benchmark journeys.
    let args = ProcessInfo.processInfo.arguments
    if let at = args.firstIndex(of: "-mb.journeyMode"), at + 1 < args.count, args[at + 1] == "1" {
      application.isIdleTimerDisabled = true
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
