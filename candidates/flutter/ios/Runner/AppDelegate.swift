import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    // Launch argument `-mb.journeyMode 1`: keep the screen awake during benchmark journeys.
    let args = ProcessInfo.processInfo.arguments
    if let at = args.firstIndex(of: "-mb.journeyMode"), at + 1 < args.count, args[at + 1] == "1" {
      application.isIdleTimerDisabled = true
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}

/// Payloads of the native-sourced iOS markers, called from Dart through FFI (lib/benchkit/backend_ffi.dart):
/// `proc.anchor` = `ws=<wall µs>;ps=<process start wall µs>`, `mem` = `fp=<phys_footprint>;pk=<peak>`
/// (task_vm_info). Writes at most `capacity` bytes into `out` and returns the length, 0 when unavailable.
@_cdecl("mb_marker_payload")
public func mbMarkerPayload(_ event: UnsafePointer<CChar>, _ out: UnsafeMutablePointer<CChar>, _ capacity: Int32) -> Int32 {
  let text: String
  switch String(cString: event) {
  case "proc.anchor":
    var now = timeval()
    gettimeofday(&now, nil)
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    var ps: Int64 = -1
    if sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 {
      let st = info.kp_proc.p_un.__p_starttime
      ps = Int64(st.tv_sec) * 1_000_000 + Int64(st.tv_usec)
    }
    text = "ws=\(Int64(now.tv_sec) * 1_000_000 + Int64(now.tv_usec));ps=\(ps)"
  case "mem":
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard kr == KERN_SUCCESS else { return 0 }
    text = "fp=\(info.phys_footprint);pk=\(info.ledger_phys_footprint_peak)"
  default:
    return 0
  }
  let bytes = Array(text.utf8.prefix(Int(capacity)))
  bytes.withUnsafeBufferPointer { buf in
    buf.baseAddress!.withMemoryRebound(to: CChar.self, capacity: bytes.count) { out.update(from: $0, count: bytes.count) }
  }
  return Int32(bytes.count)
}
