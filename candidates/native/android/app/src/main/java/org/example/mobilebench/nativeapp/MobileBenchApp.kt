package org.example.mobilebench.nativeapp

import android.app.Application

class MobileBenchApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppRuntime.install(this)
    }
}
