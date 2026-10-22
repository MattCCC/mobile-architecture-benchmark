/// Display formatting without locale APIs (design §7.7). Swift integer interpolation is locale-independent.
public enum Format {
    public static let optionKeys: [Character] = ["A", "B", "C"]

    /// Fixed-point value with scale 100: 1234 -> "12.34".
    public static func value(_ v: Int) -> String {
        precondition(v >= 0, "negative value")
        let whole = v / 100
        let frac = v % 100
        return frac < 10 ? "\(whole).0\(frac)" : "\(whole).\(frac)"
    }

    /// Label width: max(3, number of digits of n - 1).
    public static func labelWidth(itemCount: Int) -> Int {
        max(3, digits(max(itemCount - 1, 0)))
    }

    public static func digits(_ x: Int) -> Int {
        var d = 1
        var y = x
        while y >= 10 {
            y /= 10
            d += 1
        }
        return d
    }

    /// "Item 042" for index 42 and width 3.
    public static func itemLabel(_ index: Int, width: Int) -> String {
        let s = String(index)
        let pad = width - s.count
        return pad > 0 ? "Item " + String(repeating: "0", count: pad) + s : "Item " + s
    }

    public static func optionKey(_ option: Int) -> Character {
        optionKeys[option]
    }

    /// Option button / detail value text: "A 12.34".
    public static func optionText(_ option: Int, _ value: Int) -> String {
        "\(optionKey(option)) \(Format.value(value))"
    }
}
