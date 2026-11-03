import UIKit
import BenchKmp

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, BenchKitListener {
    private var host: IosHost!
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BenchKit.start(arguments: ProcessInfo.processInfo.arguments)
        BenchKit.listener = self
        BenchKit.stateProvider = {
            (Int(AppRuntime.shared.selectedCount()), Int(AppRuntime.shared.lastSeq()), Int(AppRuntime.shared.revision()))
        }
        host = IosHost { name, payload in
            MainActor.assumeIsolated { Self.event(name, payload) }
        }
        let c = BenchKit.config
        AppRuntime.shared.start(services: host, profile: c.profile, restore: c.restore, valid: c.isValid)
        application.isIdleTimerDisabled = c.journeyMode
        return true
    }
    func benchFui() { AppRuntime.shared.ready() }
    func benchRestoreDrawn() { AppRuntime.shared.ready() }
    func benchResumeDrawn() { AppRuntime.shared.resumeDrawn() }
    func benchBackground() { AppRuntime.shared.background() }
    func benchForeground(fgSeq: Int) { AppRuntime.shared.foreground(seq: Int32(fgSeq)) }

    private static func event(_ name: String, _ payload: String) {
        switch name {
        case "gate.arm": BenchKit.armFuiGate(itemCount: Int(payload)!)
        case "gate.restore":
            let p = payload.split(separator: ";").map(String.init)
            BenchKit.disarmFuiGate()
            BenchKit.setPendingRestore(route: p[0], anchor: Int(p[1])!)
        case "probe.layout": BenchKit.listLayout(Int(payload)!)
        case "probe.row": BenchKit.rowDrawn(Int(payload)!)
        case "probe.summary": BenchKit.summaryDrawn()
        case "probe.root":
            let route = String(payload.split(separator: ";")[0])
            BenchKit.navigated(to: route)
            BenchKit.rootDrawn(route: route)
        case "probe.insights.request": BenchKit.insightsRequested()
        case "probe.insights.draw": BenchKit.insightsDrawn()
        case "checkpoint": BenchKit.memoryCheckpoint(); BenchKit.flush()
        default: BenchKit.mark(name, payload)
        }
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = .light
        window.rootViewController = IosAppKt.mainViewController()
        self.window = window
        window.makeKeyAndVisible()
    }
}
