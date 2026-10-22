import MobileBenchCore
import UIKit

/// List row (design §8.2): 72 pt, label 16 pt, `Group <g>` 14 pt, three option buttons (min 48 x 36,
/// text `A 12.34`). Frame layout, so a value change only re-lays out this cell.
final class ItemCell: UITableViewCell {
    static let reuseId = "item"
    private static let optionIds = ["a", "b", "c"]

    let label = UILabel()
    let group = UILabel()
    let buttons: [UIButton] = (0..<3).map { _ in UIButton(type: .custom) }
    let probe = ProbeView(color: Palette.background)
    private(set) var index = -1
    var onToggle: ((Int, Int) -> Void)?
    var onOpen: ((Int) -> Void)?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = Palette.background
        contentView.backgroundColor = Palette.background
        label.font = Fonts.label
        label.textColor = Palette.text
        label.isUserInteractionEnabled = true
        label.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(openTapped)))
        group.font = Fonts.group
        group.textColor = Palette.secondary
        contentView.addSubview(probe)
        contentView.addSubview(label)
        contentView.addSubview(group)
        for (o, b) in buttons.enumerated() {
            b.tag = o
            b.titleLabel?.font = Fonts.body
            b.layer.cornerRadius = 6
            b.addTarget(self, action: #selector(optionTapped(_:)), for: .touchUpInside)
            contentView.addSubview(b)
        }
        probe.onDraw = { [weak self] in
            guard let self else { return }
            BenchKit.rowDrawn(self.index)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func configure(_ store: AppStore, index: Int) {
        self.index = index
        store.rowRenders += 1
        let m = store.model
        accessibilityIdentifier = "mb.row.\(index)"
        label.text = store.label(index)
        label.accessibilityIdentifier = "mb.row.\(index).label"
        group.text = "Group \(m.groups[index])"
        let selected = m.selection[index]
        for (o, b) in buttons.enumerated() {
            let on = selected == o
            b.setTitle(Format.optionText(o, m.value(index, o)), for: .normal)
            b.setTitleColor(on ? Palette.onAccent : Palette.text, for: .normal)
            b.backgroundColor = on ? Palette.accent : Palette.neutral
            b.isSelected = on
            b.accessibilityIdentifier = "mb.row.\(index).opt.\(Self.optionIds[o])"
        }
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let w = contentView.bounds.width
        let h = contentView.bounds.height
        var x = w - 16
        for b in buttons.reversed() {
            let textWidth = b.titleLabel?.sizeThatFits(CGSize(width: 120, height: 36)).width ?? 0
            let bw = max(48, ceil(textWidth) + 16)
            x -= bw
            b.frame = CGRect(x: x, y: (h - 36) / 2, width: bw, height: 36)
            x -= 8
        }
        let textWidth = max(0, x - 16)
        label.frame = CGRect(x: 16, y: h / 2 - 21, width: textWidth, height: 21)
        group.frame = CGRect(x: 16, y: h / 2 + 1, width: textWidth, height: 18)
    }

    @objc private func optionTapped(_ sender: UIButton) {
        onToggle?(index, sender.tag)
    }

    @objc private func openTapped() {
        onOpen?(index)
    }
}
