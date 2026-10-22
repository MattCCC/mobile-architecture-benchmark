import Foundation

/// Launch configuration (design §6.5, validation rules §5.9). iOS passes the keys as launch arguments
/// `-mb.<key> <value>`; only arguments starting with `-mb.` are considered.
public struct LaunchConfig: Sendable {
    public var journey = "none"
    public var profile = "representative"
    public var server: String?
    public var session: String?
    public var token: String?
    public var dataset = "embedded"
    public var restore = false
    public var remote = "embedded"
    public var clearModuleCache = false
    public var journeyMode = false
    public var bridgeBench = "0"
    public var markerMirror = "control"
    public var semantics = "auto"
    public var layoutProbe = false
    /// Known keys with invalid values, or values this candidate does not support.
    public var invalid: [String] = []
    /// Keys starting with `mb.` that are not part of the contract.
    public var unknown: [String] = []

    public var isValid: Bool { invalid.isEmpty }

    public static let profiles: Set<String> = ["small", "representative", "stress"]
    static let known: Set<String> = [
        "mb.journey", "mb.profile", "mb.server", "mb.session", "mb.token", "mb.dataset", "mb.restore", "mb.remote",
        "mb.clearModuleCache", "mb.journeyMode", "mb.bridgeBench", "mb.markerMirror", "mb.semantics",
        "mb.layoutProbe",
    ]

    public init() {}

    /// Collects `-mb.<key> <value>` pairs from process arguments.
    public static func parse(arguments: [String]) -> LaunchConfig {
        var raw = [String: String]()
        var k = 0
        while k < arguments.count {
            let a = arguments[k]
            if a.hasPrefix("-mb.") {
                let key = String(a.dropFirst())
                raw[key] = k + 1 < arguments.count ? arguments[k + 1] : ""
                k += 2
            } else {
                k += 1
            }
        }
        return parse(raw)
    }

    public static func parse(_ raw: [String: String]) -> LaunchConfig {
        var c = LaunchConfig()
        var invalid = [String]()
        c.unknown = raw.keys.filter { $0.hasPrefix("mb.") && !known.contains($0) }.sorted()

        func str(_ key: String) -> String? {
            raw[key]?.trimmingCharacters(in: .whitespaces)
        }
        func bool(_ key: String) -> Bool {
            switch str(key) {
            case nil, "0": return false
            case "1": return true
            default:
                invalid.append(key)
                return false
            }
        }
        func choice(_ key: String, _ def: String, _ allowed: Set<String>) -> String {
            guard let v = str(key) else { return def }
            if !allowed.contains(v) {
                invalid.append(key)
                return def
            }
            return v
        }
        func matches(_ s: String, _ allowed: (Character) -> Bool, length: ClosedRange<Int>) -> Bool {
            length.contains(s.count) && s.allSatisfy(allowed)
        }
        func ascii(_ ch: Character, _ extra: String) -> Bool {
            guard ch.isASCII else { return false }
            return ch.isLetter || ch.isNumber || extra.contains(ch)
        }

        if let j = str("mb.journey") {
            if matches(j, { ascii($0, "._-") }, length: 1...64) { c.journey = j } else { invalid.append("mb.journey") }
        }
        c.profile = choice("mb.profile", "representative", profiles)
        if let t = str("mb.token") {
            if matches(t, { $0.isASCII && $0.isHexDigit && !$0.isUppercase }, length: 32...32) {
                c.token = t
            } else {
                invalid.append("mb.token")
            }
        }
        if let s = str("mb.server") {
            if isValidServer(s, hasToken: c.token != nil) { c.server = s } else { invalid.append("mb.server") }
        }
        if let s = str("mb.session") {
            if matches(s, { $0.isASCII && ($0.isLowercase || $0.isNumber || $0 == "-") }, length: 1...40) {
                c.session = s
            } else {
                invalid.append("mb.session")
            }
        }
        c.dataset = choice("mb.dataset", "embedded", ["embedded", "network"])
        c.restore = bool("mb.restore")
        c.remote = choice("mb.remote", "embedded", ["embedded", "remote"])
        c.clearModuleCache = bool("mb.clearModuleCache")
        c.journeyMode = bool("mb.journeyMode")
        c.bridgeBench = choice("mb.bridgeBench", "0", ["0", "sync", "async"])
        c.markerMirror = choice("mb.markerMirror", "control", ["control", "all"])
        c.semantics = choice("mb.semantics", "auto", ["auto", "on"])
        c.layoutProbe = bool("mb.layoutProbe")

        // Valid values this candidate cannot honour yet fail loudly instead of measuring something else.
        if c.server != nil { invalid.append("mb.server") }  // WebSocket data source not implemented yet
        if c.dataset != "embedded" { invalid.append("mb.dataset") }
        if c.remote != "embedded" { invalid.append("mb.remote") }  // no remote mechanism (design §14.7 note 4)
        if c.bridgeBench != "0" { invalid.append("mb.bridgeBench") }  // no bridge (design §14.7 note 6)
        var seen = Set<String>()
        c.invalid = invalid.filter { seen.insert($0).inserted }
        return c
    }

    static func isValidServer(_ s: String, hasToken: Bool) -> Bool {
        let scheme: String
        if s.hasPrefix("ws://") {
            scheme = "ws://"
        } else if s.hasPrefix("http://") {
            scheme = "http://"
        } else {
            return false
        }
        var rest = Substring(s.dropFirst(scheme.count))
        if rest.hasSuffix("/") { rest = rest.dropLast() }
        guard let colon = rest.lastIndex(of: ":") else { return false }
        let host = String(rest[..<colon])
        let portText = rest[rest.index(after: colon)...]
        guard (4...5).contains(portText.count), portText.allSatisfy({ $0.isASCII && $0.isNumber }),
            let port = Int(portText), (1024...65535).contains(port)
        else { return false }
        guard !host.isEmpty, host.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "." || $0 == "-") })
        else { return false }
        if ["localhost", "127.0.0.1", "10.0.2.2"].contains(host) { return true }
        return host.hasSuffix(".local") && hasToken
    }
}
