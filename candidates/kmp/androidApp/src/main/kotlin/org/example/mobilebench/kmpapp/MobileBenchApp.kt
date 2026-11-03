package org.example.mobilebench.kmpapp

import android.app.Application

class MobileBenchApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AndroidRuntime.install(this)
    }
}
