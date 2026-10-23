package org.example.mobilebench.islandhost

import android.app.Application
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import org.example.mobilebench.islandhost.bench.BenchKit
import org.example.mobilebench.islandhost.ui.AppRoot
import org.example.mobilebench.islandhost.ui.ErrorScreen

class MobileBenchApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppRuntime.install(this)
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // super.onCreate dispatches onActivityCreated to BenchKit, which parses the launch configuration and
        // lets AppRuntime create (or reset) the session before the UI is composed.
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        if (BenchKit.config.journeyMode) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        val store = AppRuntime.store
        val fatal = AppRuntime.fatalError
        setContent {
            if (fatal != null || store == null) {
                ErrorScreen(fatal ?: "unexpected-exception")
            } else {
                AppRoot(store)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        AppRuntime.embedding.onActivityResumed(this)
    }

    override fun onPause() {
        AppRuntime.embedding.onActivityPaused(this)
        super.onPause()
    }

    override fun onDestroy() {
        AppRuntime.embedding.onActivityDestroyed(this)
        super.onDestroy()
    }
}
