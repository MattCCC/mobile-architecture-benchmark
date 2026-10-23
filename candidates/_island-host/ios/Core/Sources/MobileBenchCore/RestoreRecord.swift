import Foundation

public struct RestoreError: Error, CustomStringConvertible, Sendable {
    public let description: String
    public init(_ description: String) { self.description = description }
}

/// Restoration record v2 (design §8.8):
/// `{"v":2,"route":["list","detail/21"],"anchor":20,"selection":[[i,o],...],"lastSeq":n,"values":[[a,b,c],...]}`
public struct RestoreRecord: Sendable, Equatable {
    public let route: [String]
    public let anchor: Int
    /// (item, option) pairs sorted by item index.
    public let selection: [(Int, Int)]
    public let lastSeq: Int
    /// Flat values, item i option o at i * 3 + o.
    public let values: [Int]

    public init(route: [String], anchor: Int, selection: [(Int, Int)], lastSeq: Int, values: [Int]) {
        self.route = route
        self.anchor = anchor
        self.selection = selection
        self.lastSeq = lastSeq
        self.values = values
    }

    public static func == (a: RestoreRecord, b: RestoreRecord) -> Bool {
        a.route == b.route && a.anchor == b.anchor && a.lastSeq == b.lastSeq && a.values == b.values
            && a.selection.map { [$0.0, $0.1] } == b.selection.map { [$0.0, $0.1] }
    }

    public static func capture(_ model: StateModel, route: [String], anchor: Int) -> RestoreRecord {
        RestoreRecord(
            route: route, anchor: anchor,
            selection: model.selectedItems().map { ($0, model.selection[$0]) },
            lastSeq: model.lastAppliedSeq, values: model.values)
    }

    /// Compact canonical JSON with a trailing LF (fixed key order, integers only).
    public func serialize() -> String {
        var s = "{\"v\":2,\"route\":["
        s += route.map { "\"\($0)\"" }.joined(separator: ",")
        s += "],\"anchor\":\(anchor),\"selection\":["
        s += selection.map { "[\($0.0),\($0.1)]" }.joined(separator: ",")
        s += "],\"lastSeq\":\(lastSeq),\"values\":["
        var rows = [String]()
        rows.reserveCapacity(values.count / 3)
        var i = 0
        while i + 2 < values.count {
            rows.append("[\(values[i]),\(values[i + 1]),\(values[i + 2])]")
            i += 3
        }
        s += rows.joined(separator: ",")
        s += "]}\n"
        return s
    }

    public static func isValidRoute(_ r: String, itemCount: Int) -> Bool {
        if r == "list" || r == "selection" || r == "insights" { return true }
        guard r.hasPrefix("detail/") else { return false }
        let digits = r.dropFirst("detail/".count)
        guard !digits.isEmpty, digits.count <= 7, digits.allSatisfy({ $0.isASCII && $0.isNumber }),
            !(digits.count > 1 && digits.first == "0"), let i = Int(digits)
        else { return false }
        return i < itemCount
    }

    public static func parse(_ data: Data, itemCount: Int) throws -> RestoreRecord {
        guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw RestoreError("record is not a JSON object")
        }
        guard let v = root["v"] as? Int, v == 2 else { throw RestoreError("record version is not 2") }
        guard let route = root["route"] as? [String], route.first == "list",
            route.allSatisfy({ isValidRoute($0, itemCount: itemCount) })
        else { throw RestoreError("invalid route") }
        guard let anchor = root["anchor"] as? Int, (0..<itemCount).contains(anchor) else {
            throw RestoreError("anchor out of range")
        }
        guard let sel = root["selection"] as? [[Int]] else { throw RestoreError("invalid selection") }
        var seen = Set<Int>()
        var selection = [(Int, Int)]()
        for e in sel {
            guard e.count == 2, (0..<itemCount).contains(e[0]), (0...2).contains(e[1]), !seen.contains(e[0]) else {
                throw RestoreError("invalid selection entry")
            }
            seen.insert(e[0])
            selection.append((e[0], e[1]))
        }
        guard let lastSeq = root["lastSeq"] as? Int, lastSeq >= 0 else { throw RestoreError("invalid lastSeq") }
        guard let rows = root["values"] as? [[Int]], rows.count == itemCount else {
            throw RestoreError("values do not match the fixture")
        }
        var values = [Int]()
        values.reserveCapacity(itemCount * 3)
        for row in rows {
            guard row.count == 3, row.allSatisfy({ Fixture.valueRange.contains($0) }) else {
                throw RestoreError("invalid values row")
            }
            values.append(contentsOf: row)
        }
        return RestoreRecord(
            route: route, anchor: anchor, selection: selection.sorted { $0.0 < $1.0 }, lastSeq: lastSeq,
            values: values)
    }
}
