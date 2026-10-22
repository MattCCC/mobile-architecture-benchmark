package org.example.mobilebench.nativeapp.stream

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.example.mobilebench.nativeapp.AppStore
import org.example.mobilebench.nativeapp.bench.BenchKit
import org.example.mobilebench.nativeapp.domain.StateModel
import org.example.mobilebench.nativeapp.domain.StreamFrame

enum class StreamStatus(val word: String) {
    CONNECTING("Connecting"),
    LIVE("Live"),
    PAUSED("Paused"),
    STALE("Stale"),
    DISCONNECTED("Disconnected"),
    ENDED("Ended"),
}

/**
 * Stream client rules (design §7.5): seq order, duplicates ignored, gap -> reconnect from lastApplied + 1,
 * 2 s without a message -> Stale, 3 s -> reconnect, deterministic back-off; timers suspended after `c` and `e`.
 * Checkpoints after `c` / `e` + 500 ms without updates (design §6.6). Main thread only.
 */
class StreamController(
    private val store: AppStore,
    private val source: UpdateSource,
    private val onCheckpoint: (k: Int) -> Unit,
) : UpdateSource.Sink {
    private val main = Handler(Looper.getMainLooper())
    private var open = false
    private var ended = false
    private var paused = false
    private var attempt = 0
    private var liveMarked = false
    private var staleMarked = false
    private var lastFrameAt = 0L
    private var backoffIndex = 0
    private var pendingCheckpointK = -1

    private val watchdog = object : Runnable {
        override fun run() {
            if (!open || paused || ended) return
            val idle = SystemClock.elapsedRealtime() - lastFrameAt
            if (idle >= RECONNECT_AFTER_MS) {
                reconnect("stale")
                return
            }
            if (idle >= STALE_AFTER_MS && !staleMarked) {
                staleMarked = true
                store.status = StreamStatus.STALE
                BenchKit.mark("stream.stale")
            }
            main.postDelayed(this, WATCHDOG_MS)
        }
    }
    private val reconnectRunnable = Runnable { connect() }
    private val checkpointRunnable = Runnable {
        val k = pendingCheckpointK
        pendingCheckpointK = -1
        if (k >= 0) onCheckpoint(k)
    }

    val isOpen: Boolean get() = open

    fun connect() {
        main.removeCallbacks(reconnectRunnable)
        if (open || ended) return
        attempt++
        BenchKit.mark("stream.connect", "a=$attempt")
        store.status = StreamStatus.CONNECTING
        open = true
        liveMarked = false
        staleMarked = false
        paused = false
        lastFrameAt = SystemClock.elapsedRealtime()
        source.open(store.model.lastAppliedSeq + 1, this)
        main.postDelayed(watchdog, WATCHDOG_MS)
    }

    fun close(why: String) {
        main.removeCallbacks(reconnectRunnable)
        if (!open) return
        open = false
        source.close()
        main.removeCallbacks(watchdog)
        BenchKit.mark("stream.closed", "why=$why")
        if (!ended) store.status = StreamStatus.DISCONNECTED
    }

    fun dispose() {
        close("dispose")
        main.removeCallbacks(checkpointRunnable)
        source.dispose()
    }

    private fun reconnect(why: String) {
        close(why)
        val delay = BACKOFF_MS[minOf(backoffIndex, BACKOFF_MS.size - 1)]
        backoffIndex++
        main.postDelayed(reconnectRunnable, delay)
    }

    private fun scheduleCheckpoint(k: Int) {
        pendingCheckpointK = k
        main.removeCallbacks(checkpointRunnable)
        main.postDelayed(checkpointRunnable, CHECKPOINT_QUIET_MS)
    }

    override fun onFrame(frame: StreamFrame) {
        if (!open) return
        lastFrameAt = SystemClock.elapsedRealtime()
        when (frame) {
            is StreamFrame.Hello -> {
                BenchKit.mark("stream.open", "from=${frame.from}")
                store.status = StreamStatus.LIVE
            }
            is StreamFrame.Update -> {
                if (pendingCheckpointK >= 0) {
                    // An update arrived after c/e: the 500 ms quiet period starts again.
                    main.removeCallbacks(checkpointRunnable)
                    main.postDelayed(checkpointRunnable, CHECKPOINT_QUIET_MS)
                }
                when (store.offer(frame)) {
                    StateModel.Offer.APPLIED -> {
                        if (!liveMarked) {
                            liveMarked = true
                            // The back-off restarts only after data flows again, so a source that opens and then
                            // fails at once is retried with growing delays.
                            backoffIndex = 0
                            BenchKit.mark("stream.live", "s=${frame.seq}")
                        }
                        if (staleMarked) {
                            staleMarked = false
                            store.status = StreamStatus.LIVE
                        }
                    }
                    StateModel.Offer.DUPLICATE -> Unit
                    StateModel.Offer.GAP -> {
                        BenchKit.err("stream-gap")
                        reconnect("gap")
                    }
                }
            }
            is StreamFrame.End -> {
                ended = true
                paused = false
                main.removeCallbacks(watchdog)
                store.status = StreamStatus.ENDED
                scheduleCheckpoint(0)
            }
            is StreamFrame.Checkpoint -> {
                paused = true
                main.removeCallbacks(watchdog)
                store.status = StreamStatus.PAUSED
                scheduleCheckpoint(frame.k)
            }
            is StreamFrame.Resume -> {
                paused = false
                store.status = StreamStatus.LIVE
                main.removeCallbacks(watchdog)
                main.postDelayed(watchdog, WATCHDOG_MS)
            }
        }
    }

    override fun onClosed(reason: String) {
        if (!open) return
        reconnect(reason)
    }

    override fun onError(code: String) {
        BenchKit.err(code)
        if (open) reconnect("error")
    }

    companion object {
        const val STALE_AFTER_MS = 2_000L
        const val RECONNECT_AFTER_MS = 3_000L
        const val WATCHDOG_MS = 500L
        const val CHECKPOINT_QUIET_MS = 500L
        val BACKOFF_MS = longArrayOf(250, 500, 1_000, 2_000)
    }
}
