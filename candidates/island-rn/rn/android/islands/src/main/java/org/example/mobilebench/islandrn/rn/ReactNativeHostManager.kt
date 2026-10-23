package org.example.mobilebench.islandrn.rn

import android.app.Application
import com.callstack.reactnativebrownfield.OnJSBundleLoaded
import com.callstack.reactnativebrownfield.ReactNativeBrownfield
import com.facebook.react.PackageList
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

/**
 * Starts the React Native runtime of the islands (brownfield scaffold, adapted): one Hermes runtime for both island
 * components (`MBDetailIsland`, `MBInsightsIsland`), loading the bundle embedded in this AAR. The first call loads
 * the native libraries and starts the host (bundle evaluation runs in the background); later calls are no-ops.
 */
object ReactNativeHostManager {
    @Volatile
    private var started = false

    fun initialize(application: Application, onJSBundleLoaded: OnJSBundleLoaded? = null) {
        started = true
        ReactNativeBrownfield.initialize(application, onJSBundleLoaded) {
            getDefaultReactHost(
                context = application,
                packageList = PackageList(application).packages,
                jsMainModulePath = "index",
                jsBundleAssetPath = "index.android.bundle",
                jsBundleFilePath = null,
                useDevSupport = false,
                jsRuntimeFactory = null,
            )
        }
    }

    val isStarted: Boolean get() = started

    /** The React host; [initialize] must have been called. */
    val reactHost: ReactHost get() = ReactNativeBrownfield.shared.reactHost
}
