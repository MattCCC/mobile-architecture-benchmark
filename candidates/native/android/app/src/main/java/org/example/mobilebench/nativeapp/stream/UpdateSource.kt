package org.example.mobilebench.nativeapp.stream

import org.example.mobilebench.nativeapp.domain.StreamFrame

/**
 * Data-source seam for the update stream. The default implementation replays the bundled fixture stream
 * in-app ([ReplaySource]); a WebSocket client for the local server (design §7.5, §15) implements the same
 * interface. Every callback is delivered on the main thread.
 */
interface UpdateSource {
    /** Opens the stream at [from] (lastApplied + 1). Delivers [Sink.onFrame] with a Hello frame first. */
    fun open(from: Int, sink: Sink)

    /** Closes the stream; no callback is delivered afterwards until the next [open]. */
    fun close()

    /** Releases threads and files for good. */
    fun dispose()

    interface Sink {
        fun onFrame(frame: StreamFrame)
        fun onClosed(reason: String)
        fun onError(code: String)
    }
}
