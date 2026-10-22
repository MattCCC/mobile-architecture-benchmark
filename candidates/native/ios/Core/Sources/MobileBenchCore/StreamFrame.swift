import Foundation

public struct StreamProtocolError: Error, CustomStringConvertible, Sendable {
    public let description: String
    public init(_ description: String) { self.description = description }
}

/// Stream frames of the wire protocol (design §7.5).
public enum StreamFrame: Sendable, Equatable {
    case update(seq: Int, item: Int, v0: Int, v1: Int, v2: Int)
    case hello(from: Int)
    case end(last: Int)
    case checkpoint(k: Int, last: Int)
    case resume(from: Int)

    public static func parse(_ text: Substring) throws -> StreamFrame {
        try parse(Data(text.utf8))
    }

    public static func parse(_ data: Data) throws -> StreamFrame {
        guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let t = o["t"] as? String
        else { throw StreamProtocolError("invalid frame") }
        func int(_ key: String) throws -> Int {
            guard let v = o[key] as? Int else { throw StreamProtocolError("frame field \(key) missing") }
            return v
        }
        switch t {
        case "u":
            guard let v = o["v"] as? [Int], v.count == 3 else { throw StreamProtocolError("update values") }
            return .update(seq: try int("s"), item: try int("i"), v0: v[0], v1: v[1], v2: v[2])
        case "h": return .hello(from: try int("from"))
        case "e": return .end(last: try int("last"))
        case "c": return .checkpoint(k: try int("k"), last: try int("last"))
        case "r": return .resume(from: try int("from"))
        default: throw StreamProtocolError("unknown frame type \(t)")
        }
    }
}
