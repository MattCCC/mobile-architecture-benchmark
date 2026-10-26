package org.example.mobilebench.islandhost.island

import android.app.Application
import android.os.Bundle
import android.view.View
import androidx.activity.ComponentActivity
import androidx.fragment.app.FragmentActivity
import com.callstack.reactnativebrownfield.OnMessageListener
import com.callstack.reactnativebrownfield.ReactNativeBrownfield
import com.facebook.react.ReactRootView
import org.example.mobilebench.islandbench.HostBench
import org.example.mobilebench.islandbench.HostBenchSink
import org.example.mobilebench.islandhost.bench.IslandBenchApi
import org.example.mobilebench.islandrn.rn.ReactNativeHostManager
import org.json.JSONObject

object EmbeddingProvider {
    fun create(): IslandEmbedding = ReactNativeIslandEmbedding()
}

private class ReactNativeIslandEmbedding : IslandEmbedding {
    override val name = "rn"
    override val remoteCapable = false

    private lateinit var application: Application
    private lateinit var host: IslandHost
    private var initialized = false
    private val listener = OnMessageListener { message ->
        val sid = runCatching { JSONObject(message).optInt("sid", -1) }.getOrDefault(-1)
        if (sid >= 0) host.onIslandMessage(sid, message)
    }

    override fun onAppCreate(app: Application, host: IslandHost) {
        application = app
        this.host = host
        HostBench.sink = object : HostBenchSink {
            override fun mark(event: String, payload: String) = IslandBenchApi.mark(event, payload)
            override fun nowNs(): Long = IslandBenchApi.nowNs()
            override fun count(event: String): Int = IslandBenchApi.count(event)
            override fun launchConfigJson(): String = IslandBenchApi.launchConfigJson()
            override fun fgSeq(): Int = IslandBenchApi.fgSeq()
            override fun probeDrawn(kind: String, index: Int, token: String) =
                IslandBenchApi.probeDrawn(kind, index, token)
        }
    }

    override fun prewarm(activity: ComponentActivity) = ensureRuntime()

    private fun ensureRuntime() {
        if (initialized) return
        ReactNativeHostManager.initialize(application)
        ReactNativeBrownfield.shared.addMessageListener(listener)
        initialized = true
    }

    override fun insightsSource(): IslandSource = IslandSource("embedded", "1")

    override fun createView(
        activity: ComponentActivity,
        sid: Int,
        kind: IslandKind,
        initJson: String,
    ): View {
        ensureRuntime()
        return ReactNativeBrownfield.shared.createView(
            activity as FragmentActivity,
            kind.module,
            launchOptions = Bundle().apply { putString("init", initJson) },
        )
    }

    override fun send(view: View, sid: Int, message: String) {
        ReactNativeBrownfield.shared.postMessage(message)
    }

    override fun release(view: View, sid: Int) {
        (view as? ReactRootView)?.unmountReactApplication()
    }
}
