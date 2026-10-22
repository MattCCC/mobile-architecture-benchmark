import Foundation
import MobileBenchCore

/// Main run-loop timer in the common modes, so it also fires while a scroll view is tracking.
func commonTimer(_ interval: TimeInterval, repeats: Bool, block: @escaping @Sendable (Timer) -> Void) -> Timer {
    let timer = Timer(timeInterval: interval, repeats: repeats, block: block)
    RunLoop.main.add(timer, forMode: .common)
    return timer
}

enum StreamStatus: String {
    case connecting = "Connecting"
    case live = "Live"
    case paused = "Paused"
    case stale = "Stale"
    case disconnected = "Disconnected"
    case ended = "Ended"
}

/// Stream client rules (design §7.5): seq order, duplicates ignored, gap -> reconnect from lastApplied + 1,
/// 2 s without a message -> Stale, 3 s -> reconnect, deterministic back-off; timers suspended after `c` and `e`.
/// Checkpoints after `c` / `e` + 500 ms without updates (design §6.6).
@MainActor
final class StreamController: UpdateSink {
    private static let staleAfter: TimeInterval = 2
    private static let reconnectAfter: TimeInterval = 3
    private static let watchdogInterval: TimeInterval = 0.5
    private static let checkpointQuiet: TimeInterval = 0.5
    private static let backoff: [TimeInterval] = [0.25, 0.5, 1, 2]

    private let store: AppStore
    private let source: UpdateSource
    private let onCheckpoint: (Int) -> Void

    private(set) var isOpen = false
    private var ended = false
    private var paused = false
    private var attempt = 0
    private var liveMarked = false
    private var staleMarked = false
    private var lastFrameAt: TimeInterval = 0
    private var backoffIndex = 0
    private var watchdog: Timer?
    private var reconnectTimer: Timer?
    private var checkpointTimer: Timer?
    private var pendingCheckpointK = -1

    init(store: AppStore, source: UpdateSource, onCheckpoint: @escaping (Int) -> Void) {
        self.store = store
        self.source = source
        self.onCheckpoint = onCheckpoint
    }

    private func now() -> TimeInterval {
        Double(DispatchTime.now().uptimeNanoseconds) / 1e9
    }

    func connect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        guard !isOpen, !ended else { return }
        attempt += 1
        BenchKit.mark("stream.connect", "a=\(attempt)")
        store.setStatus(.connecting)
        isOpen = true
        liveMarked = false
        staleMarked = false
        paused = false
        lastFrameAt = now()
        source.open(from: store.model.lastAppliedSeq + 1, sink: self)
        startWatchdog()
    }

    func close(_ why: String) {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        guard isOpen else { return }
        isOpen = false
        source.close()
        stopWatchdog()
        BenchKit.mark("stream.closed", "why=\(why)")
        if !ended { store.setStatus(.disconnected) }
    }

    func dispose() {
        close("dispose")
        checkpointTimer?.invalidate()
    }

    private func startWatchdog() {
        stopWatchdog()
        watchdog = commonTimer(Self.watchdogInterval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkIdle() }
        }
    }

    private func stopWatchdog() {
        watchdog?.invalidate()
        watchdog = nil
    }

    private func checkIdle() {
        guard isOpen, !paused, !ended else { return }
        let idle = now() - lastFrameAt
        if idle >= Self.reconnectAfter {
            reconnect("stale")
        } else if idle >= Self.staleAfter, !staleMarked {
            staleMarked = true
            store.setStatus(.stale)
            BenchKit.mark("stream.stale")
        }
    }

    private func reconnect(_ why: String) {
        close(why)
        let delay = Self.backoff[min(backoffIndex, Self.backoff.count - 1)]
        backoffIndex += 1
        reconnectTimer = commonTimer(delay, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.connect() }
        }
    }

    private func scheduleCheckpoint(_ k: Int) {
        pendingCheckpointK = k
        restartCheckpointTimer()
    }

    private func restartCheckpointTimer() {
        checkpointTimer?.invalidate()
        checkpointTimer = commonTimer(Self.checkpointQuiet, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.pendingCheckpointK >= 0 else { return }
                let k = self.pendingCheckpointK
                self.pendingCheckpointK = -1
                self.onCheckpoint(k)
            }
        }
    }

    func onFrame(_ frame: StreamFrame) {
        guard isOpen else { return }
        lastFrameAt = now()
        switch frame {
        case let .hello(from):
            BenchKit.mark("stream.open", "from=\(from)")
            store.setStatus(.live)
        case let .update(seq, item, v0, v1, v2):
            if pendingCheckpointK >= 0 { restartCheckpointTimer() }
            switch store.offer(seq: seq, item: item, v0: v0, v1: v1, v2: v2) {
            case .applied:
                if !liveMarked {
                    liveMarked = true
                    // The back-off restarts only after data flows again, so a source that opens and then fails at
                    // once is retried with growing delays.
                    backoffIndex = 0
                    BenchKit.mark("stream.live", "s=\(seq)")
                }
                if staleMarked {
                    staleMarked = false
                    store.setStatus(.live)
                }
            case .duplicate:
                break
            case .gap:
                BenchKit.err("stream-gap")
                reconnect("gap")
            }
        case .end:
            ended = true
            paused = false
            stopWatchdog()
            store.setStatus(.ended)
            scheduleCheckpoint(0)
        case let .checkpoint(k, _):
            paused = true
            stopWatchdog()
            store.setStatus(.paused)
            scheduleCheckpoint(k)
        case .resume:
            paused = false
            store.setStatus(.live)
            startWatchdog()
        }
    }

    func onError(_ code: String) {
        BenchKit.err(code)
        if isOpen { reconnect("error") }
    }
}
