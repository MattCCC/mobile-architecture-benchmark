import Darwin
import Foundation
import MobileBenchCore
import UIKit
import notify
import os

/// Callbacks into the app (stream start/reconnect, lifecycle work).
@MainActor
protocol BenchKitListener: AnyObject {
    func benchFui()
    func benchResumeDrawn()
    func benchRestoreDrawn()
    func benchBackground()
    func benchForeground(fgSeq: Int)
}

/// Candidate-local stand-in for the core iOS BenchKit (design §6.2, §6.3) with the same API and semantics, so the
/// shared `instrumentation/ios-benchkit` package can replace it without UI changes.
///
/// Markers go to a ring buffer on `CLOCK_UPTIME_RAW` (timing source; flushed to
/// `Library/Caches/mobilebench/markers-<journeyId>.jsonl`), to `OSSignposter` (category `markers`) and, for the
/// driver-visible set (all markers with `mb.markerMirror=all`), to one public unified-log line
/// `MB <journeyId> <event> <n> <payload> t=<uptime ns>` plus a Darwin notification
/// `org.example.mobilebench.<event>`. Log lines and notifications are control signals, never a timing source.
@MainActor
enum BenchKit {
    static let subsystem = "org.example.mobilebench"
    private static let driverVisible: Set<String> = [
        "fui", "resume", "restore", "remote.ready", "remote.error", "state", "err", "a11y", "launch",
    ]
    private static let logger = Logger(subsystem: subsystem, category: "markers")
    private static let signposter = OSSignposter(subsystem: subsystem, category: "markers")

    private(set) static var config = LaunchConfig()
    weak static var listener: BenchKitListener?
    static var stateProvider: () -> (selected: Int, seq: Int, revision: Int) = { (0, 0, 0) }

    private struct Entry {
        let event: String
        let n: Int
        let t: UInt64
        let payload: String
    }

    private static let capacity = 4096
    private static var buffer: [Entry] = {
        var b = [Entry]()
        b.reserveCapacity(capacity)
        return b
    }()
    private static var ordinals: [String: Int] = [:]
    private static var started = false

    static func nowNs() -> UInt64 {
        clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
    }

    /// First BenchKit call of the process: launch configuration, `proc.anchor`, `a11y`, lifecycle observers.
    static func start(arguments: [String]) {
        guard !started else { return }
        started = true
        config = LaunchConfig.parse(arguments: arguments)
        mark("proc.anchor", "ws=\(wallMicros());ps=\(processStartMicros())")
        let vo = UIAccessibility.isVoiceOverRunning ? 1 : 0
        let sw = UIAccessibility.isSwitchControlRunning ? 1 : 0
        let sp = UIAccessibility.isSpeakScreenEnabled ? 1 : 0
        mark("a11y", "vo=\(vo);sw=\(sw);sp=\(sp)")
        if !config.unknown.isEmpty {
            mark("err", "code=launch-config-unknown-key;n=\(config.unknown.count)")
        }
        let center = NotificationCenter.default
        center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { didEnterBackground() }
        }
        center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { willEnterForeground() }
        }
    }

    // MARK: markers

    static func mark(_ event: String, _ payload: String = "") {
        let t = nowNs()
        let n = (ordinals[event] ?? 0) + 1
        ordinals[event] = n
        let p = payload.isEmpty ? "-" : payload
        buffer.append(Entry(event: event, n: n, t: t, payload: p))
        signposter.emitEvent("marker", "\(event, privacy: .public) \(n) \(p, privacy: .public)")
        if config.markerMirror == "all" || driverVisible.contains(event) {
            logger.notice(
                "MB \(config.journey, privacy: .public) \(event, privacy: .public) \(n) \(p, privacy: .public) t=\(t)")
        }
        if driverVisible.contains(event) {
            notify_post("\(subsystem).\(event)")
        }
        if buffer.count >= capacity * 3 / 4 {
            flush()
            mark("flush")
        }
    }

    static func err(_ code: String) {
        mark("err", "code=\(code)")
    }

    /// Writes the buffered markers to `Library/Caches/mobilebench/markers-<journeyId>.jsonl` (append).
    static func flush() {
        guard !buffer.isEmpty else { return }
        var text = ""
        for e in buffer {
            text += "{\"e\":\"\(e.event)\",\"n\":\(e.n),\"t\":\(e.t),\"p\":\"\(e.payload)\"}\n"
        }
        buffer.removeAll(keepingCapacity: true)
        let fm = FileManager.default
        guard let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        let dir = caches.appendingPathComponent("mobilebench", isDirectory: true)
        let file = dir.appendingPathComponent("markers-\(config.journey).jsonl")
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            if let handle = try? FileHandle(forWritingTo: file) {
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: Data(text.utf8))
            } else {
                try Data(text.utf8).write(to: file)
            }
        } catch {
            // Losing a flush must not crash the app; the os_log mirror still has the control markers.
        }
    }

    /// `task_vm_info.phys_footprint` and `ledger_phys_footprint_peak` (design §6.2, V-35).
    static func memoryCheckpoint() {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        if kr == KERN_SUCCESS {
            mark("mem", "fp=\(info.phys_footprint);pk=\(info.ledger_phys_footprint_peak)")
        }
    }

    private static func wallMicros() -> Int64 {
        var tv = timeval()
        gettimeofday(&tv, nil)
        return Int64(tv.tv_sec) * 1_000_000 + Int64(tv.tv_usec)
    }

    private static func processStartMicros() -> Int64 {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return -1 }
        let tv = info.kp_proc.p_un.__p_starttime
        return Int64(tv.tv_sec) * 1_000_000 + Int64(tv.tv_usec)
    }

    // MARK: lifecycle (design §6.3 bg / fg)

    private static var backgroundedOnce = false
    private(set) static var fgSeq = 0

    private static func didEnterBackground() {
        backgroundedOnce = true
        mark("bg", "fg=\(fgSeq)")
        listener?.benchBackground()
        flush()
    }

    private static func willEnterForeground() {
        guard backgroundedOnce else { return }
        fgSeq += 1
        mark("fg", "fg=\(fgSeq)")
        listener?.benchForeground(fgSeq: fgSeq)
        requestRootRedraw()
    }

    // MARK: FUI gate (design §8.4)

    private static var gateArmed = false
    private(set) static var fuiReached = false
    private static var gateH = -1
    private static var gateRows = 0
    private static var drawnRows = Set<Int>()
    private static var summaryDrawnForGate = false
    private static var lastRespRev = -1

    static func armFuiGate(itemCount: Int) {
        gateArmed = true
        fuiReached = false
        gateH = -1
        gateRows = itemCount
        drawnRows.removeAll()
        summaryDrawnForGate = false
    }

    static func disarmFuiGate() {
        gateArmed = false
    }

    /// List container height (pt, integer, floor) at its first layout.
    static func listLayout(_ h: Int) {
        guard gateArmed, gateH < 0 else { return }
        gateH = h
        gateRows = min(gateRows, max(h / 72, 0))
        if h / 72 < 1 { err("unexpected-exception") }
        checkGate()
    }

    /// Row probe draw callback; inert after FUI.
    static func rowDrawn(_ index: Int) {
        guard gateArmed else { return }
        drawnRows.insert(index)
        checkGate()
    }

    /// Summary probe draw callback: token `fui0` until FUI, then `rev:<selectionRevision>`.
    static func summaryDrawn() {
        if gateArmed {
            summaryDrawnForGate = true
            checkGate()
            return
        }
        guard fuiReached else { return }
        let s = stateProvider()
        if s.revision != lastRespRev {
            lastRespRev = s.revision
            mark("resp", "rev=\(s.revision);sel=\(s.selected)")
        }
    }

    private static func checkGate() {
        guard gateH >= 0, summaryDrawnForGate, gateRows >= 1 else { return }
        for i in 0..<gateRows where !drawnRows.contains(i) { return }
        gateArmed = false
        fuiReached = true
        drawnRows.removeAll()
        let s = stateProvider()
        lastRespRev = s.revision
        mark("fui", "rows=\(gateRows);h=\(gateH);sel=\(s.selected);seq=\(s.seq)")
        DispatchQueue.main.async { MainActor.assumeIsolated { listener?.benchFui() } }
    }

    /// Re-arms resp tracking after the selection changed, forcing the summary probe to redraw.
    static func selectionChanged() {
        summaryProbe?.setNeedsDisplay()
    }

    weak static var summaryProbe: ProbeView?

    // MARK: screen roots (design §6.3 screen / resume / restore)

    private(set) static var navSeq = 0
    private(set) static var topRoute = "list"
    private static var navStarted = false
    private static var lastScreenNav = -1
    private static var lastResumeFg = 0
    private static var pendingRestore: (route: String, anchor: Int)?
    private static let rootProbes = NSHashTable<ProbeView>.weakObjects()

    static func registerRootProbe(_ probe: ProbeView) {
        rootProbes.add(probe)
    }

    /// Navigation reports a new top route at transition start (push and pop).
    /// The first call sets the initial top route (navSeq 0). Push and pop always change the top route, so a call with
    /// the current top route is a duplicate notification and is ignored.
    static func navigated(to route: String) {
        if !navStarted {
            navStarted = true
        } else if route == topRoute {
            return
        } else {
            navSeq += 1
        }
        topRoute = route
        requestRootRedraw()
    }

    static func setPendingRestore(route: String, anchor: Int) {
        pendingRestore = (route, anchor)
    }

    private static func requestRootRedraw() {
        for probe in rootProbes.allObjects { probe.setNeedsDisplay() }
    }

    static func rootDrawn(route: String) {
        guard route == topRoute else { return }
        if navSeq != lastScreenNav {
            lastScreenNav = navSeq
            mark("screen", "r=\(route);nav=\(navSeq)")
        }
        if fgSeq != lastResumeFg {
            lastResumeFg = fgSeq
            mark("resume", "r=\(route);fg=\(fgSeq)")
            DispatchQueue.main.async { MainActor.assumeIsolated { listener?.benchResumeDrawn() } }
        }
        if let pr = pendingRestore, pr.route == route {
            pendingRestore = nil
            mark("restore", "r=\(route);a=\(pr.anchor)")
            DispatchQueue.main.async { MainActor.assumeIsolated { listener?.benchRestoreDrawn() } }
        }
    }

    // MARK: Insights (design §8.10, embedded only)

    private static var insightsOpen = 0
    private static var insightsReady = 0

    static func insightsRequested() {
        insightsOpen += 1
        mark("remote.request")
        mark("remote.source", "src=embedded")
    }

    static func insightsDrawn() {
        guard insightsReady != insightsOpen else { return }
        insightsReady = insightsOpen
        mark("remote.ready", "v=1")
    }

    // MARK: checkpoints (design §6.6)

    static func publishState(k: Int, seq: Int, digest: String, received: Int, applied: Int, dup: Int, gap: Int, rows: Int) {
        mark("state", "k=\(k);s=\(seq);d=\(digest.prefix(16))")
        mark("ctr", "r=\(received);a=\(applied);dup=\(dup);gap=\(gap);rows=\(rows)")
        memoryCheckpoint()
        flush()
    }
}

/// 1 x 1 pt opaque probe view painted in its parent's background colour (design §6.2). `draw(_:)` reports to
/// BenchKit; a token change calls `setNeedsDisplay()` so UIKit redraws it.
final class ProbeView: UIView {
    var onDraw: (() -> Void)?

    init(color: UIColor) {
        super.init(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
        backgroundColor = color
        isOpaque = true
        isUserInteractionEnabled = false
        isAccessibilityElement = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func draw(_ rect: CGRect) {
        backgroundColor?.setFill()
        UIRectFill(rect)
        onDraw?()
    }
}
