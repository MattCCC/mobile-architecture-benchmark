import Foundation

public struct FixtureError: Error, CustomStringConvertible, Sendable {
    public let description: String
    public init(_ description: String) { self.description = description }
}

/// Parsed fixture (format mobilebench.fixture/1.0.0, design §7.2). Values are flat: item i, option o at
/// index i * 3 + o. `selection` holds the selected option per item, or -1.
public struct Fixture: Sendable {
    public static let schema = "mobilebench.fixture/1.0.0"
    public static let valueRange = 100...9999

    public let profile: String
    public let fixtureVersion: String
    public let groups: [Int]
    public let values: [Int]
    public let selection: [Int]

    public var itemCount: Int { groups.count }

    private struct File: Decodable {
        struct Item: Decodable {
            let i: Int
            let g: Int
            let v: [Int]
        }

        struct Selected: Decodable {
            let i: Int
            let o: Int
        }

        let schema: String
        let fixtureVersion: String
        let profile: String
        let valueScale: Int
        let items: [Item]
        let selection: [Selected]
    }

    public static func parse(_ data: Data, expectedProfile: String) throws -> Fixture {
        let file: File
        do {
            file = try JSONDecoder().decode(File.self, from: data)
        } catch {
            throw FixtureError("fixture is not valid: \(error)")
        }
        guard file.schema == schema else { throw FixtureError("unexpected schema \(file.schema)") }
        guard file.profile == expectedProfile else {
            throw FixtureError("profile \(file.profile) != requested \(expectedProfile)")
        }
        guard file.valueScale == 100 else { throw FixtureError("valueScale must be 100") }
        let n = file.items.count
        guard n >= 1 else { throw FixtureError("no items") }
        var groups = [Int](repeating: 0, count: n)
        var values = [Int](repeating: 0, count: n * 3)
        for (k, item) in file.items.enumerated() {
            guard item.i == k else { throw FixtureError("item \(k) has index \(item.i)") }
            guard (0...7).contains(item.g) else { throw FixtureError("item \(k) group \(item.g) out of range") }
            guard item.v.count == 3 else { throw FixtureError("item \(k) has \(item.v.count) values") }
            groups[k] = item.g
            for o in 0..<3 {
                guard valueRange.contains(item.v[o]) else { throw FixtureError("item \(k) value out of range") }
                values[k * 3 + o] = item.v[o]
            }
        }
        var selection = [Int](repeating: -1, count: n)
        for (k, e) in file.selection.enumerated() {
            guard (0..<n).contains(e.i), (0...2).contains(e.o), selection[e.i] == -1 else {
                throw FixtureError("invalid selection entry \(k)")
            }
            selection[e.i] = e.o
        }
        return Fixture(
            profile: file.profile, fixtureVersion: file.fixtureVersion, groups: groups, values: values,
            selection: selection)
    }
}
