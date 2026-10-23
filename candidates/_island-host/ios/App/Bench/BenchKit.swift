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

/// The marker store of the process: ordinals, the ring buffer on `CLOCK_UPTIME_RAW` (timing source; flushed to
/// `Library/Caches/mobilebench/markers-<journeyId>.jsonl`), `OSSignposter` events and, for the driver-visible set
/// (all markers with `mb.markerMirror=all`), one public unified-log line `MB <journeyId> <event> <n> <payload>
/// t=<uptime ns>` plus a Darwin notification `org.example.mobilebench.<event>`. Thread-safe: island runtimes mark
/// from their own threads.
final class MarkerCore: @unchecked Sendable {
    static let shared = MarkerCore()
    static let subsystem = "org.example.mobilebench"
    private static let driverVisible: Set<String> = [
        "fui", "resume", "restore", "remote.ready", "remote.error", "state", "err", "a11y", "launch",
    ]
    private static let capacity = 4096

    private struct Entry {
        let event: String
        let n: Int
        let t: UInt64
        let payload: String
    }

    private let lock = NSLock()
    private let logger = Logger(subsystem: MarkerCore.subsystem, category: "markers")
    private let signposter = OSSignposter(subsystem: MarkerCore.subsystem, category: "markers")
    private var buffer: [Entry] = []
    private var ordinals: [String: Int] = [:]
    private var journey = "none"
    private var mirrorAll = false
    private var launchJSONValue = "{}"
    private var fgValue = 0

    private init() {
        buffer.reserveCapacity(MarkerCore.capacity)
    }

    func configure(journey: String, mirrorAll: Bool, launchJSON: String) {
        lock.lock()
        self.journey = journey
        self.mirrorAll = mirrorAll
        launchJSONValue = launchJSON
        lock.unlock()
    }

    /// Thread-safe copies for island runtimes that read them from their own threads.
    var launchJSON: String {
        lock.lock()
        defer { lock.unlock() }
        return launchJSONValue
    }

    var fgSeq: Int {
        get {
            lock.lock()
            defer { lock.unlock() }
            return fgValue
        }
        set {
            lock.lock()
            fgValue = newValue
            lock.unlock()
        }
    }

    static func nowNs() -> UInt64 {
        clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
    }

    func mark(_ event: String, _ payload: String) {
        let t = MarkerCore.nowNs()
        let p = MarkerCore.sanitize(payload)
        lock.lock()
        let n = (ordinals[event] ?? 0) + 1
        ordinals[event] = n
        buffer.append(Entry(event: event, n: n, t: t, payload: p))
        let j = journey
        let mirror = mirrorAll || MarkerCore.driverVisible.contains(event)
        let full = buffer.count >= MarkerCore.capacity * 3 / 4
        lock.unlock()
        signposter.emitEvent("marker", "\(event, privacy: .public) \(n) \(p, privacy: .public)")
        if mirror {
            logger.notice("MB \(j, privacy: .public) \(event, privacy: .public) \(n) \(p, privacy: .public) t=\(t)")
        }
        if MarkerCore.driverVisible.contains(event) {
            notify_post("\(MarkerCore.subsystem).\(event)")
        }
        if full {
            flush()
            mark("flush", "reason=buffer")
        }
    }

    func count(_ event: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return ordinals[event] ?? 0
    }

    /// Writes the buffered markers to `Library/Caches/mobilebench/markers-<journeyId>.jsonl` (append).
    @discardableResult
    func flush() -> Int {
        lock.lock()
        let entries = buffer
        buffer.removeAll(keepingCapacity: true)
        let j = journey
        lock.unlock()
        guard !entries.isEmpty else { return 0 }
        var text = ""
        for e in entries {
            text += "{\"e\":\"\(e.event)\",\"n\":\(e.n),\"t\":\(e.t),\"p\":\"\(e.payload)\"}\n"
        }
        let fm = FileManager.default
        guard let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first else { return 0 }
        let dir = caches.appendingPathComponent("mobilebench", isDirectory: true)
        let file = dir.appendingPathComponent("markers-\(j).jsonl")
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
        return entries.count
    }

    /// Payload rule of design §6.2: at most 64 printable ASCII characters, no `|`, no spaces (and no JSON quoting).
    static func sanitize(_ payload: String) -> String {
        var out = ""
        for u in payload.unicodeScalars {
            if out.count >= 64 { break }
            if u.value >= 0x21, u.value <= 0x7E, u != "|", u != "\"", u != "\\" { out.unicodeScalars.append(u) }
        }
        return out.isEmpty ? "-" : out
    }

    static func validEvent(_ e: String) -> Bool {
        (1...24).contains(e.count)
            && e.unicodeScalars.allSatisfy { ($0 >= "a" && $0 <= "z") || ($0 >= "0" && $0 <= "9") || $0 == "." }
    }
}

/// Candidate-local stand-in for the core iOS BenchKit (design §6.2, §6.3), derived from the `native` candidate's copy
/// and shared by every island candidate: one marker core per process. Island runtimes report markers and draw probes
/// through `IslandBenchApi` (Swift) or `MBHostBench` (Objective-C), or through host messages (`IslandHub`).
@MainActor
enum BenchKit {
    private(set) static var config = LaunchConfig()
    weak static var listener: BenchKitListener?
    static var stateProvider: () -> (selected: Int, seq: Int, revision: Int) = { (0, 0, 0) }
    private static var started = false

    static func nowNs() -> UInt64 {
        MarkerCore.nowNs()
    }

    /// First BenchKit call of the process: launch configuration, `proc.anchor`, `a11y`, lifecycle observers.
    static func start(arguments: [String], remoteCapable: Bool) {
        guard !started else { return }
        started = true
        config = LaunchConfig.parse(arguments: arguments, remoteCapable: remoteCapable)
        MarkerCore.shared.configure(
            journey: config.journey, mirrorAll: config.markerMirror == "all", launchJSON: launchConfigJSON())
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
        MarkerCore.shared.mark(event, payload)
    }

    static func err(_ code: String) {
        mark("err", "code=\(code)")
    }

    static func flush() {
        MarkerCore.shared.flush()
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

    /// The `mb.*` launch arguments as one JSON object of strings (for island runtimes).
    static func launchConfigJSON() -> String {
        let data = (try? JSONSerialization.data(withJSONObject: config.raw, options: [.sortedKeys])) ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
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
        MarkerCore.shared.fgSeq = fgSeq
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
    /// Called after the top route or the foreground sequence changed (the island hub sends the new token).
    static var onTokenChanged: (() -> Void)?

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
        onTokenChanged?()
    }

    /// Token an island screen root must draw to report its current state (`restore:`, `fg:` or `nav:`).
    static func token(for route: String) -> String {
        if let pr = pendingRestore, pr.route == route { return "restore:\(route):\(pr.anchor)" }
        if fgSeq != lastResumeFg { return "fg:\(fgSeq)" }
        return "nav:\(navSeq)"
    }

    /// Root probe of a native screen.
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

    /// Root probe of an island screen, drawn by the island runtime with the token the host gave it. A token for an
    /// older state (another route, an older navSeq or fgSeq) is ignored.
    static func tokenDrawn(route: String, token: String) {
        guard route == topRoute else { return }
        if token.hasPrefix("nav:") {
            guard let n = Int(token.dropFirst(4)), n == navSeq, n != lastScreenNav else { return }
            lastScreenNav = n
            mark("screen", "r=\(route);nav=\(n)")
        } else if token.hasPrefix("fg:") {
            guard let n = Int(token.dropFirst(3)), n == fgSeq, n != lastResumeFg else { return }
            lastResumeFg = n
            mark("resume", "r=\(route);fg=\(n)")
            DispatchQueue.main.async { MainActor.assumeIsolated { listener?.benchResumeDrawn() } }
        } else if token.hasPrefix("restore:"), let pr = pendingRestore, pr.route == route,
            token == "restore:\(pr.route):\(pr.anchor)"
        {
            // Same order as a native screen's first draw: `screen` for the initial navSeq, then `restore`.
            if navSeq != lastScreenNav {
                lastScreenNav = navSeq
                mark("screen", "r=\(route);nav=\(navSeq)")
            }
            pendingRestore = nil
            mark("restore", "r=\(route);a=\(pr.anchor)")
            DispatchQueue.main.async { MainActor.assumeIsolated { listener?.benchRestoreDrawn() } }
        }
    }

    /// Route of the Detail island on screen (`detail/<i>`), set by the island hub.
    static var currentDetailRoute: String?

    /// Island draw probe (main thread). Kinds: `screen` (index 2 = detail, 3 = insights; token `nav:` / `fg:` /
    /// `restore:`) and `insights` (token `ready:<version>:<open>`).
    static func islandProbeDrawn(kind: String, index: Int, token: String) {
        if kind == "screen" {
            if index == 2, let route = currentDetailRoute {
                tokenDrawn(route: route, token: token)
            } else if index == 3 {
                tokenDrawn(route: "insights", token: token)
            }
        } else if kind == "insights" {
            insightsReady(token: token)
        }
    }

    // MARK: Insights (design §8.10)

    private static var insightsReadyToken: String?

    static func insightsRequested() {
        mark("remote.request")
    }

    static func insightsSource(_ src: String) {
        mark("remote.source", "src=\(src)")
    }

    static func insightsReady(token: String) {
        guard token.hasPrefix("ready:"), token != insightsReadyToken else { return }
        insightsReadyToken = token
        let parts = token.split(separator: ":", omittingEmptySubsequences: false)
        mark("remote.ready", "v=\(parts.count > 1 ? String(parts[1]) : "")")
    }

    // MARK: checkpoints (design §6.6)

    static func publishState(k: Int, seq: Int, digest: String, received: Int, applied: Int, dup: Int, gap: Int, rows: Int) {
        mark("state", "k=\(k);s=\(seq);d=\(digest.prefix(16))")
        mark("ctr", "r=\(received);a=\(applied);dup=\(dup);gap=\(gap);rows=\(rows)")
        memoryCheckpoint()
        flush()
    }
}

/// Synchronous marker API for Swift island embeddings. `mark`, `nowNs`, `count` are thread-safe; `probeDrawn` hops
/// to the main thread when needed.
enum IslandBenchApi {
    static func mark(_ event: String, _ payload: String) {
        if MarkerCore.validEvent(event) {
            MarkerCore.shared.mark(event, payload)
        } else {
            MarkerCore.shared.mark("err", "code=unexpected-exception")
        }
    }

    static func probeDrawn(kind: String, index: Int, token: String) {
        if Thread.isMainThread {
            MainActor.assumeIsolated { BenchKit.islandProbeDrawn(kind: kind, index: index, token: token) }
        } else {
            DispatchQueue.main.async {
                MainActor.assumeIsolated { BenchKit.islandProbeDrawn(kind: kind, index: index, token: token) }
            }
        }
    }
}

/// Objective-C view of the marker API, for island runtimes written in Objective-C(++) (the React Native forwarder
/// module calls it by name through the Objective-C runtime, so it needs no compile-time dependency on the host).
@objc(MBHostBench)
final class MBHostBench: NSObject {
    @objc static func mark(_ event: String, payload: String) -> UInt64 {
        let t = MarkerCore.nowNs()
        IslandBenchApi.mark(event, payload)
        return t
    }

    @objc static func nowNs() -> UInt64 {
        MarkerCore.nowNs()
    }

    @objc static func count(_ event: String) -> Int {
        MarkerCore.shared.count(event)
    }

    @objc static func probeDrawn(_ kind: String, index: Int, token: String) {
        IslandBenchApi.probeDrawn(kind: kind, index: index, token: token)
    }

    @objc static func flush() -> Int {
        MarkerCore.shared.flush()
    }

    @objc static func launchConfigJSON() -> String {
        MarkerCore.shared.launchJSON
    }

    @objc static func fgSeq() -> Int {
        MarkerCore.shared.fgSeq
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
