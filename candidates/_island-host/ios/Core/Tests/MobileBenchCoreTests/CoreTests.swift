import Foundation
import XCTest

@testable import MobileBenchCore

/// Paths relative to this file: <repo>/candidates/native/ios/Core/Tests/MobileBenchCoreTests/CoreTests.swift
private let candidateDir = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
private let repoRoot = candidateDir.deletingLastPathComponent().deletingLastPathComponent()
private let assetsDir = candidateDir.appendingPathComponent("generated/assets/fixtures")
private let goldenURL = repoRoot.appendingPathComponent("fixtures/v1/golden.json")

final class ConformanceTests: XCTestCase {
    /// Conformance of the Swift state/digest port against fixtures/v1/golden.json at seq 0, 100, 1000, 10 000.
    func testEveryProfileMatchesGoldenDigests() throws {
        guard FileManager.default.fileExists(atPath: assetsDir.path) else {
            throw XCTSkip("bundled assets missing: run make prepare-native")
        }
        let golden = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(contentsOf: goldenURL)) as? [String: Any])
        let profiles = try XCTUnwrap(golden["profiles"] as? [String: [String: Any]])
        for name in profiles.keys.sorted() {
            try check(name, profiles[name]!)
        }
    }

    private func digests(_ g: [String: Any], _ key: String) throws -> [Int: String] {
        let list = try XCTUnwrap(g[key] as? [[String: Any]])
        var out = [Int: String]()
        for e in list { out[e["seq"] as! Int] = (e["digest"] as! String) }
        return out
    }

    private func check(_ name: String, _ g: [String: Any]) throws {
        let fixtureData = try Data(contentsOf: assetsDir.appendingPathComponent("\(name).json"))
        XCTAssertEqual(Sha256.hex(fixtureData), g["sha256"] as? String, "\(name) sha256")
        let model = StateModel(profile: name, fixture: try Fixture.parse(fixtureData, expectedProfile: name))
        XCTAssertEqual(model.itemCount, g["items"] as? Int)
        let seq0 = try XCTUnwrap(g["seq0Summary"] as? [String: Any])
        XCTAssertEqual(model.selectedCount, seq0["selectedCount"] as? Int)
        XCTAssertEqual(model.total, seq0["total"] as? Int)
        XCTAssertEqual(Format.value(model.total), seq0["totalText"] as? String)

        let state = try digests(g, "stateDigests")
        let insights = try digests(g, "insightsDigests")
        XCTAssertEqual(model.stateDigest(), state[0], "\(name) seq 0")
        XCTAssertEqual(model.insights().digest(), insights[0], "\(name) insights seq 0")

        let streamData = try Data(contentsOf: assetsDir.appendingPathComponent("stream-\(name).jsonl"))
        let stream = try XCTUnwrap(g["stream"] as? [String: Any])
        XCTAssertEqual(Sha256.hex(streamData), stream["sha256"] as? String, "\(name) stream sha256")
        let text = String(decoding: streamData, as: UTF8.self)
        for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
            guard case let .update(seq, item, v0, v1, v2) = try StreamFrame.parse(line) else {
                XCTFail("non-update frame")
                return
            }
            XCTAssertEqual(model.offer(seq: seq, item: item, v0: v0, v1: v1, v2: v2), .applied)
            if let d = state[seq] { XCTAssertEqual(model.stateDigest(), d, "\(name) seq \(seq)") }
            if let d = insights[seq] { XCTAssertEqual(model.insights().digest(), d, "\(name) insights seq \(seq)") }
        }
        XCTAssertEqual(model.lastAppliedSeq, 10_000)
        XCTAssertEqual(model.applied, 10_000)
        XCTAssertEqual(model.duplicates, 0)
        XCTAssertEqual(model.gaps, 0)
    }
}

final class DomainTests: XCTestCase {
    private let fixtureJSON = """
        {
          "schema": "mobilebench.fixture/1.0.0",
          "fixtureVersion": "1.0.0",
          "profile": "small",
          "seed": 42,
          "generator": { "prng": "mulberry32", "algorithmVersion": 1 },
          "valueScale": 100,
          "valueRange": [100, 9999],
          "items": [
            { "i": 0, "g": 1, "v": [100, 9999, 1234] },
            { "i": 1, "g": 7, "v": [5000, 200, 300] },
            { "i": 2, "g": 0, "v": [5000, 4000, 300] }
          ],
          "selection": [
            { "i": 1, "o": 2 }
          ]
        }
        """

    private func model() throws -> StateModel {
        StateModel(profile: "small", fixture: try Fixture.parse(Data(fixtureJSON.utf8), expectedProfile: "small"))
    }

    func testFormatsWithoutLocale() {
        XCTAssertEqual(Format.value(100), "1.00")
        XCTAssertEqual(Format.value(9999), "99.99")
        XCTAssertEqual(Format.value(1205), "12.05")
        XCTAssertEqual(Format.value(7), "0.07")
        XCTAssertEqual(Format.value(191_327), "1913.27")
        XCTAssertEqual(Format.itemLabel(42, width: Format.labelWidth(itemCount: 300)), "Item 042")
        XCTAssertEqual(Format.itemLabel(42, width: Format.labelWidth(itemCount: 3000)), "Item 0042")
        XCTAssertEqual(Format.optionText(1, 1234), "B 12.34")
    }

    func testSelectionRules() throws {
        let m = try model()
        XCTAssertEqual(m.selectedCount, 1)
        XCTAssertEqual(m.total, 300)
        XCTAssertEqual(m.toggle(item: 0, option: 0), 0)
        XCTAssertEqual(m.total, 400)
        XCTAssertEqual(m.toggle(item: 0, option: 1), 1)
        XCTAssertEqual(m.selectedCount, 2)
        XCTAssertEqual(m.total, 10_299)
        XCTAssertEqual(m.toggle(item: 0, option: 1), -1)
        XCTAssertEqual(m.selectedCount, 1)
        XCTAssertEqual(m.total, 300)
        XCTAssertEqual(m.selectionRevision, 3)
        XCTAssertTrue(m.stateText().hasSuffix("selection=1:C\n"))
    }

    func testUpdatesFollowClientRules() throws {
        let m = try model()
        m.toggle(item: 2, option: 0)
        XCTAssertEqual(m.offer(seq: 1, item: 2, v0: 111, v1: 222, v2: 333), .applied)
        XCTAssertEqual(m.total, 300 + 111)
        XCTAssertEqual(m.offer(seq: 1, item: 2, v0: 444, v1: 555, v2: 666), .duplicate)
        XCTAssertEqual(m.offer(seq: 3, item: 0, v0: 444, v1: 555, v2: 666), .gap)
        XCTAssertEqual(m.lastAppliedSeq, 1)
        XCTAssertEqual([m.received, m.applied, m.duplicates, m.gaps], [3, 1, 1, 1])
        XCTAssertEqual(
            m.stateText(),
            "mb-state-v1\nprofile=small\nseq=1\nvalues=100,9999,1234,5000,200,300,111,222,333\nselection=1:C,2:A\n")
    }

    func testInsights() throws {
        let ins = try model().insights()
        XCTAssertEqual(ins.topItems, [1, 2, 0])
        XCTAssertEqual(ins.topValues, [5000, 5000, 100])
        XCTAssertEqual(ins.buckets, [1, 1, 0, 0, 1])
        XCTAssertEqual(ins.text(), "mb-insights-v1\nseq=0\ntop=1:5000,2:5000,0:100\nbuckets=1,1,0,0,1\n")
    }

    func testRestoreRecordRoundTrip() throws {
        let m = try model()
        m.toggle(item: 0, option: 1)
        _ = m.offer(seq: 1, item: 2, v0: 111, v1: 222, v2: 333)
        let text = RestoreRecord.capture(m, route: ["list", "detail/2"], anchor: 1).serialize()
        XCTAssertEqual(
            text,
            "{\"v\":2,\"route\":[\"list\",\"detail/2\"],\"anchor\":1,\"selection\":[[0,1],[1,2]],\"lastSeq\":1,"
                + "\"values\":[[100,9999,1234],[5000,200,300],[111,222,333]]}\n")
        let restored = try model()
        restored.restore(try RestoreRecord.parse(Data(text.utf8), itemCount: 3))
        XCTAssertEqual(restored.stateDigest(), m.stateDigest())
        XCTAssertEqual(restored.total, m.total)
    }

    func testRestoreRecordRejectsInvalidInput() {
        let bad = [
            "not json",
            "{\"v\":1,\"route\":[\"list\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0}",
            "{\"v\":2,\"route\":[\"detail/1\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0,\"values\":[[100,100,100],[100,100,100],[100,100,100]]}",
            "{\"v\":2,\"route\":[\"list\",\"detail/9\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0,\"values\":[[100,100,100],[100,100,100],[100,100,100]]}",
            "{\"v\":2,\"route\":[\"list\"],\"anchor\":0,\"selection\":[],\"lastSeq\":0,\"values\":[[100,100,100]]}",
        ]
        for text in bad {
            XCTAssertThrowsError(try RestoreRecord.parse(Data(text.utf8), itemCount: 3), text)
        }
    }

    func testStreamFrames() throws {
        XCTAssertEqual(
            try StreamFrame.parse(Substring("{\"t\":\"u\",\"s\":17,\"i\":42,\"v\":[1234,567,8910]}")),
            .update(seq: 17, item: 42, v0: 1234, v1: 567, v2: 8910))
        XCTAssertEqual(try StreamFrame.parse(Substring("{\"t\":\"e\",\"last\":600}")), .end(last: 600))
        XCTAssertEqual(try StreamFrame.parse(Substring("{\"t\":\"c\",\"k\":3,\"last\":417}")), .checkpoint(k: 3, last: 417))
        XCTAssertEqual(try StreamFrame.parse(Substring("{\"t\":\"r\",\"from\":418}")), .resume(from: 418))
        XCTAssertThrowsError(try StreamFrame.parse(Substring("{\"t\":\"x\"}")))
    }

    func testFixtureValidation() {
        XCTAssertThrowsError(try Fixture.parse(Data(fixtureJSON.utf8), expectedProfile: "representative"))
        let outOfRange = fixtureJSON.replacingOccurrences(of: "9999, 1234", with: "10000, 1234")
        XCTAssertThrowsError(try Fixture.parse(Data(outOfRange.utf8), expectedProfile: "small"))
    }

    func testLaunchConfig() {
        let ok = LaunchConfig.parse(arguments: [
            "/app", "-mb.profile", "small", "-mb.journey", "j-1", "-mb.restore", "1", "-mb.other", "x",
        ])
        XCTAssertTrue(ok.isValid)
        XCTAssertEqual(ok.profile, "small")
        XCTAssertEqual(ok.journey, "j-1")
        XCTAssertTrue(ok.restore)
        XCTAssertEqual(ok.unknown, ["mb.other"])
        let defaults = LaunchConfig.parse(arguments: ["/app"])
        XCTAssertTrue(defaults.isValid)
        XCTAssertEqual(defaults.profile, "representative")
        XCTAssertFalse(LaunchConfig.parse(["mb.profile": "huge"]).isValid)
        XCTAssertFalse(LaunchConfig.parse(["mb.restore": "yes"]).isValid)
        XCTAssertFalse(LaunchConfig.parse(["mb.journey": "has space"]).isValid)
        XCTAssertFalse(LaunchConfig.parse(["mb.server": "ws://example.org:8787"]).isValid)
        XCTAssertFalse(LaunchConfig.parse(["mb.server": "ws://localhost:8787"]).isValid)  // unsupported yet
        XCTAssertFalse(LaunchConfig.parse(["mb.bridgeBench": "sync"]).isValid)
        XCTAssertTrue(LaunchConfig.parse(["mb.semantics": "on", "mb.markerMirror": "all"]).isValid)
    }
}
