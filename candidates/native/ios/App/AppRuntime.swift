import Foundation
import MobileBenchCore
import UIKit

/// Process-wide session orchestration (design §8.3, §8.8): fixture loading, optional restoration, stream start
/// after FUI / restore / resume, checkpoints and the background restoration record.
@MainActor
final class AppRuntime: NSObject, BenchKitListener, UINavigationControllerDelegate {
    static let shared = AppRuntime()

    private static let rates = ["small": 5, "representative": 20, "stress": 100]

    private(set) var store: AppStore?
    private var stream: StreamController?
    private(set) var fatalError: String?
    private weak var navigation: UINavigationController?
    /// The stream may connect only after FUI or after the restored screen was drawn (design §7.5, §8.8).
    private var streamAllowed = false
    private var restored = false

    func start() {
        BenchKit.listener = self
        BenchKit.stateProvider = { [weak self] in
            guard let m = self?.store?.model else { return (0, 0, 0) }
            return (m.selectedCount, m.lastAppliedSeq, m.selectionRevision)
        }
        BenchKit.start(arguments: ProcessInfo.processInfo.arguments)
        let config = BenchKit.config
        guard config.isValid else {
            fail("launch-config-invalid")
            return
        }
        let fixture: Fixture
        do {
            guard let url = Bundle.main.url(forResource: config.profile, withExtension: "json", subdirectory: "fixtures")
            else { throw FixtureError("fixture asset missing") }
            fixture = try Fixture.parse(Data(contentsOf: url), expectedProfile: config.profile)
        } catch {
            fail("fixture-invalid")
            return
        }
        let model = StateModel(profile: config.profile, fixture: fixture)
        var routes = ["list"]
        var anchor = 0
        if config.restore {
            do {
                let record = try RestoreRecord.parse(Data(contentsOf: recordURL()), itemCount: fixture.itemCount)
                model.restore(record)
                routes = record.route
                anchor = record.anchor
                restored = true
            } catch {
                BenchKit.err("persist-read")
            }
        }
        let s = AppStore(model: model, initialRoutes: routes, initialAnchor: anchor)
        store = s
        guard let streamURL = Bundle.main.url(
            forResource: "stream-\(config.profile)", withExtension: "jsonl", subdirectory: "fixtures")
        else {
            fail("fixture-invalid")
            return
        }
        let source = ReplaySource(url: streamURL, ratePerSecond: Self.rates[config.profile] ?? 20)
        stream = StreamController(store: s, source: source) { [weak self] k in self?.checkpoint(k) }
        if restored {
            BenchKit.disarmFuiGate()
            BenchKit.setPendingRestore(route: routes.last ?? "list", anchor: anchor)
        } else {
            BenchKit.armFuiGate(itemCount: model.itemCount)
        }
        if config.journeyMode {
            UIApplication.shared.isIdleTimerDisabled = true
        }
    }

    private func fail(_ code: String) {
        fatalError = code
        BenchKit.err(code)
    }

    /// Root view controller: the navigation stack of the session (restored stack built without animation).
    func makeRootViewController() -> UIViewController {
        guard let store, fatalError == nil else {
            return ErrorViewController(code: fatalError ?? "unexpected-exception")
        }
        var controllers: [UIViewController] = [ListViewController(store: store)]
        for route in store.initialRoutes.dropFirst() {
            if route == "selection" {
                controllers.append(SelectionViewController(store: store))
            } else if route == "insights" {
                controllers.append(InsightsViewController(store: store))
            } else if route.hasPrefix("detail/"), let i = Int(route.dropFirst("detail/".count)) {
                controllers.append(DetailViewController(store: store, index: i))
            }
        }
        let nav = UINavigationController()
        nav.delegate = self
        nav.navigationBar.prefersLargeTitles = false
        nav.setViewControllers(controllers, animated: false)
        navigation = nav
        // Initial top route (navSeq 0), independent of whether the delegate is told about the first appearance.
        if let top = controllers.last as? ScreenViewController {
            BenchKit.navigated(to: top.route)
        }
        return nav
    }

    // MARK: UINavigationControllerDelegate — transition start for push and pop (design §6.3 `screen`)

    func navigationController(
        _ navigationController: UINavigationController, willShow viewController: UIViewController, animated: Bool
    ) {
        if let screen = viewController as? ScreenViewController {
            BenchKit.navigated(to: screen.route)
        }
    }

    /// Corrects the top route after a cancelled interactive pop (willShow announced a pop that did not happen).
    func navigationController(
        _ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool
    ) {
        if let screen = viewController as? ScreenViewController {
            BenchKit.navigated(to: screen.route)
        }
    }

    // MARK: BenchKitListener

    func benchFui() {
        streamAllowed = true
        stream?.connect()
    }

    func benchRestoreDrawn() {
        streamAllowed = true
        stream?.connect()
    }

    func benchResumeDrawn() {
        if streamAllowed { stream?.connect() }
    }

    func benchForeground(fgSeq: Int) {}

    func benchBackground() {
        guard let store else { return }
        writeRecord(store)
        stream?.close("background")
        checkpoint(0)
    }

    /// Checkpoint (design §6.6): digest, counters, memory, digest element texts.
    func checkpoint(_ k: Int) {
        guard let store else { return }
        let m = store.model
        let digest = m.stateDigest()
        store.digestText = "k=\(k);seq=\(m.lastAppliedSeq);d=\(digest.prefix(12))"
        if store.insightsVisible {
            store.insightsDigestText = String(m.insights().digest().prefix(12))
        }
        store.chromeChanged()
        BenchKit.publishState(
            k: k, seq: m.lastAppliedSeq, digest: digest, received: m.received, applied: m.applied,
            dup: m.duplicates, gap: m.gaps, rows: store.rowRenders)
    }

    private func recordURL() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appendingPathComponent("mobilebench/restore-v2.json")
    }

    private func routeStack() -> [String] {
        let routes = (navigation?.viewControllers ?? []).compactMap { ($0 as? ScreenViewController)?.route }
        return routes.isEmpty ? ["list"] : routes
    }

    private func writeRecord(_ store: AppStore) {
        do {
            let url = try recordURL()
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let record = RestoreRecord.capture(store.model, route: routeStack(), anchor: store.anchor)
            // .atomic writes to a temporary file and renames it into place.
            try Data(record.serialize().utf8).write(to: url, options: .atomic)
        } catch {
            BenchKit.err("persist-write")
        }
    }
}
