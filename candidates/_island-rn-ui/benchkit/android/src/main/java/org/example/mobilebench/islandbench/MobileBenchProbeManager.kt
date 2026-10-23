package org.example.mobilebench.islandbench

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.MobileBenchProbeManagerDelegate
import com.facebook.react.viewmanagers.MobileBenchProbeManagerInterface

@ReactModule(name = MobileBenchProbeManager.NAME)
class MobileBenchProbeManager :
    SimpleViewManager<MobileBenchProbeView>(),
    MobileBenchProbeManagerInterface<MobileBenchProbeView> {
    private val delegate: ViewManagerDelegate<MobileBenchProbeView> = MobileBenchProbeManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<MobileBenchProbeView> = delegate

    override fun getName(): String = NAME

    override fun createViewInstance(context: ThemedReactContext): MobileBenchProbeView = MobileBenchProbeView(context)

    @ReactProp(name = "kind")
    override fun setKind(view: MobileBenchProbeView?, value: String?) {
        view?.kind = value ?: ""
    }

    @ReactProp(name = "index")
    override fun setIndex(view: MobileBenchProbeView?, value: Int) {
        view?.index = value
    }

    @ReactProp(name = "token")
    override fun setToken(view: MobileBenchProbeView?, value: String?) {
        view?.token = value ?: ""
    }

    companion object {
        const val NAME = "MobileBenchProbe"
    }
}
