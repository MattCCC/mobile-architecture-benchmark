import MobileBenchCore
import UIKit

/// Selection screen (design §8.1): selected entries `Item 042 · Option B — 12.34` with live values, and the total.
final class SelectionViewController: ScreenViewController {
    private let totalLabel = UILabel()
    private let tableView = UITableView(frame: .zero, style: .plain)
    private var dataSource: UITableViewDiffableDataSource<Int, Int>!

    init(store: AppStore) {
        super.init(store: store, route: "selection")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Selection"
        view.accessibilityIdentifier = "mb.screen.selection"
        totalLabel.translatesAutoresizingMaskIntoConstraints = false
        totalLabel.font = Fonts.body
        totalLabel.textColor = Palette.text
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.rowHeight = 48
        tableView.separatorStyle = .none
        tableView.backgroundColor = Palette.background
        tableView.contentInsetAdjustmentBehavior = .never
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "entry")
        content.addSubview(totalLabel)
        content.addSubview(tableView)
        NSLayoutConstraint.activate([
            totalLabel.topAnchor.constraint(equalTo: content.topAnchor),
            totalLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            totalLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            totalLabel.heightAnchor.constraint(equalToConstant: 48),
            tableView.topAnchor.constraint(equalTo: totalLabel.bottomAnchor),
            tableView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        let store = self.store
        dataSource = UITableViewDiffableDataSource<Int, Int>(tableView: tableView) { tv, indexPath, item in
            let cell = tv.dequeueReusableCell(withIdentifier: "entry", for: indexPath)
            cell.selectionStyle = .none
            cell.backgroundColor = Palette.background
            var config = cell.defaultContentConfiguration()
            let o = store.model.selection[item]
            if o >= 0 {
                config.text = "\(store.label(item)) \u{00B7} Option \(Format.optionKey(o)) \u{2014} "
                    + Format.value(store.model.value(item, o))
            }
            config.textProperties.font = Fonts.body
            config.textProperties.color = Palette.text
            cell.contentConfiguration = config
            return cell
        }
        var snapshot = NSDiffableDataSourceSnapshot<Int, Int>()
        snapshot.appendSections([0])
        snapshot.appendItems(store.model.selectedItems())
        dataSource.apply(snapshot, animatingDifferences: false)
        updateTotal()
    }

    private func updateTotal() {
        let m = store.model
        totalLabel.text = "Selected \(m.selectedCount) \u{00B7} Total \(Format.value(m.total))"
    }

    override func storeRowChanged(_ item: Int) {
        guard store.model.selection[item] >= 0,
            let row = dataSource.snapshot().indexOfItem(item),
            tableView.indexPathsForVisibleRows?.contains(IndexPath(row: row, section: 0)) == true
        else { return }
        var snapshot = dataSource.snapshot()
        snapshot.reconfigureItems([item])
        dataSource.apply(snapshot, animatingDifferences: false)
    }

    override func storeSummaryChanged() {
        updateTotal()
    }
}
