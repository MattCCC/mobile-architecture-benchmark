import MobileBenchCore
import UIKit

/// Visual specification (design §8.2): light theme, one accent colour, system default font.
enum Palette {
    static let background = UIColor.white
    static let text = UIColor(red: 0x1A / 255, green: 0x1A / 255, blue: 0x1A / 255, alpha: 1)
    static let secondary = UIColor(red: 0x5F / 255, green: 0x63 / 255, blue: 0x68 / 255, alpha: 1)
    static let neutral = UIColor(red: 0xE8 / 255, green: 0xEA / 255, blue: 0xED / 255, alpha: 1)
    static let accent = UIColor(red: 0x2F / 255, green: 0x6F / 255, blue: 0xEB / 255, alpha: 1)
    static let onAccent = UIColor.white
    static let faint = UIColor(red: 0xBD / 255, green: 0xBD / 255, blue: 0xBD / 255, alpha: 1)
}

enum Fonts {
    static let title = UIFont.systemFont(ofSize: 20, weight: .bold)
    static let label = UIFont.systemFont(ofSize: 16)
    static let group = UIFont.systemFont(ofSize: 14)
    static let body = UIFont.systemFont(ofSize: 14)
    static let chip = UIFont.systemFont(ofSize: 12)
    static let tiny = UIFont.systemFont(ofSize: 8)
}

/// Status chip row (32 pt): stream status left, the checkpoint digest element right (tiny, low contrast).
final class StatusRowView: UIView {
    let chip = PaddedLabel()
    let digest = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = Palette.background
        chip.font = Fonts.chip
        chip.textColor = Palette.text
        chip.backgroundColor = Palette.neutral
        chip.layer.cornerRadius = 10
        chip.layer.masksToBounds = true
        chip.accessibilityIdentifier = "mb.stream.status"
        digest.font = Fonts.tiny
        digest.textColor = Palette.faint
        digest.textAlignment = .right
        digest.accessibilityIdentifier = "mb.state.digest"
        addSubview(chip)
        addSubview(digest)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func update(_ store: AppStore) {
        if chip.text != store.status.rawValue {
            chip.text = store.status.rawValue
            setNeedsLayout()
        }
        if digest.text != store.digestText {
            digest.text = store.digestText
            setNeedsLayout()
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let h = bounds.height
        let chipSize = chip.sizeThatFits(CGSize(width: bounds.width / 2, height: h))
        chip.frame = CGRect(x: 16, y: (h - chipSize.height) / 2, width: chipSize.width, height: chipSize.height)
        let digestWidth = bounds.width / 2 - 16
        digest.frame = CGRect(x: bounds.width - 16 - digestWidth, y: 0, width: digestWidth, height: h)
    }
}

final class PaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 2, left: 10, bottom: 2, right: 10)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let s = super.sizeThatFits(size)
        return CGSize(width: s.width + insets.left + insets.right, height: s.height + insets.top + insets.bottom)
    }
}

/// Base screen: header band of exactly 56 pt (navigation bar + additional top safe-area inset), status chip row
/// of 32 pt, root probe for `screen` / `resume` / `restore` (design §8.2, §6.3).
class ScreenViewController: UIViewController, StoreObserver {
    let store: AppStore
    let route: String
    let statusRow = StatusRowView()
    let rootProbe = ProbeView(color: Palette.background)
    /// Content area below the status row, down to the bottom safe-area inset.
    let content = UIView()

    init(store: AppStore, route: String) {
        self.store = store
        self.route = route
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Palette.background
        navigationItem.largeTitleDisplayMode = .never
        navigationItem.backBarButtonItem = {
            let item = UIBarButtonItem(title: "Back", style: .plain, target: nil, action: nil)
            item.accessibilityIdentifier = "mb.nav.back"
            return item
        }()
        statusRow.translatesAutoresizingMaskIntoConstraints = false
        content.translatesAutoresizingMaskIntoConstraints = false
        content.backgroundColor = Palette.background
        view.addSubview(statusRow)
        view.addSubview(content)
        statusRow.addSubview(rootProbe)
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            statusRow.topAnchor.constraint(equalTo: guide.topAnchor),
            statusRow.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            statusRow.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusRow.heightAnchor.constraint(equalToConstant: 32),
            content.topAnchor.constraint(equalTo: statusRow.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
        ])
        let route = self.route
        rootProbe.onDraw = { BenchKit.rootDrawn(route: route) }
        BenchKit.registerRootProbe(rootProbe)
        store.addObserver(self)
        statusRow.update(store)
    }

    /// Header band = navigation bar + extra inset, 56 pt in total.
    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        let barHeight = navigationController?.navigationBar.frame.height ?? 0
        let extra = max(0, 56 - barHeight)
        if additionalSafeAreaInsets.top != extra {
            additionalSafeAreaInsets.top = extra
        }
    }

    var headerSettled: Bool {
        let barHeight = navigationController?.navigationBar.frame.height ?? 0
        return barHeight > 0 && additionalSafeAreaInsets.top == max(0, 56 - barHeight)
    }

    // StoreObserver: overridable in subclasses (class methods, so dynamic dispatch reaches the overrides).
    func storeRowChanged(_ item: Int) {}
    func storeSelectionChanged(_ item: Int) {}
    func storeSummaryChanged() {}

    func storeChromeChanged() {
        statusRow.update(store)
    }
}
