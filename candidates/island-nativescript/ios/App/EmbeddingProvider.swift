import Foundation
import MobileBenchCore
import UIKit

@MainActor
enum EmbeddingProvider {
    static func make() -> IslandEmbedding { NativeScriptIslandEmbedding() }
}

/// Channels shared with app/bridge.ios.ts. Every post is a synchronous NSNotificationCenter delivery on the main
/// thread; the payload is an NSMutableDictionary (`op`, `sid`, plus `json`, `container`, `w`/`h`, `e`/`p`, ...).
private let toIsland = Notification.Name("org.example.mobilebench.island.toIsland")
private let toHost = Notification.Name("org.example.mobilebench.island.toHost")

private func post(_ fields: [String: Any]) {
    NotificationCenter.default.post(name: toIsland, object: NSMutableDictionary(dictionary: fields))
}

/// One island-to-host post: `msg` (`sid`, `json`), `mark` (`e`, `p`) or `probe` (`kind`, `i`, `tk`).
private struct IslandToHost: Sendable {
    let op: String
    let sid: Int
    let json: String
    let event: String
    let payload: String
    let kind: String
    let index: Int
    let token: String

    init(_ f: NSDictionary) {
        op = f["op"] as? String ?? ""
        sid = (f["sid"] as? Int) ?? -1
        json = f["json"] as? String ?? ""
        event = f["e"] as? String ?? ""
        payload = f["p"] as? String ?? ""
        kind = f["kind"] as? String ?? ""
        index = (f["i"] as? Int) ?? -1
        token = f["tk"] as? String ?? ""
    }
}

/// Host view of one island. Its layout passes drive the NativeScript layout of the island root (a subview the
/// island bundle adds), which then reports its draw probes.
private final class IslandContainerView: UIView {
    let sid: Int

    init(sid: Int) {
        self.sid = sid
        super.init(frame: .zero)
        backgroundColor = .white
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        post(["op": "layout", "sid": sid, "w": bounds.width, "h": bounds.height])
    }
}

@MainActor
private final class NativeScriptIslandEmbedding: IslandEmbedding {
    let name = "nativescript"
    let remoteCapable = false

    private weak var host: IslandHost?
    private var started = false
    private var observer: NSObjectProtocol?

    func appDidLaunch(host: IslandHost, config: LaunchConfig) {
        self.host = host
        observer = NotificationCenter.default.addObserver(forName: toHost, object: nil, queue: nil) { [weak self] n in
            guard let fields = n.object as? NSDictionary else { return }
            let message = IslandToHost(fields)
            MainActor.assumeIsolated { self?.fromIsland(message) }
        }
        if config.engine == "prewarm" { start() }
    }

    /// Starts V8 and runs the island bundle, which registers its observer before `boot` returns.
    private func start() {
        guard !started else { return }
        started = true
        NativeScriptStart.setup()
        NativeScriptStart.boot()
    }

    private func fromIsland(_ m: IslandToHost) {
        switch m.op {
        case "msg": host?.islandMessage(sid: m.sid, message: m.json)
        case "mark": IslandBenchApi.mark(m.event, m.payload)
        case "probe": IslandBenchApi.probeDrawn(kind: m.kind, index: m.index, token: m.token)
        default: break
        }
    }

    func insightsSource() -> IslandSource { IslandSource(src: "embedded", version: "1") }

    func makeView(sid: Int, kind: IslandKind, initJSON: String) -> UIView {
        start()
        let container = IslandContainerView(sid: sid)
        post(["op": "create", "sid": sid, "json": initJSON, "container": container])
        return container
    }

    func send(view: UIView, sid: Int, message: String) {
        post(["op": "send", "sid": sid, "json": message])
    }

    func release(view: UIView, sid: Int) {
        post(["op": "release", "sid": sid])
    }
}
