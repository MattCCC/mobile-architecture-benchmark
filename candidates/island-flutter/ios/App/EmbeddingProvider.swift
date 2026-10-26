import Flutter
import Foundation
import MobileBenchCore
import UIKit

@MainActor
enum EmbeddingProvider {
    static func make() -> IslandEmbedding { FlutterIslandEmbedding() }
}

@MainActor
private final class FlutterIslandEmbedding: IslandEmbedding {
    let name = "flutter"
    let remoteCapable = false

    private weak var host: IslandHost?
    private var engine: FlutterEngine?
    private var channel: FlutterMethodChannel?
    private var runtimeReady = false
    private var activeSid = -1
    private var pendingInit: String?

    func appDidLaunch(host: IslandHost, config: LaunchConfig) {
        self.host = host
        if config.engine == "prewarm" { start() }
    }

    private func start() {
        guard engine == nil else { return }
        let created = FlutterEngine(name: "mobilebench-islands", project: nil, allowHeadlessExecution: true)
        // The engine must run before a channel handler is set (FlutterEngine raises otherwise). The Dart side
        // announces runtimeReady only after its own handler is registered, so no message is lost.
        _ = created.run()
        let bridge = FlutterMethodChannel(name: "org.example.mobilebench/islands", binaryMessenger: created.binaryMessenger)
        bridge.setMethodCallHandler { [weak self] call, result in
            guard call.method == "islandMessage", let message = call.arguments as? String else {
                result(nil)
                return
            }
            let object = (try? JSONSerialization.jsonObject(with: Data(message.utf8))) as? [String: Any]
            if object?["t"] as? String == "runtimeReady" {
                self?.runtimeReady = true
                if let initial = self?.pendingInit { bridge.invokeMethod("message", arguments: initial) }
            } else if let sid = object?["sid"] as? Int {
                self?.host?.islandMessage(sid: sid, message: message)
            }
            result(nil)
        }
        engine = created
        channel = bridge
    }

    func insightsSource() -> IslandSource { IslandSource(src: "embedded", version: "1") }

    /// One engine, one view controller: the app shows one island at a time (Insights opens from the List only), so
    /// every island reuses the controller and its view. A second controller on the same engine does not get the
    /// accessibility tree back after the first one is released.
    private var controller: FlutterViewController?

    func makeView(sid: Int, kind: IslandKind, initJSON: String) -> UIView {
        start()
        guard let engine else { return UIView() }
        activeSid = sid
        pendingInit = initJSON
        let shared = controller ?? FlutterViewController(engine: engine, nibName: nil, bundle: nil)
        controller = shared
        shared.view.removeFromSuperview()
        shared.view.backgroundColor = .white
        shared.beginAppearanceTransition(true, animated: false)
        shared.endAppearanceTransition()
        if runtimeReady { channel?.invokeMethod("message", arguments: initJSON) }
        return shared.view
    }

    func send(view: UIView, sid: Int, message: String) {
        if sid == activeSid { channel?.invokeMethod("message", arguments: message) }
    }

    func release(view: UIView, sid: Int) {
        guard activeSid == sid else { return }
        controller?.beginAppearanceTransition(false, animated: false)
        controller?.endAppearanceTransition()
        if activeSid == sid {
            activeSid = -1
            pendingInit = nil
        }
    }
}
