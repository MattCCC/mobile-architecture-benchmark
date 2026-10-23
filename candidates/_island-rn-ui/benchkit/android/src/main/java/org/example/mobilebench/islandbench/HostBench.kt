package org.example.mobilebench.islandbench

/**
 * The island host's marker core, as seen by the React Native island runtime. The host embedding installs the sink
 * before the runtime starts; until then (or in a host without a sink) every call is a no-op, so the island bundle also
 * runs in the RN development harness.
 */
interface HostBenchSink {
    fun mark(event: String, payload: String)

    fun nowNs(): Long

    fun count(event: String): Int

    fun launchConfigJson(): String

    fun fgSeq(): Int

    /** Draw probe of an island view; called on the main thread from `onDraw`. */
    fun probeDrawn(kind: String, index: Int, token: String)
}

object HostBench {
    @Volatile
    var sink: HostBenchSink? = null
}
