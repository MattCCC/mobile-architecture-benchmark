package org.example.mobilebench.islandhost.stream

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import java.io.BufferedReader
import java.io.InputStream
import java.io.InputStreamReader
import org.example.mobilebench.islandhost.domain.StreamFrame
import org.example.mobilebench.islandhost.domain.StreamProtocolException

/**
 * In-app replay of the bundled update stream (`assets/fixtures/stream-<profile>.jsonl`, the first 10 000 wire
 * frames of the profile, verified against golden.json at build time).
 *
 * Schedule (design §7.5): message k is due at t0 + (k - from0) / rate on the monotonic
 * `SystemClock.elapsedRealtime()` clock, where t0 and from0 are taken at the first [open] of this source (one
 * session per process start or session reset). A later [open] continues the same schedule, so messages that
 * became due while closed are delivered at once (catch-up), as the local server does for a reconnect. After the
 * last bundled message the source sends an End frame.
 *
 * Reading and parsing run on a background thread; frames are posted to the main thread.
 */
class ReplaySource(
    private val openStream: () -> InputStream,
    private val ratePerSecond: Int,
) : UpdateSource {
    private val thread = HandlerThread("mb-replay").apply { start() }
    private val worker = Handler(thread.looper)
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var generation = 0
    private var sink: UpdateSource.Sink? = null

    // Worker-thread state.
    private var reader: BufferedReader? = null
    private var pending: StreamFrame.Update? = null
    private var lastSeq = 0
    private var eof = false
    private var t0Ms = -1L
    private var from0 = 1
    private var endSent = false

    override fun open(from: Int, sink: UpdateSource.Sink) {
        this.sink = sink
        val gen = ++generation
        worker.post { startOnWorker(gen, from) }
    }

    override fun close() {
        generation++
        sink = null
        worker.removeCallbacksAndMessages(null)
    }

    override fun dispose() {
        close()
        worker.post {
            reader?.close()
            reader = null
        }
        thread.quitSafely()
    }

    private fun startOnWorker(gen: Int, from: Int) {
        try {
            // The reader only moves forward, and a frame posted to the main thread just before a close() is
            // dropped there. If the next unread frame is already past `from`, start over from the beginning of
            // the file and skip to `from` (a reconnect must deliver from lastApplied + 1, design §7.5).
            val next = pending?.seq ?: (lastSeq + 1)
            if (reader != null && next > from) {
                reader?.close()
                reader = null
                pending = null
                lastSeq = 0
                eof = false
                endSent = false
            }
            if (reader == null) {
                reader = BufferedReader(InputStreamReader(openStream(), Charsets.UTF_8), 64 * 1024)
            }
            if (t0Ms < 0) {
                t0Ms = SystemClock.elapsedRealtime()
                from0 = from
            }
            // Skip frames already applied (seq < from).
            while (true) {
                val p = pending ?: readNext() ?: break
                if (p.seq >= from) break
                pending = null
            }
            deliver(gen, StreamFrame.Hello(from))
            pump(gen)
        } catch (e: StreamProtocolException) {
            deliverError(gen, "stream-protocol")
        } catch (e: java.io.IOException) {
            deliverError(gen, "unexpected-exception")
        }
    }

    private fun readNext(): StreamFrame.Update? {
        if (eof) return null
        val line = reader?.readLine()
        if (line == null) {
            eof = true
            return null
        }
        val frame = StreamFrame.parse(line) as? StreamFrame.Update
            ?: throw StreamProtocolException("bundled stream contains a non-update frame")
        pending = frame
        lastSeq = frame.seq
        return frame
    }

    private fun dueMs(seq: Int): Long = t0Ms + (seq - from0).toLong() * 1000L / ratePerSecond

    private fun pump(gen: Int) {
        if (gen != generation) return
        try {
            val now = SystemClock.elapsedRealtime()
            while (true) {
                val p = pending ?: readNext()
                if (p == null) {
                    if (!endSent) {
                        endSent = true
                        deliver(gen, StreamFrame.End(lastSeq))
                    }
                    return
                }
                val due = dueMs(p.seq)
                if (due > now) {
                    worker.postDelayed({ pump(gen) }, due - now)
                    return
                }
                pending = null
                deliver(gen, p)
            }
        } catch (e: StreamProtocolException) {
            deliverError(gen, "stream-protocol")
        } catch (e: java.io.IOException) {
            deliverError(gen, "unexpected-exception")
        }
    }

    private fun deliver(gen: Int, frame: StreamFrame) {
        main.post {
            if (gen == generation) sink?.onFrame(frame)
        }
    }

    private fun deliverError(gen: Int, code: String) {
        main.post {
            if (gen == generation) sink?.onError(code)
        }
    }
}
