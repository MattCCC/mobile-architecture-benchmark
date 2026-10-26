// XCUITest command server for the iOS acceptance driver (tools/acceptance/ios.mjs). The simulator shares the host file
// system, so the driver writes cmd-<n>.json into $MB_DIR and this test answers with res-<n>.json. It only executes
// UI primitives; every acceptance decision is made by tools/acceptance/checks.mjs.
//
// Ops: launch {bundle, args}, activate {bundle}, terminate {bundle}, home, tap {bundle, x, y} (points),
//      snapshot {bundle} -> {tree}, quit.
import XCTest

final class CommandServer: XCTestCase {
    private var apps: [String: XCUIApplication] = [:]

    private func app(_ bundle: String) -> XCUIApplication {
        if let existing = apps[bundle] { return existing }
        let created = XCUIApplication(bundleIdentifier: bundle)
        apps[bundle] = created
        return created
    }

    func testServe() throws {
        continueAfterFailure = true
        executionTimeAllowance = 4 * 60 * 60
        let dir = URL(fileURLWithPath: try XCTUnwrap(ProcessInfo.processInfo.environment["MB_DIR"]))
        try Data("ready\n".utf8).write(to: dir.appendingPathComponent("server-ready"))
        var n = 0
        while true {
            let cmdURL = dir.appendingPathComponent("cmd-\(n).json")
            guard let data = try? Data(contentsOf: cmdURL),
                let cmd = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                let op = cmd["op"] as? String
            else {
                Thread.sleep(forTimeInterval: 0.02)
                continue
            }
            var res: [String: Any] = ["ok": true]
            let bundle = cmd["bundle"] as? String ?? ""
            switch op {
            case "launch":
                let a = app(bundle)
                a.launchArguments = cmd["args"] as? [String] ?? []
                a.launch()
            case "activate":
                app(bundle).activate()
            case "terminate":
                app(bundle).terminate()
            case "home":
                XCUIDevice.shared.press(.home)
            case "tap":
                let x = cmd["x"] as? Double ?? 0
                let y = cmd["y"] as? Double ?? 0
                app(bundle).coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y)).tap()
            case "snapshot":
                do {
                    res["tree"] = serialize(try app(bundle).snapshot())
                } catch {
                    res = ["ok": false, "error": "\(error)"]
                }
            case "quit":
                try write(res, to: dir.appendingPathComponent("res-\(n).json"))
                return
            default:
                res = ["ok": false, "error": "unknown op \(op)"]
            }
            try write(res, to: dir.appendingPathComponent("res-\(n).json"))
            n += 1
        }
    }

    private func serialize(_ s: XCUIElementSnapshot) -> [String: Any] {
        var value = ""
        if let v = s.value { value = "\(v)" }
        return [
            "id": s.identifier,
            "label": s.label,
            "value": value,
            "selected": s.isSelected,
            "type": s.elementType.rawValue,
            "frame": [s.frame.minX, s.frame.minY, s.frame.maxX, s.frame.maxY],
            "children": s.children.map(serialize),
        ]
    }

    private func write(_ object: [String: Any], to url: URL) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        let tmp = url.appendingPathExtension("tmp")
        try data.write(to: tmp)
        _ = try FileManager.default.replaceItemAt(url, withItemAt: tmp)
    }
}
