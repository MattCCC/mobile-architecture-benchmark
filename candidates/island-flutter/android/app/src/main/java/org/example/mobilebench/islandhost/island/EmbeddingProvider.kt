package org.example.mobilebench.islandhost.island

import android.app.Application
import android.graphics.Color
import android.view.View
import androidx.activity.ComponentActivity
import io.flutter.embedding.android.FlutterView
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject

object EmbeddingProvider {
    fun create(): IslandEmbedding = FlutterIslandEmbedding()
}

private class FlutterIslandEmbedding : IslandEmbedding {
    override val name = "flutter"
    override val remoteCapable = false

    private lateinit var application: Application
    private lateinit var host: IslandHost
    private var engine: FlutterEngine? = null
    private var channel: MethodChannel? = null
    private var runtimeReady = false
    private var activeSid = -1
    private var pendingInit: String? = null

    override fun onAppCreate(app: Application, host: IslandHost) {
        application = app
        this.host = host
    }

    override fun prewarm(activity: ComponentActivity) {
        ensureEngine()
    }

    private fun ensureEngine(): FlutterEngine {
        engine?.let { return it }
        val created = FlutterEngine(application)
        channel = MethodChannel(created.dartExecutor.binaryMessenger, "org.example.mobilebench/islands").apply {
            setMethodCallHandler { call, result ->
                when (call.method) {
                    "islandMessage" -> {
                        val message = call.arguments as? String
                        if (message != null) {
                            val objectValue = runCatching { JSONObject(message) }.getOrNull()
                            if (objectValue?.optString("t") == "runtimeReady") {
                                runtimeReady = true
                                pendingInit?.let { invokeMethod("message", it) }
                            } else {
                                val sid = objectValue?.optInt("sid", -1) ?: -1
                                if (sid >= 0) host.onIslandMessage(sid, message)
                            }
                        }
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        }
        created.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint.createDefault())
        engine = created
        return created
    }

    override fun insightsSource(): IslandSource = IslandSource("embedded", "1")

    override fun createView(
        activity: ComponentActivity,
        sid: Int,
        kind: IslandKind,
        initJson: String,
    ): View {
        val current = ensureEngine()
        activeSid = sid
        pendingInit = initJson
        current.lifecycleChannel.appIsResumed()
        val view = FlutterView(activity).apply {
            setBackgroundColor(Color.WHITE)
            attachToFlutterEngine(current)
        }
        if (runtimeReady) channel?.invokeMethod("message", initJson)
        return view
    }

    override fun send(view: View, sid: Int, message: String) {
        if (sid == activeSid) channel?.invokeMethod("message", message)
    }

    override fun release(view: View, sid: Int) {
        (view as? FlutterView)?.detachFromFlutterEngine()
        if (activeSid == sid) {
            activeSid = -1
            pendingInit = null
        }
    }

    override fun onActivityResumed(activity: ComponentActivity) {
        engine?.lifecycleChannel?.appIsResumed()
    }

    override fun onActivityPaused(activity: ComponentActivity) {
        engine?.lifecycleChannel?.appIsInactive()
    }

    override fun onActivityDestroyed(activity: ComponentActivity) {
        engine?.lifecycleChannel?.appIsDetached()
    }
}
