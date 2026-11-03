import MobileBenchCore
import UIKit

/// List content and its draw probes belong to the island runtime; navigation remains native.
final class ListViewController: IslandViewController {
    private lazy var selectionItem = UIBarButtonItem(
        title: "Selection (0)", style: .plain, target: self, action: #selector(openSelection))
    private lazy var insightsItem = UIBarButtonItem(
        title: "Insights", style: .plain, target: self, action: #selector(openInsights))

    init(store: AppStore) { super.init(store: store, kind: .list, index: 0) }

    override func viewDidLoad() {
        super.viewDidLoad()
        selectionItem.accessibilityIdentifier = "mb.nav.selection"
        insightsItem.accessibilityIdentifier = "mb.nav.insights"
        navigationItem.rightBarButtonItems = [insightsItem, selectionItem]
        storeSummaryChanged()
    }

    override func storeSummaryChanged() {
        selectionItem.title = "Selection (\(store.model.selectedCount))"
    }

    @objc private func openSelection() {
        guard navigationController?.topViewController === self else { return }
        navigationController?.pushViewController(SelectionViewController(store: store), animated: true)
    }

    @objc private func openInsights() {
        guard navigationController?.topViewController === self else { return }
        BenchKit.insightsRequested()
        navigationController?.pushViewController(IslandViewController(store: store, kind: .insights, index: 0), animated: true)
    }
}
