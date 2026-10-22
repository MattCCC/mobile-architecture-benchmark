package org.example.mobilebench.nativeapp

import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import org.example.mobilebench.nativeapp.bench.BenchKit
import org.example.mobilebench.nativeapp.ui.AppRoot
import org.example.mobilebench.nativeapp.ui.ErrorScreen

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
}
