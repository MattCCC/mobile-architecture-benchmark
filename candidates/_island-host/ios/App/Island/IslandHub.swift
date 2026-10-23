import Foundation
import MobileBenchCore
import UIKit

/// Host side of the island protocol, the same JSON messages for every runtime (see the Android `IslandHub` for the
/// message list). Main thread only.
@MainActor
final class IslandHub: IslandHost {
    static let shared = IslandHub()

    var embedding: IslandEmbedding!
    weak var store: AppStore?

    private struct Open {
        let sid: Int
        let kind: IslandKind
        let index: Int
        let route: String
        weak var view: UIView?
        let source: IslandSource?
        let openNo: Int
    }

    private var open: [Int: Open] = [:]
    private var nextSid = 1
    private var insightsOpens = 0

    var insightsOpen: Bool { open.values.contains { $0.kind == .insights } }

    /// Creates the island view for a Detail(index) or Insights screen.
    func makeView(kind: IslandKind, index: Int, route: String) -> (sid: Int, view: UIView) {
        let sid = nextSid
        nextSid += 1
        var source: IslandSource?
        var openNo = 0
        if kind == .insights {
            let s = embedding.insightsSource()
            source = s
            BenchKit.insightsSource(s.src)
            insightsOpens += 1
            openNo = insightsOpens
        } else {
            BenchKit.currentDetailRoute = route
        }
        let json = state("init", sid: sid, kind: kind, index: index, token: BenchKit.token(for: route), source: source,
                         openNo: openNo)
        let view = embedding.makeView(sid: sid, kind: kind, initJSON: json)
        open[sid] = Open(sid: sid, kind: kind, index: index, route: route, view: view, source: source, openNo: openNo)
        return (sid, view)
    }

    func release(sid: Int) {
        guard let entry = open.removeValue(forKey: sid) else { return }
        if entry.kind == .detail, BenchKit.currentDetailRoute == entry.route { BenchKit.currentDetailRoute = nil }
        if let view = entry.view { embedding.release(view: view, sid: sid) }
    }

    /// A stream update was applied to the store (called by `AppStore.offer`).
    func onApplied(seq: Int, item: Int, v0: Int, v1: Int, v2: Int) {
        guard !open.isEmpty else { return }
        var marked = false
        for o in open.values {
            guard let view = o.view else { continue }
            let message: String
            switch o.kind {
            case .detail:
                guard o.index == item else { continue }
                message = "{\"t\":\"v\",\"sid\":\(o.sid),\"s\":\(seq),\"v\":[\(v0),\(v1),\(v2)]}"
            case .insights:
                message = "{\"t\":\"ins\",\"sid\":\(o.sid),\"s\":\(seq)" + insightsFields() + "}"
            }
            if !marked, BenchKit.config.xr {
                marked = true
                BenchKit.mark("xr.native", "s=\(seq)")
            }
            embedding.send(view: view, sid: o.sid, message: message)
        }
    }

    /// The top route or the foreground sequence changed: the top island draws its new token.
    func onTokenChanged() {
        for o in open.values where o.route == BenchKit.topRoute {
            guard let view = o.view else { continue }
            embedding.send(view: view, sid: o.sid,
                           message: "{\"t\":\"tk\",\"sid\":\(o.sid),\"k\":\"\(BenchKit.token(for: o.route))\"}")
        }
    }

    /// Checkpoint: the Insights digest element text changed.
    func onInsightsDigest(_ text: String) {
        for o in open.values where o.kind == .insights {
            guard let view = o.view else { continue }
            embedding.send(view: view, sid: o.sid, message: "{\"t\":\"idg\",\"sid\":\(o.sid),\"x\":\"\(text)\"}")
        }
    }

    func islandMessage(sid: Int, message: String) {
        guard let data = message.data(using: .utf8),
            let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let t = m["t"] as? String
        else {
            BenchKit.err("unexpected-exception")
            return
        }
        switch t {
        case "ready":
            guard let o = open[sid], let view = o.view else { return }
            embedding.send(view: view, sid: sid,
                           message: state("snap", sid: sid, kind: o.kind, index: o.index,
                                          token: BenchKit.token(for: o.route), source: o.source, openNo: o.openNo))
        case "mark":
            IslandBenchApi.mark(m["e"] as? String ?? "", m["p"] as? String ?? "")
        case "probe":
            BenchKit.islandProbeDrawn(kind: m["kind"] as? String ?? "", index: m["i"] as? Int ?? -1,
                                      token: m["tk"] as? String ?? "")
        default:
            break
        }
    }

    private func state(_ type: String, sid: Int, kind: IslandKind, index: Int, token: String, source: IslandSource?,
                       openNo: Int) -> String
    {
        guard let store else { return "{}" }
        let m = store.model
        var s = "{\"t\":\"\(type)\",\"sid\":\(sid),\"k\":\"\(kind.rawValue)\",\"n\":\(m.itemCount),"
        s += "\"s\":\(m.lastAppliedSeq),\"tk\":\"\(token)\",\"xr\":\(BenchKit.config.xr ? 1 : 0)"
        switch kind {
        case .detail:
            s += ",\"i\":\(index),\"g\":\(m.groups[index]),\"v\":[\(m.value(index, 0)),\(m.value(index, 1)),"
            s += "\(m.value(index, 2))]"
        case .insights:
            s += insightsFields()
            s += ",\"src\":\"\(source?.src ?? "embedded")\",\"ver\":\"\(source?.version ?? "1")\",\"open\":\(openNo)"
            s += ",\"idg\":\"\(store.insightsDigestText)\""
        }
        return s + "}"
    }

    private func insightsFields() -> String {
        guard let store else { return "" }
        let ins = store.model.insights()
        let top = zip(ins.topItems, ins.topValues).map { "[\($0),\($1)]" }.joined(separator: ",")
        return ",\"top\":[\(top)],\"b\":[\(ins.buckets.map { String($0) }.joined(separator: ","))]"
    }
}
