import MobileBenchCore
import UIKit

/// List screen (design §8.1, §8.2): header 56 (navigation bar), status row 32, summary bar 48, `UITableView` with
/// a diffable data source and 72 pt rows; value updates reconfigure the visible cell of the item.
/// Summary bar (48 pt): `Selected <count> · Total <fmt(total)>` plus the summary probe. It lays out its own labels,
/// so their frames always follow the bar's current bounds.
final class SummaryBarView: UIView {
    let count = UILabel()
    private let separatorLabel = UILabel()
    let total = UILabel()
    let probe = ProbeView(color: Palette.background)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Palette.background
        accessibilityIdentifier = "mb.summary"
        for l in [count, separatorLabel, total] {
            l.font = Fonts.body
            l.textColor = Palette.text
            addSubview(l)
        }
        count.accessibilityIdentifier = "mb.summary.count"
        total.accessibilityIdentifier = "mb.summary.total"
        separatorLabel.text = " \u{00B7} "
        addSubview(probe)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func update(selected: Int, total value: Int) {
        count.text = "Selected \(selected)"
        total.text = "Total \(Format.value(value))"
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let h = bounds.height
        var x: CGFloat = 16
        for l in [count, separatorLabel, total] {
            let w = ceil(l.sizeThatFits(CGSize(width: 400, height: h)).width)
            l.frame = CGRect(x: x, y: 0, width: w, height: h)
            x += w
        }
        probe.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
    }
}

final class ListViewController: ScreenViewController, UITableViewDelegate {
    private let summary = SummaryBarView()
    private let tableView = UITableView(frame: .zero, style: .plain)
    private var dataSource: UITableViewDiffableDataSource<Int, Int>!
    private lazy var selectionItem = UIBarButtonItem(
        title: "Selection (0)", style: .plain, target: self, action: #selector(openSelection))
    private lazy var insightsItem = UIBarButtonItem(
        title: "Insights", style: .plain, target: self, action: #selector(openInsights))
    private var reportedLayout = false
    private var pendingAnchor: Int?

    init(store: AppStore) {
        super.init(store: store, route: "list")
        pendingAnchor = store.initialAnchor > 0 ? store.initialAnchor : nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Items"
        selectionItem.accessibilityIdentifier = "mb.nav.selection"
        insightsItem.accessibilityIdentifier = "mb.nav.insights"
        navigationItem.rightBarButtonItems = [insightsItem, selectionItem]
        view.accessibilityIdentifier = "mb.screen.list"

        summary.translatesAutoresizingMaskIntoConstraints = false
        summary.probe.onDraw = { BenchKit.summaryDrawn() }
        BenchKit.summaryProbe = summary.probe

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.accessibilityIdentifier = "mb.list"
        tableView.rowHeight = 72
        tableView.estimatedRowHeight = 72
        tableView.separatorStyle = .none
        tableView.backgroundColor = Palette.background
        tableView.contentInsetAdjustmentBehavior = .never
        tableView.register(ItemCell.self, forCellReuseIdentifier: ItemCell.reuseId)
        tableView.delegate = self
        content.addSubview(summary)
        content.addSubview(tableView)
        NSLayoutConstraint.activate([
            summary.topAnchor.constraint(equalTo: content.topAnchor),
            summary.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            summary.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            summary.heightAnchor.constraint(equalToConstant: 48),
            tableView.topAnchor.constraint(equalTo: summary.bottomAnchor),
            tableView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])

        let store = self.store
        dataSource = UITableViewDiffableDataSource<Int, Int>(tableView: tableView) { [weak self] tv, indexPath, item in
            let cell = tv.dequeueReusableCell(withIdentifier: ItemCell.reuseId, for: indexPath) as! ItemCell
            cell.configure(store, index: item)
            cell.onToggle = { i, o in store.toggle(item: i, option: o) }
            cell.onOpen = { i in self?.openDetail(i) }
            return cell
        }
        var snapshot = NSDiffableDataSourceSnapshot<Int, Int>()
        snapshot.appendSections([0])
        snapshot.appendItems(Array(0..<store.model.itemCount))
        dataSource.apply(snapshot, animatingDifferences: false)
        updateSummary()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // The summary bar and the table are subviews of `content`; UIKit applies their frames in content's own
        // layout pass after this callback. Lay them out now so the sizes read below are current.
        content.layoutIfNeeded()
        if let anchor = pendingAnchor, tableView.bounds.height > 0 {
            pendingAnchor = nil
            tableView.scrollToRow(at: IndexPath(row: anchor, section: 0), at: .top, animated: false)
        }
        if !reportedLayout, headerSettled, tableView.bounds.height > 0 {
            reportedLayout = true
            BenchKit.listLayout(Int(tableView.bounds.height.rounded(.down)))
        }
    }

    private func updateSummary() {
        let m = store.model
        summary.update(selected: m.selectedCount, total: m.total)
        selectionItem.title = "Selection (\(m.selectedCount))"
    }

    private func reconfigureIfVisible(_ item: Int) {
        guard tableView.indexPathsForVisibleRows?.contains(IndexPath(row: item, section: 0)) == true else { return }
        var snapshot = dataSource.snapshot()
        snapshot.reconfigureItems([item])
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    override func storeRowChanged(_ item: Int) {
        reconfigureIfVisible(item)
    }

    override func storeSelectionChanged(_ item: Int) {
        reconfigureIfVisible(item)
    }

    override func storeSummaryChanged() {
        updateSummary()
    }

    // MARK: navigation

    private func openDetail(_ index: Int) {
        guard navigationController?.topViewController === self else { return }
        navigationController?.pushViewController(DetailViewController(store: store, index: index), animated: true)
    }

    @objc private func openSelection() {
        guard navigationController?.topViewController === self else { return }
        navigationController?.pushViewController(SelectionViewController(store: store), animated: true)
    }

    @objc private func openInsights() {
        guard navigationController?.topViewController === self else { return }
        BenchKit.insightsRequested()
        navigationController?.pushViewController(InsightsViewController(store: store), animated: true)
    }

    // MARK: UIScrollViewDelegate

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        store.anchor = max(0, min(store.model.itemCount - 1, Int(scrollView.contentOffset.y / 72)))
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { BenchKit.mark("scroll.idle") }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        BenchKit.mark("scroll.idle")
    }
}
