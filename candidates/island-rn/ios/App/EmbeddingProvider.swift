import Foundation
import MobileBenchCore
import ReactBrownfield
import UIKit

@MainActor
enum EmbeddingProvider {
    static func make() -> IslandEmbedding { ReactNativeIslandEmbedding() }
}

@MainActor
private final class ReactNativeIslandEmbedding: IslandEmbedding {
    let name = "rn"
    let remoteCapable = false

    private weak var host: IslandHost?
    private var observer: NSObjectProtocol?
    private var started = false

    func appDidLaunch(host: IslandHost, config: LaunchConfig) {
        self.host = host
        let brownfield = ReactNativeBrownfield.shared
        brownfield.bundle = .main
        brownfield.bundlePath = "main.jsbundle"
        observer = brownfield.onMessage { [weak self] message in
            guard let data = message.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let sid = object["sid"] as? Int else { return }
            Task { @MainActor in self?.host?.islandMessage(sid: sid, message: message) }
        }
        if config.engine == "prewarm" { start(preload: true) }
    }

    private func start(preload: Bool) {
        guard !started else { return }
        ReactNativeBrownfield.shared.startReactNative(launchOptions: nil, preloadBundle: preload, onBundleLoaded: nil)
        started = true
    }

    func insightsSource() -> IslandSource { IslandSource(src: "embedded", version: "1") }

    func makeView(sid: Int, kind: IslandKind, initJSON: String) -> UIView {
        start(preload: false)
        return ReactNativeBrownfield.shared.view(
            moduleName: kind.module,
            initialProps: ["init": initJSON]
        ) ?? UIView()
    }

    func send(view: UIView, sid: Int, message: String) {
        ReactNativeBrownfield.shared.postMessage(message)
    }

    func release(view: UIView, sid: Int) {
        view.removeFromSuperview()
    }
}
