package org.example.mobilebench.islandhost.island

import android.app.Activity
import android.app.Application
import android.os.Handler
import android.os.Message
import android.view.View
import androidx.activity.ComponentActivity
import com.tns.RuntimeHelper

object EmbeddingProvider {
    fun create(): IslandEmbedding = NativeScriptIslandEmbedding()
}

/**
 * The surface the NativeScript island bundle (app/bridge.android.ts) sees. JavaScript calls these members
 * synchronously on the main thread, and registers one [Handler.Callback] through which the host drives it:
 * `what` = operation, `arg1` = island instance id, `obj` = JSON message text (for [OP_CREATE] the callback replaces
 * `obj` with the island's root view).
 */
object NsIslands {
    const val OP_CREATE = 1
    const val OP_SEND = 2
    const val OP_RELEASE = 3

    @JvmStatic
    lateinit var application: Application
        internal set

    internal lateinit var host: IslandHost
    internal var runtime: Handler.Callback? = null

    /** Activity that hosts the island being created (the context of its views). */
    @JvmStatic
    var activity: Activity? = null
        internal set

    @JvmStatic
    fun register(callback: Handler.Callback) {
        runtime = callback
    }

    /** Island-to-host message (`ready`; markers and probes use `bench.IslandBenchApi` directly). */
    @JvmStatic
    fun toHost(sid: Int, message: String) = host.onIslandMessage(sid, message)
}

private class NativeScriptIslandEmbedding : IslandEmbedding {
    override val name = "nativescript"
    override val remoteCapable = false

    override fun onAppCreate(app: Application, host: IslandHost) {
        NsIslands.application = app
        NsIslands.host = host
    }

    override fun prewarm(activity: ComponentActivity) {
        ensureRuntime()
    }

    /** Starts V8 and runs the island bundle, which registers its callback before `run()` returns. */
    private fun ensureRuntime(): Handler.Callback {
        NsIslands.runtime?.let { return it }
        val runtime = checkNotNull(RuntimeHelper.initRuntime(NsIslands.application)) { "NativeScript runtime not initialized" }
        runtime.run()
        return checkNotNull(NsIslands.runtime) { "NativeScript island bundle did not register" }
    }

    override fun insightsSource(): IslandSource = IslandSource("embedded", "1")

    override fun createView(activity: ComponentActivity, sid: Int, kind: IslandKind, initJson: String): View {
        val runtime = ensureRuntime()
        NsIslands.activity = activity
        val message = Message.obtain(null, NsIslands.OP_CREATE, sid, 0, initJson)
        runtime.handleMessage(message)
        return message.obj as View
    }

    override fun send(view: View, sid: Int, message: String) {
        NsIslands.runtime?.handleMessage(Message.obtain(null, NsIslands.OP_SEND, sid, 0, message))
    }

    override fun release(view: View, sid: Int) {
        NsIslands.runtime?.handleMessage(Message.obtain(null, NsIslands.OP_RELEASE, sid, 0, null))
    }

    override fun onActivityDestroyed(activity: ComponentActivity) {
        if (NsIslands.activity === activity) NsIslands.activity = null
    }
}
