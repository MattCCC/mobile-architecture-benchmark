import MobileBenchCore
import UIKit

/// The two island screens (decision 38): the item Detail screen and the Insights feature.
enum IslandKind: String {
    case detail
    case insights

    /// Component name registered by runtimes that address islands by name.
    var module: String { self == .detail ? "MBDetailIsland" : "MBInsightsIsland" }
}

/// Where the Insights island code came from for one open (design §8.10).
struct IslandSource {
    let src: String
    let version: String
}

/// Host services for embeddings.
@MainActor
protocol IslandHost: AnyObject {
    /// Island-to-host message of island instance `sid` (JSON object text).
    func islandMessage(sid: Int, message: String)
}

/// One embedded UI runtime (React Native, Flutter, WebView, ...). Each island candidate provides exactly one
/// implementation through `EmbeddingProvider.make()` in its own sources; the host code is identical for all of them.
/// Messages in both directions are JSON object texts of the island protocol (see `IslandHub`). Runtimes that can call
/// native code synchronously report markers and draw probes through `IslandBenchApi` / `MBHostBench`; the others
/// send `mark` / `probe` messages to `IslandHost.islandMessage`.
@MainActor
protocol IslandEmbedding: AnyObject {
    /// Short runtime name for diagnostics (`rn`, `webview`, `flutter`, ...).
    var name: String { get }
    /// True when the island code can be loaded from the local server (`mb.remote=remote`).
    var remoteCapable: Bool { get }
    /// Called once at launch with the parsed launch configuration; `mb.engine=prewarm` starts the runtime here.
    func appDidLaunch(host: IslandHost, config: LaunchConfig)
    /// Source of the Insights island code for the next open.
    func insightsSource() -> IslandSource
    /// Creates the view that renders one island instance; `initJSON` is its `init` message.
    func makeView(sid: Int, kind: IslandKind, initJSON: String) -> UIView
    /// Delivers one host message to the island instance `sid` shown in `view`.
    func send(view: UIView, sid: Int, message: String)
    /// The view left the screen for good: stop the island instance and release its resources.
    func release(view: UIView, sid: Int)
}
