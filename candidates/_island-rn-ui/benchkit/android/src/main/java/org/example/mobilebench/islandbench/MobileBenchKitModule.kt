package org.example.mobilebench.islandbench

import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/**
 * TurboModule `MobileBenchKit`, island variant: the same spec as candidates/_rn-shared/rn-benchkit, but every call
 * forwards to the island host's marker core (one marker core per process). Session calls (`sessionStart`,
 * `selectionChanged`, `navStart`, `listLayout`, `publishState`) belong to the host's data layer and are no-ops here.
 * Every method except `echoAsync` returns a value, so React Native calls it synchronously on the JS thread (JSI).
 */
class MobileBenchKitModule(reactContext: ReactApplicationContext) : NativeMobileBenchKitSpec(reactContext) {
    private val sink: HostBenchSink? get() = HostBench.sink

    override fun mark(event: String, payload: String): Double {
        val s = sink ?: return 0.0
        val t = s.nowNs()
        s.mark(event, payload)
        return t.toDouble()
    }

    override fun nowNs(): Double = (sink?.nowNs() ?: SystemClock.elapsedRealtimeNanos()).toDouble()

    override fun markerCount(event: String): Double = (sink?.count(event) ?: 0).toDouble()

    override fun launchConfig(): String = sink?.launchConfigJson() ?: "{}"

    override fun fgSeq(): Double = (sink?.fgSeq() ?: 0).toDouble()

    override fun sessionStart(selectedCount: Double): Double = 1.0

    override fun selectionChanged(selectedCount: Double): Double = 0.0

    override fun navStart(route: String): Double = 0.0

    override fun restoreToken(route: String, anchor: Double): String = "restore:$route:${anchor.toInt()}"

    override fun listLayout(height: Double): Double = 0.0

    override fun publishState(k: Double, seq: Double, digest: String, counters: String): Double = 1.0

    // Memory is read by the harness (Android) or at the host's checkpoints (iOS); nothing to do in the island.
    override fun memoryCheckpoint(label: String): String = ""

    override fun flush(): Double = 0.0

    override fun echo(value: String): String = value

    override fun echoAsync(value: String, promise: Promise) {
        promise.resolve(value)
    }

    companion object {
        const val NAME = NativeMobileBenchKitSpec.NAME
    }
}
