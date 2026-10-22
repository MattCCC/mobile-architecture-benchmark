import CryptoKit
import Foundation

public enum Sha256 {
    private static let hex: [UInt8] = Array("0123456789abcdef".utf8)

    /// Lowercase hex SHA-256 of the UTF-8 bytes of `text`.
    public static func hex(_ text: String) -> String {
        hex(Data(text.utf8))
    }

    public static func hex(_ data: Data) -> String {
        let digest = SHA256.hash(data: data)
        var out = [UInt8]()
        out.reserveCapacity(64)
        for b in digest {
            out.append(hex[Int(b >> 4)])
            out.append(hex[Int(b & 0x0f)])
        }
        return String(decoding: out, as: UTF8.self)
    }
}

/// Observable application state of one session (design §7, §8.5, §8.6): values, selection, last applied
/// update, aggregates and stream counters. Single-threaded (main thread in the app).
public final class StateModel {
    public enum Offer: Sendable { case applied, duplicate, gap }

    public let profile: String
    public let itemCount: Int
    public let groups: [Int]
    public private(set) var values: [Int]
    public private(set) var selection: [Int]

    public private(set) var lastAppliedSeq = 0
    public private(set) var selectedCount = 0
    public private(set) var total = 0
    public private(set) var selectionRevision = 0

    // Stream counters reported in the `ctr` checkpoint marker.
    public private(set) var received = 0
    public private(set) var applied = 0
    public private(set) var duplicates = 0
    public private(set) var gaps = 0

    public init(profile: String, fixture: Fixture) {
        self.profile = profile
        itemCount = fixture.itemCount
        groups = fixture.groups
        values = fixture.values
        selection = fixture.selection
        recomputeAggregates()
    }

    public func value(_ item: Int, _ option: Int) -> Int {
        values[item * 3 + option]
    }

    /// Applies update `seq` if it is the next one (client rules, design §7.5).
    public func offer(seq: Int, item: Int, v0: Int, v1: Int, v2: Int) -> Offer {
        received += 1
        if seq <= lastAppliedSeq {
            duplicates += 1
            return .duplicate
        }
        if seq > lastAppliedSeq + 1 || !(0..<itemCount).contains(item) {
            gaps += 1
            return .gap
        }
        let base = item * 3
        let sel = selection[item]
        if sel >= 0 { total -= values[base + sel] }
        values[base] = v0
        values[base + 1] = v1
        values[base + 2] = v2
        if sel >= 0 { total += values[base + sel] }
        lastAppliedSeq = seq
        applied += 1
        return .applied
    }

    /// Selection rule (design §8.5). Returns the selected option of `item` after the tap, or -1.
    @discardableResult
    public func toggle(item: Int, option: Int) -> Int {
        let current = selection[item]
        if current == option {
            selection[item] = -1
            selectedCount -= 1
            total -= value(item, option)
        } else {
            if current >= 0 {
                total -= value(item, current)
            } else {
                selectedCount += 1
            }
            selection[item] = option
            total += value(item, option)
        }
        selectionRevision += 1
        return selection[item]
    }

    /// Replaces values, selection and last seq with a restoration record (design §8.8).
    public func restore(_ record: RestoreRecord) {
        precondition(record.values.count == values.count, "record item count mismatch")
        values = record.values
        selection = [Int](repeating: -1, count: itemCount)
        for (i, o) in record.selection { selection[i] = o }
        lastAppliedSeq = record.lastSeq
        recomputeAggregates()
    }

    public func selectedItems() -> [Int] {
        (0..<itemCount).filter { selection[$0] >= 0 }
    }

    private func recomputeAggregates() {
        var count = 0
        var sum = 0
        for i in 0..<itemCount where selection[i] >= 0 {
            count += 1
            sum += values[i * 3 + selection[i]]
        }
        selectedCount = count
        total = sum
    }

    /// Canonical state text mb-state-v1 (design §7.6).
    public func stateText() -> String {
        var s = "mb-state-v1\nprofile=\(profile)\nseq=\(lastAppliedSeq)\nvalues="
        s.reserveCapacity(64 + values.count * 5)
        for (k, v) in values.enumerated() {
            if k > 0 { s += "," }
            s += String(v)
        }
        s += "\nselection="
        var first = true
        for i in 0..<itemCount where selection[i] >= 0 {
            if !first { s += "," }
            s += "\(i):\(Format.optionKey(selection[i]))"
            first = false
        }
        s += "\n"
        return s
    }

    public func stateDigest() -> String {
        Sha256.hex(stateText())
    }

    public func insights() -> Insights {
        Insights.compute(seq: lastAppliedSeq, values: values, itemCount: itemCount)
    }
}

/// Derived Insights (design §7.1, §7.6).
public struct Insights: Sendable {
    public static let top = 5

    public let seq: Int
    public let topItems: [Int]
    public let topValues: [Int]
    public let buckets: [Int]

    public static func bucket(of b: Int) -> Int {
        min(4, (b - 100) * 5 / 9900)
    }

    public static func compute(seq: Int, values: [Int], itemCount: Int) -> Insights {
        let k = min(top, itemCount)
        var items = [Int](repeating: -1, count: k)
        var vals = [Int](repeating: Int.min, count: k)
        var buckets = [Int](repeating: 0, count: 5)
        for i in 0..<itemCount {
            let a = values[i * 3]
            buckets[bucket(of: values[i * 3 + 1])] += 1
            // Insert into the sorted top list; equal values keep the lower index first.
            var pos = k
            while pos > 0 && a > vals[pos - 1] { pos -= 1 }
            if pos < k {
                var j = k - 1
                while j > pos {
                    vals[j] = vals[j - 1]
                    items[j] = items[j - 1]
                    j -= 1
                }
                vals[pos] = a
                items[pos] = i
            }
        }
        return Insights(seq: seq, topItems: items, topValues: vals, buckets: buckets)
    }

    public func text() -> String {
        let top = zip(topItems, topValues).map { "\($0):\($1)" }.joined(separator: ",")
        let b = buckets.map { String($0) }.joined(separator: ",")
        return "mb-insights-v1\nseq=\(seq)\ntop=\(top)\nbuckets=\(b)\n"
    }

    public func digest() -> String {
        Sha256.hex(text())
    }
}
