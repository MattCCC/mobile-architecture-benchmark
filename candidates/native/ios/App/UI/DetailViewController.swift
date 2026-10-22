import MobileBenchCore
import UIKit

/// Detail screen (design §8.1, §8.7): item label, group, three live values, toggle and the animated info panel
/// (300 ms, cubic-bezier(0.42, 0, 0.58, 1), translateY +240 pt and opacity, `UIViewPropertyAnimator`).
final class DetailViewController: ScreenViewController {
    private let index: Int
    private let heading = UILabel()
    private let group = UILabel()
    private let values = (0..<3).map { _ in UILabel() }
    private let toggle = UIButton(type: .system)
    private let panel = UIView()
    private let panelTitle = UILabel()
    private let panelBody = UILabel()
    private let footer = UILabel()
    private var shown = false
    private var animator: UIViewPropertyAnimator?

    init(store: AppStore, index: Int) {
        self.index = index
        super.init(store: store, route: "detail/\(index)")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = store.label(index)
        view.accessibilityIdentifier = "mb.screen.detail"
        heading.font = Fonts.title
        heading.textColor = Palette.text
        heading.text = store.label(index)
        group.font = Fonts.group
        group.textColor = Palette.secondary
        group.text = "Group \(store.model.groups[index])"
        let ids = ["mb.detail.values.a", "mb.detail.values.b", "mb.detail.values.c"]
        for (o, l) in values.enumerated() {
            l.font = Fonts.label
            l.textColor = Palette.text
            l.accessibilityIdentifier = ids[o]
        }
        toggle.setTitle("Show details", for: .normal)
        toggle.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        toggle.contentHorizontalAlignment = .leading
        toggle.accessibilityIdentifier = "mb.detail.panel.toggle"
        toggle.addTarget(self, action: #selector(togglePanel), for: .touchUpInside)
        panel.backgroundColor = Palette.neutral
        panel.layer.cornerRadius = 8
        panel.accessibilityIdentifier = "mb.detail.panel"
        panel.isHidden = true
        panel.alpha = 0
        panelTitle.font = Fonts.label
        panelTitle.textColor = Palette.text
        panelTitle.text = "Details of \(store.label(index))"
        panelBody.font = Fonts.body
        panelBody.textColor = Palette.text
        panelBody.numberOfLines = 0
        panel.addSubview(panelTitle)
        panel.addSubview(panelBody)
        footer.font = Fonts.tiny
        footer.textColor = Palette.faint
        footer.text = "Build \(BuildProbe.value)"
        for v in [heading, group] + values + [toggle, panel, footer] {
            content.addSubview(v)
        }
        updateValues()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = content.bounds.width - 32
        var y: CGFloat = 8
        heading.frame = CGRect(x: 16, y: y, width: w, height: 26)
        y += 26
        group.frame = CGRect(x: 16, y: y, width: w, height: 20)
        y += 32
        for l in values {
            l.frame = CGRect(x: 16, y: y, width: w, height: 22)
            y += 22
        }
        y += 16
        toggle.frame = CGRect(x: 16, y: y, width: w, height: 44)
        y += 44
        panelTitle.frame = CGRect(x: 16, y: 16, width: w - 32, height: 22)
        let bodyHeight = ceil(panelBody.sizeThatFits(CGSize(width: w - 32, height: 200)).height)
        panelBody.frame = CGRect(x: 16, y: 42, width: w - 32, height: bodyHeight)
        panel.bounds = CGRect(x: 0, y: 0, width: w, height: 58 + bodyHeight)
        panel.center = CGPoint(x: 16 + w / 2, y: y + panel.bounds.height / 2)
        footer.frame = CGRect(x: 16, y: content.bounds.height - 20, width: w, height: 14)
    }

    private func updateValues() {
        let m = store.model
        for (o, l) in values.enumerated() { l.text = Format.optionText(o, m.value(index, o)) }
        panelBody.text = "Group \(m.groups[index]) \u{00B7} " + (0..<3).map { Format.optionText($0, m.value(index, $0)) }
            .joined(separator: " \u{00B7} ")
    }

    override func storeRowChanged(_ item: Int) {
        if item == index { updateValues() }
    }

    @objc private func togglePanel() {
        shown.toggle()
        toggle.setTitle(shown ? "Hide details" : "Show details", for: .normal)
        let show = shown
        BenchKit.mark("anim.start", show ? "dir=show" : "dir=hide")
        animator?.stopAnimation(true)
        if show {
            panel.isHidden = false
            if panel.alpha == 0 { panel.transform = CGAffineTransform(translationX: 0, y: 240) }
        }
        let timing = UICubicTimingParameters(
            controlPoint1: CGPoint(x: 0.42, y: 0), controlPoint2: CGPoint(x: 0.58, y: 1))
        let a = UIViewPropertyAnimator(duration: 0.3, timingParameters: timing)
        a.addAnimations { [panel] in
            panel.transform = show ? .identity : CGAffineTransform(translationX: 0, y: 240)
            panel.alpha = show ? 1 : 0
        }
        a.addCompletion { [weak self] position in
            MainActor.assumeIsolated {
                guard let self else { return }
                if position == .end {
                    BenchKit.mark("anim.end", show ? "dir=show" : "dir=hide")
                    if !show { self.panel.isHidden = true }
                }
            }
        }
        animator = a
        a.startAnimation()
    }
}
