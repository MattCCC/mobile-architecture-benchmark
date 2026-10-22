import XCTest

/// Pre-harness smoke journey of the native iOS candidate (black box, XCUITest). It drives the same steps as the
/// Android emulator smoke script and prints observations as `SMOKE <key> <value>` lines; the host-side check
/// compares them, and the app's marker files, with the reference model. The core acceptance suite (`drivers/ios`,
/// design §9) supersedes this test.
final class SmokeUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @MainActor
    private func wait(_ e: XCUIElement, _ timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "missing \(e)", file: file, line: line)
    }

    @MainActor
    private func waitGone(_ e: XCUIElement, _ timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let end = Date().addingTimeInterval(timeout)
        while e.exists && Date() < end { usleep(100_000) }
        XCTAssertFalse(e.exists, "still present: \(e)", file: file, line: line)
    }

    /// Polls the element's label until it equals `text` (UI updates are asynchronous) and returns the last label.
    @MainActor
    @discardableResult
    private func waitLabel(_ e: XCUIElement, _ text: String, _ timeout: TimeInterval = 5) -> String {
        let end = Date().addingTimeInterval(timeout)
        var label = e.label
        while label != text && Date() < end {
            usleep(100_000)
            label = e.label
        }
        return label
    }

    private func report(_ key: String, _ value: String) {
        print("SMOKE \(key) \(value.replacingOccurrences(of: "\n", with: "|"))")
    }

    @MainActor
    private func back(_ app: XCUIApplication) {
        let b = element(app, "mb.nav.back")
        if b.exists && b.isHittable {
            b.tap()
        } else {
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
    }

    /// Identifier of the k-th fully visible list cell from the top (0-based). UITableView exposes an accessibility
    /// element for every row, so this reads one snapshot of the table instead of querying each cell.
    @MainActor
    private func visibleCell(_ app: XCUIApplication, _ k: Int) -> String {
        guard let table = try? element(app, "mb.list").snapshot() else { return "" }
        let top = table.frame.minY - 0.5
        let bottom = table.frame.maxY + 0.5
        let cells = table.children
            .filter { $0.elementType == .cell && $0.frame.minY >= top && $0.frame.maxY <= bottom }
            .sorted { $0.frame.minY < $1.frame.minY }
        return k < cells.count ? cells[k].identifier : ""
    }

    @MainActor
    func testSmokeJourney() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-mb.markerMirror", "all", "-mb.journey", "smoke-ui"]
        app.launch()

        // List: ids and texts (design §8.12)
        wait(element(app, "mb.screen.list"), 30)
        let optA = element(app, "mb.row.1.opt.a")
        wait(optA)
        for id in [
            "mb.list", "mb.summary", "mb.summary.count", "mb.summary.total", "mb.nav.selection", "mb.nav.insights",
            "mb.stream.status", "mb.state.digest", "mb.row.0", "mb.row.0.label", "mb.row.0.opt.a", "mb.row.0.opt.b",
            "mb.row.0.opt.c",
        ] {
            report("exists \(id)", element(app, id).exists ? "1" : "0")
        }
        report("row0-label", element(app, "mb.row.0.label").label)
        report("row0-opt-a", element(app, "mb.row.0.opt.a").label)
        report("status", element(app, "mb.stream.status").label)
        report("summary-count-start", element(app, "mb.summary.count").label)
        report("row1-opt-a-selected-before", optA.isSelected ? "1" : "0")

        // Selection rule: tap A of item 1
        optA.tap()
        report("summary-count-after-tap", waitLabel(element(app, "mb.summary.count"), "Selected 51"))
        report("row1-opt-a-selected-after", element(app, "mb.row.1.opt.a").isSelected ? "1" : "0")
        report("row1-opt-b-selected-after", element(app, "mb.row.1.opt.b").isSelected ? "1" : "0")
        report("nav-selection-label", element(app, "mb.nav.selection").label)

        // Selection screen and back
        element(app, "mb.nav.selection").tap()
        let selection = element(app, "mb.screen.selection")
        wait(selection)
        report("exists mb.nav.back", element(app, "mb.nav.back").exists ? "1" : "0")
        back(app)
        waitGone(selection)

        // Detail with the animated panel
        element(app, "mb.row.3.label").tap()
        let detail = element(app, "mb.screen.detail")
        wait(detail)
        report("detail-value-a", element(app, "mb.detail.values.a").label)
        let toggle = element(app, "mb.detail.panel.toggle")
        toggle.tap()
        wait(element(app, "mb.detail.panel"), 5)
        report("detail-toggle-after-show", toggle.label)
        sleep(1)
        toggle.tap()
        waitGone(element(app, "mb.detail.panel"), 5)
        report("detail-panel-after-hide", element(app, "mb.detail.panel").exists ? "1" : "0")
        back(app)
        waitGone(detail)

        // Insights
        element(app, "mb.nav.insights").tap()
        let insights = element(app, "mb.screen.insights")
        wait(insights)
        report("insights-source", element(app, "mb.insights.source").label)
        for id in ["mb.insights.top", "mb.insights.buckets", "mb.insights.digest"] {
            report("exists \(id)", element(app, id).exists ? "1" : "0")
        }
        back(app)
        waitGone(insights)

        // Background, foreground, scroll, open a Detail, background again, kill
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.activate()
        sleep(4)
        report("status-after-foreground", element(app, "mb.stream.status").label)
        element(app, "mb.list").swipeUp()
        sleep(3)
        let cellId = visibleCell(app, 2)
        report("restore-tap", cellId)
        element(app, "\(cellId).label").tap()
        wait(element(app, "mb.screen.detail"))
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.terminate()

        // Relaunch with mb.restore=1: Detail first, then back to List with the anchor row at the top
        app.launchArguments = ["-mb.markerMirror", "all", "-mb.journey", "smoke-ui-2", "-mb.restore", "1"]
        app.launch()
        wait(element(app, "mb.screen.detail"), 30)
        report("restored-screen", "detail")
        report("restored-heading", app.navigationBars.firstMatch.identifier)
        back(app)
        wait(element(app, "mb.screen.list"))
        sleep(1)
        report("restored-top", visibleCell(app, 0))
        report("restored-summary-count", element(app, "mb.summary.count").label)
        XCUIDevice.shared.press(.home)
        sleep(3)
        app.terminate()
    }
}
