import Foundation
import MobileBenchCore

/// Data-source seam for the update stream. The default implementation replays the bundled fixture stream in-app;
/// a `URLSessionWebSocketTask` client for the local server (design §7.5, §15) implements the same protocol.
/// Every sink callback is delivered asynchronously on the main thread.
@MainActor
protocol UpdateSource: AnyObject {
    func open(from: Int, sink: UpdateSink)
    func close()
}

@MainActor
protocol UpdateSink: AnyObject {
    func onFrame(_ frame: StreamFrame)
    func onError(_ code: String)
}

/// In-app replay of `fixtures/stream-<profile>.jsonl` (first 10 000 wire frames, verified against golden.json when
/// the assets are prepared).
///
/// Schedule (design §7.5): message k is due at t0 + (k - from0) / rate on `CLOCK_UPTIME_RAW` (via `DispatchTime`),
/// with t0 and from0 taken at the first `open` of this source (one session per process start). A later `open`
/// continues the same schedule, so frames that became due while closed are delivered at once (catch-up), as the
/// local server does for a reconnect. After the last bundled frame the source sends an End frame. Lines are parsed
/// lazily on the main queue when they become due.
@MainActor
final class ReplaySource: UpdateSource {
    private let url: URL
    private let rate: Int
    private var data: Data?
    private var offset = 0
    private var pending: (seq: Int, frame: StreamFrame)?
    private var lastSeq = 0
    private var eof = false
    private var endSent = false
    private var t0: UInt64 = 0
    private var from0 = 1
    private var started = false
    private var generation = 0
    private weak var sink: UpdateSink?

    init(url: URL, ratePerSecond: Int) {
        self.url = url
        self.rate = ratePerSecond
    }

    func open(from: Int, sink: UpdateSink) {
        self.sink = sink
        generation += 1
        let gen = generation
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated { self?.start(gen: gen, from: from) }
        }
    }

    func close() {
        generation += 1
        sink = nil
    }

    private func start(gen: Int, from: Int) {
        guard gen == generation else { return }
        do {
            if data == nil { data = try Data(contentsOf: url) }
            if !started {
                started = true
                t0 = DispatchTime.now().uptimeNanoseconds
                from0 = from
            }
            // A reconnect must deliver from `from` (= lastApplied + 1, design §7.5). If the next unread frame is
            // already past it, start over from the beginning of the file and skip forward.
            let next = pending?.seq ?? (lastSeq + 1)
            if next > from {
                offset = 0
                pending = nil
                lastSeq = 0
                eof = false
                endSent = false
            }
            while true {
                guard let p = try pending ?? readNext() else { break }
                if p.seq >= from { break }
                pending = nil
            }
            sink?.onFrame(.hello(from: from))
            pump(gen: gen)
        } catch {
            sink?.onError(error is StreamProtocolError ? "stream-protocol" : "unexpected-exception")
        }
    }

    private func readNext() throws -> (seq: Int, frame: StreamFrame)? {
        guard !eof, let data else { return nil }
        guard offset < data.count else {
            eof = true
            return nil
        }
        let end = data[offset...].firstIndex(of: 0x0A) ?? data.count
        let line = data[offset..<end]
        offset = end + 1
        let frame = try StreamFrame.parse(Data(line))
        guard case let .update(seq, _, _, _, _) = frame else {
            throw StreamProtocolError("bundled stream contains a non-update frame")
        }
        lastSeq = seq
        pending = (seq, frame)
        return (seq, frame)
    }

    private func dueNs(_ seq: Int) -> UInt64 {
        t0 + UInt64(seq - from0) * 1_000_000_000 / UInt64(rate)
    }

    private func pump(gen: Int) {
        guard gen == generation else { return }
        do {
            let now = DispatchTime.now().uptimeNanoseconds
            while true {
                guard let p = try pending ?? readNext() else {
                    if !endSent {
                        endSent = true
                        sink?.onFrame(.end(last: lastSeq))
                    }
                    return
                }
                let due = dueNs(p.seq)
                if due > now {
                    DispatchQueue.main.asyncAfter(deadline: DispatchTime(uptimeNanoseconds: due)) { [weak self] in
                        MainActor.assumeIsolated { self?.pump(gen: gen) }
                    }
                    return
                }
                pending = nil
                sink?.onFrame(p.frame)
                if gen != generation { return }
            }
        } catch {
            sink?.onError(error is StreamProtocolError ? "stream-protocol" : "unexpected-exception")
        }
    }
}
