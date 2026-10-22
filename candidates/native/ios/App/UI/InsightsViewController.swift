import MobileBenchCore
import UIKit

/// Insights (design §8.1, §8.10), embedded only: no remote-loading mechanism (design §14.7 note 4). Computed once
/// when the screen opens; the digest element updates at checkpoints.
final class InsightsViewController: ScreenViewController {
    private let topTitle = UILabel()
    private let top = UILabel()
    private let bucketsTitle = UILabel()
    private let buckets = UILabel()
    private let source = UILabel()
    private let digest = UILabel()
    private let probe = ProbeView(color: Palette.background)

    init(store: AppStore) {
        super.init(store: store, route: "insights")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Insights"
        view.accessibilityIdentifier = "mb.screen.insights"
        let insights = store.model.insights()
        topTitle.text = "Top 5 by Option A"
        bucketsTitle.text = "Option B distribution"
        for l in [topTitle, bucketsTitle] {
            l.font = Fonts.label
            l.textColor = Palette.text
        }
        top.numberOfLines = 0
        top.text = zip(insights.topItems, insights.topValues)
            .map { "\(store.label($0)) \u{00B7} A \(Format.value($1))" }
            .joined(separator: "\n")
        top.accessibilityIdentifier = "mb.insights.top"
        buckets.text = insights.buckets.map { String($0) }.joined(separator: ", ")
        buckets.accessibilityIdentifier = "mb.insights.buckets"
        source.text = "Source: embedded"
        source.accessibilityIdentifier = "mb.insights.source"
        for l in [top, buckets, source] {
            l.font = Fonts.body
            l.textColor = Palette.text
        }
        digest.font = Fonts.tiny
        digest.textColor = Palette.faint
        digest.accessibilityIdentifier = "mb.insights.digest"
        digest.text = store.insightsDigestText
        probe.onDraw = { BenchKit.insightsDrawn() }
        for v in [probe, topTitle, top, bucketsTitle, buckets, source, digest] {
            content.addSubview(v)
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        store.insightsVisible = true
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        store.insightsVisible = false
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = content.bounds.width - 32
        var y: CGFloat = 8
        probe.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        topTitle.frame = CGRect(x: 16, y: y, width: w, height: 22)
        y += 24
        let topHeight = ceil(top.sizeThatFits(CGSize(width: w, height: 400)).height)
        top.frame = CGRect(x: 16, y: y, width: w, height: topHeight)
        y += topHeight + 12
        bucketsTitle.frame = CGRect(x: 16, y: y, width: w, height: 22)
        y += 24
        buckets.frame = CGRect(x: 16, y: y, width: w, height: 20)
        y += 32
        source.frame = CGRect(x: 16, y: y, width: w, height: 20)
        y += 22
        digest.frame = CGRect(x: 16, y: y, width: w, height: 12)
    }

    override func storeChromeChanged() {
        super.storeChromeChanged()
        if digest.text != store.insightsDigestText { digest.text = store.insightsDigestText }
    }
}
