package org.example.mobilebench.kmpapp.stream

import kotlinx.coroutines.*
import org.example.mobilebench.kmpapp.*
import org.example.mobilebench.kmpapp.bench.BenchKit
import org.example.mobilebench.kmpapp.domain.*

enum class StreamStatus(val word: String) {
    CONNECTING("Connecting"), LIVE("Live"), PAUSED("Paused"), STALE("Stale"), DISCONNECTED("Disconnected"), ENDED("Ended")
}

/** Shared replay with an absolute monotonic schedule; background reads and main-thread state delivery. */
class StreamController(private val store: AppStore, private val host: HostServices, private val checkpoint: (Int) -> Unit) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var replay: Job? = null
    private var watchdog: Job? = null
    private var retry: Job? = null
    private var quiet: Job? = null
    private var open = false
    private var ended = false
    private var paused = false
    private var attempt = 0
    private var backoff = 0
    private var live = false
    private var stale = false
    private var lastFrame = 0L
    private var t0 = -1L
    private var from0 = 1
    private val rate = mapOf("small" to 5, "representative" to 20, "stress" to 100).getValue(store.model.profile)

    fun connect() {
        retry?.cancel()
        if (open || ended) return
        open = true
        paused = false
        live = false
        stale = false
        lastFrame = host.nowNanos()
        val from = store.model.lastAppliedSeq + 1
        if (t0 < 0) { t0 = lastFrame; from0 = from }
        BenchKit.mark("stream.connect", "a=${++attempt}")
        store.status = StreamStatus.CONNECTING
        replay = scope.launch(Dispatchers.Default) {
            var reader: ReplayReader? = null
            try {
                reader = host.replay("stream-${store.model.profile}.jsonl")
                withContext(Dispatchers.Main) { frame(StreamFrame.Hello(from)) }
                var last = from - 1
                while (isActive) {
                    val line = reader.next() ?: break
                    val update = StreamFrame.parse(line) as? StreamFrame.Update
                        ?: throw StreamProtocolException("non-update replay frame")
                    if (update.seq < from) continue
                    val due = t0 + (update.seq - from0).toLong() * 1_000_000_000L / rate
                    val remaining = due - host.nowNanos()
                    if (remaining > 0) delay((remaining + 999_999) / 1_000_000)
                    ensureActive()
                    withContext(Dispatchers.Main) { frame(update) }
                    last = update.seq
                }
                ensureActive()
                withContext(Dispatchers.Main) { frame(StreamFrame.End(last)) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    BenchKit.err(if (e is StreamProtocolException) "stream-protocol" else "unexpected-exception")
                    reconnect("error")
                }
            } finally { reader?.close() }
        }
        watch()
    }
    private fun watch() {
        watchdog?.cancel()
        watchdog = scope.launch {
            while (open && !paused && !ended) {
                delay(500)
                val idle = (host.nowNanos() - lastFrame) / 1_000_000
                if (idle >= 3000) { reconnect("stale"); break }
                if (idle >= 2000 && !stale) {
                    stale = true; store.status = StreamStatus.STALE; BenchKit.mark("stream.stale")
                }
            }
        }
    }
    fun close(why: String) {
        retry?.cancel(); replay?.cancel(); watchdog?.cancel()
        if (!open) return
        open = false
        BenchKit.mark("stream.closed", "why=$why")
        if (!ended) store.status = StreamStatus.DISCONNECTED
    }
    fun dispose() { close("dispose"); scope.cancel() }
    private fun reconnect(why: String) {
        close(why)
        val wait = longArrayOf(250, 500, 1000, 2000)[minOf(backoff++, 3)]
        retry = scope.launch { delay(wait); connect() }
    }
    private fun scheduleCheckpoint(k: Int) {
        quiet?.cancel()
        quiet = scope.launch { delay(500); checkpoint(k) }
    }
    private fun frame(f: StreamFrame) {
        if (!open) return
        lastFrame = host.nowNanos()
        when (f) {
            is StreamFrame.Hello -> { BenchKit.mark("stream.open", "from=${f.from}"); store.status = StreamStatus.LIVE }
            is StreamFrame.Update -> when (store.offer(f)) {
                StateModel.Offer.APPLIED -> {
                    if (!live) { live = true; backoff = 0; BenchKit.mark("stream.live", "s=${f.seq}") }
                    if (stale) { stale = false; store.status = StreamStatus.LIVE }
                }
                StateModel.Offer.DUPLICATE -> Unit
                StateModel.Offer.GAP -> { BenchKit.err("stream-gap"); reconnect("gap") }
            }
            is StreamFrame.End -> { ended = true; paused = false; watchdog?.cancel(); store.status = StreamStatus.ENDED; scheduleCheckpoint(0) }
            is StreamFrame.Checkpoint -> { paused = true; watchdog?.cancel(); store.status = StreamStatus.PAUSED; scheduleCheckpoint(f.k) }
            is StreamFrame.Resume -> { paused = false; store.status = StreamStatus.LIVE; watch() }
        }
    }
}
