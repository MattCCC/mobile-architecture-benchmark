import Foundation
import MobileBenchCore

/// Screens observe the store; every callback runs on the main thread.
@MainActor
protocol StoreObserver: AnyObject {
    /// Values of `item` changed (stream update).
    func storeRowChanged(_ item: Int)
    /// Selection of `item` changed (tap).
    func storeSelectionChanged(_ item: Int)
    /// Selected count or total changed.
    func storeSummaryChanged()
    /// Stream status or checkpoint digest texts changed.
    func storeChromeChanged()
}

/// UI-facing state of one session: wraps `StateModel`, notifies the native screens and forwards applied updates to
/// the open islands (`IslandHub`). Main thread only.
@MainActor
final class AppStore {
    let model: StateModel
    let labelWidth: Int
    let initialRoutes: [String]
    let initialAnchor: Int

    private(set) var status: StreamStatus = .connecting
    var digestText = "-"
    var insightsDigestText = "-"
    /// Index of the first visible List row (restoration anchor).
    var anchor: Int
    /// Cell configurations of the native List (implementation-quality counter, `ctr rows=`).
    var rowRenders = 0
    private let observers = NSHashTable<AnyObject>.weakObjects()

    init(model: StateModel, initialRoutes: [String], initialAnchor: Int) {
        self.model = model
        labelWidth = Format.labelWidth(itemCount: model.itemCount)
        self.initialRoutes = initialRoutes
        self.initialAnchor = initialAnchor
        anchor = initialAnchor
    }

    func label(_ index: Int) -> String {
        Format.itemLabel(index, width: labelWidth)
    }

    func addObserver(_ o: StoreObserver) {
        observers.add(o)
    }

    private func each(_ body: (StoreObserver) -> Void) {
        for case let o as StoreObserver in observers.allObjects { body(o) }
    }

    func offer(seq: Int, item: Int, v0: Int, v1: Int, v2: Int) -> StateModel.Offer {
        let result = model.offer(seq: seq, item: item, v0: v0, v1: v1, v2: v2)
        if result == .applied {
            each { $0.storeRowChanged(item) }
            if model.selection[item] >= 0 { each { $0.storeSummaryChanged() } }
            IslandHub.shared.onApplied(seq: seq, item: item, v0: v0, v1: v1, v2: v2)
        }
        return result
    }

    func toggle(item: Int, option: Int) {
        model.toggle(item: item, option: option)
        each { $0.storeSelectionChanged(item) }
        each { $0.storeSummaryChanged() }
        BenchKit.selectionChanged()
    }

    func setStatus(_ s: StreamStatus) {
        guard s != status else { return }
        status = s
        each { $0.storeChromeChanged() }
    }

    func chromeChanged() {
        each { $0.storeChromeChanged() }
    }
}
