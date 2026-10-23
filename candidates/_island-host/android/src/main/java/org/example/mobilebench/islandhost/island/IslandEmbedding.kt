package org.example.mobilebench.islandhost.island

import android.app.Application
import android.view.View
import androidx.activity.ComponentActivity

/** The two island screens (decision 38): the item Detail screen and the Insights feature. */
enum class IslandKind(val wire: String, val module: String) {
    DETAIL("detail", "MBDetailIsland"),
    INSIGHTS("insights", "MBInsightsIsland"),
}

/** Where the Insights island code came from for one open (design §8.10). */
class IslandSource(val src: String, val version: String)

/**
 * One embedded UI runtime (React Native, Flutter, WebView, ...). Each island candidate provides exactly one
 * implementation through `EmbeddingProvider.create()` in its own sources; the host code is identical for all of
 * them. Every call happens on the main thread.
 *
 * Messages in both directions are JSON object texts of the island protocol (see `IslandHub`), the same for every
 * runtime. Runtimes that can call native code synchronously report markers and draw probes through
 * `bench.IslandBenchApi`; the others send `mark` / `probe` messages to [IslandHost.onIslandMessage].
 */
interface IslandEmbedding {
    /** Short runtime name for diagnostics (`rn`, `webview`, `flutter`, ...). */
    val name: String

    /** True when the island code can be loaded from the local server (`mb.remote=remote`). */
    val remoteCapable: Boolean get() = false

    /** Application.onCreate: one-time setup that must not start the runtime (the launch keys are not known yet). */
    fun onAppCreate(app: Application, host: IslandHost) {}

    /** First main activity of the process: `mb.engine=prewarm` starts the runtime here. */
    fun prewarm(activity: ComponentActivity) {}

    /** Source of the Insights island code for the next open. */
    fun insightsSource(): IslandSource = IslandSource("embedded", "1")

    /** Creates the view that renders one island instance; [initJson] is its `init` message. */
    fun createView(activity: ComponentActivity, sid: Int, kind: IslandKind, initJson: String): View

    /** Delivers one host message to the island instance [sid] shown in [view]. */
    fun send(view: View, sid: Int, message: String)

    /** The view left the screen for good: stop the island instance and release its resources. */
    fun release(view: View, sid: Int)

    fun onActivityResumed(activity: ComponentActivity) {}

    fun onActivityPaused(activity: ComponentActivity) {}

    fun onActivityDestroyed(activity: ComponentActivity) {}
}

/** Host services for embeddings. */
interface IslandHost {
    /** Island-to-host message of island instance [sid] (any thread; delivered to the main thread). */
    fun onIslandMessage(sid: Int, message: String)
}
