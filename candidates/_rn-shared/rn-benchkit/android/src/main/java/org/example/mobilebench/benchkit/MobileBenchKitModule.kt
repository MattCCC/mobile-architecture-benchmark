package org.example.mobilebench.benchkit

import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/**
 * TurboModule `MobileBenchKit`. Every method except `echoAsync` returns a value, so React Native calls it
 * synchronously on the JS thread (JSI); the timestamp is taken inside the call.
 */
class MobileBenchKitModule(reactContext: ReactApplicationContext) : NativeMobileBenchKitSpec(reactContext) {
  override fun mark(event: String, payload: String): Double = BenchKitCore.mark(event, payload).toDouble()

  override fun nowNs(): Double = SystemClock.elapsedRealtimeNanos().toDouble()

  override fun markerCount(event: String): Double = BenchKitCore.count(event).toDouble()

  override fun launchConfig(): String = BenchKitCore.launchConfigJson()

  override fun fgSeq(): Double = BenchKitCore.fgSeq().toDouble()

  override fun sessionStart(selectedCount: Double): Double {
    BenchKitCore.sessionStart(selectedCount.toInt())
    return 1.0
  }

  override fun selectionChanged(selectedCount: Double): Double =
    BenchKitCore.selectionChanged(selectedCount.toInt()).toDouble()

  override fun navStart(route: String): Double = BenchKitCore.navStart(route).toDouble()

  override fun restoreToken(route: String, anchor: Double): String = BenchKitCore.restoreToken(route, anchor.toInt())

  override fun listLayout(height: Double): Double = BenchKitCore.listHeight(height.toInt()).toDouble()

  override fun publishState(k: Double, seq: Double, digest: String, counters: String): Double {
    BenchKitCore.publishState(k.toInt(), seq.toInt(), digest, counters)
    return 1.0
  }

  // Android memory is read externally by the harness (dumpsys meminfo); no in-app reading.
  override fun memoryCheckpoint(label: String): String = ""

  // Android markers live in the trace; nothing to flush.
  override fun flush(): Double = 0.0

  override fun echo(value: String): String = value

  override fun echoAsync(value: String, promise: Promise) {
    promise.resolve(value)
  }

  companion object {
    const val NAME = NativeMobileBenchKitSpec.NAME
  }
}
