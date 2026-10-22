package org.example.mobilebench.flutter

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Plain FlutterActivity (default engine, SurfaceView render mode) with two small additions:
 *
 * 1. Launch configuration: every Intent extra whose key starts with "mb." is forwarded to the Dart
 *    entry point as "-mb.<key> <value>", the same form the iOS launch arguments use. The app's
 *    private files directory and whether the platform passed saved instance state are forwarded as
 *    internal arguments, so Dart needs no plugin to read them.
 * 2. A method channel that lets the app call Activity.reportFullyDrawn() at the first usable UI.
 */
class MainActivity : FlutterActivity() {
    private var launchedWithSavedState = false

    override fun onCreate(savedInstanceState: Bundle?) {
        launchedWithSavedState = savedInstanceState != null
        super.onCreate(savedInstanceState)
        // Launch key mb.journeyMode=1: keep the screen awake during benchmark journeys.
        if (intent?.getStringExtra("mb.journeyMode") == "1") {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    override fun getDartEntrypointArgs(): List<String> {
        val args = mutableListOf<String>()
        val extras = intent?.extras
        if (extras != null) {
            extras.keySet().filter { it.startsWith("mb.") }.sorted().forEach { key ->
                args += "-$key"
                args += extraAsString(extras, key)
            }
        }
        args += "--mb-internal-files-dir=${filesDir.absolutePath}"
        args += "--mb-internal-saved-state=${if (launchedWithSavedState) 1 else 0}"
        return args
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "fullyDrawn" -> {
                    reportFullyDrawn()
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun extraAsString(extras: Bundle, key: String): String {
        extras.getString(key)?.let { return it }
        @Suppress("DEPRECATION")
        return extras.get(key)?.toString() ?: ""
    }

    private companion object {
        const val CHANNEL = "org.example.mobilebench/benchkit"
    }
}
