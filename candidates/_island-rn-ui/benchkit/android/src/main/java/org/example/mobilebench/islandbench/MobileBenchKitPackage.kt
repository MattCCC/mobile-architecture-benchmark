package org.example.mobilebench.islandbench

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager

/** Autolinked package: the `MobileBenchKit` TurboModule and the `MobileBenchProbe` view manager (island variant). */
class MobileBenchKitPackage : BaseReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == MobileBenchKitModule.NAME) MobileBenchKitModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            MobileBenchKitModule.NAME to ReactModuleInfo(
                name = MobileBenchKitModule.NAME,
                className = MobileBenchKitModule.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = true,
            ),
        )
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        listOf(MobileBenchProbeManager())
}
